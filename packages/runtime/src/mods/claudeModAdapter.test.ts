import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ClaudeModAdapter } from './claudeModAdapter.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'vessel-adapter-')); await writeFile(path.join(root, 'mod.js'), 'module.exports = { rewriteToolInput(input, context) { return {metadata: context.metadata}; } };'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const manifest = { name: 'adapter', version: '1', entrypoint: 'mod.js', systemPromptContribution: '  static\r\nprompt ' };
it.each(['vessel.mod.json', 'claude.mod', 'package.json'])('loads %s without evaluating source on host', async filename => {
  await writeFile(path.join(root, filename), JSON.stringify(filename === 'package.json' ? { 'claude.mod': manifest } : manifest));
  const loaded = await ClaudeModAdapter.loadFromDirectory(root);
  const middleware = ClaudeModAdapter.createMiddleware(loaded);
  await expect(middleware.rewriteToolInput!({}, { sessionId: 's', turnIndex: 1, metadata: { apiKey: 'must not cross' } })).resolves.toEqual({ metadata: {} });
});
it('normalizes labelled static scoped contribution', () => { expect(ClaudeModAdapter.scopedPromptContribution(manifest)).toBe('[Mod: adapter]\nstatic\nprompt'); });
it('rejects unsupported source format and authority manifest fields', async () => {
  await writeFile(path.join(root, 'vessel.mod.json'), JSON.stringify({ ...manifest, credentials: {} }));
  await expect(ClaudeModAdapter.loadFromDirectory(root)).rejects.toThrow('Unknown');
  await writeFile(path.join(root, 'mod.ts'), ''); await writeFile(path.join(root, 'vessel.mod.json'), JSON.stringify({ ...manifest, entrypoint: 'mod.ts' }));
  await expect(ClaudeModAdapter.loadFromDirectory(root)).rejects.toThrow('unsupported');
});

