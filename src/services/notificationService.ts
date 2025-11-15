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
    const {
      title,
      description,
      startTime,
      endTime,
      location,
      department,
      section,
    } = payload;

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

    // デバッグ: 受け取った時間データを確認
    console.log('startTime:', startTime, 'type:', typeof startTime);
    console.log('endTime:', endTime, 'type:', typeof endTime);

    // 時間をHH:MM形式にフォーマット
    const formatTime = (
      time: Date | string | undefined | any
    ): string | undefined => {
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

      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    // 日付をMM/DD（曜日）形式にフォーマット
    const formatDate = (
      time: Date | string | undefined | any
    ): string | undefined => {
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

      const month = (date.getMonth() + 1).toString();
      const day = date.getDate().toString();
      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const weekday = weekdays[date.getDay()];
      return `${month}/${day}（${weekday}）`;
    };

    const formattedStartTime = formatTime(startTime);
    const formattedEndTime = formatTime(endTime);
    const formattedDate = formatDate(startTime || endTime);

    const time =
      formattedStartTime && formattedEndTime
        ? `${formattedStartTime}～${formattedEndTime}`
        : formattedStartTime || formattedEndTime || '未定';

    const dateTime = formattedDate ? `${formattedDate} ${time}` : time;

    // やがぽんの絵文字リスト
    const yagaponEmojis = [
      '<:front_sq:1439180903007125514>',
      '<:front_face:1439180911685013625>',
    ];

    // やがぽんのメッセージリスト
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

    // ランダムに絵文字とメッセージを選択
    const yagaponEmoji =
      yagaponEmojis[Math.floor(Math.random() * yagaponEmojis.length)];
    const yagaponMessage =
      yagaponMessages[Math.floor(Math.random() * yagaponMessages.length)];

    // Discord Embed を作成
    const embed = new EmbedBuilder().setColor(getDepartmentColor(department));

    const embedDescription = `
## 明日は${title}だぽん！<:face:1439173874368381011>

${description || ''}

📍  ${location || '未定'}
🗓️  ${dateTime}

### ${yagaponEmoji}${yagaponMessage}
    `.trim();

    // descriptionが空文字列でない場合のみ設定
    if (embedDescription && embedDescription.trim().length > 0) {
      embed.setDescription(embedDescription);
    }

    if (department) {
      embed.setFooter({ text: department + (section ? `（${section}）` : '') });
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
