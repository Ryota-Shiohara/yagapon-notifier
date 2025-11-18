/**
 * 通知データの型定義
 */

export interface Schedule {
  id?: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  department?: string;
  section?: string;
}

/**
 * Monthly通知用のデータ型
 */
export interface MonthlyData {
  department: string;
  month: string; // 例: "11月" または "2025-11"
  schedules: Schedule[];
}

/**
 * 通知ペイロードの型定義（Union型）
 */
export type NotificationPayload =
  | { type: 'daily'; data: Schedule; channelId?: string }
  | { type: 'monthly'; data: MonthlyData; channelId?: string };
