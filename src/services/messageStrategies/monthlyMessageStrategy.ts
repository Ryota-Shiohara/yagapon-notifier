/**
 * Monthly通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { getDepartmentColor } from '../../config/departmentColors';
import { MonthlyData } from '../../types/notification';
import { MessageContent, MessageStrategy } from './baseMessageStrategy';

export class MonthlyMessageStrategy implements MessageStrategy<MonthlyData> {
  /**
   * Monthly通知用のメッセージを構築
   */
  build(data: MonthlyData, roleId?: string): MessageContent {
    const { department, month, schedules } = data;

    // スケジュールリストを文字列として構築
    // 開始時刻でソート
    const sortedSchedules = [...schedules].sort((a, b) => {
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      const dateA = this.toDate(a.startTime);
      const dateB = this.toDate(b.startTime);
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.getTime() - dateB.getTime();
    });

    let lastDate = '';
    const scheduleList = sortedSchedules
      .map((schedule, index) => {
        const formattedDate = this.formatDate(schedule.startTime);
        const currentDate = formattedDate || '未定';
        const titleWithSection = schedule.section
          ? `**${schedule.title}**（${schedule.section}）`
          : `**${schedule.title}**`;

        // 前の予定と同じ日付の場合は日付を省略（箇条書きで表示）
        if (currentDate === lastDate) {
          return `　　　　　 ${titleWithSection}`;
        }

        lastDate = currentDate;
        // 最初の予定でなければ、日付が変わるタイミングで空行を追加
        const prefix = index > 0 ? '\n' : '';
        return `${prefix}${currentDate} 　${titleWithSection}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(getDepartmentColor(department))
      .setTitle(`📅 ${month}の予定`)
      .setDescription(
        `${department}の${month}のスケジュールをお知らせするぽん！\n\n` +
          `全${schedules.length}件の予定があるぽん！\n\n` +
          `${scheduleList}`
      )
      .setFooter({ text: department });

    const mentionPart = roleId ? `<@&${roleId}>\n` : '';
    const titlePart = `# ${department} ${month}のスケジュールだぽん！<:face:1439173874368381011>`;
    const messageContent = `${mentionPart}${titlePart}`;

    return {
      content: messageContent,
      embeds: [embed],
    };
  }

  /**
   * 日付をMM/DD形式にフォーマット（日本時間）
   */
  private formatDate(
    time: Date | string | undefined | any
  ): string | undefined {
    if (!time) return undefined;

    const date = this.toDate(time);
    if (!date) return undefined;

    // 日本時間（JST）でフォーマット
    const jstDate = new Date(
      date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
    );
    const month = jstDate.getMonth() + 1;
    const day = jstDate.getDate();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[jstDate.getDay()];
    return `${month}/${day}(${weekday}) `;
  }

  /**
   * 任意の時刻形式をDateオブジェクトに変換
   */
  private toDate(time: Date | string | undefined | any): Date | undefined {
    if (!time) return undefined;

    // Firebase Timestampの場合
    if (time.toDate && typeof time.toDate === 'function') {
      return time.toDate();
    } else if (time instanceof Date) {
      return time;
    } else if (typeof time === 'string') {
      return new Date(time);
    } else {
      console.warn('Unknown date format:', time);
      return undefined;
    }
  }
}
