/**
 * トリガー定義（簡潔）
 * id: 識別子
 * pattern: 検出文字列
 * mode: 'includes' | 'exact'（部分一致／完全一致）
 * reply: 標準返信
 * extract?: { start, end?, template?, onFail? }（includes 時に start〜end を抽出し template の {value} に埋め込む）
 * enabled?: boolean, priority?: number（小さいほど優先）
 */

import { TriggerDef } from '../types/trigger';

// サンプル定義。運用では外部JSONやDBから読み込む想定。
export const triggers: TriggerDef[] = [
  {
    id: 'register-channel',
    pattern: '',
    mode: 'mention',
    reply: 'このチャンネルは{',
    extract: {
      start: 'このチャンネルは',
      end: 'のチャンネル',
      template: 'ここは{value}のチャンネル！わかったぽん！',
      onFail: 'なにを言いたいのかよくわからないぽん...',
    },
    enabled: true,
    priority: 10,
  },
  {
    id: 'simple-ping',
    pattern: 'ping',
    mode: 'includes',
    reply: '自動返信: pong',
    enabled: true,
    priority: 20,
  },
];

export default triggers;
