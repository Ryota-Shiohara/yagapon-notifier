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

export type ScheduleAction = 'add' | 'update' | 'delete';

export interface ScheduleSnapshot {
  title: string;
  startAt: string;
  endAt: string;
  detail?: string;
  description?: string;
  location?: string;
  department?: string;
  section?: string;
  url?: string;
  updatedBy?: string;
}

export interface ScheduleChangeDetail {
  field: string;
  item?: string;
  before: string;
  after: string;
}

export interface ScheduleNotificationData {
  action: ScheduleAction;
  title: string;
  startAt: string;
  endAt: string;
  scheduleId?: string;
  detail?: string;
  description?: string;
  location?: string;
  department?: string;
  section?: string;
  url?: string;
  updatedBy?: string;
  before?: ScheduleSnapshot;
  after?: ScheduleSnapshot;
  changedDetails?: ScheduleChangeDetail[];
}

/**
 * 通知ペイロードの型定義（Union型）
 */
export type NotificationPayload =
  | { type: 'daily'; data: Schedule; channelId?: string }
  | { type: 'monthly'; data: MonthlyData; channelId?: string }
  | { type: 'schedule'; data: ScheduleNotificationData; channelId?: string };
