# Cloud Functions通知再送処理 実装計画書

## 1. 背景

2026/07/13 07:47頃、Cloud Functionから通知Webhookを送信した際に、CloudflareからHTTP 502が返却された。

Cloud Functionログでは、以下が確認できている。

- 実行時刻: 2026-07-12 22:47:45 UTC
- ステータス: 502
- `error_name`: `origin_bad_gateway`
- `retryable`: `true`
- `retry_after`: `60`

現在は送信失敗時の再送処理がないため、一時的なTunnel・Origin障害が通知欠落につながっている。

## 2. 目的

- 一時的な通信障害やHTTP 5xxで通知を欠落させない
- Cloudflareの`Retry-After`を尊重して再送する
- 再送による重複通知を防止する
- 失敗時に原因と再送回数を追跡できるようにする

## 3. 対象ファイル

### 再送処理を追加する関数

- `application/notifyApplicationChange.js`
- `daily/sendDailySchedule.js`
- `monthly/getMonthlySchedule.js`
- `schedule/notifyScheduleChange.js`

### 呼び出し元・定期実行関数

- `daily/sendDailyScheduleRegularly.js`
- `monthly/getMonthlyScheduleRegularly.js`

定期実行関数が個別送信関数を呼び出している場合、再送処理は個別送信関数側だけに実装する。
両方に再送処理を入れると、再送回数が掛け算になるため注意する。

### 新規共通ユーティリティ

- `utils/retryNotificationRequest.js`

### 必要に応じて変更するファイル

- GCE側botの`src/routes/notify.ts`
- GCE側botの`src/app.ts`
- GCE側botの通知重複防止処理

## 4. 再送対象

### 再送するエラー

以下のHTTPステータスは一時障害として再送する。

- `408 Request Timeout`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `502 Bad Gateway`
- `503 Service Unavailable`
- `504 Gateway Timeout`
- Cloudflareの`520`〜`524`

以下のネットワークエラーも再送対象とする。

- `ECONNRESET`
- `ECONNREFUSED`
- `ETIMEDOUT`
- `ECONNABORTED`
- 一時的なDNSエラー
- HTTPクライアントの接続タイムアウト

### 再送しないエラー

以下はリクエスト内容や認証の問題であるため、再送しない。

- `400`
- `401`
- `403`
- `404`
- `422`

## 5. 再送仕様

### 基本設定

- 最大試行回数: 4回（初回1回、再送3回）
- リクエスト単位のタイムアウト: 15秒
- 再送間隔: 5秒、15秒、30秒
- 最大待機時間: 60秒

### `Retry-After`の扱い

レスポンスに`Retry-After`がある場合は、その値を優先する。

今回のCloudflareエラーは`retry_after: 60`だったため、60秒後に再送する。

レスポンスヘッダーに`Retry-After`がない場合は、エラー本文の`retry_after`を確認する。どちらもない場合は指数バックオフを使用する。

### ジッター

複数のCloud Functionsが同時に再送しないよう、待機時間に0〜1秒程度のランダム値を加える。

## 6. 共通ユーティリティの責務

`utils/retryNotificationRequest.js`に以下を集約する。

- HTTPリクエストの実行
- タイムアウト設定
- 再送対象エラーの判定
- `Retry-After`の解析
- 指数バックオフ
- ネットワークエラーの判定
- 再送ログの出力
- 最大試行回数の管理

各Cloud Functionには個別の再送ロジックを書かず、共通ユーティリティを呼び出す。

## 7. 通知IDと重複防止

再送時に、最初のリクエストがGCE側で処理済みでもレスポンスだけ失われている可能性がある。

そのため、すべての通知に一意な通知IDを付与する。

### 通知IDの例

- application: `applicationId + event + updatedAt`
- schedule: `scheduleId + action + updatedAt`
- daily: `daily + 対象日 + department`
- monthly: `monthly + 対象月 + department`

Webhook送信時に以下のヘッダーを追加する。

```text
Idempotency-Key: <notificationId>
```

GCE側botでは、同じ`Idempotency-Key`を受信した場合、Discordへ二重送信しない。

現在の単一GCE・単一botコンテナ構成では、追加サービスを使わず、Docker volumeで永続化した`/app/data/idempotency.json`に保存する。
将来、botを複数VM・複数コンテナで運用する場合は、Firestoreなどの共有永続ストレージへ移行する。

Cloud Functions側がまだ`Idempotency-Key`を送らない期間は、botはキーなし通知を後方互換で処理する。ただし、その場合は重複防止の対象外として警告ログを出す。

## 8. ログ仕様

各試行について、Cloud Loggingに以下を記録する。

```json
{
  "event": "notification_delivery_attempt",
  "function": "notifyApplicationChange",
  "notificationId": "通知ID",
  "attempt": 1,
  "maxAttempts": 4,
  "status": 502,
  "retryable": true,
  "retryAfterSeconds": 60,
  "elapsedMs": 9200
}
```

成功時は以下を記録する。

```json
{
  "event": "notification_delivery_succeeded",
  "function": "notifyApplicationChange",
  "notificationId": "通知ID",
  "attempt": 2,
  "status": 200
}
```

最終失敗時は以下を記録する。

```json
{
  "event": "notification_delivery_failed",
  "function": "notifyApplicationChange",
  "notificationId": "通知ID",
  "attempt": 4,
  "status": 502,
  "maxAttempts": 4
}
```

以下の情報はログに出さない。

- Discordトークン
- Bearer Token
- Webhookシークレット
- 通知本文全体
- 個人情報を含むpayload全体

## 9. 環境変数

以下を環境変数で変更できるようにする。

```text
NOTIFICATION_RETRY_MAX_ATTEMPTS=4
NOTIFICATION_RETRY_BASE_DELAY_MS=5000
NOTIFICATION_RETRY_MAX_DELAY_MS=60000
NOTIFICATION_REQUEST_TIMEOUT_MS=15000
```

環境変数が未設定の場合は、安全なデフォルト値を使用する。

## 10. テスト計画

### 単体テスト

- 502後に200が返った場合、再送して成功する
- 502が継続した場合、最大4回で停止する
- `Retry-After: 60`を正しく尊重する
- 400では再送しない
- 401では再送しない
- ネットワークエラーで再送する
- タイムアウトで再送する
- 同一通知IDが重複送信されない
- 再送間隔にジッターが付与される

### 結合テスト

モックサーバーを使用して、以下の順番でレスポンスを返す。

```text
1回目: 502
2回目: 502
3回目: 200
```

期待結果：

- 3回目で成功する
- Cloud Functionのログに3回分の試行記録が残る
- GCE側botでは通知が1回だけ送信される

### 実環境確認

1. GCE側botに重複防止処理をデプロイする
2. Cloud Functionsの共通再送処理をデプロイする
3. テスト通知を送信する
4. Cloud Functionログを確認する
5. GCEのbotログを確認する
6. Discord通知が1回だけ届くことを確認する

## 11. デプロイ順序

1. GCE側botの受信ログを強化する
2. GCE側botに通知ID・重複防止を追加する
3. GCE側botをデプロイする
4. `notifyApplicationChange`に再送処理を追加する
5. application通知で動作確認する
6. daily通知へ展開する
7. monthly通知へ展開する
8. schedule通知へ展開する
9. 定期実行関数を確認する

## 12. 完了条件

- Cloudflareの502発生時に自動再送される
- 502発生後、最大3回まで再送される
- `Retry-After`がある場合、その値が使用される
- 400・401・403では無駄な再送をしない
- 同じ通知がDiscordに二重投稿されない
- Cloud Functionログから試行回数と最終結果を確認できる
- 通知欠落時に、送信元・Tunnel・botのどこで失敗したか追跡できる
