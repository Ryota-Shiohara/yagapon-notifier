/**
 * Application通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { getDepartmentColor } from '../../config/departmentColors';
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

    if (data.formType === '委員ロール申請' || data.committeeRole) {
      const embed = new EmbedBuilder()
        .setColor(getDepartmentColor(data.bureau || data.organization))
        .setTitle(`【役職申請】${data.committeeRole || data.eventName}`)
        .setDescription(
          [
            `申請者：${data.applicant}`,
            `所属：${data.bureau || data.organization || '未設定'} / ${data.grade || '未設定'}`,
            data.description ? data.description : undefined,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .addFields(
          {
            name: 'やがサポ照合',
            value:
              data.supportUserExists === true
                ? '✅ users登録あり'
                : '⚠️ users登録なし・Discordのみで処理',
            inline: true,
          },
          {
            name: '状態',
            value: data.status || 'pending',
            inline: true,
          }
        )
        .setFooter({
          text: `申請ID: ${data.applicationId || '不明'}`,
        });
      if (data.discordUserId) {
        embed.addFields({
          name: 'Discord利用者',
          value: `<@${data.discordUserId}>（${data.discordUserId}）`,
          inline: false,
        });
      }
      return {content: mentionPart, embeds: [embed]};
    }

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
