import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { markProjectionPublicationUncertain, type ToolSpec } from '@vessel/shared';
import { ContextBuilder } from '../builder/Builder.js';
import { LayeredContextCache } from './LayeredContextCache.js';

it('versions all four layers independently and isolates mutations', () => {
  const cache = new LayeredContextCache();
  for (const layer of ['assembly', 'provider-prefix', 'projection', 'token-estimation'] as const) {
    const first = cache.get(layer, { revision: 1 }, () => ({ content: 'first' }));
    first.content = 'corrupted';
    expect(cache.get(layer, { revision: 1 }, () => ({ content: 'unexpected' }))).toEqual({ content: 'first' });
    expect(cache.get(layer, { revision: 2 }, () => ({ content: 'second' }))).toEqual({ content: 'second' });
  }
  expect(cache.snapshot().every(layer => layer.hits === 1 && layer.misses === 2 && layer.invalidations === 1 && layer.entries === 1)).toBe(true);
});

it('rejects identity-bound publication uncertainty even after caching the unchanged log', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-uncertain-'));
  const session = await Session.open({ workspaceRoot: root });
  try {
    await session.appendSync({ type: 'user/message', role: 'user', msgId: 'u', content: 'goal', surface: true });
    await session.appendSync({ type: 'compaction/end', trigger: 'manual', removedRecords: 1, surface: false, outcome: 'committed',
      projectionCommit: { expectedRevision: 0, startSeq: 1, endSeq: 1, summary: 'goal' } });
    const builder = new ContextBuilder({ session, model: 'm', stableSections: () => [], policyGuidance: () => [], instructions: () => [], getVisibleTools: () => [] });
    await builder.assemble(1);
    markProjectionPublicationUncertain(session.replay().at(-1)!);
    await expect(builder.assemble(2)).rejects.toThrow('publication outcome unknown');
  } finally { await session.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

it('refreshes configuration but keeps prefix on a new event; invalidates tokenizer/provider separately', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-layered-'));
  const session = await Session.open({ workspaceRoot: root });
  try {
    let behavior = 'behavior-v1', policy = 'policy-v1', instruction = 'rules-v1';
    let providerId = 'p1', model = 'm', tokenizerVersion = 't1', skillManifestHash = 'skills-v1';
    const tools: ToolSpec[] = [];
    const builder = new ContextBuilder({ session, model: 'm', stableSections: () => [behavior], policyGuidance: () => [policy],
      instructions: () => [{ sourcePath: 'AGENTS.md', content: instruction, scope: 'project' }], getVisibleTools: () => tools,
      cacheDependencies: () => ({ tokenizerVersion, skillManifestHash }), modelSelection: () => ({ model, providerId }) });
    const first = await builder.assemble(1);
    const repeated = await builder.assemble(2);
    expect(repeated.cacheLayers.every(layer => layer.hits > 0)).toBe(true);
    await session.appendSync({ type: 'user/message', role: 'user', msgId: 'u', content: 'new event', surface: true });
    const event = await builder.assemble(3);
    expect(event.cacheLayers.find(l => l.layer === 'projection')!.invalidations).toBe(1);
    expect(event.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations).toBe(0);
    for (const change of [() => { behavior = 'behavior-v2'; }, () => { policy = 'policy-v2'; },
      () => { instruction = 'rules-v2'; }, () => { skillManifestHash = 'skills-v2'; }]) {
      change(); await builder.assemble(4);
    }
    const config = await builder.assemble(5);
    expect(config.messages[0]!.content).toContain('behavior-v2');
    expect(config.messages[0]!.content).toContain('policy-v2');
    expect(config.messages.some(m => m.source === 'instruction' && m.content.includes('rules-v1'))).toBe(false);
    expect(config.prefixLayout.scopedPrefix).toContain('rules-v2');
    expect(config.dependencyHash).not.toBe(first.dependencyHash);
    tools.push({ name: 'Read', description: 'Read a file', family: 'file_read', requiredPermission: 'read', exclusive: false,
      inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) });
    const tool = await builder.assemble(5);
    expect(tool.prefixLayout.stablePrefix).toContain('Read a file');
    expect(tool.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations).toBeGreaterThan(config.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations);
    providerId = 'p2';
    const provider = await builder.assemble(6);
    expect(provider.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations).toBeGreaterThan(config.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations);
    tokenizerVersion = 't2';
    const tokenizer = await builder.assemble(7);
    expect(tokenizer.cacheLayers.find(l => l.layer === 'token-estimation')!.invalidations).toBeGreaterThan(provider.cacheLayers.find(l => l.layer === 'token-estimation')!.invalidations);
    expect(tokenizer.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations).toBe(provider.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations);
    model = 'm2';
    const switched = await builder.assemble(8);
    expect(switched.model).toBe('m2');
    expect(switched.requestHash).not.toBe(tokenizer.requestHash);
    expect(switched.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations).toBeGreaterThan(tokenizer.cacheLayers.find(l => l.layer === 'provider-prefix')!.invalidations);
    expect(switched.cacheLayers.find(l => l.layer === 'token-estimation')!.invalidations).toBeGreaterThan(tokenizer.cacheLayers.find(l => l.layer === 'token-estimation')!.invalidations);
    expect(session.replay().filter(r => r.type === 'user/message' && r.source === 'instruction')).toHaveLength(2);
  } finally { await session.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
