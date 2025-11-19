/**
 * Trigger (自動反応) の型定義
 */
export interface TriggerDef {
  id: string;
  // パターン文字列。
  // パターン文字列。例: キーワードやフレーズを指定します。
  pattern: string;
  // 利用可能なモード: includes / exact
  // - 'includes': 部分一致
  // - 'exact': 完全一致
  mode?: 'includes' | 'exact' | 'mention';
  // 返信コンテンツ（シンプル実装では text のみサポート）
  reply?: string;
  // 有効/無効
  enabled?: boolean;
  // 対象チャンネルIDのホワイトリスト。未定義/空は全チャンネル許可
  channels?: string[];
  // 抽出設定（includes モードで使用）
  // start: 抽出開始マーカー（例: '開始:'）
  // end: 抽出終了マーカー（例: ' 終了:'）
  // template: 抽出した値を埋め込む返信テンプレート。{value} が抽出文字列に置換される。
  extract?: { start: string; end?: string; template?: string; onFail?: string };
  // 優先度。値が小さいほど高優先度（0 が最優先）。未定義は末尾扱い
  priority?: number;
}
