/**
 * 通知エンドポイント
 * POST /notify で外部サービスからの通知を受け付ける
 */

import { Request, Response, Router } from 'express';

import { authMiddleware } from '../middlewares/auth';
import { NotificationService } from '../services/notificationService';
import { NotificationPayload } from '../types/notification';

export function createNotifyRouter(
  notificationService: NotificationService,
  getBotReadyStatus: () => boolean
): Router {
  const router = Router();

  router.post(
    '/notify',
    authMiddleware,
    async (req: Request, res: Response) => {
      console.log('/notify エンドポイントにリクエスト受信');
      try {
        // ボットの準備状態を確認
        if (!getBotReadyStatus()) {
          console.warn('Discordボットがまだ準備できていません。');
          return res
            .status(503)
            .send({ error: 'Discord bot is not ready yet' });
        }

        // 仕様書 4. データモデル に基づくペイロード
        const payload: NotificationPayload = req.body;

        // 最小限のバリデーション
        if (!payload.type || !payload.data) {
          return res
            .status(400)
            .send({ error: 'Missing required fields: type, data' });
        }

        // 型に応じた基本的なバリデーション
        if (payload.type === 'daily' && !payload.data.title) {
          return res
            .status(400)
            .send({ error: 'Missing required fields: data.title' });
        }

        if (
          payload.type === 'monthly' &&
          (!payload.data.department ||
            !payload.data.month ||
            !payload.data.schedules)
        ) {
          return res.status(400).send({
            error:
              'Missing required fields: data.department, data.month, data.schedules',
          });
        }

        // 通知を送信（戦略パターンで自動的に適切な処理が選択される）
        await notificationService.sendNotificationByType(payload);

        res.status(200).send({ success: true, message: 'Notification sent' });
      } catch (error) {
        console.error('通知処理中にエラーが発生しました:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  return router;
}
