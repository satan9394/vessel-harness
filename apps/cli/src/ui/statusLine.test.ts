import { describe, expect, it, vi } from 'vitest';
import type { DiffInspectorWidget, PermissionActionWidget, WidgetBlock } from '@vessel/shared';
import { TerminalStatusLine, terminalText } from './TerminalStatusLine.js';
import { PermissionSelection, renderAnsiWidget } from './AnsiWidgetRenderer.js';

const base = { id: 'w', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending' as const };
const diff = (patch: string): DiffInspectorWidget => ({ ...base, kind: 'diff_inspector', payload: { filePath: 'a.ts', patch, additions: 99, deletions: 99 } });
const action: PermissionActionWidget = { ...base, kind: 'permission_action', payload: { actionType: 'filesystem_write', description: 'Choose', options: [{ id: 'deny', label: 'Deny', tone: 'neutral' }, { id: 'allow', label: 'Allow', tone: 'primary' }] } };

describe('terminal status and widgets', () => {
  it('falls back to plain output and preserves unknown measured fields', () => {
    const write = vi.fn(); const status = new TerminalStatusLine({ write });
    status.update({ modelName: 'mock', workspaceFingerprint: 'a'.repeat(64) }); status.render(); status.dispose();
    expect(write.mock.calls.flat().join('')).toContain('cache unknown');
    expect(write.mock.calls.flat().join('')).not.toContain('\x1b');
  });
  it('keeps required fields within 80 columns, deduplicates redraws and cleans resize', () => {
    const output = { isTTY: true, columns: 80, write: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
    const status = new TerminalStatusLine(output);
    status.update({ modelName: 'gpt-6.1-sol', sandboxTier: 'JobRestricted', workspaceFingerprint: 'b'.repeat(64), cachedTokensRate: 0.8 });
    status.render(); status.render(); expect(output.write).toHaveBeenCalledTimes(1);
    expect(output.write.mock.calls[0]![0]).toContain('cache 80%');
    output.columns = 30; output.on.mock.calls[0]![1]();
    expect(terminalText(output.write.mock.calls[1]![0]).length).toBeLessThan(30);
    status.dispose(); expect(output.removeListener).toHaveBeenCalledWith('resize', output.on.mock.calls[0]![1]);
    const calls = output.write.mock.calls.length; status.render(); expect(output.write).toHaveBeenCalledTimes(calls);
  });
  it('counts triple-sign hunk changes separately from file metadata', () => {
    const rendered = renderAnsiWidget(diff('--- a\n+++ b\n@@ -1 +1 @@\n---removed\n+++added'), true);
    expect(rendered).toContain('a.ts +1 -1');
    expect(rendered).toContain('\x1b[31m---removed'); expect(rendered).toContain('\x1b[32m+++added');
  });
  it('collapses only beyond 15 lines and computes additions from patch', () => {
    expect(renderAnsiWidget(diff(Array.from({ length: 16 }, () => '+x').join('\n')))).toBe('a.ts +16 -0 [16 lines collapsed]');
    expect(renderAnsiWidget(diff(Array.from({ length: 15 }, () => '+x').join('\n')))).toContain('\n+x');
  });
  it('shows gates, caller detail, and resolved decisions without executing actions', () => {
    const gate: WidgetBlock = { ...base, kind: 'red_green_gate', payload: { phase: 'red_verified', command: 'test', exitCode: 1, proofSha256: 'c'.repeat(64) } };
    expect(renderAnsiWidget(gate, true)).toContain('[RED: exit 1 verified]');
    gate.payload.phase = 'green_verified'; expect(renderAnsiWidget(gate)).toContain('[GREEN: verified] test SHA-256 cccccccccccc');
    const impact: WidgetBlock = { ...base, kind: 'impact_radar', payload: { targetSymbol: 'foo', blastRadius: { modifiedFiles: ['a'], affectedCallers: [{ filePath: 'b', symbolName: 'bar' }] } } };
    expect(renderAnsiWidget(impact)).toContain('b: bar');
    expect(renderAnsiWidget({ ...action, status: 'resolved', resolution: { selectedOptionId: 'deny', resolvedAt: base.timestamp } })).toContain('[resolved: deny]');
  });
  it('selects with arrows, wraps around and only returns a decision on Enter', () => {
    const selection = new PermissionSelection(action);
    expect(selection.key('up')).toBeUndefined(); expect(selection.render()).toContain('> Allow');
    expect(selection.key('enter')).toBe('allow'); selection.key('right'); expect(selection.key('enter')).toBe('deny');
  });
  it('removes terminal controls from all untrusted output', () => {
    const hostile = '\x1b]0;pwn\x07\x1b[2Jbad\r\x90';
    expect(terminalText(hostile)).toBe('bad');
    expect(renderAnsiWidget({ ...action, payload: { ...action.payload, description: hostile } })).not.toContain('\x1b');
  });
  it('preserves link text between OSC hyperlink commands terminated by ESC backslash', () => {
    expect(terminalText('\x1b]8;;https://e.com\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
  });
  it('preserves link text with BEL terminators and handles repeated incomplete OSC starts', () => {
    expect(terminalText('\x1b]8;;https://e.com\x07link\x1b]8;;\x07')).toBe('link');
    expect(terminalText('\x1b]'.repeat(8000) + 'visible')).toBe('visible');
  });
});
