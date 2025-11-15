# 🤖 Yagapon Notifier

Discord Webhook通知機能を持つDiscordボット。  
PC開発 → GitHub管理 → Raspberry Pi運用 のワークフローに対応。

## 📋 目次

- [概要](#概要)
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
