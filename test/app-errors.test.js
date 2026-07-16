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
process.env.PORT = '3000';

const testDirectory = mkdtempSync(join(tmpdir(), 'yagapon-notifier-test-'));
process.env.IDEMPOTENCY_STORE_PATH = join(testDirectory, 'idempotency.json');

const { createApp } = require('../dist/app.js');

after(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

function createBot({ throwOnReady = false } = {}) {
  return {
    client: {
      channels: {
        fetch: async () => {
          throw new Error('Discord should not be called in this test');
        },
      },
    },
    getReadyStatus: () => {
      if (throwOnReady) throw new Error('internal-test-secret');
      return true;
    },
  };
}

async function withServer(bot, callback) {
  const server = createApp(bot).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl, body, headers = {}) {
  const response = await fetch(`${baseUrl}/notify`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-notify-secret',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
  return {
    response,
    body: await response.json(),
  };
}

test('不正JSONは400かつretryable falseでrequestIdを返す', async () => {
  await withServer(createBot(), async (baseUrl) => {
    const { response, body } = await postJson(baseUrl, '{"type":');

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Invalid JSON');
    assert.equal(body.retryable, false);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  });
});

test('100KBを超えるJSONは413で返す', async () => {
  await withServer(createBot(), async (baseUrl) => {
    const body = JSON.stringify({ data: 'x'.repeat(110 * 1024) });
    const { response, body: responseBody } = await postJson(baseUrl, body);

    assert.equal(response.status, 413);
    assert.equal(responseBody.error, 'Payload too large');
    assert.equal(responseBody.retryable, false);
    assert.equal(responseBody.requestId, response.headers.get('x-request-id'));
  });
});

test('未対応のcontent encodingは415で返す', async () => {
  await withServer(createBot(), async (baseUrl) => {
    const { response, body } = await postJson(baseUrl, '{}', {
      'Content-Encoding': 'compress',
    });

    assert.equal(response.status, 415);
    assert.equal(body.error, 'Unsupported content encoding');
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(body.retryable, false);
  });
});

test('予期しない例外だけが500かつretryable trueになる', async () => {
  await withServer(createBot({ throwOnReady: true }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, 'Internal server error');
    assert.equal(body.retryable, true);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('internal-test-secret'), false);
  });
});
