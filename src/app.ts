/**
 * Expressアプリケーションのセットアップ
 */

import express, { Express } from 'express';

import { DiscordBot } from './bot';
import { createHealthRouter } from './routes/health';
import { createNotifyRouter } from './routes/notify';
import { NotificationService } from './services/notificationService';

export function createApp(bot: DiscordBot): Express {
  const app = express();

  // JSONリクエストボディをパースするためのミドルウェア (仕様書 6.3)
  app.use(express.json());

  // 通知サービスのインスタンス作成
  const notificationService = new NotificationService(bot.client);

  // ルーターの設定
  app.use(createHealthRouter(() => bot.getReadyStatus()));
  app.use(createNotifyRouter(notificationService, () => bot.getReadyStatus()));

  return app;
}
