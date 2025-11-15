/**
 * src/types/notification.ts
 *
 * 通知データの型定義
 * 仕様書 4. データモデル に基づく
 */

export interface NotificationPayload {
  id?: string;
  title: string;
  description?: string;
  remindTime?: string;
  location?: string;
  department?: string;
}
