const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test, after } = require('node:test');

process.env.DISCORD_TOKEN = 'test-discord-token';
process.env.BOT_NOTIFY_SECRET = 'test-notify-secret';
process.env.NOTIFICATION_CHANNEL_ID = 'default-channel-id';
process.env.FORM_CHANNELS = '{}';
process.env.FORM_ROLES = '{}';
process.env.DEPARTMENT_CHANNELS = '{}';
process.env.DEPARTMENT_ROLES = '{}';

const testDirectory = mkdtempSync(join(tmpdir(), 'yagapon-notify-response-'));
process.env.IDEMPOTENCY_STORE_PATH = join(testDirectory, 'idempotency.json');

const { createApp } = require('../dist/app.js');

after(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

function createBot({ throwOnReady = false, channel } = {}) {
  return {
    client: {
      channels: {
        fetch: async () => channel,
      },
    },
    getReadyStatus: () => {
      if (throwOnReady) {
        throw new Error('internal-test-secret');
      }
      return true;
    },
  };
}

async function withServer(bot, callback) {
  const server = createApp(bot).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl, payload, options = {}) {
  const authorization = Object.prototype.hasOwnProperty.call(
    options,
    'authorization'
  )
    ? options.authorization
    : 'Bearer test-notify-secret';
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (authorization !== undefined) {
    headers.Authorization = authorization;
  }

  const response = await fetch(baseUrl + '/notify', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

function validApplication() {
  return {
    type: 'application',
    data: {
      event: 'created',
      eventName: 'test event',
      applicant: 'test applicant',
    },
  };
}

function validCommitteeApplication() {
  return {
    type: 'application',
    data: {
      event: 'created',
      eventName: '企画長申請',
      applicant: '毛蟹',
      applicationId: 'application-1',
      formType: '委員ロール申請',
      formName: 'Discord委員プロフィール',
      organization: 'IT局',
      description: '企画: ITラボ',
      committeeRole: '企画長',
      bureau: 'IT局',
      grade: '２年生',
      discordUserId: '123456789',
      supportUserExists: true,
      status: 'pending',
    },
  };
}

function validReceipt() {
  return {
    type: 'receipt',
    data: {
      event: 'created',
      organizationId: 'organization-1',
      submissionId: 'submission-1',
      organizationName: 'test organization',
      eventName: 'test event',
      applicant: 'test applicant',
      submittedAt: '2026-08-02T10:00:00+09:00',
      occurredAt: '2026-08-02T10:00:05+09:00',
      items: [
        {
          budgetItemId: 'budget-item-1',
          itemName: 'test item',
          actualPrice: 1200,
          purpose: 'test purpose',
          companyName: 'test company',
          wasActuallyPurchased: true,
        },
      ],
      receiptFiles: [
        {
          fileId: 'drive-file-1',
          fileName: 'receipt.pdf',
          webViewLink: 'https://example.test/receipt.pdf',
        },
      ],
    },
  };
}

test('notifyのバリデーション400はretryable falseとrequestIdを返す', async () => {
  const invalidPayloads = [
    {},
    { type: 'unknown', data: {} },
    { type: 'daily', data: {} },
    { type: 'monthly', data: {} },
    {
      type: 'schedule',
      data: {
        action: 'invalid',
        title: 'test',
        startAt: '2026-07-17T00:00:00Z',
        endAt: '2026-07-17T01:00:00Z',
      },
    },
    {
      type: 'application',
      data: {
        event: 'created',
        eventName: 'test',
        applicant: 'test',
        description: 123,
      },
    },
    {
      ...validCommitteeApplication(),
      data: {
        ...validCommitteeApplication().data,
        committeeRole: '神',
      },
    },
    {
      ...validCommitteeApplication(),
      data: {
        ...validCommitteeApplication().data,
        supportUserExists: undefined,
      },
    },
    {
      ...validReceipt(),
      data: {
        ...validReceipt().data,
        event: 'updated',
      },
    },
    {
      ...validReceipt(),
      data: {
        ...validReceipt().data,
        items: [{ itemName: 'broken item' }],
      },
    },
  ];

  await withServer(createBot(), async (baseUrl) => {
    for (const payload of invalidPayloads) {
      const { response, body } = await postJson(baseUrl, payload);
      assert.equal(response.status, 400);
      assert.equal(body.retryable, false);
      assert.equal(body.requestId, response.headers.get('x-request-id'));
    }
  });
});

test('正しい領収書通知を受け付ける', async () => {
  const sentMessages = [];
  const channel = {
    isTextBased: () => true,
    send: async (message) => {
      sentMessages.push(message);
      return { id: 'receipt-message' };
    },
  };

  await withServer(createBot({ channel }), async (baseUrl) => {
    const { response, body } = await postJson(baseUrl, validReceipt());

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(sentMessages.length, 1);
  });
});

test('Functionsの委員ロール申請契約を受け付けてDiscordへ送る', async () => {
  const sentMessages = [];
  const channel = {
    isTextBased: () => true,
    send: async (message) => {
      sentMessages.push(message);
      return { id: 'committee-role-message' };
    },
  };

  await withServer(createBot({ channel }), async (baseUrl) => {
    const { response, body } = await postJson(
      baseUrl,
      validCommitteeApplication()
    );

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(sentMessages.length, 1);
    const embed = sentMessages[0].embeds[0].toJSON();
    assert.equal(embed.title, '【役職申請】企画長');
    assert.equal(embed.color, 0x008736);
    assert.match(embed.description, /IT局 \/ ２年生/);
    assert.match(embed.fields[0].value, /users登録あり/);
    assert.match(embed.fields[2].value, /123456789/);
    assert.equal(embed.footer.text, '申請ID: application-1');
  });
});

test('カード明細通知のリンクをDiscordへ送り、不正なファイルは拒否する', async () => {
  const sentMessages = [];
  const channel = {
    isTextBased: () => true,
    send: async (message) => {
      sentMessages.push(message);
      return { id: 'card-message' };
    },
  };
  const payload = validReceipt();
  payload.data.event = 'cardStatementUpdated';
  payload.data.cardStatementFiles = [
    {
      fileId: 'card-1',
      fileName: 'card.pdf',
      webViewLink: 'https://example.test/card',
    },
  ];
  await withServer(createBot({ channel }), async (baseUrl) => {
    const { response } = await postJson(baseUrl, payload);
    assert.equal(response.status, 200);
    const embed = sentMessages[0].embeds[0].toJSON();
    assert.equal(embed.title, '【更新】クレジットカード明細');
    assert.match(
      embed.fields.find((field) => field.name === 'クレジットカード明細').value,
      /https:\/\/example.test\/card/
    );
    for (const invalidFiles of [
      null,
      {},
      [null],
      [{ fileId: '1', fileName: 'card.pdf', webViewLink: 123 }],
    ]) {
      payload.data.cardStatementFiles = invalidFiles;
      const { response: invalidResponse } = await postJson(baseUrl, payload);
      assert.equal(invalidResponse.status, 400);
    }
    assert.equal(sentMessages.length, 1);
  });
});

test('長すぎるIdempotency-Keyは400のクライアントエラーになる', async () => {
  await withServer(createBot(), async (baseUrl) => {
    const { response, body } = await postJson(
      baseUrl,
      {},
      {
        headers: { 'Idempotency-Key': 'a'.repeat(257) },
      }
    );

    assert.equal(response.status, 400);
    assert.equal(body.retryable, false);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  });
});

test('notifyの認証エラーはrequestIdを含む', async () => {
  await withServer(createBot(), async (baseUrl) => {
    for (const [authorization, status] of [
      [undefined, 401],
      ['Basic test-notify-secret', 403],
    ]) {
      const options = { authorization };
      const { response, body } = await postJson(
        baseUrl,
        validApplication(),
        options
      );
      assert.equal(response.status, status);
      assert.equal(body.retryable, false);
      assert.equal(body.requestId, response.headers.get('x-request-id'));
    }
  });
});

test('Discordの恒久エラーは422かつ再試行不可で返る', async () => {
  await withServer(createBot(), async (baseUrl) => {
    const { response, body } = await postJson(baseUrl, validApplication());

    assert.equal(response.status, 422);
    assert.equal(body.retryable, false);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  });
});

test('notifyの予期しない例外は500かつ再試行可能で返る', async () => {
  await withServer(createBot({ throwOnReady: true }), async (baseUrl) => {
    const { response, body } = await postJson(baseUrl, validApplication());

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
    assert.equal(body.retryable, true);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('internal-test-secret'), false);
  });
});
