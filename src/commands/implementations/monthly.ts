/**
 * /monthly コマンド - 外部にHTTPリクエストを送信
 */

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { config } from '../../config/env';
import { Command } from '../../types/command';

export const monthly: Command = {
  data: new SlashCommandBuilder()
    .setName('monthly')
    .setDescription('月次処理を実行します')
    .addStringOption((option) =>
      option
        .setName('局')
        .setDescription('月間予定を取得する局')
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
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const url = config.MONTHLY_URL;

      if (!url) {
        throw new Error(
          '月間予定取得用のURLが設定されていません。.envファイルにMONTHLY_URLを設定してください。'
        );
      }

      const department = interaction.options.getString('局', true);
      const channelId = interaction.channelId;

      // HTTPリクエストを送信
      const requestUrl = `${url}?department=${encodeURIComponent(department)}&channelId=${channelId}`;
      await fetch(requestUrl, {
        method: 'POST',
      });

      await interaction.editReply({
        content: `✅ ${department}の月間予定取得リクエストを送信しました`,
      });
    } catch (error) {
      console.error('Monthly command error:', error);
      await interaction.editReply({
        content: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
      });
    }
  },
};
