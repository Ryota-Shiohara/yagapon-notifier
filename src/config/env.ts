/**
 * 環境変数の読み込みと検証
 */

import 'dotenv/config';

interface EnvConfig {
  DISCORD_TOKEN: string;
  BOT_NOTIFY_SECRET: string;
  NOTIFICATION_CHANNEL_ID: string;
  DEPARTMENT_CHANNELS: Record<string, string>;
  DEPARTMENT_ROLES: Record<string, string>;
  PORT: number;
  MONTHLY_URL?: string;
}

function validateEnv(): EnvConfig {
  const {
    DISCORD_TOKEN,
    BOT_NOTIFY_SECRET,
    NOTIFICATION_CHANNEL_ID,
    DEPARTMENT_CHANNELS,
    DEPARTMENT_ROLES,
    PORT,
    MONTHLY_URL,
  } = process.env;

  if (!DISCORD_TOKEN || !BOT_NOTIFY_SECRET || !NOTIFICATION_CHANNEL_ID) {
    throw new Error(
      '.envファイルに必要な環境変数が設定されていません。(DISCORD_TOKEN, BOT_NOTIFY_SECRET, NOTIFICATION_CHANNEL_ID)'
    );
  }

  // DEPARTMENT_CHANNELSをパース
  let departmentChannels: Record<string, string> = {};
  if (DEPARTMENT_CHANNELS) {
    try {
      const sanitized = DEPARTMENT_CHANNELS.replace(/\s+/g, ' ').trim();
      departmentChannels = JSON.parse(sanitized);
    } catch (error) {
      console.warn(
        'DEPARTMENT_CHANNELSのパースに失敗しました。デフォルトチャンネルを使用します。',
        error
      );
    }
  }

  // DEPARTMENT_ROLESをパース
  let departmentRoles: Record<string, string> = {};
  if (DEPARTMENT_ROLES) {
    try {
      const sanitized = DEPARTMENT_ROLES.replace(/\s+/g, ' ').trim();
      departmentRoles = JSON.parse(sanitized);
    } catch (error) {
      console.warn(
        'DEPARTMENT_ROLESのパースに失敗しました。デフォルトロールを使用します。',
        error
      );
    }
  }

  return {
    DISCORD_TOKEN,
    BOT_NOTIFY_SECRET,
    NOTIFICATION_CHANNEL_ID,
    DEPARTMENT_CHANNELS: departmentChannels,
    DEPARTMENT_ROLES: departmentRoles,
    PORT: parseInt(PORT || '3000', 10),
    MONTHLY_URL,
  };
}

export const config = validateEnv();
