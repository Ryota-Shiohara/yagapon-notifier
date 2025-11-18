/**
 * /notify コマンド - 通知を送信（管理者用）
 */

import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { NotificationService } from '../../services/notificationService';
import { Command } from '../../types/command';
import { Schedule } from '../../types/notification';

export const notify: Command = {
  data: new SlashCommandBuilder()
    .setName('notify')
    .setDescription('通知を送信します（管理者用）')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('イベントのタイトル')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('department')
        .setDescription('局名')
        .addChoices(
          { name: '全局', value: '全局' },
          { name: '役員', value: '役員' },
          { name: '執行部', value: '執行部' },
          { name: '総務局', value: '総務局' },
          { name: '室内局', value: '室内局' },
          { name: '屋外局', value: '屋外局' },
          { name: '装飾局', value: '装飾局' },
          { name: 'ステージ局', value: 'ステージ局' },
          { name: '広報局', value: '広報局' },
          { name: '渉外局', value: '渉外局' },
          { name: 'IT局', value: 'IT局' }
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('description').setDescription('イベントの説明')
    )
    .addStringOption((option) =>
      option.setName('location').setDescription('場所')
    )
    .addStringOption((option) =>
      option.setName('section').setDescription('部署名')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description') || '';
      const location = interaction.options.getString('location') || '未定';
      const department = interaction.options.getString('department', true);
      const section = interaction.options.getString('section') || '';

      const payload: Schedule = {
        title,
        description,
        location,
        department,
        section,
      };

      const notificationService = new NotificationService(interaction.client);
      await notificationService.sendNotification(payload);

      await interaction.editReply({
        content: `✅ 通知を送信しました！\n**タイトル**: ${title}\n**局**: ${department || '全体'}`,
      });
    } catch (error) {
      console.error('通知送信エラー:', error);
      await interaction.editReply({
        content: `❌ 通知の送信に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
      });
    }
  },
};
