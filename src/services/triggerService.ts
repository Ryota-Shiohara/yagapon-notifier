import triggers from '../triggers/definitions';
import { TriggerDef } from '../types/trigger';
import { matches } from './messageMatcher';

export class TriggerService {
  private triggers: TriggerDef[];

  constructor() {
    // コピーしてソート（優先度順）
    this.triggers = [...triggers].sort((a, b) => {
      const pa =
        typeof a.priority === 'number' ? a.priority : Number.MAX_SAFE_INTEGER;
      const pb =
        typeof b.priority === 'number' ? b.priority : Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
  }

  /**
   * メッセージにマッチする最初のトリガーを返す（コンテキストのチャンネルも考慮）
   */
  getFirstMatchingTrigger(
    content: string,
    context?: { channelId?: string }
  ): TriggerDef | null {
    for (const t of this.triggers) {
      if (!t.enabled) continue;
      if (t.channels && t.channels.length > 0 && context?.channelId) {
        if (!t.channels.includes(context.channelId)) continue;
      }

      if (matches(content, t)) return t;
    }

    return null;
  }

  // 将来的にトリガーの登録/更新/削除を追加するためのメソッドを置いておく
  listTriggers(): TriggerDef[] {
    return this.triggers;
  }
}

export default TriggerService;
