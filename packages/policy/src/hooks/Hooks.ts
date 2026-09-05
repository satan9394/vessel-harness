import type { WaterfallResult } from '@cah/shared';

export interface HooksCommandConfig {
  /** Claude Code / Codex dialect matcher (prefix/glob) */
  match: string;
  command: string;
  /** exit code semantics: 0 = continue, 2 = block, other = warn (Claude Code) */
}

/**
 * policy/hooks — external hooks.json compat bridge seam (ARCHITECTURE §4.6).
 * v0.1: interface + no-op install; command-hook execution (subprocess JSON
 * stdin/stdout protocol) lands with the full hooks plane.
 */
export class Hooks {
  private commands: HooksCommandConfig[] = [];

  install(config: { commands?: HooksCommandConfig[] }): void {
    this.commands = config.commands ?? [];
  }

  get installed(): boolean {
    return this.commands.length > 0;
  }

  async runBeforeTool(_call: { toolName: string; arguments: Record<string, unknown> }): Promise<WaterfallResult> {
    // v0.1 no-op passthrough (seam only)
    return { kind: 'defer' };
  }
}
