/**
 * Express/body-parserのエラーを外部向けの安全なレスポンスへ変換する。
 */

import { NextFunction, Request, Response } from 'express';

interface HttpErrorLike {
  type?: unknown;
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

function getErrorProperty(
  error: unknown,
  property: keyof HttpErrorLike
): unknown {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined;
  }

  try {
    return (error as HttpErrorLike)[property];
  } catch {
    return undefined;
  }
}

function getErrorType(error: unknown): string {
  const type = getErrorProperty(error, 'type');
  if (typeof type === 'string' && type.length > 0) {
    return sanitizeErrorType(type);
  }

  const name = getErrorProperty(error, 'name');
  if (typeof name === 'string' && name.length > 0) {
    return sanitizeErrorType(name);
  }

  return 'unknown_error';
}

function sanitizeErrorType(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return sanitized || 'unknown_error';
}

function getStatus(error: unknown): number | undefined {
  for (const property of ['status', 'statusCode'] as const) {
    const rawStatus = getErrorProperty(error, property);
    const status =
      typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);

    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  return undefined;
}

export function httpErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = res.locals.requestId ?? 'unknown';
  const errorType = getErrorType(error);
  const status = getStatus(error);
  const isParseError = errorType === 'entity.parse.failed';
  const isTooLarge = errorType === 'entity.too.large' || status === 413;
  const isUnsupportedEncoding =
    errorType === 'encoding.unsupported' || status === 415;

  const isClientError = status !== undefined && status >= 400 && status < 500;

  if (isParseError || isTooLarge || isUnsupportedEncoding || isClientError) {
    const responseStatus = isParseError
      ? 400
      : isTooLarge
        ? 413
        : isUnsupportedEncoding
          ? 415
          : (status ?? 400);
    const responseError = isParseError
      ? 'Invalid JSON'
      : isTooLarge
        ? 'Payload too large'
        : isUnsupportedEncoding
          ? 'Unsupported content encoding'
          : 'Invalid request body';

    console.warn(
      JSON.stringify({
        event: 'http_body_parser_error',
        requestId,
        method: req.method,
        path: req.path,
        status: responseStatus,
        errorType,
      })
    );
    res.status(responseStatus).send({
      error: responseError,
      retryable: false,
      requestId,
    });
    return;
  }

  console.error(
    JSON.stringify({
      event: 'http_unhandled_error',
      requestId,
      method: req.method,
      path: req.path,
      status: 500,
      errorType,
    })
  );
  res.status(500).send({
    error: 'Internal server error',
    retryable: true,
    requestId,
  });
}
