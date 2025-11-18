/**
 * メッセージ構築戦略の基底インターフェース
 */

import { EmbedBuilder } from 'discord.js';

export interface MessageContent {
  content: string;
  embeds: EmbedBuilder[];
}

/**
 * メッセージ構築戦略のインターフェース
 */
export interface MessageStrategy<T = any> {
  /**
   * メッセージを構築
   * @param data 通知データ
   * @param roleId メンションするロールID（オプション）
   * @returns メッセージコンテンツ
   */
  build(data: T, roleId?: string): MessageContent;
}
