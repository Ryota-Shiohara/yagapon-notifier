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

    // 局名に応じたチャンネルIDとロールIDを取得（見つからない場合はデフォルト）
    const channelId =
      (department && config.DEPARTMENT_CHANNELS[department]) ||
      config.NOTIFICATION_CHANNEL_ID;
    const roleId = department && config.DEPARTMENT_ROLES[department];

    // チャンネルを取得
    const channel = await this.client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      throw new Error(
        `チャンネルID ${channelId} が見つからないか、テキストチャンネルではありません。`
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
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [embed],
    });

    console.log(
      `通知を${department ? `${department}の` : ''}チャンネル ${channelId} に送信しました。`
    );
  }
}
