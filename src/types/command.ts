/**
 * スラッシュコマンドの型定義
 */

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';

/**
 * コマンドインターフェース
 */
export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommandGroup' | 'addSubcommand'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
