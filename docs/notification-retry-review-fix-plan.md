# 通知再試行レビュー指摘 修正実装計画書

## 1. 背景

通知の再試行・冪等性・構造化ログを追加するローカル変更のレビューで、次の3点が見つかった。

1. Discordへのメッセージ作成後に応答だけ失われた場合、再試行で二重投稿される可能性がある
2. Discord RESTのタイムアウトや一部のネットワークエラーが恒久エラーへ誤分類され、送信元へ`422 retryable: false`を返す
3. `express.json()`が生成した`413`や`415`などの4xxが、共通エラーハンドラによって`500`へ変換される

本計画では、上記を修正し、同じ不具合を再発させない自動テストを追加する。

## 2. 目的

- Webhookの再試行とdiscord.js内部の再試行によるDiscord二重投稿を抑止する
- タイムアウト、一時的なネットワーク障害、HTTP 408・429・5xxを再試行可能として送信元へ通知する
- 不正または大きすぎるHTTPリクエストを正しい4xxで終了させ、無駄な再試行を発生させない
- 今回確認した境界条件を自動テストで固定する
- 既存の`Idempotency-Key`なし通知との後方互換性を維持する

## 3. 対象範囲

### 変更対象

- `src/services/notificationService.ts`
- `src/services/notificationErrors.ts`
- `src/app.ts`
- 必要に応じて新設する小さなヘルパーまたはミドルウェア
- `package.json`
- `test/`配下の新規テスト
- `README.md`の通知API・エラーレスポンス説明

### 対象外

- Cloud Functions側の再試行ユーティリティ実装
- `IdempotencyStore`の保存形式変更
- Firestoreなど共有ストレージへの移行
- 複数VM・複数botコンテナ構成への対応
- Discordとローカルファイル間の完全なトランザクション保証

## 4. 修正方針

### 4.1 Discord送信にも決定的なnonceを付ける

#### 問題

現在のローカル冪等性ストアは、Discord送信が正常終了した後に`completed`を保存する。Discordがメッセージを作成した後で接続リセットやタイムアウトが起きると、botは送信結果を確定できない。

この場合、次の経路で二重投稿が起こり得る。

1. Discordが1件目のメッセージを作成する
2. Discordからbotへの応答が失われる
3. discord.jsまたはWebhook送信元が同じ処理を再試行する
4. 同じ内容の2件目が作成される

#### 実装

`Idempotency-Key`がある場合、Discordのメッセージ作成オプションへ以下を追加する。

- `nonce`: `Idempotency-Key`から決定的に生成した固定長の値
- `enforceNonce: true`: 同じnonceのメッセージが直近に作成済みなら新規作成しない

nonceは生の`Idempotency-Key`を使用せず、次の形式で生成する。

```text
SHA-256("yagapon-notifier:v1:" + idempotencyKey) の先頭24文字
```

理由は以下のとおり。

- 通知IDや業務IDをDiscordへ露出させない
- Discordのnonce長制約に収まる固定長にする
- 同じキーから常に同じ値を得る
- 実運用上無視できる衝突確率を確保する

実装は、例えば`src/services/discordNonce.ts`へ純粋関数として分離する。

```ts
createDiscordNonce(idempotencyKey: string): string
```

`NotificationService.sendNotificationByType()`では、既存のメッセージに次のように送信オプションを追加する。

```ts
const sendOptions = context.idempotencyKey
  ? {
      ...message,
      nonce: createDiscordNonce(context.idempotencyKey),
      enforceNonce: true,
    }
  : message;
```

`Idempotency-Key`がない通知は、従来どおりnonceなしで送信する。

#### ローカルストアとの役割分担

- ローカル`IdempotencyStore`: Webhookレスポンス消失後の再送、プロセス内の並行リクエスト、数日後までの重複を抑止する
- Discord nonce: Discordメッセージ作成の結果が不明な短時間の再試行を抑止する

Discord nonceの重複判定期間は有限であるため、ローカルストアは引き続き必要である。また、Discord送信成功直後にbotが停止し、ローカル完了履歴が保存されないケースまで完全に保証するものではない。この制約はREADMEへ明記する。

### 4.2 一時エラー判定で原因チェーンを調べる

#### 問題

現在の`toNotificationError()`はトップレベルの`status`と`code`だけを確認している。そのため、次のエラーが恒久エラーになる。

- `name === "AbortError"`のタイムアウト
- `status === 408`
- `cause.code === "UND_ERR_SOCKET"`のように原因側へコードを持つエラー
- `statusCode`のみを持つHTTPエラー
- discord.jsの`RateLimitError`のように名前と`retryAfter`を持つエラー

#### 実装

エラーと`cause`を安全にたどるヘルパーを追加する。

- 循環参照を`Set`で防止する
- 深さに上限を設ける（例: 8階層）
- 各階層から`name`、`code`、`status`、`statusCode`、`retryAfter`、`retry_after`を取得する
- 値をログへそのまま展開せず、分類に必要なスカラー値だけを扱う

一時エラー条件を次のようにする。

| 種別 | 一時エラーとして扱う値 |
| --- | --- |
| HTTP | `408`、`429`、`500`〜`599` |
| エラー名 | `AbortError`、`TimeoutError`、`RateLimitError` |
| Node.js | `ECONNABORTED`、`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`EAI_AGAIN`、`ENETUNREACH`、`EHOSTUNREACH`、`EPIPE` |
| Undici | `UND_ERR_CONNECT_TIMEOUT`、`UND_ERR_HEADERS_TIMEOUT`、`UND_ERR_BODY_TIMEOUT`、`UND_ERR_SOCKET` |

以下は恒久エラーのままとする。

- HTTP `400`、`401`、`403`、`404`、`422`
- Discordの権限不足、存在しないチャンネル、無効なメッセージ形式
- 分類根拠を持たないメッセージ構築エラー

#### Retry-After

- discord.jsの`retryAfter`はミリ秒として秒へ切り上げる
- API本文由来の`retry_after`は秒として扱う
- 取得できない場合は現在と同じ5秒を使用する
- 0以下や非数値は無視する

`NotificationTransientError`は既存どおり`/notify`で`503`と`Retry-After`へ変換する。

### 4.3 Express/body-parserの4xxを維持する

#### 問題

現在の共通エラーハンドラは、`entity.parse.failed`以外をすべて`500`で返す。`express.json()`のデフォルト上限を超えるJSONは内部で`413`になるが、クライアントには`500`が返るため再試行対象になってしまう。

#### 実装

インラインのエラーハンドラを、必要に応じて`src/middlewares/httpErrorHandler.ts`へ分離する。

レスポンス規則は次のとおり。

| エラー | HTTP | レスポンスの`error` | `retryable` |
| --- | ---: | --- | --- |
| 不正JSON (`entity.parse.failed`) | 400 | `Invalid JSON` | `false` |
| サイズ超過 (`entity.too.large`) | 413 | `Payload too large` | `false` |
| 未対応エンコーディング | 415 | `Unsupported content encoding` | `false` |
| その他のbody-parser 4xx | 元の4xx | `Invalid request body` | `false` |
| 予期しない例外 | 500 | `Internal server error` | `true` |

すべてのレスポンスに`requestId`を含め、既存の`X-Request-Id`も維持する。内部例外メッセージやリクエスト本文はレスポンスへ含めない。

`res.headersSent`の場合は、現在と同様に`next(error)`へ委譲する。

ログには以下を含める。

- `event`
- `requestId`
- `method`
- `path`
- 実際に返した`status`
- サニタイズしたエラー種別

## 5. 自動テスト計画

### 5.1 テスト基盤

追加パッケージは導入せず、Node.js 20標準機能を使用する。

- テストランナー: `node:test`
- アサーション: `node:assert/strict`
- HTTPテスト: ポート`0`でExpressを起動し、組み込み`fetch`で呼び出す
- 一時ファイル: `node:os`と`node:fs/promises`で一時ディレクトリを使用する

`package.json`へ次を追加する。

```json
{
  "scripts": {
    "test": "npm run build && node --test"
  }
}
```

テストは`test/*.test.js`へ配置し、ビルド後の`dist/`を検証する。これによりTypeScriptテスト用の追加ランタイムを不要にする。

### 5.2 エラー分類テスト

新規候補: `test/notificationErrors.test.js`

| ケース | 期待結果 |
| --- | --- |
| `AbortError` | `NotificationTransientError` |
| `status: 408` | transient |
| `status: 429` | transient |
| `status: 500`、`502`、`503`、`504` | transient |
| `cause.code: UND_ERR_SOCKET` | transient |
| 2階層以上の`cause.code: ECONNRESET` | transient |
| `statusCode: 503` | transient |
| `RateLimitError`相当 + `retryAfter: 1200` | `retryAfterSeconds === 2` |
| `retry_after: 60` | `retryAfterSeconds === 60` |
| `status: 400`、`401`、`403`、`404`、`422` | `NotificationPermanentError` |
| 原因不明の通常`Error` | permanent |
| 循環した`cause` | 無限ループせず分類完了 |

### 5.3 Discord nonceテスト

新規候補: `test/discordNonce.test.js`、`test/notificationService.test.js`

- 同じ`Idempotency-Key`から常に同じnonceを生成する
- 異なるキーから異なるnonceを生成する
- nonceが固定長かつDiscordへ送信可能な文字だけで構成される
- 生の通知IDがnonceに含まれない
- キーありの場合、`channel.send()`へ`nonce`と`enforceNonce: true`が渡る
- キーなしの場合、`nonce`と`enforceNonce`が付かない
- Discordが同じnonceに対して既存メッセージを返しても、通知処理は成功扱いになる
- 送信エラー分類と既存の構造化ログを壊さない

Discord Clientは、`channels.fetch()`と`channel.send()`だけを持つ最小モックで置き換える。

### 5.4 HTTPエラーハンドラテスト

新規候補: `test/app-errors.test.js`

- 不正JSONが`400`、`retryable: false`、`requestId`付きになる
- 100KBを超えるJSONが`413`になる
- body-parser由来の4xxが`500`へ変換されない
- 予期しないエラーだけが`500`、`retryable: true`になる
- `X-Request-Id`と本文の`requestId`が一致する
- レスポンスに内部例外メッセージや本文が含まれない

テスト起動前に必要な環境変数をダミー値で設定し、`IDEMPOTENCY_STORE_PATH`は一時ディレクトリへ向ける。実際の`.env`や`data/`は使用しない。

## 6. 実装順序

1. Node.js標準テストランナーのスクリプトとテスト用ヘルパーを追加する
2. 現在の誤動作を再現するテストを追加する
   - `AbortError`がpermanentになる
   - 入れ子の`UND_ERR_SOCKET`がpermanentになる
   - 110KB程度のJSONが`500`になる
   - Discord送信オプションにnonceがない
3. `notificationErrors.ts`の原因チェーン探索と一時エラー判定を修正する
4. 決定的nonce生成ヘルパーを追加し、Discord送信オプションへ組み込む
5. Expressエラーハンドラを修正または分離し、body-parserの4xxを維持する
6. READMEへAPIレスポンス、nonce、保証範囲を追記する
7. 全テスト、ビルド、差分チェックを実行する
8. ステージング環境で同一キー再送とエラーレスポンスを確認する

## 7. 検証コマンド

```bash
npm test
npm run build
git diff --check
```

追加で、Docker Compose構成を使用する場合は次を確認する。

```bash
docker compose config
docker compose build bot
```

## 8. 実環境確認

### 同一通知の再送

1. 同じ`Idempotency-Key`と同じpayloadで`/notify`を2回呼ぶ
2. 1回目が`200 Notification sent`になることを確認する
3. 2回目が`200 Notification already processed`かつ`duplicate: true`になることを確認する
4. Discord上のメッセージが1件だけであることを確認する

### 一時障害

1. Discord送信モックまたはテスト用経路でタイムアウトを発生させる
2. `/notify`が`503`を返すことを確認する
3. `Retry-After`と`retryable: true`を確認する
4. 再試行時に同じDiscord nonceが使われることを確認する

### 不正リクエスト

1. 不正JSONを送り`400`になることを確認する
2. 100KB超のJSONを送り`413`になることを確認する
3. どちらも`retryable: false`であることを確認する
4. Cloud Functions側が4xxを再試行しないことを確認する

## 9. ロールバック

- `IdempotencyStore`のファイル形式は変更しないため、既存の`idempotency.json`はそのまま利用できる
- 新しい環境変数やデータ移行は不要
- 問題発生時は以前のコンテナイメージへ戻せる
- nonce追加のみを無効化してもローカル冪等性ストアは継続利用できる

## 10. 完了条件

- 同じ`Idempotency-Key`から同じDiscord nonceが生成される
- キーありのDiscord送信で`enforceNonce: true`が設定される
- キーなし通知の既存動作が維持される
- `AbortError`、HTTP 408・429・5xx、入れ子のネットワークエラーが一時エラーになる
- HTTP 400・401・403・404・422が恒久エラーのままになる
- 不正JSONが`400`、サイズ超過が`413`で返る
- body-parserの4xxが`500`へ変換されない
- レスポンスに`requestId`と正しい`retryable`が含まれる
- `npm test`、`npm run build`、`git diff --check`が成功する
- 同一通知の実環境確認でDiscord投稿が1件だけになる

