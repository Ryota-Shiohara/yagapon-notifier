/**
 * Discord通知サービス
 * 通知データを受け取り、指定チャンネルにEmbedメッセージを送信
 */

import { Client, TextChannel } from 'discord.js';

import {
  MonthlyData,
  NotificationPayload,
  Schedule,
  ScheduleNotificationData,
} from '../types/notification';
import { ChannelResolver } from './channelResolver';
import {
  DailyMessageStrategy,
  MessageStrategy,
  MonthlyMessageStrategy,
  ScheduleMessageStrategy,
} from './messageStrategies';

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
    };
  }

  /**
   * 通知ペイロードに基づいて通知を送信
   * @param payload 通知ペイロード（type と data を含む）
   */
  async sendNotificationByType(payload: NotificationPayload): Promise<void> {
    const { type, data, channelId: specifiedChannelId } = payload;

    // 適切な戦略を取得
    const strategy = this.messageStrategies[type];
    if (!strategy) {
      throw new Error(`Unknown notification type: ${type}`);
    }

    // 部署名を取得
    let department: string | undefined;
    if (type === 'daily') {
      department = (data as Schedule).department;
    } else if (type === 'monthly') {
      department = (data as MonthlyData).department;
    } else if (type === 'schedule') {
      const scheduleData = data as ScheduleNotificationData;
      department = scheduleData.department || scheduleData.after?.department;
    }

    // チャンネルIDと通知先を解決
    const { channelId, roleId } = this.channelResolver.resolveChannel(
      specifiedChannelId,
      department
    );

    // チャンネルを取得
    const channel = await this.client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      throw new Error(
        `チャンネルID ${channelId} が見つからないか、テキストチャンネルではありません。`
      );
    }

    // 戦略を使ってメッセージを構築
    const message = strategy.build(data, roleId);

    // チャンネルにEmbedを送信
    await (channel as TextChannel).send(message);

    console.log(
      `${type}通知を${department ? `${department}の` : ''}チャンネル ${channelId} に送信しました。`
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
