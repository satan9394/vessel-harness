import { describe, expect, it } from 'vitest';
import { ModPipeline } from '../../src/mods/onionPipeline.js';

const context = { sessionId: 's', turnIndex: 0, metadata: {} };

describe('Mod scoped prompt fragments', () => {
  it('only exposes the incremental fragment and appends labels after the existing scoped prefix', async () => {
    const pipeline = new ModPipeline();
    pipeline.register({ name: 'format', version: '1', priority: 1, rewritePromptFragment: async fragment => {
      expect(fragment).toBe('increment');
      return fragment.toUpperCase();
    } });
    pipeline.register({ name: 'suffix', version: '1', priority: 2, rewritePromptFragment: async fragment => `${fragment}!` });
    expect(await pipeline.appendScopedPrompt('existing scoped bytes', 'increment', context)).toBe('existing scoped bytes\n[Mod: format]\n[Mod: suffix]\nINCREMENT!');
  });

  it('preserves the scoped prefix exactly when no fragment is present', async () => {
    expect(await new ModPipeline().appendScopedPrompt('prefix\n', '', context)).toBe('prefix\n');
  });

  it('fails closed for a non-string prompt response', async () => {
    const pipeline = new ModPipeline();
    pipeline.register({ name: 'invalid', version: '1', priority: 1, rewritePromptFragment: async () => 2 as never });
    await expect(pipeline.appendScopedPrompt('prefix', 'fragment', context)).rejects.toThrow('failed closed');
    await expect(pipeline.dispatchIntercept('read', {}, context)).rejects.toThrow('failed closed');
  });
});
