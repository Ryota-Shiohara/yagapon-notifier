/**
 * Discord APIからコマンドを削除するスクリプト
 * 使用方法: npm run delete-commands
 */

import { REST, Routes } from 'discord.js';
import { config } from '../config/env';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!CLIENT_ID) {
  throw new Error('DISCORD_CLIENT_IDが設定されていません。');
}

const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

async function deleteCommands() {
  try {
    console.log('🗑️  コマンドを削除しています...');

    if (GUILD_ID) {
      // ギルドコマンドを削除
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID), {
        body: [],
      });
      console.log(`✅ ギルドID ${GUILD_ID} のコマンドを削除しました。`);
    } else {
      // グローバルコマンドを削除
      await rest.put(Routes.applicationCommands(CLIENT_ID!), {
        body: [],
      });
      console.log('✅ グローバルコマンドを削除しました。');
    }
  } catch (error) {
    console.error('❌ コマンドの削除に失敗しました:', error);
    process.exit(1);
  }
}

deleteCommands();
