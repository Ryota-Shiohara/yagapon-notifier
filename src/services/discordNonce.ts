/**
 * Idempotency-KeyからDiscordメッセージ用の決定的nonceを生成する。
 */

import { createHash } from 'node:crypto';

const DISCORD_NONCE_PREFIX = 'yagamy-notifier:v1:';
const DISCORD_NONCE_LENGTH = 24;

export function createDiscordNonce(idempotencyKey: string): string {
  return createHash('sha256')
    .update(`${DISCORD_NONCE_PREFIX}${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, DISCORD_NONCE_LENGTH);
}
