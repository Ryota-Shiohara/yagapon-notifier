/**
 * HTTPリクエストの追跡情報を付与し、開始・終了・切断を記録するミドルウェア
 */

import { randomUUID } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

const IDEMPOTENCY_KEY_MAX_LENGTH = 256;

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = randomUUID();
  const rawIdempotencyKey = req.header('Idempotency-Key');
  const idempotencyKey = rawIdempotencyKey?.trim();

  res.locals.requestId = requestId;
  res.locals.idempotencyKey =
    idempotencyKey && idempotencyKey.length <= IDEMPOTENCY_KEY_MAX_LENGTH
      ? idempotencyKey
      : undefined;
  res.locals.idempotencyKeyInvalid = Boolean(
    idempotencyKey && idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
  );
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  let completed = false;

  console.info(
    JSON.stringify({
      event: 'http_request_started',
      requestId,
      method: req.method,
      path: req.path,
      idempotencyKey: res.locals.idempotencyKey ?? null,
    })
  );

  const logCompletion = (
    event: 'http_request_completed' | 'http_request_aborted'
  ) => {
    if (completed) return;
    completed = true;

    console.info(
      JSON.stringify({
        event,
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      })
    );
  };

  res.once('finish', () => logCompletion('http_request_completed'));
  res.once('close', () => logCompletion('http_request_aborted'));

  next();
}
