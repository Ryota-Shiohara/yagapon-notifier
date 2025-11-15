/**
 * 通知データの型定義
 */

export interface NotificationPayload {
  id?: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  department?: string;
  section?: string;
}
