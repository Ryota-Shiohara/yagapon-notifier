/**
 * Schedule通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { getDepartmentColor } from '../../config/departmentColors';
import { ScheduleNotificationData } from '../../types/notification';
import { MessageContent, MessageStrategy } from './baseMessageStrategy';

export class ScheduleMessageStrategy
  implements MessageStrategy<ScheduleNotificationData>
{
  build(data: ScheduleNotificationData, roleId?: string): MessageContent {
    if (data.action === 'add') {
      return this.buildAddMessage(data, roleId);
    }

    if (data.action === 'update') {
      return this.buildUpdateMessage(data, roleId);
    }

    return this.buildDeleteMessage(data, roleId);
  }

  private buildAddMessage(
    data: ScheduleNotificationData,
    roleId?: string
  ): MessageContent {
    const eventDate = this.formatMonthDay(data.startAt);
    const messageContent = this.buildHeadingContent(
      `${eventDate}に${this.getHeading('add', data.title)}`,
      roleId
    );

    return {
      content: messageContent,
      embeds: [this.buildScheduleEmbed(`${data.title}(追加)`, data, data)],
    };
  }

  private buildUpdateMessage(
    data: ScheduleNotificationData,
    roleId?: string
  ): MessageContent {
    const afterData = {
      title: data.after?.title || data.title,
      startAt: data.after?.startAt || data.startAt,
      endAt: data.after?.endAt || data.endAt,
      detail: data.after?.detail || data.detail,
      description: data.after?.description || data.description,
      location: data.after?.location || data.location,
      department: data.after?.department || data.department,
      section: data.after?.section || data.section,
      url: data.after?.url || data.url,
      updatedBy: data.after?.updatedBy || data.updatedBy,
    };

    const eventDate = this.formatMonthDay(afterData.startAt);

    const lines = [
      `# ${eventDate}の${this.getHeading('update', data.title)}<:face:1439173874368381011>`,
      '**変更箇所**',
      ...this.formatChangedDetails(data.changedDetails),
    ];

    const mentionPart = roleId ? `<@&${roleId}>\n` : '';

    return {
      content: `${mentionPart}${lines.join('\n')}`,
      embeds: [
        this.buildScheduleEmbed(`${afterData.title}(変更後)`, afterData, data),
      ],
    };
  }

  private buildDeleteMessage(
    data: ScheduleNotificationData,
    roleId?: string
  ): MessageContent {
    const effectiveTitle = data.after?.title || data.title;
    const effectiveStartAt = data.after?.startAt || data.startAt;
    const eventDate = this.formatMonthDay(effectiveStartAt);
    const deletedBy = (data.after?.updatedBy || data.updatedBy)?.trim();
    const deleteReason = (data.after?.description || data.description)?.trim();
    const mentionPart = roleId ? `<@&${roleId}>\n` : '';
    const deletedByPart = deletedBy ? `\n削除者：${deletedBy}` : '';
    const reasonPart = deleteReason ? `\n削除理由：\n${deleteReason}` : '';

    return {
      content:
        `${mentionPart}# ${eventDate}の${this.getHeading('delete', effectiveTitle)}<:face:1439173874368381011>` +
        deletedByPart +
        reasonPart,
      embeds: [],
    };
  }

  private buildScheduleEmbed(
    embedTitle: string,
    viewData: {
      title: string;
      startAt: string;
      endAt: string;
      detail?: string;
      description?: string;
      location?: string;
      department?: string;
      section?: string;
      url?: string;
      updatedBy?: string;
    },
    sourceData: ScheduleNotificationData
  ): EmbedBuilder {
    const descriptionLines: string[] = [];
    const effectiveDescription = viewData.detail || viewData.description;
    if (effectiveDescription) {
      descriptionLines.push(effectiveDescription);
      descriptionLines.push('');
    }

    descriptionLines.push(
      `🗓️ ${this.formatDateRange(viewData.startAt, viewData.endAt)}`
    );
    descriptionLines.push(`📍 ${viewData.location || '未定'}`);

    if (viewData.url) {
      descriptionLines.push(`🔗 ${viewData.url}`);
    }

    if (viewData.updatedBy) {
      descriptionLines.push(
        `👤 ${this.getActionLabel(sourceData.action)}者: ${viewData.updatedBy}`
      );
    }

    const embed = new EmbedBuilder()
      .setColor(getDepartmentColor(viewData.department))
      .setTitle(embedTitle)
      .setDescription(descriptionLines.join('\n'));

    if (viewData.department) {
      embed.setFooter({
        text:
          viewData.department +
          (viewData.section ? `（${viewData.section}）` : ''),
      });
    }

    return embed;
  }

  private buildHeadingContent(heading: string, roleId?: string): string {
    const mentionPart = roleId ? `<@&${roleId}>\n` : '';
    return `${mentionPart}# ${heading}<:face:1439173874368381011>`;
  }

  private formatChangedDetails(
    changedDetails?: ScheduleNotificationData['changedDetails']
  ): string[] {
    if (!changedDetails || changedDetails.length === 0) {
      return [];
    }

    return changedDetails.map((change) => {
      const itemLabel = change.item || this.toJapaneseLabel(change.field);

      if (change.field === 'startAt') {
        return `- ${itemLabel}：${change.before}からを${change.after}からに変更`;
      }

      if (change.field === 'endAt') {
        return `- ${itemLabel}：${change.before}までを${change.after}までに変更`;
      }

      if (change.field === 'detail' || change.field === 'description') {
        return this.formatMultilineChange(
          itemLabel,
          change.before,
          change.after
        );
      }

      return `- ${itemLabel}：${change.before}→${change.after}`;
    });
  }

  private formatMultilineChange(
    label: string,
    before: string,
    after: string
  ): string {
    const formattedBefore = this.indentMultiline(before, '  ');
    const formattedAfter = this.indentMultiline(after, '  ');

    return (
      `- ${label}：\n` +
      `  変更前:\n` +
      `${formattedBefore}\n` +
      `  変更後:\n` +
      `${formattedAfter}`
    );
  }

  private indentMultiline(value: string, indent: string): string {
    return value
      .split(/\r?\n/)
      .map((line) => `${indent}${line}`)
      .join('\n');
  }

  private formatDateRange(startAt: string, endAt: string): string {
    const start = this.formatDateTime(startAt);
    const end = this.formatTimeOnly(endAt);
    return `${start} ～ ${end}`;
  }

  private formatDateOnly(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private formatMonthDay(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private formatTimeOnly(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private getActionLabel(action: ScheduleNotificationData['action']): string {
    if (action === 'add') {
      return '追加';
    }
    if (action === 'update') {
      return '変更';
    }
    return '削除';
  }

  private getHeading(
    action: ScheduleNotificationData['action'],
    title: string
  ): string {
    if (action === 'add') {
      return `${title}が追加されたぽん！`;
    }
    if (action === 'update') {
      return `${title}が変更されたぽん！`;
    }
    return `${title}が削除されたぽん！`;
  }

  private toJapaneseLabel(field: string): string {
    const labelMap: Record<string, string> = {
      title: 'タイトル',
      location: '場所',
      description: '説明',
      detail: '詳細',
      startAt: '開始時刻',
      endAt: '終了時刻',
      department: '局',
      section: '部署',
      url: 'URL',
    };

    return labelMap[field] || field;
  }
}
