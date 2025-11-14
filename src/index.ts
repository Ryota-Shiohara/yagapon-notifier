/**
 * src/index.ts
 *
 * 仕様設計書 (v2) に基づくDiscordボット兼Expressサーバー
 * 1. Discordボットとしてログイン
 * 2. Expressサーバーを起動し、Functionsからの通知を /notify で待ち受ける
 * 3. 認証ミドルウェアでリクエストを検証
 * 4. 検証成功後、指定されたチャンネルにEmbedメッセージを送信
 */

import 'dotenv/config'; // .envファイルを読み込む
import express, { Request, Response, NextFunction } from 'express';
import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
  ColorResolvable,
} from 'discord.js';

// --- 1. 環境変数の読み込みと検証 ---
// 仕様書 9. フェーズ1-2 と 7.2 に基づく
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BOT_NOTIFY_SECRET = process.env.BOT_NOTIFY_SECRET;
const NOTIFICATION_CHANNEL_ID = process.env.NOTIFICATION_CHANNEL_ID;
const PORT = process.env.PORT || 3000; // Expressサーバーがリッスンするポート

if (!DISCORD_TOKEN || !BOT_NOTIFY_SECRET || !NOTIFICATION_CHANNEL_ID) {
  throw new Error(
    '.envファイルに必要な環境変数が設定されていません。(DISCORD_TOKEN, BOT_NOTIFY_SECRET, NOTIFICATION_CHANNEL_ID)',
  );
}

// --- 2. Expressサーバーのセットアップ ---
// 仕様書 6.1 に基づく
const app = express();
// JSONリクエストボディをパースするためのミドルウェア (仕様書 6.3)
app.use(express.json());

// --- 3. Discordクライアントのセットアップ ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // チャンネルの情報を取得するために必要
    GatewayIntentBits.GuildMessages, // メッセージ関連
    GatewayIntentBits.MessageContent, // メッセージの中身を読む（!ping機能に必要）
  ],
});

// ボットの準備状態を管理
let isBotReady = false;

// --- 4. 認証ミドルウェアの実装 ---
// 仕様書 6.2 と 7.2 に基づく
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.warn('認証ヘッダーなしで /notify へのアクセスがありました。');
    return res.status(401).send({ error: 'Authorization header is missing' });
  }

  // 'Bearer <token>' の形式を想定
  const token = authHeader.split(' ')[1];

  if (token !== BOT_NOTIFY_SECRET) {
    console.warn('無効なシークレットで /notify へのアクセスがありました。');
    return res.status(403).send({ error: 'Invalid secret token' });
  }

  // 認証成功
  next();
};

// --- 5. ヘルスチェックエンドポイント ---
// Docker Composeのヘルスチェック用
app.get('/health', (req: Request, res: Response) => {
  if (isBotReady) {
    res.status(200).send({ status: 'ok', bot: 'ready' });
  } else {
    res.status(503).send({ status: 'unavailable', bot: 'not ready' });
  }
});

// --- 6. 通知受け取りエンドポイントの実装 ---
// 仕様書 6.1, 6.2, 6.3 に基づく
app.post('/notify', authMiddleware, async (req: Request, res: Response) => {
  console.log('/notify エンドポイントにリクエスト受信');
  try {
    // ボットの準備状態を確認
    if (!isBotReady) {
      console.warn('Discordボットがまだ準備できていません。');
      return res.status(503).send({ error: 'Discord bot is not ready yet' });
    }
    // 仕様書 4. データモデル に基づくペイロード
    const { id, title, description, remindTime, location, department }  = req.body;

    // 最小限のバリデーション
    if (!title) {
      return res.status(400).send({ error: 'Missing required fields: title' });
    }

    // 仕様書 6.3 に基づき、チャンネルを取得
    const channel = await client.channels.fetch(NOTIFICATION_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
      // Discord Embed を作成
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor('#0099ff') // デフォルト色
      
      // descriptionが空文字列でない場合のみ設定
      if (description && description.trim().length > 0) {
        embed.setDescription(description);
      }

      if (department) {
        embed.setAuthor({ name: department });
      }

      // locationが空でない場合のみフィールドを追加
      if (location && location.trim().length > 0) {
        embed.addFields({ name: '場所', value: location });
      }

      // チャンネルにEmbedを送信
      await (channel as TextChannel).send({ embeds: [embed] });

      console.log(`通知をチャンネル ${NOTIFICATION_CHANNEL_ID} に送信しました。`);
      res.status(200).send({ success: true, message: 'Notification sent' });

    } else {
      console.error(`チャンネルID ${NOTIFICATION_CHANNEL_ID} が見つからないか、テキストチャンネルではありません。`);
      res.status(500).send({ error: 'Notification channel not found or is not a text channel' });
    }
  } catch (error) {
    console.error('通知処理中にエラーが発生しました:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

// --- 6. Discordボットの準備完了イベント ---
client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Discord準備OK！ ${readyClient.user.tag} としてログインしました。`);
  isBotReady = true;
});

// --- 7. 既存機能: メッセージへの応答 (Ping-Pong) ---
client.on(Events.MessageCreate, async (message) => {
  // Bot自身の発言は無視する
  if (message.author.bot) return;

  // "!ping" と打たれたら "Pong!" と返す
  if (message.content === '!ping') {
    await message.reply('Pong!');
  }
});

// --- 8. サーバーとボットの起動 ---
// 仕様書 6.1 と 8.6 に基づき、login() の「前」に listen() を呼ぶ
app.listen(PORT, () => {
  console.log(`🔥 HTTPサーバーが http://localhost:${PORT} で起動しました。`);
  
  // Expressサーバーが起動してからDiscordボットをログインさせる
  console.log('Discordボットをログインさせています...');
  client.login(DISCORD_TOKEN);
});