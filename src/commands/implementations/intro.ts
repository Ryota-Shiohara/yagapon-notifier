/**
 * /intro コマンド - ボットの紹介を表示
 */

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types/command';

export const intro: Command = {
  data: new SlashCommandBuilder()
    .setName('intro')
    .setDescription('おしらせやがぽんを紹介します'),

  async execute(interaction: ChatInputCommandInteraction) {
    const description = `やっほー！やがぽんだぽん！<:front_face:1439180911685013625>

僕は**矢上祭実行委員会のお知らせ専門ボット**だぽん！
各局のイベントやミーティングの通知を、かわいく分かりやすくお届けするのが僕のお仕事だぽん！

**できること**
✨ 各局ごとに色分けされた通知を送信
📢 一か月の予定を見やすく整理
🎨 やがぽんからの応援メッセージ付き

みんなの実行委員会活動を全力でサポートするぽん！
困ったことがあったら \`/help\` で使い方を確認してね！`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('<:face:1439173874368381011> おしらせやがぽん')
      .setDescription(description)
      .addFields(
        {
          name: '📅 /monthly',
          value: '今月の矢上祭実行委員会の予定をお届けするよ！',
          inline: false,
        },
        {
          name: '❓ /help',
          value: 'このヘルプメッセージを表示します',
          inline: false,
        }
      )
      .setFooter({
        text: 'おしらせやがぽん - 矢上祭実行委員会通知ボット',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
