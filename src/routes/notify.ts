/**
 * 通知エンドポイント
 * POST /notify で外部サービスからの通知を受け付ける
 */

import { Request, Response, Router } from 'express';

import { authMiddleware } from '../middlewares/auth';
import { NotificationService } from '../services/notificationService';
import { NotificationPayload } from '../types/notification';

const SCHEDULE_ACTIONS = new Set(['add', 'update', 'delete']);

function isIso8601WithTimezone(value: string): boolean {
  if (typeof value !== 'string') return false;

  const iso8601Pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

  if (!iso8601Pattern.test(value)) {
    return false;
  }

  const parsedDate = new Date(value);
  return !Number.isNaN(parsedDate.getTime());
}

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

        if (!['daily', 'monthly', 'schedule'].includes(payload.type)) {
          return res.status(400).send({
            error: 'Invalid type. Supported values: daily, monthly, schedule',
          });
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

        if (payload.type === 'schedule') {
          const {
            action,
            title,
            startAt,
            endAt,
            after,
            changedDetails,
            before,
          } = payload.data;

          if (!action || !title || !startAt || !endAt) {
            return res.status(400).send({
              error:
                'Missing required fields: data.action, data.title, data.startAt, data.endAt',
            });
          }

          if (!SCHEDULE_ACTIONS.has(action)) {
            return res.status(400).send({
              error:
                'Invalid data.action. Supported values: add, update, delete',
            });
          }

          if (
            !isIso8601WithTimezone(startAt) ||
            !isIso8601WithTimezone(endAt)
          ) {
            return res.status(400).send({
              error:
                'data.startAt and data.endAt must be ISO 8601 strings with timezone',
            });
          }

          if (action === 'update' || action === 'delete') {
            if (
              !after ||
              !changedDetails ||
              !Array.isArray(changedDetails) ||
              changedDetails.length === 0
            ) {
              return res.status(400).send({
                error:
                  'Missing required fields for update/delete: data.after, data.changedDetails',
              });
            }

            if (!after.title || !after.startAt || !after.endAt) {
              return res.status(400).send({
                error:
                  'Missing required fields in data.after: title, startAt, endAt',
              });
            }

            if (
              !isIso8601WithTimezone(after.startAt) ||
              !isIso8601WithTimezone(after.endAt)
            ) {
              return res.status(400).send({
                error:
                  'data.after.startAt and data.after.endAt must be ISO 8601 strings with timezone',
              });
            }

            if (
              !changedDetails.every(
                (detail) =>
                  detail &&
                  typeof detail.field === 'string' &&
                  detail.field.length > 0 &&
                  typeof detail.before === 'string' &&
                  typeof detail.after === 'string'
              )
            ) {
              return res.status(400).send({
                error:
                  'data.changedDetails must be an array of { field, before, after }',
              });
            }
          }

          if (before) {
            if (!before.title || !before.startAt || !before.endAt) {
              return res.status(400).send({
                error:
                  'Missing required fields in data.before: title, startAt, endAt',
              });
            }

            if (
              !isIso8601WithTimezone(before.startAt) ||
              !isIso8601WithTimezone(before.endAt)
            ) {
              return res.status(400).send({
                error:
                  'data.before.startAt and data.before.endAt must be ISO 8601 strings with timezone',
              });
            }
          }
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
