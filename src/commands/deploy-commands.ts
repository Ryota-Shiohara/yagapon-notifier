/**
 * Discord APIにコマンドを登録するスクリプト
 * 使用方法: npm run deploy-commands
 */

import { REST, Routes } from 'discord.js';
import { config } from '../config/env';
import { commands } from './index';

// 環境変数からアプリケーションIDとギルドIDを取得
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // テスト用のサーバーID（任意）

if (!CLIENT_ID) {
  throw new Error(
    '.envファイルにDISCORD_CLIENT_IDが設定されていません。\n' +
      'Discord Developer PortalからアプリケーションのクライアントIDを取得して設定してください。'
  );
}

// コマンドデータをJSON形式に変換
const commandsData = Array.from(commands.values()).map((command) =>
  command.data.toJSON()
);

// Discord REST APIクライアントを初期化
const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

/**
 * コマンドをDiscord APIに登録
 */
async function deployCommands() {
  try {
    console.log(
      `🚀 ${commandsData.length}個のスラッシュコマンドを登録しています...`
    );

    let data;

    if (GUILD_ID) {
      // ギルドコマンドとして登録（特定のサーバーのみ、即座に反映）
      console.log(`📍 ギルドID ${GUILD_ID} に登録します（テスト用）`);
      data = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID),
        {
          body: commandsData,
        }
      );
    } else {
      // グローバルコマンドとして登録（全サーバーで利用可能、反映に最大1時間）
      console.log('🌍 グローバルコマンドとして登録します（本番用）');
      data = await rest.put(Routes.applicationCommands(CLIENT_ID!), {
        body: commandsData,
      });
    }

    console.log(`✅ ${(data as any).length}個のコマンドの登録に成功しました！`);
    console.log(
      '\n登録されたコマンド:',
      commandsData.map((cmd) => `/${cmd.name}`).join(', ')
    );
  } catch (error) {
    console.error('❌ コマンドの登録に失敗しました:', error);
    process.exit(1);
  }
}

deployCommands();
