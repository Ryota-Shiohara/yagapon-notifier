const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.DISCORD_TOKEN = 'test-discord-token';
process.env.BOT_NOTIFY_SECRET = 'test-notify-secret';
process.env.NOTIFICATION_CHANNEL_ID = 'default-channel-id';
process.env.RECEIPT_NOTIFICATION_CHANNEL_ID = 'receipt-channel-id';
process.env.RECEIPT_NOTIFICATION_ROLE_ID = 'receipt-role-id';
process.env.CARD_STATEMENT_NOTIFICATION_CHANNEL_ID = 'card-channel-id';
process.env.CARD_STATEMENT_NOTIFICATION_ROLE_ID = 'card-role-id';
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

function createReceiptPayload() {
  return {
    type: 'receipt',
    data: {
      event: 'created',
      organizationId: 'organization-1',
      submissionId: 'submission-1',
      organizationName: 'テスト団体',
      applicant: 'テスト申請者',
      submittedAt: '2026-08-02T10:00:00+09:00',
      occurredAt: '2026-08-02T10:00:05+09:00',
      items: [],
      receiptFiles: [],
    },
  };
}

function createFakeClient(sentMessages, expectedChannelId = 'test-channel-id') {
  return {
    channels: {
      fetch: async (channelId) => {
        assert.equal(channelId, expectedChannelId);
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

test('領収書通知は専用チャンネルとロールメンションを使用する', async () => {
  const sentMessages = [];
  const service = new NotificationService(
    createFakeClient(sentMessages, 'receipt-channel-id')
  );

  await service.sendNotificationByType(createReceiptPayload());

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].content, '<@&receipt-role-id>');
});

test('カード明細通知は領収書と別の専用チャンネルとロールを使う', async () => {
  const messages = [];
  const service = new NotificationService(
    createFakeClient(messages, 'card-channel-id')
  );
  const payload = createReceiptPayload();
  payload.data.event = 'cardStatementUpdated';
  await service.sendNotificationByType(payload);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, '<@&card-role-id>');
  assert.equal(
    messages[0].embeds[0].toJSON().title,
    '【更新】クレジットカード明細'
  );
});

test('カード明細でも明示したチャンネル指定を優先しメンションしない', async () => {
  const messages = [];
  const service = new NotificationService(createFakeClient(messages));
  const payload = createReceiptPayload();
  payload.data.event = 'cardStatementUpdated';
  payload.channelId = 'test-channel-id';
  await service.sendNotificationByType(payload);
  assert.equal(messages[0].content, '');
});

test('カード明細の専用設定がなければデフォルトへ送り領収書ロールを使わない', () => {
  const { config } = require('../dist/config/env.js');
  const { ChannelResolver } = require('../dist/services/channelResolver.js');
  const originalChannel = config.CARD_STATEMENT_NOTIFICATION_CHANNEL_ID;
  const originalRole = config.CARD_STATEMENT_NOTIFICATION_ROLE_ID;
  try {
    config.CARD_STATEMENT_NOTIFICATION_CHANNEL_ID = undefined;
    config.CARD_STATEMENT_NOTIFICATION_ROLE_ID = undefined;
    assert.deepEqual(
      new ChannelResolver().resolveCardStatementChannel('preset'),
      {
        channelId: 'default-channel-id',
        roleId: undefined,
        source: 'default',
      }
    );
  } finally {
    config.CARD_STATEMENT_NOTIFICATION_CHANNEL_ID = originalChannel;
    config.CARD_STATEMENT_NOTIFICATION_ROLE_ID = originalRole;
  }
});
