export interface MarkdownPreviewConfig {
  enabled: boolean;
  publicUrl: string;
  channelIds: string[];
  storePath: string;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  ttlMs: number;
  downloadTimeoutMs: number;
  cleanupIntervalMs: number;
}

export function readMarkdownPreviewConfig(
  env: NodeJS.ProcessEnv = process.env
): MarkdownPreviewConfig {
  const positive = (name: string, fallback: number) => {
    if (!env[name]) return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} は正の整数を指定してください。`);
    }
    return value;
  };
  const enabled = env.MARKDOWN_PREVIEW_ENABLED === 'true';
  const channelIds = (env.MARKDOWN_PREVIEW_CHANNEL_IDS ?? '*')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  let publicUrl = '';
  if (enabled) {
    if (
      !channelIds.length ||
      channelIds.some((id) => id !== '*' && !/^\d{17,20}$/.test(id))
    ) {
      throw new Error(
        'MARKDOWN_PREVIEW_CHANNEL_IDS に * またはチャンネルIDを指定してください。'
      );
    }
    try {
      const url = new URL(env.MARKDOWN_PREVIEW_PUBLIC_URL || '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.origin.length > 1000
      ) {
        throw new Error();
      }
      publicUrl = url.origin;
    } catch {
      throw new Error(
        'MARKDOWN_PREVIEW_PUBLIC_URL にHTTPSの公開オリジンを指定してください。'
      );
    }
  }
  return {
    enabled,
    publicUrl,
    channelIds,
    storePath: env.MARKDOWN_PREVIEW_STORE_PATH || 'data/markdown',
    maxFileBytes: positive('MARKDOWN_PREVIEW_MAX_FILE_BYTES', 1024 * 1024),
    maxTotalBytes: positive(
      'MARKDOWN_PREVIEW_MAX_TOTAL_BYTES',
      100 * 1024 * 1024
    ),
    maxFiles: positive('MARKDOWN_PREVIEW_MAX_FILES', 1000),
    ttlMs: positive('MARKDOWN_PREVIEW_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    downloadTimeoutMs: positive('MARKDOWN_PREVIEW_DOWNLOAD_TIMEOUT_MS', 10000),
    cleanupIntervalMs: positive(
      'MARKDOWN_PREVIEW_CLEANUP_INTERVAL_MS',
      60 * 60 * 1000
    ),
  };
}
