/**
 * src/bot.ts
 *
 * Discordクライアントの設定とイベント処理
 */

import { Client, Events, GatewayIntentBits } from 'discord.js';

import { config } from './config/env';

export class DiscordBot {
  public client: Client;
  private isReady: boolean = false;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds, // チャンネルの情報を取得するために必要
        GatewayIntentBits.GuildMessages, // メッセージ関連
        GatewayIntentBits.MessageContent, // メッセージの中身を読む（!ping機能に必要）
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // ボットの準備完了イベント
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(
        `✅ Discord準備OK！ ${readyClient.user.tag} としてログインしました。`
      );
      this.isReady = true;
    });

    // メッセージへの応答 (Ping-Pong)
    this.client.on(Events.MessageCreate, async (message) => {
      // Bot自身の発言は無視する
      if (message.author.bot) return;

      // "!ping" と打たれたら "Pong!" と返す
      if (message.content === '!ping') {
        await message.reply('Pong!');
      }
    });
  }

  async login(): Promise<void> {
    console.log('Discordボットをログインさせています...');
    await this.client.login(config.DISCORD_TOKEN);
  }

  getReadyStatus(): boolean {
    return this.isReady;
  }
}
