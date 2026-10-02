import type { EventBus, LoopDeps, Session } from '@vessel/core';
import type { ContextBuilder } from '../builder/Builder.js';
import type { Compaction } from './Compaction.js';
import { isContextOverflowError } from './overflowClassifier.js';

export function createOverflowRecovery(deps: {
  session: Session;
  bus: EventBus;
  builder: ContextBuilder;
  compaction: Compaction;
  maxOutputTokens: number;
}): NonNullable<LoopDeps['modelErrorRecovery']> {
  return {
    maxOverflowRetries: 1,
    isOverflowError: isContextOverflowError,
    recover: async (error, { step, requestId, retryCount }) => {
      if (!isContextOverflowError(error)) return null;
      const payload = { requestId, retryCount };
      await deps.session.appendSync({ type: 'compaction:overflow_intercepted', ...payload, surface: false });
      await deps.bus.emit('compaction:overflow_intercepted', payload);
      await deps.compaction.compact('overflow');
      return { ...await deps.builder.assemble(step), maxOutputTokens: deps.maxOutputTokens };
    },
  };
}
