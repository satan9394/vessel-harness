export interface MatchedReasoningRule {
  id: string;
  trigger: string;
  lesson: string;
  recommendedAction?: string;
}

export function isMatchedReasoningRule(value: unknown): value is MatchedReasoningRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  return ['id', 'trigger', 'lesson'].every(key => typeof rule[key] === 'string' && (rule[key] as string).length > 0 && (rule[key] as string).length <= 10000)
    && (rule.recommendedAction === undefined || typeof rule.recommendedAction === 'string' && rule.recommendedAction.length <= 10000);
}
