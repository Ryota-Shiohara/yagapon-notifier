const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createDiscordNonce } = require('../dist/services/discordNonce.js');

test('同じIdempotency-Keyから同じnonceを生成する', () => {
  const first = createDiscordNonce('notification-123');
  const second = createDiscordNonce('notification-123');

  assert.equal(first, second);
  assert.equal(first.length, 24);
  assert.match(first, /^[0-9a-f]+$/);
});

test('異なるキーから異なるnonceを生成し、元のキーを露出しない', () => {
  const key = 'notification-456';
  const nonce = createDiscordNonce(key);

  assert.notEqual(nonce, createDiscordNonce('notification-457'));
  assert.equal(nonce.includes(key), false);
});
