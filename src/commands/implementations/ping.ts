/**
 * /ping コマンド - ボットの応答速度を確認
 */

import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/command';

export const ping: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('ボットの応答速度を確認します'),

  async execute(interaction: ChatInputCommandInteraction) {
    const sent = await interaction.reply({
      content: 'Pinging...',
      fetchReply: true,
    });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    await interaction.editReply(
      `🏓 Pong!\n` +
        `⏱️ レイテンシー: ${latency}ms\n` +
        `💓 API レイテンシー: ${apiLatency}ms`
    );
  },
};
