/**
 * src/middlewares/auth.ts
 *
 * 認証ミドルウェア
 * 仕様書 6.2 と 7.2 に基づく
 */

import { NextFunction, Request, Response } from 'express';

import { config } from '../config/env';

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    console.warn('認証ヘッダーなしで /notify へのアクセスがありました。');
    return res.status(401).send({ error: 'Authorization header is missing' });
  }

  // 'Bearer <token>' の形式を想定
  const token = authHeader.split(' ')[1];

  if (token !== config.BOT_NOTIFY_SECRET) {
    console.warn('無効なシークレットで /notify へのアクセスがありました。');
    return res.status(403).send({ error: 'Invalid secret token' });
  }

  // 認証成功
  next();
};
