/**
 * 領収書提出通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { ReceiptNotificationData } from '../../types/notification';
import { MessageContent, MessageStrategy } from './baseMessageStrategy';

const MAX_FIELD_LENGTH = 1024;

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function joinLimitedLines(lines: string[], emptyText: string): string {
  if (lines.length === 0) return emptyText;

  let result = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidate = result ? `${result}\n${line}` : line;
    const remaining = lines.length - index - 1;
    const suffix = remaining > 0 ? `\n…ほか${remaining}件` : '';

    if (candidate.length + suffix.length > MAX_FIELD_LENGTH) {
      if (!result) return truncateText(line, MAX_FIELD_LENGTH);
      return `${result}\n…ほか${lines.length - index}件`;
    }
    result = candidate;
  }

  return result;
}

function escapeLinkLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function isSafeLink(value: string): boolean {
  if (!value || value.length > 500) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function formatPrice(value: number): string {
  return `¥${new Intl.NumberFormat('ja-JP').format(value)}`;
}

function formatSubmittedAt(value: string): string {
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:F>` : value;
}

export class ReceiptMessageStrategy
  implements MessageStrategy<ReceiptNotificationData>
{
  private readonly CREATED_COLOR = '#22c55e';
  private readonly EDITED_COLOR = '#f59e0b';

  build(data: ReceiptNotificationData, roleId?: string): MessageContent {
    const purchasedItems = data.items.filter(
      (item) => item.wasActuallyPurchased
    );
    const totalAmount = purchasedItems.reduce(
      (total, item) => total + item.actualPrice,
      0
    );
    const itemLines = purchasedItems.map((item) => {
      const details = [
        item.purpose
          ? `購入目的: ${truncateText(item.purpose, 250)}`
          : undefined,
        item.companyName
          ? `企業名: ${truncateText(item.companyName, 250)}`
          : undefined,
      ].filter((detail): detail is string => !!detail);
      const detailLine = details.length > 0 ? `\n  ${details.join(' / ')}` : '';

      return `• ${truncateText(item.itemName, 400)} — ${formatPrice(item.actualPrice)}${detailLine}`;
    });
    const receiptLines = data.receiptFiles.map((file, index) => {
      const fileName = truncateText(
        file.fileName || `領収書 ${index + 1}`,
        200
      );
      return isSafeLink(file.webViewLink)
        ? `• [${escapeLinkLabel(fileName)}](${file.webViewLink})`
        : `• ${fileName}（リンクなし）`;
    });
    const eventLabel = data.event === 'created' ? '新規' : '編集';

    const embed = new EmbedBuilder()
      .setColor(
        data.event === 'created' ? this.CREATED_COLOR : this.EDITED_COLOR
      )
      .setTitle(`【${eventLabel}】領収書提出`)
      .setDescription(
        data.event === 'created'
          ? '領収書が提出されました。'
          : '領収書の内容が編集されました。'
      )
      .addFields(
        {
          name: '団体名',
          value: truncateText(data.organizationName, 256),
        },
        ...(data.eventName
          ? [
              {
                name: '企画名',
                value: truncateText(data.eventName, 256),
              },
            ]
          : []),
        {
          name: '申請者',
          value: truncateText(data.applicant, 256),
        },
        {
          name: '提出日時',
          value: formatSubmittedAt(data.submittedAt),
        },
        {
          name: '購入件数',
          value: `${purchasedItems.length}件`,
          inline: true,
        },
        {
          name: '合計金額',
          value: formatPrice(totalAmount),
          inline: true,
        },
        {
          name: '購入品',
          value: joinLimitedLines(itemLines, '購入済みの品目はありません。'),
        },
        {
          name: '領収書',
          value: joinLimitedLines(receiptLines, '領収書ファイルはありません。'),
        }
      )
      .setFooter({
        text: `Submission ID: ${truncateText(data.submissionId, 200)}`,
      })
      .setTimestamp(new Date(data.occurredAt));

    return {
      content: roleId ? `<@&${roleId}>` : '',
      embeds: [embed],
    };
  }
}
