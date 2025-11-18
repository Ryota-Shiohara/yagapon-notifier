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
  resolveChannelFromDepartment(department?: string): ChannelInfo {
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

  /**
   * チャンネル指定と部署名から通知先を解決
   * @param specifiedChannelId 指定されたチャンネルID（オプション、"preset"の場合は部署から解決）
   * @param department 部署名（オプション）
   * @returns チャンネルIDとロールID
   */
  resolveChannel(
    specifiedChannelId: string | undefined,
    department?: string
  ): ChannelInfo {
    // チャンネルIDが明示的に指定されている場合（"preset"以外）
    if (specifiedChannelId && specifiedChannelId !== 'preset') {
      return {
        channelId: specifiedChannelId,
        roleId: undefined, // 明示的に指定されたチャンネルの場合はロールメンションなし
      };
    }

    // channelIdが未指定または"preset"の場合は部署から解決
    return this.resolveChannelFromDepartment(department);
  }
}
