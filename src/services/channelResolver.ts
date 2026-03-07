/**
 * 通知先チャンネル解決サービス
 * 部署情報に基づいて適切なチャンネルIDとロールIDを返す
 */

import { config } from '../config/env';

export interface ChannelInfo {
  channelId: string;
  roleId?: string;
  source: 'specified' | 'form' | 'department' | 'default';
}

export class ChannelResolver {
  /**
   * 部署名に基づいて通知先チャンネルとロールを解決
   * @param department 部署名（オプション）
   * @returns チャンネルIDとロールID
   */
  resolveChannelFromDepartment(department?: string): ChannelInfo {
    const hasDepartmentChannel =
      !!department && !!config.DEPARTMENT_CHANNELS[department];

    // 局名に応じたチャンネルIDとロールIDを取得（見つからない場合はデフォルト）
    const channelId =
      (department && config.DEPARTMENT_CHANNELS[department]) ||
      config.NOTIFICATION_CHANNEL_ID;
    const roleId = department && config.DEPARTMENT_ROLES[department];

    return {
      channelId,
      roleId,
      source: hasDepartmentChannel ? 'department' : 'default',
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
    department?: string,
    formType?: string
  ): ChannelInfo {
    // チャンネルIDが明示的に指定されている場合（"preset"以外）
    if (specifiedChannelId && specifiedChannelId !== 'preset') {
      return {
        channelId: specifiedChannelId,
        roleId: undefined, // 明示的に指定されたチャンネルの場合はロールメンションなし
        source: 'specified',
      };
    }

    if (formType) {
      const formRoleId = config.FORM_ROLES[formType];

      if (config.FORM_CHANNELS[formType]) {
        return {
          channelId: config.FORM_CHANNELS[formType],
          roleId: formRoleId,
          source: 'form',
        };
      }

      // formTypeが指定されている場合、ロールはFORM_ROLESのみを参照。
      // キーがなければメンションなしでフォールバック先チャンネルへ送信する。
      const fallbackChannel = this.resolveChannelFromDepartment(department);
      return {
        channelId: fallbackChannel.channelId,
        roleId: formRoleId,
        source: fallbackChannel.source,
      };
    }

    // channelIdが未指定または"preset"の場合は部署から解決
    return this.resolveChannelFromDepartment(department);
  }
}
