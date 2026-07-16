const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.DISCORD_TOKEN = 'test-discord-token';
process.env.BOT_NOTIFY_SECRET = 'test-notify-secret';
process.env.NOTIFICATION_CHANNEL_ID = 'default-channel-id';
process.env.FORM_CHANNELS = '{}';
process.env.FORM_ROLES = '{}';
process.env.DEPARTMENT_CHANNELS = '{}';
process.env.DEPARTMENT_ROLES = '{}';
process.env.PORT = '3000';
process.env.IDEMPOTENCY_STORE_PATH = 'test-data/idempotency.json';

const { createDiscordNonce } = require('../dist/services/discordNonce.js');
const {
  NotificationService,
} = require('../dist/services/notificationService.js');

function createPayload() {
  return {
    type: 'application',
    data: {
      event: 'created',
      eventName: 'テスト申請',
      applicant: 'テスト申請者',
      organization: '総務局',
      formType: 'committee_join_request',
      formName: '参加申請（テスト）',
    },
    channelId: 'test-channel-id',
  };
}

function createFakeClient(sentMessages) {
  return {
    channels: {
      fetch: async (channelId) => {
        assert.equal(channelId, 'test-channel-id');
        return {
          isTextBased: () => true,
          send: async (message) => {
            sentMessages.push(message);
            return { id: 'existing-or-new-message' };
          },
        };
      },
    },
  };
}

test('Idempotency-KeyがあるとnonceとenforceNonceを送信オプションへ付ける', async () => {
  const sentMessages = [];
  const service = new NotificationService(createFakeClient(sentMessages));
  const idempotencyKey = 'notification-123';

  await service.sendNotificationByType(createPayload(), {
    requestId: 'request-123',
    idempotencyKey,
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].nonce, createDiscordNonce(idempotencyKey));
  assert.equal(sentMessages[0].enforceNonce, true);
});

test('Idempotency-Keyがない場合はnonceオプションを付けない', async () => {
  const sentMessages = [];
  const service = new NotificationService(createFakeClient(sentMessages));

  await service.sendNotificationByType(createPayload());

  assert.equal(sentMessages.length, 1);
  assert.equal(Object.hasOwn(sentMessages[0], 'nonce'), false);
  assert.equal(Object.hasOwn(sentMessages[0], 'enforceNonce'), false);
});
