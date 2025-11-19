import { Message } from 'discord.js';
import { extractBetween } from '../services/extractors';
import TriggerService from '../services/triggerService';

const triggerService = new TriggerService();

/**
 * メッセージを処理し、トリガーが発火した場合は true を返す。
 */
export async function handleMessage(message: Message): Promise<boolean> {
  // Botの発言は無視
  if (message.author.bot) return false;

  const content = message.content.trim();
  if (!content) return false;

  // まずは Bot へのメンションによるトリガーをチェック（mode === 'mention'）
  try {
    const clientUserId = message.client.user?.id;
    if (clientUserId && message.mentions.users.has(clientUserId)) {
      // メッセージがメンションのみ（Botへのメンション以外にテキストが無い）なら即時応答する
      // Discord のユーザーメンションは `<@123>` または `<@!123>` となるのでそれらを取り除く
      const contentWithoutMentions = content
        .replace(/<@!?(\d+)>/g, '')
        .replace(/<@&(\d+)>/g, '')
        .trim();
      if (!contentWithoutMentions) {
        try {
          await message.reply('呼んだぽん？');
          console.log(`Replied to bare mention in ${message.channelId}`);
        } catch (err) {
          console.error('Error replying to bare mention:', err);
        }
        return true;
      }
      const mentionTrigger = triggerService.listTriggers().find((t) => {
        if (!t.enabled) return false;
        if (t.mode !== 'mention') return false;
        if (t.channels && t.channels.length > 0) {
          return t.channels.includes(message.channelId);
        }
        return true;
      });

      if (mentionTrigger) {
        // mention トリガーの処理（extract があれば試す）
        if (mentionTrigger.extract) {
          const value = extractBetween(
            content,
            mentionTrigger.extract.start,
            mentionTrigger.extract.end
          );
          if (value) {
            const template = mentionTrigger.extract.template ?? '{value}';
            const reply = template.replace('{value}', value);
            await message.reply(reply);
            console.log(
              `Trigger ${mentionTrigger.id} replied to mention in ${message.channelId}`
            );
            return true;
          }
          const failMsg =
            mentionTrigger.extract.onFail ??
            'フォーマットが見つかりませんでした。入力形式を確認してください。';
          await message.reply(failMsg);
          console.log(
            `Trigger ${mentionTrigger.id} matched mention but extraction failed in ${message.channelId}`
          );
          return true;
        }

        if (mentionTrigger.reply) {
          await message.reply(mentionTrigger.reply);
          console.log(
            `Trigger ${mentionTrigger.id} replied to mention in ${message.channelId}`
          );
          return true;
        }
      }
    }
  } catch (err) {
    console.error('Error checking mention triggers:', err);
  }

  const trigger = triggerService.getFirstMatchingTrigger(content, {
    channelId: message.channelId,
  });
  if (!trigger) return false;

  try {
    // includes モードかつ extract 設定がある場合はマーカー間抽出を行う
    if (trigger.mode === 'includes' && trigger.extract) {
      const value = extractBetween(
        content,
        trigger.extract.start,
        trigger.extract.end
      );
      if (value) {
        const template = trigger.extract.template ?? '{value}';
        const reply = template.replace('{value}', value);
        await message.reply(reply);
        console.log(
          `Trigger ${trigger.id} matched and replied with extracted value in ${message.channelId}`
        );
        return true;
      }

      // 抽出に失敗した場合は onFail があればそれを送信、なければデフォルトメッセージを送信
      const failMsg =
        trigger.extract.onFail ?? 'なにを言いたいのかよくわからないぽん...';
      await message.reply(failMsg);
      console.log(
        `Trigger ${trigger.id} matched but extraction failed in ${message.channelId}`
      );
      return true;
    }

    if (trigger.reply) {
      await message.reply(trigger.reply);
      console.log(
        `Trigger ${trigger.id} matched and replied in ${message.channelId}`
      );
      return true;
    }
  } catch (err) {
    console.error('Error handling trigger reply:', err);
  }

  return false;
}

export default handleMessage;
