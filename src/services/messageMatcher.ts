import { TriggerDef } from '../types/trigger';

export function matches(content: string, trigger: TriggerDef): boolean {
  if (!trigger.enabled) return false;

  // デフォルト: exact
  const mode = trigger.mode ?? 'exact';

  try {
    if (mode === 'exact') return content === trigger.pattern;
    if (mode === 'includes') return content.includes(trigger.pattern);

    // unknown mode: treat as no match
    return false;
  } catch (err) {
    console.error('Error testing trigger match:', err);
    return false;
  }
}
