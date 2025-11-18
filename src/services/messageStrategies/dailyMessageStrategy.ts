/**
 * Daily通知用のメッセージ構築戦略
 */

import { EmbedBuilder } from 'discord.js';

import { getDepartmentColor } from '../../config/departmentColors';
import { Schedule } from '../../types/notification';
import { MessageContent, MessageStrategy } from './baseMessageStrategy';

export class DailyMessageStrategy implements MessageStrategy<Schedule> {
  /**
   * Daily通知用のメッセージを構築
   */
  build(payload: Schedule, roleId?: string): MessageContent {
    const {
      title,
      description,
      startTime,
      endTime,
      location,
      department,
      section,
    } = payload;

    // 時間をフォーマット
    const formattedStartTime = this.formatTime(startTime);
    const formattedEndTime = this.formatTime(endTime);
    const formattedDate = this.formatDate(startTime || endTime);

    const time =
      formattedStartTime && formattedEndTime
        ? `${formattedStartTime}～${formattedEndTime}`
        : formattedStartTime || formattedEndTime || '未定';

    const dateTime = formattedDate ? `${formattedDate} ${time}` : time;

    // やがぽんの絵文字とメッセージをランダム選択
    const yagaponEmoji = this.getRandomYagaponEmoji();
    const yagaponMessage = this.getRandomYagaponMessage();

    // Discord Embed を作成
    const embed = new EmbedBuilder().setColor(getDepartmentColor(department));

    const embedDescription = `

${description || ''}

📍  ${location || '未定'}
🗓️  ${dateTime}

### ${yagaponEmoji}${yagaponMessage}
    `.trim();

    if (embedDescription && embedDescription.trim().length > 0) {
      embed.setDescription(embedDescription);
    }

    if (department) {
      embed.setFooter({ text: department + (section ? `（${section}）` : '') });
    }

    // メッセージのコンテンツを作成
    const mentionPart = roleId ? `<@&${roleId}>\n` : '';
    const titlePart = `# 明日は${title}だぽん！<:face:1439173874368381011>`;
    const messageContent = `${mentionPart}${titlePart}`;

    return {
      content: messageContent,
      embeds: [embed],
    };
  }

  /**
   * 時間をHH:MM形式にフォーマット（日本時間）
   */
  private formatTime(
    time: Date | string | undefined | any
  ): string | undefined {
    if (!time) return undefined;

    // Firebase Timestampの場合
    let date: Date;
    if (time.toDate && typeof time.toDate === 'function') {
      date = time.toDate();
    } else if (time instanceof Date) {
      date = time;
    } else if (typeof time === 'string') {
      date = new Date(time);
    } else {
      console.warn('Unknown time format:', time);
      return undefined;
    }

    // 日本時間（JST）でフォーマット
    const jstString = date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return jstString;
  }

  /**
   * 日付をMM/DD（曜日）形式にフォーマット（日本時間）
   */
  private formatDate(
    time: Date | string | undefined | any
  ): string | undefined {
    if (!time) return undefined;

    // Firebase Timestampの場合
    let date: Date;
    if (time.toDate && typeof time.toDate === 'function') {
      date = time.toDate();
    } else if (time instanceof Date) {
      date = time;
    } else if (typeof time === 'string') {
      date = new Date(time);
    } else {
      console.warn('Unknown date format:', time);
      return undefined;
    }

    // 日本時間（JST）でフォーマット
    const jstDate = new Date(
      date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
    );
    const month = jstDate.getMonth() + 1;
    const day = jstDate.getDate();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[jstDate.getDay()];
    return `${month}/${day}（${weekday}）`;
  }

  /**
   * やがぽんの絵文字をランダムに取得
   */
  private getRandomYagaponEmoji(): string {
    const yagaponEmojis = [
      '<:front_sq:1439180903007125514>',
      '<:front_face:1439180911685013625>',
    ];
    return yagaponEmojis[Math.floor(Math.random() * yagaponEmojis.length)];
  }

  /**
   * やがぽんのメッセージをランダムに取得
   */
  private getRandomYagaponMessage(): string {
    const yagaponMessages = [
      '楽しみだぽん！！',
      'みんな集まるぽん！',
      '忘れないでぽん！',
      '待ってるぽん！',
      '準備しておくぽん！',
      'よろしくぽん！',
      'ワクワクするぽん！',
      '元気に参加するぽん！',
      'ここが頑張り時だぽん！',
    ];
    return yagaponMessages[Math.floor(Math.random() * yagaponMessages.length)];
  }
}
