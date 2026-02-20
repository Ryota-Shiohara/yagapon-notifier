# 🤖 Yagapon Notifier

Discord Webhook通知機能を持つDiscordボット。  
PC開発 → GitHub管理 → Raspberry Pi運用 のワークフローに対応。

## 📋 目次

- [概要](#概要)
- [API仕様](#api仕様)
  - [認証方式](#認証方式)
  - [HTTP API エンドポイント](#http-api-エンドポイント)
  - [Discordスラッシュコマンド](#discordスラッシュコマンド)
  - [メッセージトリガー](#メッセージトリガー)
- [システム構成](#システム構成)
- [必要な環境](#必要な環境)
- [セットアップ](#セットアップ)
  - [1. PC開発環境のセットアップ](#1-pc開発環境のセットアップ)
  - [2. Cloudflare Tunnelの設定](#2-cloudflare-tunnelの設定)
  - [3. Raspberry Piでの運用](#3-raspberry-piでの運用)
- [開発ワークフロー](#開発ワークフロー)
- [Docker使用方法](#docker使用方法)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

このボットは以下の機能を提供します：

- **Discord通知**: 外部サービス（Google Apps Script等）からのWebhook通知をDiscordチャンネルに送信
- **認証機能**: Bearer Token認証でセキュアな通知
- **Docker対応**: コンテナ化された環境で安定稼働
- **Cloudflare Tunnel**: ポート開放不要でWebhookを安全に公開

---

## API仕様

このボットは **HTTP API**、**Discordスラッシュコマンド**、**メッセージトリガー** の3種類のインターフェースを持ちます。

### 全体リクエストフロー

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Yagapon Notifier                                │
│                                                                         │
│  ┌─────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │  Express HTTP Server (:3000)    │  │  Discord.js Client           │  │
│  │                                 │  │                              │  │
│  │  GET /health                    │  │  スラッシュコマンド            │  │
│  │   → ボット状態チェック           │  │   /ping   応答速度確認        │  │
│  │                                 │  │   /notify  通知送信(管理者)   │  │
│  │  POST /notify                   │  │   /help    ヘルプ表示         │  │
│  │   → Bearer Token認証            │  │   /intro   ボット紹介         │  │
│  │   → バリデーション              │  │   /monthly 月次予定取得       │  │
│  │   → NotificationService        │  │                              │  │
│  │     → 戦略パターンで振り分け    │  │  メッセージトリガー           │  │
│  │       ├ daily: 日次通知         │  │   @ボット → mention応答      │  │
│  │       ├ monthly: 月次通知       │  │   キーワード → 自動返信      │  │
│  │       └ schedule: 予定変更通知  │  │                              │  │
│  └─────────────────────────────────┘  └──────────────────────────────┘  │
│                    │                              │                      │
│                    └──────────┬───────────────────┘                      │
│                               ▼                                         │
│                    ┌─────────────────────┐                              │
│                    │  Discord Channel     │                              │
│                    │  (Embed メッセージ)  │                              │
│                    └─────────────────────┘                              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 認証方式

HTTP APIでは**Bearer Token認証**を使用します。Discordスラッシュコマンドは**Discord側の権限管理**に委任しています。

| インターフェース   | 認証方式         | 詳細                                                              |
| ------------------ | ---------------- | ----------------------------------------------------------------- |
| `GET /health`      | **なし**         | 誰でもアクセス可能                                                |
| `POST /notify`     | **Bearer Token** | `Authorization: Bearer <BOT_NOTIFY_SECRET>` ヘッダー必須          |
| スラッシュコマンド | **Discord権限**  | `/notify` のみ管理者権限（`Administrator`）が必要。他は全員利用可 |
| メッセージトリガー | **なし**         | Bot自身のメッセージは自動で無視される                             |

#### Bearer Token認証の仕組み（`POST /notify`）

```
クライアント                            サーバー (authMiddleware)
    │                                       │
    │  Authorization: Bearer <token>        │
    │ ────────────────────────────────────→  │
    │                                       │
    │                          ┌────────────┴────────────┐
    │                          │ ① ヘッダー存在チェック    │
    │                          │    Authorization ヘッダー │
    │                          │    が存在するか？         │
    │                          └────────────┬────────────┘
    │                                  YES  │  NO → 401
    │                          ┌────────────┴────────────┐
    │                          │ ② "Bearer " 以降を分離   │
    │                          │    token を取得          │
    │                          └────────────┬────────────┘
    │                          ┌────────────┴────────────┐
    │                          │ ③ token と               │
    │                          │    BOT_NOTIFY_SECRET     │
    │                          │    を文字列比較          │
    │                          └────────────┬────────────┘
    │                                  一致  │  不一致 → 403
    │                          ┌────────────┴────────────┐
    │                          │ ④ next() → ルート処理へ  │
    │                          └─────────────────────────┘
    │                                       │
    │  200 / 4xx / 5xx                      │
    │ ←────────────────────────────────────  │
```

- **環境変数** `BOT_NOTIFY_SECRET` にシークレットを設定（例: `openssl rand -base64 32` で生成）
- ミドルウェア実装: [src/middlewares/auth.ts](src/middlewares/auth.ts)

#### エラーレスポンス

| ステータス         | 条件                                    | レスポンス                                       |
| ------------------ | --------------------------------------- | ------------------------------------------------ |
| `401 Unauthorized` | `Authorization` ヘッダーがない          | `{ "error": "Authorization header is missing" }` |
| `403 Forbidden`    | トークンが `BOT_NOTIFY_SECRET` と不一致 | `{ "error": "Invalid secret token" }`            |

---

### HTTP API エンドポイント

#### `GET /health` — ヘルスチェック

Botの起動状態を確認するためのエンドポイント。Docker ヘルスチェック等で使用。

**認証**: 不要

```
GET /health
```

**レスポンス**

| 状態   | ステータス                | ボディ                                            |
| ------ | ------------------------- | ------------------------------------------------- |
| 正常   | `200 OK`                  | `{ "status": "ok", "bot": "ready" }`              |
| 未準備 | `503 Service Unavailable` | `{ "status": "unavailable", "bot": "not ready" }` |

```
リクエスト例:
  curl http://localhost:3000/health

レスポンス例 (200):
  { "status": "ok", "bot": "ready" }
```

---

#### `POST /notify` — 通知送信

外部サービス（GAS等）から Discord チャンネルへ通知を送信する。`type` フィールドで日次通知 (`daily`)、月次通知 (`monthly`)、予定追加/変更/削除通知 (`schedule`) を振り分ける戦略パターンを採用。

**認証**: Bearer Token（`Authorization: Bearer <BOT_NOTIFY_SECRET>`）

```
POST /notify
Content-Type: application/json
Authorization: Bearer <BOT_NOTIFY_SECRET>
```

##### 認証・バリデーション処理フロー

```
POST /notify
  │
  ▼
┌──────────────────┐    401 Unauthorized
│ Authorization     │──→ { "error": "Authorization header is missing" }
│ ヘッダー存在確認  │
└────────┬─────────┘
         │ あり
         ▼
┌──────────────────┐    403 Forbidden
│ Bearer Token     │──→ { "error": "Invalid secret token" }
│ 値の一致確認      │
└────────┬─────────┘
         │ 一致
         ▼
┌──────────────────┐    503 Service Unavailable
│ ボット準備状態    │──→ { "error": "Discord bot is not ready yet" }
│ チェック          │
└────────┬─────────┘
         │ ready
         ▼
┌──────────────────┐    400 Bad Request
│ type / data      │──→ { "error": "Missing required fields: type, data" }
│ 必須フィールド    │
└────────┬─────────┘
         │ OK
         ▼
┌──────────────────┐    400 Bad Request
│ type別           │──→ daily:   { "error": "Missing required fields: data.title" }
│ 詳細バリデーション│    monthly: { "error": "Missing required fields: data.department, ..." }
│                  │    schedule:{ "error": "Missing required fields: data.action, ..." }
└────────┬─────────┘
         │ OK
         ▼
┌──────────────────┐
│ 通知チャンネル    │
│ 解決              │
│ (channelId指定 or │
│  部署名→preset)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐    200 OK
│ Discord送信      │──→ { "success": true, "message": "Notification sent" }
│ (Embed構築)       │
└──────────────────┘    500 (エラー時)
                        { "error": "Internal server error" }
```

##### リクエストボディ: `type: "daily"`（日次通知）

翌日の予定を1件ずつ通知する。

```jsonc
{
  "type": "daily",
  "data": {
    "title": "定例ミーティング", // 必須: イベントタイトル
    "description": "議題: 進捗報告", // 任意: 説明
    "startTime": "2025-06-15T10:00:00", // 任意: 開始時刻 (ISO8601)
    "endTime": "2025-06-15T11:00:00", // 任意: 終了時刻 (ISO8601)
    "location": "会議室A", // 任意: 場所
    "department": "総務局", // 任意: 局名 → チャンネル/ロール解決に使用
    "section": "企画部", // 任意: 部署名
  },
  "channelId": "123456789012345678", // 任意: 送信先チャンネルID (省略時は部署名から解決)
}
```

**`data` (Schedule型) フィールド一覧**

| フィールド    | 型       | 必須 | 説明                                |
| ------------- | -------- | ---- | ----------------------------------- |
| `title`       | `string` | ✅   | イベントタイトル                    |
| `description` | `string` | -    | イベントの説明                      |
| `startTime`   | `string` | -    | 開始時刻（ISO8601形式）             |
| `endTime`     | `string` | -    | 終了時刻（ISO8601形式）             |
| `location`    | `string` | -    | 開催場所                            |
| `department`  | `string` | -    | 局名（チャンネル/ロール解決に使用） |
| `section`     | `string` | -    | 部署名（フッターに表示）            |

##### リクエストボディ: `type: "monthly"`（月次通知）

1ヶ月分のスケジュールを一括で通知する。

```jsonc
{
  "type": "monthly",
  "data": {
    "department": "総務局", // 必須: 局名
    "month": "6月", // 必須: 対象月 (例: "6月" or "2025-06")
    "schedules": [
      // 必須: スケジュール配列
      {
        "title": "定例ミーティング",
        "startTime": "2025-06-01T10:00:00",
        "endTime": "2025-06-01T11:00:00",
        "location": "会議室A",
        "section": "企画部",
      },
      {
        "title": "全体会議",
        "startTime": "2025-06-15T14:00:00",
        "description": "月次報告",
      },
    ],
  },
  "channelId": "preset", // 任意: "preset" → 部署名からチャンネル解決
}
```

**`data` (MonthlyData型) フィールド一覧**

| フィールド   | 型           | 必須 | 説明                                          |
| ------------ | ------------ | ---- | --------------------------------------------- |
| `department` | `string`     | ✅   | 局名                                          |
| `month`      | `string`     | ✅   | 対象月（例: `"6月"`, `"2025-06"`）            |
| `schedules`  | `Schedule[]` | ✅   | スケジュール配列（Schedule型は daily と同一） |

##### リクエストボディ: `type: "schedule"`（予定追加/変更/削除通知）

予定の追加・変更・削除を受信時に通知する。`data.action` でイベント種別を指定する。

**`schedule` 通知の表示仕様（action別）**

- `add`: 追加された予定を **Embedのみ** で表示
- `update`: **変更箇所をテキスト** で先に表示し、その下に **変更後の予定をEmbed** で表示
- `delete`: 削除した予定の **タイトルと日付のみをテキスト** で表示（Embedなし）

```jsonc
{
  "type": "schedule",
  "data": {
    "action": "update", // 必須: add | update | delete
    "title": "定例ミーティング", // 必須
    "startAt": "2026-02-20T09:00:00+09:00", // 必須: ISO 8601 + タイムゾーン
    "endAt": "2026-02-20T10:00:00+09:00", // 必須: ISO 8601 + タイムゾーン
    "detail": "会議室変更あり", // 任意: 予定の詳細メモ
    "department": "総務局", // 任意: チャンネル解決に使用
    "section": "企画部", // 任意
    "location": "会議室A", // 任意
    "description": "議題を更新", // 任意
    "url": "https://example.com/schedules/123", // 任意
    "updatedBy": "山田", // 任意
    "after": {
      // update/delete で必須
      "title": "定例ミーティング",
      "startAt": "2026-02-20T09:30:00+09:00",
      "endAt": "2026-02-20T10:30:00+09:00",
      "location": "会議室B",
    },
    "changedDetails": [
      // update/delete で必須: 項目 + 変更前後
      {
        "field": "location",
        "item": "場所",
        "before": "会議室A",
        "after": "会議室B",
      },
      {
        "field": "startAt",
        "item": "開始時刻",
        "before": "10:00",
        "after": "12:00",
      },
    ],
  },
  "channelId": "preset", // 任意
}
```

**`data` (ScheduleNotificationData型) フィールド一覧**

| フィールド       | 型                              | 必須              | 説明                                |
| ---------------- | ------------------------------- | ----------------- | ----------------------------------- |
| `action`         | `"add" \| "update" \| "delete"` | ✅                | 予定イベント種別                    |
| `title`          | `string`                        | ✅                | 予定タイトル                        |
| `startAt`        | `string`                        | ✅                | 開始時刻（ISO8601 + タイムゾーン）  |
| `endAt`          | `string`                        | ✅                | 終了時刻（ISO8601 + タイムゾーン）  |
| `detail`         | `string`                        | -                 | 予定の詳細メモ                      |
| `department`     | `string`                        | -                 | 局名（チャンネル/ロール解決に使用） |
| `section`        | `string`                        | -                 | 部署名                              |
| `location`       | `string`                        | -                 | 開催場所                            |
| `description`    | `string`                        | -                 | 説明                                |
| `url`            | `string`                        | -                 | 詳細リンク                          |
| `updatedBy`      | `string`                        | -                 | 操作者                              |
| `after`          | `ScheduleSnapshot`              | update/deleteで✅ | 変更後または削除対象の予定情報      |
| `changedDetails` | `ScheduleChangeDetail[]`        | update/deleteで✅ | 変更項目・変更前・変更後            |
| `before`         | `ScheduleSnapshot`              | -                 | 変更前情報（任意）                  |

**`ScheduleChangeDetail` フィールド**

| フィールド | 型       | 必須 | 説明                                            |
| ---------- | -------- | ---- | ----------------------------------------------- |
| `field`    | `string` | ✅   | 変更対象フィールド（例: `location`, `startAt`） |
| `item`     | `string` | -    | 表示名（例: `場所`, `開始時刻`）                |
| `before`   | `string` | ✅   | 変更前の値                                      |
| `after`    | `string` | ✅   | 変更後の値                                      |

##### チャンネル解決ロジック

通知先チャンネルは `channelId` と `department` の組み合わせで決定される。

```
channelId の値
  │
  ├─ 具体的なチャンネルID → そのチャンネルに送信（ロールメンションなし）
  │
  ├─ "preset" ─┐
  │             ├─→ department から DEPARTMENT_CHANNELS を参照
  └─ 未指定 ───┘    ├─ 一致あり → 該当チャンネル + DEPARTMENT_ROLES のロールメンション
                     └─ 一致なし → NOTIFICATION_CHANNEL_ID（デフォルトチャンネル）
```

**対応局名一覧**: `全局` / `役員` / `執行部` / `総務局` / `室内局` / `屋外局` / `装飾局` / `ステージ局` / `広報局` / `渉外局` / `IT局`

##### レスポンス一覧

| ステータス | 条件               | ボディ                                                |
| ---------- | ------------------ | ----------------------------------------------------- |
| `200`      | 送信成功           | `{ "success": true, "message": "Notification sent" }` |
| `400`      | バリデーション失敗 | `{ "error": "Missing required fields: ..." }`         |
| `401`      | 認証ヘッダーなし   | `{ "error": "Authorization header is missing" }`      |
| `403`      | トークン不一致     | `{ "error": "Invalid secret token" }`                 |
| `503`      | ボット未準備       | `{ "error": "Discord bot is not ready yet" }`         |
| `500`      | サーバーエラー     | `{ "error": "Internal server error" }`                |

---

### Discordスラッシュコマンド

Discordチャット上で `/コマンド名` で実行するインタラクティブコマンド。

```
ユーザー入力: /コマンド名 [オプション]
       │
       ▼
┌──────────────────┐
│ InteractionCreate │
│ イベント受信       │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ commands Map      │
│ からコマンド検索   │
│ (Collection)      │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ command.execute() │
│ 実行              │
└──────────────────┘
```

#### `/ping`

ボットの応答速度を確認する。

| 項目           | 値                                    |
| -------------- | ------------------------------------- |
| **オプション** | なし                                  |
| **権限**       | 全員                                  |
| **レスポンス** | レイテンシー + API レイテンシーを表示 |

#### `/notify`

管理者がDiscordからDaily通知を手動送信する。

| オプション    | 型                | 必須 | 説明                 |
| ------------- | ----------------- | ---- | -------------------- |
| `title`       | `string`          | ✅   | イベントタイトル     |
| `department`  | `string (choice)` | ✅   | 局名（11局から選択） |
| `description` | `string`          | -    | イベントの説明       |
| `location`    | `string`          | -    | 開催場所             |
| `section`     | `string`          | -    | 部署名               |

| 項目           | 値                                      |
| -------------- | --------------------------------------- |
| **権限**       | 管理者のみ (`Administrator`)            |
| **レスポンス** | Ephemeral（実行者のみ表示）で結果を返信 |

```
/notify title:定例会 department:総務局 location:会議室A
       │
       ▼
  Schedule オブジェクト構築
       │
       ▼
  NotificationService.sendNotification()
       │
       ▼
  部署名 → チャンネル解決 → Embed構築 → Discord送信
```

#### `/monthly`

外部サービス（GAS）に月間予定取得のHTTPリクエストを送信する。

| オプション | 型                | 必須 | 説明                                   |
| ---------- | ----------------- | ---- | -------------------------------------- |
| `局`       | `string (choice)` | ✅   | 月間予定を取得する局名（11局から選択） |

| 項目           | 値                                  |
| -------------- | ----------------------------------- |
| **権限**       | 全員                                |
| **レスポンス** | Ephemeralでリクエスト送信結果を返信 |

```
/monthly 局:総務局
       │
       ▼
  MONTHLY_URL に POST リクエスト送信
  (パラメータ: ?department=総務局&channelId=実行チャンネルID)
       │
       ▼
  外部サービス(GAS)が処理 → POST /notify で月次データを返送
```

#### `/help`

コマンド一覧をEmbed形式で表示する。

| 項目           | 値                                   |
| -------------- | ------------------------------------ |
| **オプション** | なし                                 |
| **権限**       | 全員                                 |
| **レスポンス** | Ephemeral。コマンド一覧のEmbedを返信 |

#### `/intro`

ボットの紹介をEmbed形式で表示する。

| 項目           | 値                                  |
| -------------- | ----------------------------------- |
| **オプション** | なし                                |
| **権限**       | 全員                                |
| **レスポンス** | 全員に表示。ボット紹介のEmbedを返信 |

---

### メッセージトリガー

通常のメッセージ（スラッシュコマンドではない）に対して自動応答するシステム。`TriggerService` が優先度順にマッチングを行う。

```
ユーザーメッセージ受信 (MessageCreate)
       │
       ├─ Bot自身の発言 → 無視
       │
       ▼
┌──────────────────────┐
│ ① mentionトリガー     │  ※ ボットへのメンションが含まれる場合のみ
│   (@ボット を検出)    │
│                      │
│   メンションのみ？    │
│   ├─ YES → "呼んだぽん？" を返信
│   └─ NO  → mentionモードのトリガーを検索
│            ├─ extract設定あり → マーカー間テキスト抽出 → テンプレート返信
│            └─ reply設定あり  → 固定メッセージ返信
└────────┬─────────────┘
         │ メンションなし or mentionトリガー不発火
         ▼
┌──────────────────────┐
│ ② includes/exact      │  ※ 優先度順にマッチング
│   トリガー検索         │
│                       │
│   マッチしたトリガー   │
│   ├─ extract設定あり  │
│   │   └─ マーカー間テキスト抽出 → テンプレート返信 or onFail返信
│   └─ reply設定あり    │
│       └─ 固定メッセージ返信
└────────┬──────────────┘
         │ トリガー不発火
         ▼
┌──────────────────────┐
│ ③ レガシー !ping      │
│   "!ping" → "Pong!"   │
└──────────────────────┘
```

#### トリガー定義（TriggerDef型）

| フィールド | 型                                     | 説明                                                |
| ---------- | -------------------------------------- | --------------------------------------------------- |
| `id`       | `string`                               | 一意の識別子                                        |
| `pattern`  | `string`                               | 検出パターン文字列                                  |
| `mode`     | `"includes"` / `"exact"` / `"mention"` | マッチング方式                                      |
| `reply`    | `string`                               | 標準返信メッセージ                                  |
| `extract`  | `object`                               | テキスト抽出設定（下表参照）                        |
| `enabled`  | `boolean`                              | 有効/無効フラグ                                     |
| `channels` | `string[]`                             | 対象チャンネルIDのホワイトリスト（空=全チャンネル） |
| `priority` | `number`                               | 優先度（小さいほど高優先）                          |

**`extract` オブジェクト**

| フィールド | 型       | 説明                                             |
| ---------- | -------- | ------------------------------------------------ |
| `start`    | `string` | 抽出開始マーカー                                 |
| `end`      | `string` | 抽出終了マーカー（省略時は末尾まで）             |
| `template` | `string` | 返信テンプレート。`{value}` が抽出値に置換される |
| `onFail`   | `string` | 抽出失敗時の返信メッセージ                       |

---

## システム構成

```
┌─────────────┐
│  PC (開発)   │
│  - VS Code  │
│  - Node.js  │
└──────┬──────┘
       │ git push
       ▼
┌─────────────┐
│   GitHub    │
│ (リポジトリ) │
└──────┬──────┘
       │ git pull
       ▼
┌──────────────────────────┐
│  Raspberry Pi (本番運用)  │
│  ┌────────────────────┐  │
│  │  Docker Compose    │  │
│  │  ┌──────────────┐  │  │
│  │  │  Bot         │  │  │
│  │  │  Container   │  │  │
│  │  └──────────────┘  │  │
│  │  ┌──────────────┐  │  │
│  │  │  Cloudflare  │  │  │
│  │  │  Tunnel      │  │  │
│  │  └──────────────┘  │  │
│  └────────────────────┘  │
└──────────────────────────┘
       │
       ▼ HTTPS (安全な公開)
┌─────────────┐
│ 外部サービス │
│ (Webhook)   │
└─────────────┘
```

---

## 必要な環境

### PC開発環境

- **Node.js**: v18以上
- **npm**: v9以上
- **Git**: 任意のバージョン
- **エディタ**: VS Code推奨

### Raspberry Pi運用環境

- **OS**: Raspberry Pi OS (Debian系)
- **Docker**: 20.10以上
- **Docker Compose**: v2.0以上
- **Git**: 任意のバージョン

### 必要なアカウント

- Discord Developer Account (ボットトークン取得用)
- Cloudflare Account (Tunnel設定用)

---

## セットアップ

### 1. PC開発環境のセットアップ

#### 1.1 リポジトリのクローン

```bash
git clone https://github.com/Ryota-Shiohara/yagapon-notifier.git
cd yagapon-notifier
```

#### 1.2 依存関係のインストール

```bash
npm install
```

#### 1.3 環境変数の設定

`.env.example`をコピーして`.env`を作成：

```bash
cp .env.example .env
```

`.env`を編集して以下の値を設定：

```env
# Discord Developer Portalで取得
DISCORD_TOKEN=あなたのボットトークン

# 任意の安全な文字列（例: openssl rand -base64 32 で生成）
BOT_NOTIFY_SECRET=あなたの秘密鍵

# Discordで右クリック→IDをコピー（開発者モード有効化が必要）
NOTIFICATION_CHANNEL_ID=通知先チャンネルID

# サーバーポート
PORT=3000

# Cloudflare Tunnel設定後に追加
CLOUDFLARE_TUNNEL_TOKEN=あとで設定
```

#### 1.4 開発サーバーの起動

```bash
npm run dev
```

✅ `http://localhost:3000` でサーバーが起動します。

#### 1.5 動作確認

別のターミナルで以下を実行：

```bash
# ヘルスチェック
curl http://localhost:3000/health

# 通知テスト（BOT_NOTIFY_SECRETを実際の値に置き換え）
curl -X POST http://localhost:3000/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer あなたの秘密鍵" \
  -d '{"title":"テスト通知","description":"動作確認"}'
```

---

### 2. Cloudflare Tunnelの設定

#### 2.1 Cloudflareアカウントでトンネルを作成

1. [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) にアクセス
2. **Access** → **Tunnels** → **Create a tunnel**
3. トンネル名を入力（例: `yagapon-notifier`）
4. **Docker** を選択
5. 表示されたトークンをコピー

#### 2.2 トンネルの設定

1. **Public Hostname** を追加
   - **Subdomain**: 任意（例: `yagapon-bot`）
   - **Domain**: あなたのドメイン（Cloudflareで管理）
   - **Type**: HTTP
   - **URL**: `bot:3000`（Docker Composeのサービス名）

2. **Save tunnel**

#### 2.3 トークンを.envに追加

```env
CLOUDFLARE_TUNNEL_TOKEN=コピーしたトークン
```

---

### 3. Raspberry Piでの運用

#### 3.1 Raspberry Piの準備

Dockerをインストール：

```bash
# Dockerのインストール
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 現在のユーザーをdockerグループに追加
sudo usermod -aG docker $USER

# 再ログイン後、確認
docker --version
docker compose version
```

#### 3.2 リポジトリのクローン

```bash
git clone https://github.com/Ryota-Shiohara/yagapon-notifier.git
cd yagapon-notifier
```

#### 3.3 環境変数の設定

PC開発環境と同じように`.env`を作成：

```bash
cp .env.example .env
nano .env  # または vi .env
```

**重要**: `.env`には本番用の値を設定してください。

#### 3.4 Dockerコンテナの起動

```bash
# ビルドして起動（初回・コード変更時）
docker compose up -d --build

# ログの確認
docker compose logs -f

# 停止
docker compose down

# 再起動
docker compose restart
```

#### 3.5 自動起動の設定（オプション）

再起動時に自動で起動するようにDockerサービスを有効化：

```bash
sudo systemctl enable docker
```

`docker-compose.yml`の`restart: unless-stopped`により、コンテナも自動起動されます。

---

## 開発ワークフロー

### PC側での開発・更新

1. **コードを編集**

   ```bash
   npm run dev  # ホットリロードで開発
   ```

2. **動作確認**
   - ローカルでテスト
   - 必要に応じてDocker環境でもテスト

3. **変更をコミット**
   ```bash
   git add .
   git commit -m "機能追加: ○○○"
   git push origin main
   ```

### Raspberry Pi側での更新

1. **最新コードを取得**

   ```bash
   cd yagapon-notifier
   git pull origin main
   ```

2. **コンテナを再ビルド・再起動**

   ```bash
   docker compose up -d --build
   ```

3. **ログで動作確認**
   ```bash
   docker compose logs -f bot
   ```

---

## Docker使用方法

### 基本コマンド

```bash
# ビルドして起動（デタッチモード）
docker compose up -d --build

# ログをリアルタイムで表示
docker compose logs -f

# ボットのログのみ表示
docker compose logs -f bot

# コンテナの状態確認
docker compose ps

# コンテナを停止
docker compose down

# コンテナを再起動
docker compose restart

# コンテナに入る（デバッグ用）
docker compose exec bot sh
```

### ヘルスチェック確認

```bash
# ボットの健康状態を確認
docker inspect yagapon-notifier-bot | grep -A 10 Health
```

### イメージの削除（クリーンアップ）

```bash
# 使用していないイメージを削除
docker image prune -a

# すべてのコンテナとボリュームを削除（注意）
docker compose down -v
```

---

## トラブルシューティング

### ボットが起動しない

**症状**: コンテナが`Exited`状態になる

**確認手順**:

```bash
docker compose logs bot
```

**よくある原因**:

- `.env`の環境変数が不足または間違っている
- `DISCORD_TOKEN`が無効
- TypeScriptのビルドエラー

**解決方法**:

```bash
# .envを再確認
cat .env

# ローカルでビルドテスト
npm run build

# コンテナを再ビルド
docker compose up -d --build
```

---

### Cloudflare Tunnelが接続できない

**症状**: `cloudflared`コンテナがエラーで停止

**確認手順**:

```bash
docker compose logs cloudflared
```

**よくある原因**:

- `CLOUDFLARE_TUNNEL_TOKEN`が間違っている
- トンネル設定で`bot:3000`のマッピングが不正

**解決方法**:

1. Cloudflare Dashboardでトンネル設定を確認
2. `.env`のトークンを再確認
3. トンネルを削除して再作成

---

### Webhookが届かない

**症状**: `/notify`エンドポイントにリクエストしてもDiscordに通知されない

**確認手順**:

```bash
# ボットのログを確認
docker compose logs -f bot

# ヘルスチェック
curl https://あなたのドメイン/health

# 通知テスト
curl -X POST https://あなたのドメイン/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer あなたの秘密鍵" \
  -d '{"title":"テスト","description":"テスト通知"}'
```

**よくある原因**:

- `Authorization`ヘッダーが間違っている
- ボットがチャンネルにアクセスする権限がない
- ボットがまだ準備完了していない

**解決方法**:

1. Discordでボットの権限を確認
2. `.env`の`BOT_NOTIFY_SECRET`を確認
3. ボットが起動完了するまで待つ（`/health`で確認）

---

### ポート競合エラー

**症状**: `port is already allocated`

**解決方法**:

```bash
# 使用中のポートを確認
sudo lsof -i :3000

# プロセスを停止
sudo kill -9 <PID>

# または、docker-compose.ymlのポートを変更
ports:
  - "3001:3000"  # ホスト側を3001に変更
```

---

## 📚 その他のリソース

- [Discord.js ドキュメント](https://discord.js.org/)
- [Cloudflare Tunnel ドキュメント](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Docker Compose リファレンス](https://docs.docker.com/compose/)

---

## 作者

Ryota-Shiohara
