/**
 * Discord通知サービス
 * 通知データを受け取り、指定チャンネルにEmbedメッセージを送信
 */

import { Client, MessageCreateOptions, TextChannel } from 'discord.js';

import {
  ApplicationNotificationData,
  MonthlyData,
  NotificationPayload,
  ReceiptNotificationData,
  Schedule,
  ScheduleNotificationData,
} from '../types/notification';
import { ChannelResolver } from './channelResolver';
import {
  NotificationPermanentError,
  toNotificationError,
} from './notificationErrors';
import { createDiscordNonce } from './discordNonce';
import {
  ApplicationMessageStrategy,
  DailyMessageStrategy,
  MessageStrategy,
  MonthlyMessageStrategy,
  ReceiptMessageStrategy,
  ScheduleMessageStrategy,
} from './messageStrategies';

export interface NotificationRequestContext {
  requestId?: string;
  idempotencyKey?: string;
}

export class NotificationService {
  private channelResolver: ChannelResolver;
  private messageStrategies: Record<string, MessageStrategy>;

  constructor(private client: Client) {
    this.channelResolver = new ChannelResolver();
    // メッセージ戦略のマップを初期化
    this.messageStrategies = {
      daily: new DailyMessageStrategy(),
      monthly: new MonthlyMessageStrategy(),
      schedule: new ScheduleMessageStrategy(),
      application: new ApplicationMessageStrategy(),
      receipt: new ReceiptMessageStrategy(),
    };
  }

  /**
   * 通知ペイロードに基づいて通知を送信
   * @param payload 通知ペイロード（type と data を含む）
   */
  async sendNotificationByType(
    payload: NotificationPayload,
    context: NotificationRequestContext = {}
  ): Promise<void> {
    const { type, data, channelId: specifiedChannelId } = payload;
    const startedAt = Date.now();
    const requestId = context.requestId ?? 'unknown';

    console.info(
      JSON.stringify({
        event: 'discord_notification_started',
        requestId,
        idempotencyKey: context.idempotencyKey ?? null,
        type,
      })
    );

    // 適切な戦略を取得
    const strategy = this.messageStrategies[type];
    if (!strategy) {
      throw new Error(`Unknown notification type: ${type}`);
    }

    // 部署名を取得
    let department: string | undefined;
    let formType: string | undefined;
    if (type === 'daily') {
      department = (data as Schedule).department;
    } else if (type === 'monthly') {
      department = (data as MonthlyData).department;
    } else if (type === 'schedule') {
      const scheduleData = data as ScheduleNotificationData;
      department = scheduleData.department || scheduleData.after?.department;
    } else if (type === 'application') {
      const applicationData = data as ApplicationNotificationData;
      department = applicationData.organization;
      formType = applicationData.formType;
    } else if (type === 'receipt') {
      const receiptData = data as ReceiptNotificationData;
      department = receiptData.organizationName;
    }

    // チャンネルIDと通知先を解決
    const { channelId, roleId, source } =
      type === 'receipt'
        ? this.channelResolver.resolveReceiptChannel(specifiedChannelId)
        : this.channelResolver.resolveChannel(
            specifiedChannelId,
            department,
            formType
          );

    // チャンネルを取得
    let channel: Awaited<ReturnType<Client['channels']['fetch']>>;
    const channelFetchStartedAt = Date.now();
    try {
      console.info(
        JSON.stringify({
          event: 'discord_channel_fetch_started',
          requestId,
          type,
          channelId,
        })
      );
      channel = await this.client.channels.fetch(channelId);
      console.info(
        JSON.stringify({
          event: 'discord_channel_fetch_succeeded',
          requestId,
          type,
          channelId,
          durationMs: Date.now() - channelFetchStartedAt,
        })
      );
    } catch (error) {
      const classifiedError = toNotificationError(
        error,
        'Discordチャンネル取得'
      );
      console.error(
        JSON.stringify({
          event: 'discord_channel_fetch_failed',
          requestId,
          type,
          channelId,
          durationMs: Date.now() - channelFetchStartedAt,
          error: classifiedError.message,
        })
      );
      throw classifiedError;
    }

    if (!channel || !channel.isTextBased()) {
      throw new NotificationPermanentError(
        `チャンネルID ${channelId} が見つからないか、テキストチャンネルではありません。`
      );
    }

    // 戦略を使ってメッセージを構築
    let message;
    try {
      message = strategy.build(data, roleId);
    } catch (error) {
      throw new NotificationPermanentError(
        `Discordメッセージの構築に失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }

    // チャンネルにEmbedを送信
    const messageSendStartedAt = Date.now();
    try {
      console.info(
        JSON.stringify({
          event: 'discord_message_send_started',
          requestId,
          type,
          channelId,
        })
      );
      const sendOptions: MessageCreateOptions = context.idempotencyKey
        ? {
            ...message,
            nonce: createDiscordNonce(context.idempotencyKey),
            enforceNonce: true,
          }
        : message;
      await (channel as TextChannel).send(sendOptions);
    } catch (error) {
      const classifiedError = toNotificationError(
        error,
        'Discordメッセージ送信'
      );
      console.error(
        JSON.stringify({
          event: 'discord_message_send_failed',
          requestId,
          type,
          channelId,
          durationMs: Date.now() - messageSendStartedAt,
          error: classifiedError.message,
        })
      );
      throw classifiedError;
    }

    console.log(
      `${type}通知を${department ? `${department}の` : ''}チャンネル ${channelId} に送信しました。` +
        ` (source=${source}, specifiedChannelId=${specifiedChannelId ?? 'undefined'}, formType=${formType ?? 'undefined'}, department=${department ?? 'undefined'})`
    );
    console.info(
      JSON.stringify({
        event: 'discord_notification_succeeded',
        requestId,
        idempotencyKey: context.idempotencyKey ?? null,
        type,
        channelId,
        durationMs: Date.now() - startedAt,
      })
    );
  }

  /**
   * Daily通知を送信（後方互換性のため残す）
   * @deprecated sendNotificationByType を使用してください
   */
  async sendNotification(payload: Schedule): Promise<void> {
    await this.sendNotificationByType({ type: 'daily', data: payload });
  }
}
