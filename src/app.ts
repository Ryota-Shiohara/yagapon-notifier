/**
 * Expressアプリケーションのセットアップ
 */

import express, { Express } from 'express';

import { DiscordBot } from './bot';
import { config } from './config/env';
import { httpErrorHandler } from './middlewares/httpErrorHandler';
import { requestContextMiddleware } from './middlewares/requestContext';
import { createHealthRouter } from './routes/health';
import { createNotifyRouter } from './routes/notify';
import { IdempotencyStore } from './services/idempotencyStore';
import { NotificationService } from './services/notificationService';

export function createApp(bot: DiscordBot): Express {
  const app = express();

  // JSONパースより前にリクエストIDと受信ログを付与する
  app.use(requestContextMiddleware);

  // JSONリクエストボディをパースするためのミドルウェア (仕様書 6.3)
  app.use(express.json());

  // 通知サービスのインスタンス作成
  const notificationService = new NotificationService(bot.client);
  const idempotencyStore = new IdempotencyStore(
    config.IDEMPOTENCY_STORE_PATH,
    config.IDEMPOTENCY_TTL_MS,
    config.IDEMPOTENCY_PROCESSING_TTL_MS
  );

  // ルーターの設定
  app.use(createHealthRouter(() => bot.getReadyStatus()));
  app.use(
    createNotifyRouter(
      notificationService,
      () => bot.getReadyStatus(),
      idempotencyStore
    )
  );

  app.use(httpErrorHandler);

  return app;
}
