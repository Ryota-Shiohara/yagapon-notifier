/**
 * 通知エンドポイント
 * POST /notify で外部サービスからの通知を受け付ける
 */

import { Request, Response, Router } from 'express';

import { authMiddleware } from '../middlewares/auth';
import { sendClientError, sendServerError } from '../middlewares/httpResponses';
import {
  ClaimMutationResult,
  IdempotencyStore,
} from '../services/idempotencyStore';
import { NotificationService } from '../services/notificationService';
import {
  NotificationPermanentError,
  NotificationTransientError,
} from '../services/notificationErrors';
import { NotificationPayload } from '../types/notification';

const SCHEDULE_ACTIONS = new Set(['add', 'update', 'delete']);
const APPLICATION_EVENTS = new Set(['created', 'updated']);
const RECEIPT_EVENTS = new Set(['created', 'edited']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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

function logClaimMutationResult(
  result: ClaimMutationResult,
  requestId: string,
  idempotencyKey: string,
  operation: 'complete' | 'release'
): void {
  if (result.state === 'updated') return;

  console.warn(
    JSON.stringify({
      event:
        result.state === 'ownership_lost'
          ? 'idempotency_claim_ownership_lost'
          : 'idempotency_claim_missing',
      requestId,
      idempotencyKey,
      operation,
    })
  );
}

async function releaseIdempotencyClaim(
  idempotencyStore: IdempotencyStore,
  idempotencyKey: string,
  claimId: string,
  requestId: string
): Promise<void> {
  try {
    const result = await idempotencyStore.release(idempotencyKey, claimId);
    logClaimMutationResult(result, requestId, idempotencyKey, 'release');
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'idempotency_release_failed',
        requestId,
        idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

export function createNotifyRouter(
  notificationService: NotificationService,
  getBotReadyStatus: () => boolean,
  idempotencyStore: IdempotencyStore
): Router {
  const router = Router();

  router.post(
    '/notify',
    authMiddleware,
    async (req: Request, res: Response) => {
      const requestId = res.locals.requestId ?? 'unknown';
      const idempotencyKey = res.locals.idempotencyKey as string | undefined;

      console.info(
        JSON.stringify({
          event: 'notify_request_received',
          requestId,
          idempotencyKey: idempotencyKey ?? null,
        })
      );

      if (res.locals.idempotencyKeyInvalid) {
        return sendClientError(
          res,
          requestId,
          400,
          'Idempotency-Key is too long'
        );
      }

      if (!idempotencyKey) {
        console.warn(
          JSON.stringify({
            event: 'notify_idempotency_key_missing',
            requestId,
          })
        );
      }

      let activeClaimId: string | undefined;
      try {
        // 仕様書 4. データモデル に基づくペイロード
        const payload = req.body as NotificationPayload | undefined;

        // 最小限のバリデーション
        if (!payload || !payload.type || !payload.data) {
          return sendClientError(
            res,
            requestId,
            400,
            'Missing required fields: type, data'
          );
        }

        if (
          !['daily', 'monthly', 'schedule', 'application', 'receipt'].includes(
            payload.type
          )
        ) {
          return sendClientError(
            res,
            requestId,
            400,
            'Invalid type. Supported values: daily, monthly, schedule, application, receipt'
          );
        }

        // 型に応じた基本的なバリデーション
        if (payload.type === 'daily' && !payload.data.title) {
          return sendClientError(
            res,
            requestId,
            400,
            'Missing required fields: data.title'
          );
        }

        if (
          payload.type === 'monthly' &&
          (!payload.data.department ||
            !payload.data.month ||
            !payload.data.schedules)
        ) {
          return sendClientError(
            res,
            requestId,
            400,
            'Missing required fields: data.department, data.month, data.schedules'
          );
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
            return sendClientError(
              res,
              requestId,
              400,
              'Missing required fields: data.action, data.title, data.startAt, data.endAt'
            );
          }

          if (!SCHEDULE_ACTIONS.has(action)) {
            return sendClientError(
              res,
              requestId,
              400,
              'Invalid data.action. Supported values: add, update, delete'
            );
          }

          if (
            !isIso8601WithTimezone(startAt) ||
            !isIso8601WithTimezone(endAt)
          ) {
            return sendClientError(
              res,
              requestId,
              400,
              'data.startAt and data.endAt must be ISO 8601 strings with timezone'
            );
          }

          if (action === 'update') {
            if (
              !after ||
              !changedDetails ||
              !Array.isArray(changedDetails) ||
              changedDetails.length === 0
            ) {
              return sendClientError(
                res,
                requestId,
                400,
                'Missing required fields for update: data.after, data.changedDetails'
              );
            }

            if (!after.title || !after.startAt || !after.endAt) {
              return sendClientError(
                res,
                requestId,
                400,
                'Missing required fields in data.after: title, startAt, endAt'
              );
            }

            if (
              !isIso8601WithTimezone(after.startAt) ||
              !isIso8601WithTimezone(after.endAt)
            ) {
              return sendClientError(
                res,
                requestId,
                400,
                'data.after.startAt and data.after.endAt must be ISO 8601 strings with timezone'
              );
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
              return sendClientError(
                res,
                requestId,
                400,
                'data.changedDetails must be an array of { field, before, after }'
              );
            }
          }

          if (action === 'delete' && changedDetails !== undefined) {
            if (
              !Array.isArray(changedDetails) ||
              !changedDetails.every(
                (detail) =>
                  detail &&
                  typeof detail.field === 'string' &&
                  detail.field.length > 0 &&
                  typeof detail.before === 'string' &&
                  typeof detail.after === 'string'
              )
            ) {
              return sendClientError(
                res,
                requestId,
                400,
                'data.changedDetails must be an array of { field, before, after }'
              );
            }
          }

          if (before) {
            if (!before.title || !before.startAt || !before.endAt) {
              return sendClientError(
                res,
                requestId,
                400,
                'Missing required fields in data.before: title, startAt, endAt'
              );
            }

            if (
              !isIso8601WithTimezone(before.startAt) ||
              !isIso8601WithTimezone(before.endAt)
            ) {
              return sendClientError(
                res,
                requestId,
                400,
                'data.before.startAt and data.before.endAt must be ISO 8601 strings with timezone'
              );
            }
          }
        }

        if (payload.type === 'application') {
          const {
            event,
            eventName,
            applicant,
            changedDetails,
            formType,
            formName,
            applicationId,
            description,
            url,
            organization,
            section,
            appliedAt,
            updatedBy,
          } = payload.data;

          if (!event || !eventName || !applicant) {
            return sendClientError(
              res,
              requestId,
              400,
              'Missing required fields: data.event, data.eventName, data.applicant'
            );
          }

          if (!APPLICATION_EVENTS.has(event)) {
            return sendClientError(
              res,
              requestId,
              400,
              'Invalid data.event. Supported values: created, updated'
            );
          }

          const optionalStringFields: Array<[string, unknown]> = [
            ['data.changedDetails', changedDetails],
            ['data.formType', formType],
            ['data.formName', formName],
            ['data.applicationId', applicationId],
            ['data.description', description],
            ['data.url', url],
            ['data.organization', organization],
            ['data.section', section],
            ['data.appliedAt', appliedAt],
            ['data.updatedBy', updatedBy],
          ];

          const invalidField = optionalStringFields.find(
            ([, value]) => value !== undefined && typeof value !== 'string'
          );

          if (invalidField) {
            return sendClientError(
              res,
              requestId,
              400,
              `${invalidField[0]} must be a string`
            );
          }

          if (
            appliedAt &&
            typeof appliedAt === 'string' &&
            !isIso8601WithTimezone(appliedAt)
          ) {
            return sendClientError(
              res,
              requestId,
              400,
              'data.appliedAt must be an ISO 8601 string with timezone'
            );
          }
        }

        if (payload.type === 'receipt') {
          const {
            event,
            organizationId,
            submissionId,
            organizationName,
            eventName,
            applicant,
            submittedBy,
            submittedAt,
            occurredAt,
            items,
            receiptFiles,
          } = payload.data;

          const requiredStringFields: Array<[string, unknown]> = [
            ['data.organizationId', organizationId],
            ['data.submissionId', submissionId],
            ['data.organizationName', organizationName],
            ['data.applicant', applicant],
            ['data.submittedAt', submittedAt],
            ['data.occurredAt', occurredAt],
          ];
          const missingField = requiredStringFields.find(
            ([, value]) => !isNonEmptyString(value)
          );

          if (!event || missingField) {
            return sendClientError(
              res,
              requestId,
              400,
              `Missing required field: ${missingField?.[0] ?? 'data.event'}`
            );
          }

          if (!RECEIPT_EVENTS.has(event)) {
            return sendClientError(
              res,
              requestId,
              400,
              'Invalid data.event. Supported values: created, edited'
            );
          }

          const optionalStringFields: Array<[string, unknown]> = [
            ['data.eventName', eventName],
            ['data.submittedBy', submittedBy],
          ];
          const invalidOptionalField = optionalStringFields.find(
            ([, value]) => value !== undefined && typeof value !== 'string'
          );

          if (invalidOptionalField) {
            return sendClientError(
              res,
              requestId,
              400,
              `${invalidOptionalField[0]} must be a string`
            );
          }

          if (
            !isIso8601WithTimezone(submittedAt) ||
            !isIso8601WithTimezone(occurredAt)
          ) {
            return sendClientError(
              res,
              requestId,
              400,
              'data.submittedAt and data.occurredAt must be ISO 8601 strings with timezone'
            );
          }

          if (
            !Array.isArray(items) ||
            !items.every(
              (item) =>
                item &&
                isNonEmptyString(item.itemName) &&
                typeof item.actualPrice === 'number' &&
                Number.isFinite(item.actualPrice) &&
                item.actualPrice >= 0 &&
                typeof item.wasActuallyPurchased === 'boolean'
            )
          ) {
            return sendClientError(
              res,
              requestId,
              400,
              'data.items must be an array of valid receipt items'
            );
          }

          if (
            !Array.isArray(receiptFiles) ||
            !receiptFiles.every(
              (file) =>
                file &&
                isNonEmptyString(file.fileName) &&
                typeof file.webViewLink === 'string'
            )
          ) {
            return sendClientError(
              res,
              requestId,
              400,
              'data.receiptFiles must be an array of valid receipt files'
            );
          }
        }

        if (idempotencyKey) {
          let claim;
          try {
            claim = await idempotencyStore.begin(idempotencyKey);
          } catch (error) {
            console.error(
              JSON.stringify({
                event: 'idempotency_claim_failed',
                requestId,
                error: error instanceof Error ? error.message : String(error),
              })
            );
            res.setHeader('Retry-After', '10');
            return res.status(503).send({
              error: 'Notification deduplication store is unavailable',
              retryable: true,
              requestId,
            });
          }

          if (claim.state === 'completed') {
            console.info(
              JSON.stringify({
                event: 'notification_duplicate_ignored',
                requestId,
                idempotencyKey,
              })
            );
            return res.status(200).send({
              success: true,
              message: 'Notification already processed',
              duplicate: true,
              requestId,
            });
          }

          if (claim.state === 'processing') {
            console.warn(
              JSON.stringify({
                event: 'notification_already_processing',
                requestId,
                idempotencyKey,
              })
            );
            res.setHeader('Retry-After', '5');
            return res.status(503).send({
              error: 'Notification is already being processed',
              retryable: true,
              requestId,
            });
          }

          if (claim.state !== 'new') {
            throw new Error('Unexpected idempotency claim state');
          }
          activeClaimId = claim.claimId;
        }

        // ボットの準備状態を確認
        if (!getBotReadyStatus()) {
          console.warn(
            JSON.stringify({
              event: 'notification_bot_not_ready',
              requestId,
            })
          );
          if (activeClaimId && idempotencyKey) {
            await releaseIdempotencyClaim(
              idempotencyStore,
              idempotencyKey,
              activeClaimId,
              requestId
            );
            activeClaimId = undefined;
          }
          res.setHeader('Retry-After', '10');
          return res.status(503).send({
            error: 'Discord bot is not ready yet',
            retryable: true,
            requestId,
          });
        }

        // 通知を送信（戦略パターンで自動的に適切な処理が選択される）
        await notificationService.sendNotificationByType(payload, {
          requestId,
          idempotencyKey,
        });

        if (activeClaimId && idempotencyKey) {
          try {
            const result = await idempotencyStore.complete(
              idempotencyKey,
              activeClaimId
            );
            logClaimMutationResult(
              result,
              requestId,
              idempotencyKey,
              'complete'
            );
          } catch (error) {
            // Discord送信自体は成功しているため、再送を誘発しないよう200を返す。
            console.error(
              JSON.stringify({
                event: 'idempotency_completion_persist_failed',
                requestId,
                idempotencyKey,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          }
          activeClaimId = undefined;
        }

        res.status(200).send({
          success: true,
          message: 'Notification sent',
          requestId,
        });
      } catch (error) {
        if (activeClaimId && idempotencyKey) {
          await releaseIdempotencyClaim(
            idempotencyStore,
            idempotencyKey,
            activeClaimId,
            requestId
          );
          activeClaimId = undefined;
        }

        if (error instanceof NotificationTransientError) {
          console.error(
            JSON.stringify({
              event: 'notification_delivery_transient_failure',
              requestId,
              retryAfterSeconds: error.retryAfterSeconds,
              error: error.message,
            })
          );
          res.setHeader('Retry-After', String(error.retryAfterSeconds));
          return res.status(503).send({
            error: 'Temporary notification delivery failure',
            retryable: true,
            requestId,
          });
        }

        if (error instanceof NotificationPermanentError) {
          console.error(
            JSON.stringify({
              event: 'notification_delivery_permanent_failure',
              requestId,
              error: error.message,
            })
          );
          return res.status(422).send({
            error: 'Notification could not be delivered',
            retryable: false,
            requestId,
          });
        }

        console.error(
          JSON.stringify({
            event: 'notification_processing_failed',
            requestId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        return sendServerError(res, requestId);
      }
    }
  );

  return router;
}
