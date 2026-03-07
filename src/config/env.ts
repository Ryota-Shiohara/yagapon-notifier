/**
 * 環境変数の読み込みと検証
 */

import 'dotenv/config';

interface EnvConfig {
  DISCORD_TOKEN: string;
  BOT_NOTIFY_SECRET: string;
  NOTIFICATION_CHANNEL_ID: string;
  FORM_CHANNELS: Record<string, string>;
  FORM_ROLES: Record<string, string>;
  DEPARTMENT_CHANNELS: Record<string, string>;
  DEPARTMENT_ROLES: Record<string, string>;
  PORT: number;
  MONTHLY_URL?: string;
}

function parseJsonEnvRecord(
  name: string,
  rawValue: string | undefined,
  parseFailMessage: string
): Record<string, string> {
  if (!rawValue) {
    console.warn(`[env] ${name} が未設定です。空の設定として扱います。`);
    return {};
  }

  try {
    const sanitized = rawValue.replace(/\s+/g, ' ').trim();
    const parsed = JSON.parse(sanitized);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(
        `[env] ${name} はJSONオブジェクト形式である必要があります。空の設定として扱います。`
      );
      return {};
    }

    const record = parsed as Record<string, string>;
    const keys = Object.keys(record);
    console.info(
      `[env] ${name} の読み込みに成功しました。キー数: ${keys.length}${keys.length > 0 ? ` (${keys.join(', ')})` : ''}`
    );
    return record;
  } catch (error) {
    console.warn(parseFailMessage, error);
    return {};
  }
}

function validateEnv(): EnvConfig {
  const {
    DISCORD_TOKEN,
    BOT_NOTIFY_SECRET,
    NOTIFICATION_CHANNEL_ID,
    FORM_CHANNELS,
    FORM_ROLES,
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

  const formChannels = parseJsonEnvRecord(
    'FORM_CHANNELS',
    FORM_CHANNELS,
    'FORM_CHANNELSのパースに失敗しました。フォーム別チャンネル設定をスキップします。'
  );

  const departmentChannels = parseJsonEnvRecord(
    'DEPARTMENT_CHANNELS',
    DEPARTMENT_CHANNELS,
    'DEPARTMENT_CHANNELSのパースに失敗しました。デフォルトチャンネルを使用します。'
  );

  const formRoles = parseJsonEnvRecord(
    'FORM_ROLES',
    FORM_ROLES,
    'FORM_ROLESのパースに失敗しました。フォーム別ロール設定をスキップします。'
  );

  const departmentRoles = parseJsonEnvRecord(
    'DEPARTMENT_ROLES',
    DEPARTMENT_ROLES,
    'DEPARTMENT_ROLESのパースに失敗しました。デフォルトロールを使用します。'
  );

  return {
    DISCORD_TOKEN,
    BOT_NOTIFY_SECRET,
    NOTIFICATION_CHANNEL_ID,
    FORM_CHANNELS: formChannels,
    FORM_ROLES: formRoles,
    DEPARTMENT_CHANNELS: departmentChannels,
    DEPARTMENT_ROLES: departmentRoles,
    PORT: parseInt(PORT || '3000', 10),
    MONTHLY_URL,
  };
}

export const config = validateEnv();
