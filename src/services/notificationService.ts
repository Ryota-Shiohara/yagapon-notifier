/**
 * Discord通知サービス
 * 通知データを受け取り、指定チャンネルにEmbedメッセージを送信
 */

import { Client, EmbedBuilder, TextChannel } from 'discord.js';

import { getDepartmentColor } from '../config/departmentColors';
import { config } from '../config/env';
import { NotificationPayload } from '../types/notification';

export class NotificationService {
  constructor(private client: Client) {}

  async sendNotification(payload: NotificationPayload): Promise<void> {
    const { title, description, remindTime, location, department } = payload;

    // チャンネルを取得
    const channel = await this.client.channels.fetch(
      config.NOTIFICATION_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) {
      throw new Error(
        `チャンネルID ${config.NOTIFICATION_CHANNEL_ID} が見つからないか、テキストチャンネルではありません。`
      );
    }

    // Discord Embed を作成
    const embed = new EmbedBuilder().setColor(getDepartmentColor(department));

    const embedDescription = `
## 明日は${title}だぽん！

${description || ''}

場所: ${location || '未定'}
時間: ${remindTime || '未定'}
    `.trim();

    // descriptionが空文字列でない場合のみ設定
    if (embedDescription && embedDescription.trim().length > 0) {
      embed.setDescription(embedDescription);
    }

    if (department) {
      embed.setFooter({ text: department });
    }

    // チャンネルにEmbedを送信
    await (channel as TextChannel).send({
      content: `<@&${'1438943768702357646'}>`,
      embeds: [embed],
    });

    console.log(
      `通知をチャンネル ${config.NOTIFICATION_CHANNEL_ID} に送信しました。`
    );
  }
}
