/**
 * 環境変数の読み込みと検証
 */

import 'dotenv/config';

interface EnvConfig {
  DISCORD_TOKEN: string;
  BOT_NOTIFY_SECRET: string;
  NOTIFICATION_CHANNEL_ID: string;
  PORT: number;
}

function validateEnv(): EnvConfig {
  const { DISCORD_TOKEN, BOT_NOTIFY_SECRET, NOTIFICATION_CHANNEL_ID, PORT } =
    process.env;

  if (!DISCORD_TOKEN || !BOT_NOTIFY_SECRET || !NOTIFICATION_CHANNEL_ID) {
    throw new Error(
      '.envファイルに必要な環境変数が設定されていません。(DISCORD_TOKEN, BOT_NOTIFY_SECRET, NOTIFICATION_CHANNEL_ID)'
    );
  }

  return {
    DISCORD_TOKEN,
    BOT_NOTIFY_SECRET,
    NOTIFICATION_CHANNEL_ID,
    PORT: parseInt(PORT || '3000', 10),
  };
}

export const config = validateEnv();
