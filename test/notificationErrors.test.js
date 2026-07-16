const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  NotificationPermanentError,
  NotificationTransientError,
  toNotificationError,
} = require('../dist/services/notificationErrors.js');

function assertTransient(error, retryAfterSeconds) {
  const classified = toNotificationError(error, 'テスト処理');
  assert.ok(classified instanceof NotificationTransientError);
  if (retryAfterSeconds !== undefined) {
    assert.equal(classified.retryAfterSeconds, retryAfterSeconds);
  }
}

test('一時エラーの名前とHTTPステータスを分類する', () => {
  const abortError = new Error('request aborted');
  abortError.name = 'AbortError';
  assertTransient(abortError);
  assertTransient({ status: 408 });
  assertTransient({ status: 429 });

  for (const status of [500, 502, 503, 504]) {
    assertTransient({ status });
  }
});

test('原因チェーン内のコードとstatusCodeを分類する', () => {
  assertTransient({ cause: { code: 'UND_ERR_SOCKET' } });
  assertTransient({ cause: { cause: { code: 'ECONNRESET' } } });
  assertTransient({ statusCode: 503 });
  assertTransient({ status: 400, statusCode: 503 });
});

test('RateLimitErrorのretryAfterはミリ秒から秒へ切り上げる', () => {
  assertTransient(
    { name: 'RateLimitError[/channels/:id/messages]', retryAfter: 1200 },
    2
  );
});

test('API本文のretry_afterは秒として扱う', () => {
  assertTransient({ status: 429, retry_after: 60 }, 60);
  assertTransient({ status: 429, retry_after: 0 }, 5);
  assertTransient({ status: 429, retry_after: 'not-a-number' }, 5);
});

test('恒久エラーと原因不明のエラーは再試行しない', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const classified = toNotificationError({ status }, 'テスト処理');
    assert.ok(classified instanceof NotificationPermanentError);
  }

  const classified = toNotificationError(
    new Error('invalid message'),
    'テスト処理'
  );
  assert.ok(classified instanceof NotificationPermanentError);

  assert.ok(
    toNotificationError(
      { name: 'SomeRateLimitError[/messages]' },
      'テスト処理'
    ) instanceof NotificationPermanentError
  );
});

test('循環したcauseでも無限ループせず分類できる', () => {
  const first = new Error('first');
  const second = new Error('second');
  first.cause = second;
  second.cause = first;

  const classified = toNotificationError(first, 'テスト処理');
  assert.ok(classified instanceof NotificationPermanentError);
});
