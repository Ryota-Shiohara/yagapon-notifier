/**
 * Bearer Token認証ミドルウェア
 */

import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { config } from '../config/env';

import { sendClientError } from './httpResponses';
export function parseBearerToken(header: string): string | undefined {
  const match = /^Bearer[ \t]+([^ \t]+)[ \t]*$/i.exec(header);
  return match?.[1];
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const requestId = res.locals.requestId ?? 'unknown';

  if (!authHeader) {
    console.warn(
      JSON.stringify({
        event: 'notify_auth_rejected',
        requestId,
        reason: 'missing_authorization_header',
      })
    );
    return sendClientError(
      res,
      requestId,
      401,
      'Authorization header is missing'
    );
  }

  const token = parseBearerToken(authHeader);

  if (!token || !tokensEqual(token, config.BOT_NOTIFY_SECRET)) {
    console.warn(
      JSON.stringify({
        event: 'notify_auth_rejected',
        requestId,
        reason: 'invalid_bearer_token',
      })
    );
    return sendClientError(res, requestId, 403, 'Invalid secret token');
  }

  // 認証成功
  next();
};
