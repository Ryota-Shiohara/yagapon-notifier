/**
 * 通知APIのエラーレスポンスを統一するヘルパー。
 */

import { Response } from 'express';

export function sendClientError(
  res: Response,
  requestId: string,
  status: number,
  error: string
): Response {
  return res.status(status).send({
    error,
    retryable: false,
    requestId,
  });
}

export function sendServerError(
  res: Response,
  requestId: string,
  error = 'Internal server error'
): Response {
  return res.status(500).send({
    error,
    retryable: true,
    requestId,
  });
}
