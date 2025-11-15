/**
 * 部署ごとのDiscord Embedカラー設定
 */

import { ColorResolvable } from 'discord.js';

const departmentColors: { [key: string]: ColorResolvable } = {
  全局: '#000000',
  役員: '#000000',
  執行部: '#30a4d2',
  総務局: '#535151',
  室内局: '#082ac9',
  屋外局: '#e28100',
  装飾局: '#d0a100',
  ステージ局: '#c70000',
  広報局: '#f90faa',
  渉外局: '#6b49ab',
  IT局: '#008736',
};

export function getDepartmentColor(department?: string): ColorResolvable {
  if (!department) return '#808080';
  return departmentColors[department] || '#808080'; // デフォルトはグレー
}
