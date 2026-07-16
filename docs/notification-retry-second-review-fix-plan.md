# 通知再試行 第2次レビュー指摘 修正実装計画書

## 1. 背景

第1次レビューで指摘されたDiscord nonce、タイムアウト分類、body-parserの4xx維持は実装され、追加された14件のテストも成功した。

再レビューでは、次の4点が残っていることを確認した。

1. processing TTLを超えた古い処理が、新しく取得された冪等性claimを削除または完了できる
2. 実際のdiscord.js REST `RateLimitError`の名前を完全一致で判定できない
3. HTTP仕様上有効なBearer認証表現を拒否する
4. `/notify`の400・500レスポンスがREADMEのAPI契約と一致しない

本計画では、既存の冪等性ファイルとAPIの後方互換性を維持しながら、上記を修正する。

## 2. 目的

- TTL失効後の古い処理が、新しい処理のclaimを変更できないようにする
- discord.jsが生成する実際のRateLimitErrorを一時エラーとして扱う
- Bearerスキームの大文字小文字と有効な空白表現を正しく受け付ける
- すべての通知APIエラーレスポンスで`requestId`と`retryable`を一貫させる
- 実ライブラリの形状と並行処理を模した回帰テストを追加する

## 3. 対象ファイル

### 主な変更対象

- `src/services/idempotencyStore.ts`
- `src/routes/notify.ts`
- `src/services/notificationErrors.ts`
- `src/middlewares/auth.ts`
- `README.md`
- `test/notificationErrors.test.js`
- `test/app-errors.test.js`

### 新規候補

- `test/idempotencyStore.test.js`
- `test/auth.test.js`
- `test/notifyResponses.test.js`

### 対象外

- Idempotency-Keyとpayloadハッシュの関連付け
- Firestoreなどの共有冪等性ストアへの移行
- 複数botコンテナでの排他制御
- Discord送信とローカルファイル更新間の完全なトランザクション保証
- Cloud Functions側の再試行処理

## 4. 修正方針

### 4.1 冪等性claimへ所有者IDを追加する

#### 問題

現在の`complete(key)`と`release(key)`はキーだけで対象を変更する。

次の順序になると、古い処理Aが新しい処理Bのclaimを破壊できる。

1. Aがキー`K`を`processing`として取得する
2. Aの処理がprocessing TTLを超える
3. Bの`begin(K)`がAを期限切れとして削除し、新しいclaimを取得する
4. Aが失敗して`release(K)`を呼ぶ
5. Bのclaimまで削除される
6. Cの`begin(K)`が`new`となり、並行送信が増える

同様に、Aの`complete(K)`がBの処理中claimを完了済みに変更する可能性もある。

#### データモデル

各`processing`エントリへ所有者を識別する`claimId`を追加する。

```ts
interface IdempotencyEntry {
  key: string;
  state: IdempotencyState;
  claimId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

新しいclaimでは`randomUUID()`を使用して`claimId`を生成する。

#### 保存形式の互換性

ファイルの`version`は`1`のままとする。

理由は以下のとおり。

- `claimId`は追加プロパティであり、既存コードは未知のプロパティを無視できる
- 既存のcompletedエントリはそのまま重複防止に利用できる
- 既存のprocessingエントリは、従来どおりTTLまで保持できる
- 新バージョンから旧コンテナへロールバックしても、旧コードがファイル全体を無効扱いしない

`isValidEntry()`は次の条件を追加する。

- `claimId`が存在する場合は、空でない文字列であること
- `claimId`がない既存エントリも読み込み可能であること

#### API変更

`begin()`が`new`を返す場合、呼び出し元へ`claimId`を返す。

```ts
type IdempotencyBeginResult =
  | { state: 'new'; entry: IdempotencyEntry; claimId: string }
  | { state: 'processing' | 'completed'; entry: IdempotencyEntry };
```

`complete()`と`release()`はclaimIdを必須にし、現在の所有者と一致する場合だけ更新する。

```ts
complete(key: string, claimId: string): Promise<ClaimMutationResult>
release(key: string, claimId: string): Promise<ClaimMutationResult>
```

戻り値はログと分岐を明確にするため、booleanではなく次のいずれかとする。

```ts
type ClaimMutationResult =
  | { state: 'updated' }
  | { state: 'missing' }
  | { state: 'ownership_lost' };
```

動作は次のとおり。

| 状態 | complete/releaseの動作 |
| --- | --- |
| キーなし | `missing`、永続化なし |
| claimId不一致 | `ownership_lost`、現在のエントリを変更しない |
| claimId一致 | 更新して永続化し、`updated` |

#### ルーター変更

`src/routes/notify.ts`の`idempotencyClaimed: boolean`を、次へ置き換える。

```ts
let activeClaimId: string | undefined;
```

- `begin()`が`new`の場合に`activeClaimId = claim.claimId`
- `complete(idempotencyKey, activeClaimId)`を呼ぶ
- 例外時は`release(idempotencyKey, activeClaimId)`を呼ぶ
- `ownership_lost`は現在のclaimを変更せず、構造化ログ`idempotency_claim_ownership_lost`を出す
- `missing`は構造化ログ`idempotency_claim_missing`を出す

古い処理がDiscord送信に成功した後で所有権を失っていた場合、そのHTTPリクエスト自体は`200`を返す。新しい所有者の状態を古い処理から上書きしないことを優先する。Discord nonceは同じIdempotency-Keyから生成されるため、短時間の並行送信はDiscord側でも抑止される。

### 4.2 RateLimitErrorの実際の名前を認識する

#### 問題

インストール済み`@discordjs/rest`の`RateLimitError.name`は、次のようにルートを含む。

```text
RateLimitError[/channels/:id/messages]
```

現在の`TRANSIENT_ERROR_NAMES.has(name)`は`RateLimitError`との完全一致しか認識しない。そのため、実インスタンスは`NotificationPermanentError`になる。

#### 実装

名前判定をヘルパーへ分離する。

```ts
function isTransientErrorName(name: string): boolean {
  return (
    TRANSIENT_ERROR_NAMES.has(name) ||
    name.startsWith('RateLimitError[')
  );
}
```

`AbortError`と`TimeoutError`は完全一致のままとし、RateLimitErrorだけdiscord.jsの名前形式を許可する。単純な`includes('RateLimitError')`は、無関係なユーザー定義エラーまで一時エラーにし得るため使用しない。

`retryAfter`は現在どおりミリ秒として秒へ切り上げる。

#### テスト修正

現在の次の偽物だけを使うテストを置き換える。

```js
{ name: 'RateLimitError', retryAfter: 1200 }
```

最低限、実際の名前形式を使う。

```js
{
  name: 'RateLimitError[/channels/:id/messages]',
  retryAfter: 1200,
}
```

テスト環境から`@discordjs/rest`を安定してimportできる場合は、実際の`RateLimitError`も生成して分類する。直接依存を追加せずに解決できない場合は、依存追加よりも上記の実形状fixtureを優先し、discord.js更新時に形状を再確認する。

### 4.3 Bearer認証をHTTP仕様に沿って解析する

#### 問題

現在の実装は`split(' ')`と`scheme !== 'Bearer'`を使用しているため、次の有効な表現を拒否する。

```text
authorization: bearer <token>
Authorization: Bearer  <token>
Authorization: Bearer\t<token>
```

HTTPの認証スキームは大文字小文字を区別せず、スキームとcredentialsの間には1個以上のSPまたはHTABを使用できる。

#### 実装

認証ヘッダー解析を小さな純粋関数へ分離する。

```ts
function parseBearerToken(header: string): string | undefined
```

解析規則は次のとおり。

- `Bearer`を大文字小文字を区別せず照合する
- スキームとtokenの間に1個以上のSPまたはHTABを許可する
- tokenの前後に追加されたSPまたはHTABは無視する
- token内部の空白や複数credentialsは拒否する
- `Basic`など他スキームは拒否する
- tokenが空の場合は拒否する

実装例は次のとおり。

```ts
const match = /^Bearer[ \t]+([^ \t]+)[ \t]*$/i.exec(header);
return match?.[1];
```

シークレット比較は、可能であれば`node:crypto`の`timingSafeEqual()`を使用する。長さが異なる場合は比較前に拒否し、例外を発生させない。

HTTPステータスは互換性維持のため次のままとする。

- ヘッダーなし: `401`
- 不正形式またはtoken不一致: `403`

### 4.4 `/notify`のエラーレスポンスを統一する

#### 問題

READMEでは、400と500の例を次のように定義している。

```json
{ "error": "...", "retryable": false, "requestId": "..." }
{ "error": "Internal server error", "retryable": true, "requestId": "..." }
```

しかし、多くのバリデーション失敗は`error`だけを返し、`/notify`内部の予期しない500も`retryable: true`を返さない。

#### 実装

ルーター内にレスポンスヘルパーを追加するか、共通モジュールへ分離する。

```ts
function sendClientError(
  res: Response,
  requestId: string,
  status: 400 | 401 | 403,
  error: string
): Response

function sendServerError(
  res: Response,
  requestId: string,
  error: string
): Response
```

レスポンス規則を次へ統一する。

| HTTP | retryable | requestId |
| ---: | --- | --- |
| 400 | `false` | 必須 |
| 401 | `false` | 必須 |
| 403 | `false` | 必須 |
| 413 | `false` | 必須 |
| 415 | `false` | 必須 |
| 422 | `false` | 必須 |
| 500 | `true` | 必須 |
| 503 | `true` | 必須 |

具体的には次を変更する。

- Idempotency-Key長超過
- 必須フィールド不足
- notification type不正
- daily、monthly、schedule、application固有の全バリデーション失敗
- 認証ヘッダーなし・token不一致
- `/notify`内の分類不能な例外

成功レスポンスと重複レスポンスは現在の`requestId`を維持する。

READMEの400行から「認証」を外すか、401・403も統一後の本文例へ更新する。

## 5. 自動テスト計画

### 5.1 IdempotencyStore

新規: `test/idempotencyStore.test.js`

#### 基本動作

- `begin()`の`new`結果に空でない`claimId`がある
- 同じキーの2回目は`processing`になる
- 正しいclaimIdで`complete()`すると`completed`になる
- 正しいclaimIdで`release()`すると再取得できる
- 完了済みキーは再起動後も`completed`になる

#### 所有権

- 誤ったclaimIdの`release()`が`ownership_lost`を返す
- 誤ったclaimIdの`complete()`が`ownership_lost`を返す
- 誤ったclaimIdではファイル内容を更新しない
- TTL後にBが新しいclaimIdを取得する
- その後にAのclaimIdでreleaseしてもBは`processing`のまま
- その後にAのclaimIdでcompleteしてもBは`processing`のまま

TTL境界テストでは小さいTTLと制御可能な時刻を使用する。可能であれば`Date.now()`を直接待つのではなく、`IdempotencyStore`へ時刻取得関数を注入し、テストを決定的にする。

```ts
constructor(..., private readonly now: () => number = Date.now)
```

ISO日時生成も同じ時刻を基準にする。

#### 後方互換性

- `claimId`なしの既存completedエントリを読み込める
- `claimId`なしの既存processingエントリをTTLまで保持する
- 新しく保存されたファイルの`version`が`1`のままである

### 5.2 RateLimitError

更新: `test/notificationErrors.test.js`

- `RateLimitError[/channels/:id/messages]`がtransientになる
- `retryAfter: 1200`が2秒になる
- `SomeRateLimitError[...]`のような類似名はpermanentのままになる
- `AbortError`と`TimeoutError`の既存テストが引き続き成功する

### 5.3 Bearer認証

新規: `test/auth.test.js`

| Authorization | 期待結果 |
| --- | --- |
| `Bearer valid-token` | 認証成功 |
| `bearer valid-token` | 認証成功 |
| `BEARER valid-token` | 認証成功 |
| `Bearer  valid-token` | 認証成功 |
| `Bearer\tvalid-token` | 認証成功 |
| ヘッダーなし | 401、`retryable: false` |
| `Basic valid-token` | 403、`retryable: false` |
| `Bearer` | 403 |
| `Bearer wrong-token` | 403 |
| `Bearer valid-token extra` | 403 |

認証成功テストでは、後段のルーターへ到達したことだけを確認できる最小Expressアプリを使用する。Discordへ接続しない。

### 5.4 通知APIレスポンス

新規候補: `test/notifyResponses.test.js`

- notification type不正が`400`、`retryable: false`、`requestId`付きになる
- daily必須項目不足が同じ形式になる
- monthly必須項目不足が同じ形式になる
- scheduleのaction・日時・更新内容不正が同じ形式になる
- applicationのevent・任意項目型不正が同じ形式になる
- Idempotency-Key長超過が同じ形式になる
- `/notify`内の予期しない例外が`500`、`retryable: true`になる
- 401・403にも`requestId`と`retryable: false`が含まれる
- 本文の`requestId`が`X-Request-Id`と一致する

## 6. 実装順序

1. IdempotencyStoreへ時刻注入と所有権回帰テストを追加する
2. `claimId`を追加し、条件付きcomplete/releaseを実装する
3. notifyルーターを`activeClaimId`方式へ変更する
4. RateLimitErrorの実名形式テストを追加し、名前判定を修正する
5. Bearer認証のテーブルテストを追加し、ヘッダー解析を修正する
6. エラーレスポンスの統合テストを追加し、全400・401・403・500を統一する
7. READMEのレスポンス表と認証説明を更新する
8. 全テスト、ビルド、差分チェックを実行する
9. ステージング環境で同一キー並行リクエストを確認する

## 7. 検証コマンド

```bash
npm test
npm run build
git diff --check
```

Docker構成を確認する場合は、シークレットを出力しない環境で次を実行する。

```bash
docker compose build bot
```

## 8. 実環境・ステージング確認

### 冪等性claim

1. processing TTLより短い通常通知が1回だけ送信されることを確認する
2. テスト用にTTLを短くし、古い処理Aと新しい処理Bを並行させる
3. Aの終了後もBのclaimが消えないことをログで確認する
4. 3件目が新規Discord送信を開始しないことを確認する

### RateLimitError

1. モックで実際の名前形式を持つRateLimitErrorを発生させる
2. `/notify`が`503`を返すことを確認する
3. `Retry-After`がミリ秒から秒へ正しく変換されることを確認する

### Bearer認証

1. 現行Cloud Functionsの`Bearer <token>`が引き続き成功することを確認する
2. 小文字スキームと複数空白でも認証成功することを確認する
3. Basic、tokenなし、余分なcredentialsが拒否されることを確認する

### レスポンス契約

1. 代表的な400で`retryable: false`と`requestId`を確認する
2. 意図的な500で`retryable: true`と`requestId`を確認する
3. すべてで本文と`X-Request-Id`が一致することを確認する

## 9. ロールバック

- 冪等性ファイルの`version`は`1`のままなので、旧コンテナへ戻しても読み込める
- `claimId`は旧コードでは無視される追加フィールドであり、データ移行は不要
- APIレスポンスへの`requestId`と`retryable`追加は加算的変更であり、既存クライアントを壊さない
- Bearerの既存標準形式`Bearer <token>`は挙動を維持する
- 新しい環境変数は追加しない

## 10. 完了条件

- 古いclaimIdによるcomplete/releaseが新しいclaimを変更しない
- TTLを跨ぐ並行処理テストが決定的に成功する
- 既存のversion 1冪等性ファイルを読み込める
- 実際の名前形式を持つRateLimitErrorが503相当の一時エラーになる
- RateLimitErrorの`retryAfter`が正しく秒へ変換される
- Bearerスキームを大文字小文字を区別せず受け付ける
- 1個以上のSP/HTABを正しく処理し、不正な追加credentialsは拒否する
- 400・401・403・413・415・422が`retryable: false`と`requestId`を返す
- 500・503が`retryable: true`と`requestId`を返す
- READMEと実レスポンスが一致する
- `npm test`、`npm run build`、`git diff --check`が成功する

