/**
 * Application通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { ApplicationNotificationData } from '../../types/notification';
import { MessageContent, MessageStrategy } from './baseMessageStrategy';

export class ApplicationMessageStrategy
  implements MessageStrategy<ApplicationNotificationData>
{
  private readonly CREATED_COLOR = '#22c55e';
  private readonly UPDATED_COLOR = '#f59e0b';

  build(data: ApplicationNotificationData, roleId?: string): MessageContent {
    const mentionPart = roleId ? `<@&${roleId}>` : '';
    const eventLabel = data.event === 'created' ? '新規' : '編集';

    const details: string[] = [
      `企画名：${data.eventName}`,
      `団体名：${data.organization || '未設定'}`,
      `申請者：${data.applicant}`,
    ];

    const embed = new EmbedBuilder()
      .setColor(
        data.event === 'created' ? this.CREATED_COLOR : this.UPDATED_COLOR
      )
      .setTitle(`【${eventLabel}】${data.eventName}`)
      .setDescription(details.join('\n'));

    const formLabel = data.formName || data.formType;
    if (formLabel) {
      embed.setFooter({
        text: formLabel,
      });
    }

    return {
      content: mentionPart,
      embeds: [embed],
    };
  }
}
