/**
 * 通知データの型定義
 */

export interface NotificationPayload {
  id?: string;
  title: string;
  description?: string;
  remindTime?: string;
  location?: string;
  department?: string;
}
