import { describe, expect, it, vi } from 'vitest';
import { SessionInspector } from './sessionInspector.js';
const payload = { envelope: { prefixLayout: { stablePrefix: '秘密', scopedPrefix: 'rules', volatileSuffix: 'now', prefixByteHash: 'a'.repeat(64) } } };
const workspace = { timestamp: 1, trackedFilesHash: 'b'.repeat(64), fileCount: 2, uncommittedDiffBytes: 3 };
describe('session inspector telemetry', () => {
  it('publishes byte counts and distinct hashes without prompt contents; replays only its session', async () => {
    const inspector = new SessionInspector(async () => workspace);
    const receive = vi.fn(); inspector.subscribe('a', receive);
    inspector.observe('a', payload, '/fixture');
    await Promise.resolve();
    expect(receive.mock.lastCall?.[0]).toMatchObject({ prefix: { stableBytes: 6, scopedBytes: 5, volatileBytes: 3, sha256: 'a'.repeat(64) }, workspace });
    expect(JSON.stringify(receive.mock.calls)).not.toContain('秘密');
    const other = vi.fn(); inspector.subscribe('b', other); expect(other).not.toHaveBeenCalled();
    const replay = vi.fn(); inspector.subscribe('a', replay); expect(replay).toHaveBeenCalledOnce(); inspector.close();
  });
  it('ignores stale/closed asynchronous results and invalid envelopes', async () => {
    const resolves: Array<(value: typeof workspace) => void> = [];
    const inspector = new SessionInspector(() => new Promise(resolve => resolves.push(resolve)));
    const receive = vi.fn(); inspector.subscribe('a', receive);
    inspector.observe('a', {}, '/fixture'); expect(receive).not.toHaveBeenCalled();
    inspector.observe('a', payload, '/fixture'); inspector.observe('a', payload, '/fixture');
    resolves[0]!(workspace); await Promise.resolve(); expect(receive).toHaveBeenCalledTimes(2);
    inspector.close(); resolves[1]!(workspace); await Promise.resolve(); expect(receive).toHaveBeenCalledTimes(2);
  });
  it('does not retain a stale fingerprint when the next observation fails', async () => {
    const observer = vi.fn().mockResolvedValueOnce(workspace).mockRejectedValueOnce(new Error('unreadable'));
    const inspector = new SessionInspector(observer); const receive = vi.fn(); inspector.subscribe('a', receive);
    inspector.observe('a', payload, '/fixture'); await Promise.resolve();
    inspector.observe('a', payload, '/fixture'); await Promise.resolve(); await Promise.resolve();
    expect(receive.mock.lastCall?.[0].workspace).toBeUndefined(); inspector.close();
  });
});
