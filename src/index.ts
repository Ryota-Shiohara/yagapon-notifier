import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from 'dotenv';

// .envファイルを読み込む
dotenv.config();

// Botクライアントの作成（Intentsは必要最小限または全部盛りで指定）
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // サーバー関連
        GatewayIntentBits.GuildMessages, // メッセージ関連
        GatewayIntentBits.MessageContent // メッセージの中身を読む（必須）
    ]
});

// 起動確認
client.once(Events.ClientReady, (c) => {
    console.log(`準備OK! ${c.user.tag} としてログインしました。`);
});

// メッセージへの応答 (Ping-Pong)
client.on(Events.MessageCreate, async (message) => {
    // Bot自身の発言は無視する
    if (message.author.bot) return;

    // "!ping" と打たれたら "Pong!" と返す
    if (message.content === '!ping') {
        await message.reply('Pong!');
    }
});

// ログイン
client.login(process.env.DISCORD_TOKEN);