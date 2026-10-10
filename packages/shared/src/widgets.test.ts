import { describe, it, expect } from 'vitest';
import { deserializeWidgetBlock, isWidgetBlock, serializeWidgetBlock, type WidgetBlock } from './widgets.js';

const base = { id: 'w1', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending' as const };
const blocks: WidgetBlock[] = [
  { ...base, kind: 'diff_inspector', payload: { filePath: 'a.ts', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+hello' } },
  { ...base, kind: 'red_green_gate', payload: { phase: 'green_verified', command: 'test', exitCode: 0, proofSha256: 'a'.repeat(64) } },
  { ...base, kind: 'impact_radar', payload: { targetSymbol: 'foo', blastRadius: { modifiedFiles: ['a.ts'], affectedCallers: [{ filePath: 'b.ts', symbolName: 'bar' }] } } },
  { ...base, kind: 'permission_action', payload: { actionType: 'filesystem_write', description: 'Write patch', options: [{ id: 'allow', label: 'Allow', tone: 'primary' }] } },
];
describe('widget transport', () => {
  it.each(blocks)('round trips $kind and detects altered content', async widget => {
    const serialized = await serializeWidgetBlock(widget);
    expect(await deserializeWidgetBlock(serialized)).toEqual(widget);
    const envelope = JSON.parse(serialized);
    envelope.data = envelope.data.replace('w1', 'w2');
    await expect(deserializeWidgetBlock(JSON.stringify(envelope))).rejects.toThrow('checksum');
  });
  it('rejects invalid fields, conflicting resolutions and duplicate option ids', async () => {
    expect(isWidgetBlock({ ...blocks[0], turnIndex: -1 })).toBe(false);
    expect(isWidgetBlock({ ...blocks[0], status: ['pending'] })).toBe(false);
    expect(isWidgetBlock({ ...blocks[1], payload: { ...blocks[1]!.payload, proofSha256: 'not-a-hash' } })).toBe(false);
    expect(isWidgetBlock({ ...blocks[3], status: 'resolved' })).toBe(false);
    const action = blocks[3]!;
    if (action.kind !== 'permission_action') throw new Error('fixture');
    expect(isWidgetBlock({ ...action, payload: { ...action.payload, options: [...action.payload.options, ...action.payload.options] } })).toBe(false);
    await expect(serializeWidgetBlock({ ...blocks[0]!, timestamp: 'bad-date' })).rejects.toThrow('invalid');
  });
});
