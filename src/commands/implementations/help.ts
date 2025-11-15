/**
 * /help コマンド - 使い方を表示
 */

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types/command';

export const help: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('やがぽんの使い方を表示します'),

  async execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 やがぽん - コマンド一覧')
      .setDescription('やがぽんボットの使い方だぽん！')
      .addFields(
        {
          name: '📍 /ping',
          value: 'ボットの応答速度を確認します',
          inline: false,
        },
        {
          name: '📢 /notify',
          value:
            '通知を送信します（管理者専用）\n各種オプションでタイトル、説明、場所、局などを指定できます',
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

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
