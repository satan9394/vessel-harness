export type WidgetKind = 'diff_inspector' | 'red_green_gate' | 'impact_radar' | 'permission_action';

export interface BaseWidgetBlock {
  id: string;
  kind: WidgetKind;
  turnIndex: number;
  timestamp: string;
  status: 'pending' | 'resolved' | 'expired';
}
export interface DiffInspectorWidget extends BaseWidgetBlock {
  kind: 'diff_inspector';
  payload: { filePath: string; additions: number; deletions: number; patch: string; collapsedByDefault?: boolean };
}
export interface RedGreenGateWidget extends BaseWidgetBlock {
  kind: 'red_green_gate';
  payload: { phase: 'red_verified' | 'green_verified' | 'rejected'; command: string; exitCode: number; failureSummary?: string; proofSha256: string };
}
export interface ImpactRadarWidget extends BaseWidgetBlock {
  kind: 'impact_radar';
  payload: { targetSymbol: string; blastRadius: { modifiedFiles: string[]; affectedCallers: Array<{ filePath: string; symbolName: string }> } };
}
export interface PermissionActionWidget extends BaseWidgetBlock {
  kind: 'permission_action';
  payload: { actionType: 'mod_execution' | 'policy_override' | 'filesystem_write'; description: string; options: Array<{ id: string; label: string; tone: 'primary' | 'danger' | 'neutral' }> };
  resolution?: { selectedOptionId: string; resolvedAt: string };
}
export type WidgetBlock = DiffInspectorWidget | RedGreenGateWidget | ImpactRadarWidget | PermissionActionWidget;
export interface WidgetActionResponse { widgetId: string; selectedOptionId: string; resolvedAt: string }
export type WidgetEventKind = 'widget_block' | 'action_request' | 'action_response';

/** Shared Web/ANSI interpretation keeps header detection and hunk counts consistent. */
export function parseUnifiedDiff(patch: string) {
  let oldLine = 0; let newLine = 0;
  let oldRemaining = 0; let newRemaining = 0;
  return patch.split(/\r?\n/).map(text => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[3]); oldRemaining = Number(hunk[2] ?? 1); newRemaining = Number(hunk[4] ?? 1); }
    const inHunk = oldRemaining > 0 || newRemaining > 0;
    const kind = hunk || /^\\/.test(text) || (!inHunk && /^(---|\+\+\+|diff |index )/.test(text)) ? 'meta' : text.startsWith('+') ? 'add' : text.startsWith('-') ? 'remove' : text.startsWith(' ') ? 'context' : 'meta';
    const row = { text, kind, oldLine: kind === 'remove' || kind === 'context' ? oldLine++ : undefined, newLine: kind === 'add' || kind === 'context' ? newLine++ : undefined };
    if (kind === 'remove' || kind === 'context') oldRemaining -= 1;
    if (kind === 'add' || kind === 'context') newRemaining -= 1;
    return row;
  });
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Validate the transport boundary before rendering or registering an action. */
export function isWidgetBlock(v: unknown): v is WidgetBlock {
  if (!record(v) || !text(v.id) || !count(v.turnIndex) || !date(v.timestamp) || !['pending', 'resolved', 'expired'].includes(v.status as string) || !record(v.payload)) return false;
  const p = v.payload;
  switch (v.kind) {
    case 'diff_inspector': return text(p.filePath) && count(p.additions) && count(p.deletions) && typeof p.patch === 'string' && (p.collapsedByDefault === undefined || typeof p.collapsedByDefault === 'boolean');
    case 'red_green_gate': return ['red_verified', 'green_verified', 'rejected'].includes(p.phase as string) && text(p.command) && typeof p.exitCode === 'number' && Number.isSafeInteger(p.exitCode) && (p.failureSummary === undefined || typeof p.failureSummary === 'string') && typeof p.proofSha256 === 'string' && /^[a-f0-9]{64}$/i.test(p.proofSha256);
    case 'impact_radar': return text(p.targetSymbol) && record(p.blastRadius) && Array.isArray(p.blastRadius.modifiedFiles) && p.blastRadius.modifiedFiles.every(text) && Array.isArray(p.blastRadius.affectedCallers) && p.blastRadius.affectedCallers.every(c => record(c) && text(c.filePath) && text(c.symbolName));
    case 'permission_action': {
      if (!['mod_execution', 'policy_override', 'filesystem_write'].includes(p.actionType as string) || !text(p.description) || !Array.isArray(p.options) || !p.options.length || !p.options.every(o => record(o) && text(o.id) && text(o.label) && ['primary', 'danger', 'neutral'].includes(o.tone as string))) return false;
      const ids = p.options.map(o => (o as Record<string, unknown>).id);
      if (new Set(ids).size !== ids.length) return false;
      return v.status === 'resolved'
        ? record(v.resolution) && ids.includes(v.resolution.selectedOptionId) && date(v.resolution.resolvedAt)
        : v.resolution === undefined;
    }
    default: return false;
  }
}

async function digest(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 detects accidental/tampered content; this checksum is not authentication. */
export async function serializeWidgetBlock(widget: WidgetBlock): Promise<string> {
  if (!isWidgetBlock(widget)) throw new TypeError('invalid widget block');
  const data = JSON.stringify(widget);
  return JSON.stringify({ data, sha256: await digest(data) });
}
export async function deserializeWidgetBlock(serialized: string): Promise<WidgetBlock> {
  const envelope: unknown = JSON.parse(serialized);
  if (!record(envelope) || typeof envelope.data !== 'string' || envelope.sha256 !== await digest(envelope.data)) throw new TypeError('widget checksum mismatch');
  const widget: unknown = JSON.parse(envelope.data);
  if (!isWidgetBlock(widget)) throw new TypeError('invalid widget block');
  return widget;
}
