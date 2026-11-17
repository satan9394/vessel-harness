/** Strip terminal commands from untrusted model, path and label text. */
export function terminalText(value: string): string {
  return value.replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

export interface StatusLineState {
  modelName: string;
  reasoningEffort?: string;
  sandboxTier: string;
  cachedTokensRate?: number;
  workspaceFingerprint: string;
  activeTurns: number;
  turnElapsedMs?: number;
}
export interface ITerminalStatusLine {
  update(state: Partial<StatusLineState>): void;
  render(): void;
  clear(): void;
  dispose(): void;
}
export interface TerminalWriter {
  isTTY?: boolean;
  columns?: number;
  write(text: string): unknown;
  on?(event: 'resize', listener: () => void): unknown;
  removeListener?(event: 'resize', listener: () => void): unknown;
}

/** One transient line; callers clear it before output or accepting user input. */
export class TerminalStatusLine implements ITerminalStatusLine {
  private state: StatusLineState = { modelName: 'unknown', sandboxTier: 'unknown', workspaceFingerprint: 'unknown', activeTurns: 0 };
  private visible = false;
  private disposed = false;
  private last = '';
  private readonly resize = () => { if (this.visible) { this.last = ''; this.render(); } };
  constructor(private readonly output: TerminalWriter) { output.on?.('resize', this.resize); }
  update(state: Partial<StatusLineState>): void { this.state = { ...this.state, ...state }; if (this.visible) this.render(); }
  render(): void {
    if (this.disposed) return;
    const s = this.state;
    const rate = s.cachedTokensRate;
    const cache = rate !== undefined && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? `${Math.round(rate * 100)}%` : 'unknown';
    const text = terminalText(`${s.modelName.slice(0, 18)} | ${s.sandboxTier} | hash ${s.workspaceFingerprint.slice(0, 8)} | cache ${cache} | ${s.reasoningEffort ?? '?'} | ${s.activeTurns} turn ${((s.turnElapsedMs ?? 0) / 1000).toFixed(1)}s`).replace(/[\r\n\t]/g, ' ');
    // ASCII projection avoids splitting wide unicode cells or combining marks.
    const line = this.output.isTTY ? text.replace(/[^\x20-\x7e]/g, '|').slice(0, Math.max(1, (this.output.columns ?? 80) - 1)) : text;
    if (line === this.last) return;
    this.output.write(this.output.isTTY ? `\r\x1b[2K${line}` : `${line}\n`);
    this.visible = !!this.output.isTTY;
    this.last = line;
  }
  clear(): void { if (this.visible) this.output.write('\r\x1b[2K'); this.visible = false; this.last = ''; }
  dispose(): void { this.clear(); this.disposed = true; this.output.removeListener?.('resize', this.resize); }
}
