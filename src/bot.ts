/**
 * Discordボットの初期化とイベント処理
 */

import { Client, Events, GatewayIntentBits, Message } from 'discord.js';

import { commands } from './commands';
import { config } from './config/env';
import { handleMessage } from './handlers/messageHandler';

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

    // スラッシュコマンドのハンドリング
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = commands.get(interaction.commandName);

      if (!command) {
        console.error(`コマンド ${interaction.commandName} が見つかりません。`);
        return;
      }

      try {
        await command.execute(interaction);
        console.log(
          `✅ コマンド /${interaction.commandName} を ${interaction.user.tag} が実行しました。`
        );
      } catch (error) {
        console.error(`❌ コマンド実行エラー:`, error);
        const errorMessage = {
          content: 'コマンドの実行中にエラーが発生しました。',
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    });

    // メッセージへの応答 (トリガー + Ping) - トリガーハンドラを優先して呼ぶ
    this.client.on(Events.MessageCreate, async (message: Message) => {
      try {
        // 先にトリガー処理。発火したら以降の処理は行わない
        const handled = await handleMessage(message);
        if (handled) return;
      } catch (err) {
        console.error('Error in trigger handler:', err);
      }

      // 下位互換: "!ping" と打たれたら "Pong!" と返す
      if (!message.author.bot && message.content === '!ping') {
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
