import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Advisory toolchain pin checks shared by doctor and opt-in benchmark preparation. */

export function parseToolVersion(raw: string): string | null {
  return raw.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

export function satisfiesRange(version: string, range: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !range.trim()) return false;
  const actual = version.split('.').map(Number);
  return range.trim().split(/\s+/).every(clause => {
    const match = /^(>=|>|<=|<|=)(\d+\.\d+\.\d+)$/.exec(clause);
    if (!match) return false;
    const expected = match[2]!.split('.').map(Number);
    let comparison = 0;
    for (let i = 0; i < 3; i++) {
      comparison = actual[i]! - expected[i]!;
      if (comparison) break;
    }
    switch (match[1]) {
      case '>=': return comparison >= 0;
      case '>': return comparison > 0;
      case '<=': return comparison <= 0;
      case '<': return comparison < 0;
      case '=': return comparison === 0;
      default: return false;
    }
  });
}

export interface ToolPinCheck {
  tool: string;
  declared: string;
  found: string | null;
  status: 'pass' | 'warn';
  message: string;
}

export function probeToolVersion(tool: string): string | null {
  const result = spawnSync(tool, ['--version'], {
    encoding: 'utf8', shell: process.platform === 'win32', timeout: 10000,
  });
  return result.status === 0 ? parseToolVersion(result.stdout ?? '') : null;
}

export function checkToolPins(repoRoot: string, probe: (tool: string) => string | null = probeToolVersion): ToolPinCheck[] {
  try {
    const pins = JSON.parse(fs.readFileSync(path.join(repoRoot, 'configs/tool-pins.json'), 'utf8'));
    if (pins?.version !== 1 || !pins.tools || typeof pins.tools !== 'object' || Array.isArray(pins.tools)) throw new Error('Invalid pins');
    return Object.entries(pins.tools).map(([tool, pin]) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(tool) || !pin || typeof pin !== 'object' || !('range' in pin) || typeof pin.range !== 'string') throw new Error('Invalid pin');
      const declared = pin.range;
      let found: string | null = null;
      try { const raw = probe(tool); found = raw === null ? null : parseToolVersion(raw); } catch { /* unavailable CLI is advisory */ }
      if (found === null) return { tool, declared, found, status: 'warn', message: `${tool}: not installed on this machine; skipped` };
      const ok = satisfiesRange(found, declared);
      return { tool, declared, found, status: ok ? 'pass' : 'warn', message: ok
        ? `${tool}: ${found} (${declared}) ok`
        : `${tool}: found ${found}, declared ${declared}; upgrade/downgrade the CLI or update the pin.` };
    });
  } catch {
    return [{ tool: 'tool-pins.json', declared: '', found: null, status: 'warn', message: 'tool-pins.json: missing or invalid; restore configs/tool-pins.json version 1.' }];
  }
}
