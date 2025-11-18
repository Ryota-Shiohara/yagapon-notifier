/**
 * 通知先チャンネル解決サービス
 * 部署情報に基づいて適切なチャンネルIDとロールIDを返す
 */

import { config } from '../config/env';

export interface ChannelInfo {
  channelId: string;
  roleId?: string;
}

export class ChannelResolver {
  /**
   * 部署名に基づいて通知先チャンネルとロールを解決
   * @param department 部署名（オプション）
   * @returns チャンネルIDとロールID
   */
  resolveChannel(department?: string): ChannelInfo {
    // 局名に応じたチャンネルIDとロールIDを取得（見つからない場合はデフォルト）
    const channelId =
      (department && config.DEPARTMENT_CHANNELS[department]) ||
      config.NOTIFICATION_CHANNEL_ID;
    const roleId = department && config.DEPARTMENT_ROLES[department];

    return {
      channelId,
      roleId,
    };
  }
}
