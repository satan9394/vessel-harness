import { parseUnifiedDiff, type PermissionActionWidget, type WidgetBlock } from '@vessel/shared';
import { terminalText } from './TerminalStatusLine.js';

export function renderAnsiWidget(widget: WidgetBlock, tty = false): string {
  const safe = (text: string) => terminalText(text);
  const color = (text: string, code: number) => tty ? `\x1b[${code}m${text}\x1b[0m` : text;
  switch (widget.kind) {
    case 'diff_inspector': {
      const lines = parseUnifiedDiff(safe(widget.payload.patch));
      const additions = lines.filter(line => line.kind === 'add').length;
      const deletions = lines.filter(line => line.kind === 'remove').length;
      const summary = `${safe(widget.payload.filePath)} +${additions} -${deletions}`;
      if (lines.length > 15) return `${summary} [${lines.length} lines collapsed]`;
      return `${summary}\n${lines.map(line => color(line.text, line.kind === 'add' ? 32 : line.kind === 'remove' ? 31 : 0)).join('\n')}`;
    }
    case 'red_green_gate': {
      const p = widget.payload;
      const label = p.phase === 'green_verified' ? 'GREEN: verified' : p.phase === 'red_verified' ? `RED: exit ${p.exitCode} verified` : `REJECTED: exit ${p.exitCode}`;
      return `${color(`[${label}]`, p.phase === 'green_verified' ? 32 : 31)} ${safe(p.command)} SHA-256 ${safe(p.proofSha256).slice(0, 12)}`;
    }
    case 'impact_radar': return `Impact ${safe(widget.payload.targetSymbol)}: ${widget.payload.blastRadius.modifiedFiles.length} files, ${widget.payload.blastRadius.affectedCallers.length} callers\n${widget.payload.blastRadius.affectedCallers.map(c => `${safe(c.filePath)}: ${safe(c.symbolName)}`).join('\n')}`;
    case 'permission_action': return `${safe(widget.payload.description)} [${widget.status}${widget.resolution ? `: ${safe(widget.resolution.selectedOptionId)}` : ''}]\n${widget.payload.options.map(o => safe(o.label)).join(' | ')}`;
  }
}

/** Pure keyboard decision model. Returning an option never executes an action. */
export class PermissionSelection {
  index = 0;
  constructor(readonly widget: PermissionActionWidget) {}
  key(key: string): string | undefined {
    if (key === 'left' || key === 'up') this.index = (this.index + this.widget.payload.options.length - 1) % this.widget.payload.options.length;
    if (key === 'right' || key === 'down') this.index = (this.index + 1) % this.widget.payload.options.length;
    return key === 'enter' ? this.widget.payload.options[this.index]?.id : undefined;
  }
  render(): string { return this.widget.payload.options.map((o, i) => `${i === this.index ? '>' : ' '} ${terminalText(o.label).replace(/[\r\n\t]/g, ' ')}`).join(' | '); }
}
