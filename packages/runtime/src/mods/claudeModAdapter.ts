import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateModManifest, type ClaudeModManifest, type ModExecutionContext, type ModMiddleware } from '@vessel/shared';
import { WorkerSandbox, ModSecurityViolationError, type WorkerSandboxOptions } from './workerSandbox.js';

export interface LoadedClaudeMod { manifest: ClaudeModManifest; source: string; root: string }

export class ClaudeModAdapter {
  static async loadFromDirectory(directory: string): Promise<LoadedClaudeMod> {
    const root = await realpath(directory);
    let raw: unknown;
    for (const filename of ['vessel.mod.json', 'claude.mod', 'package.json']) {
      try {
        const filenamePath = await realpath(path.join(root, filename));
        if (path.dirname(filenamePath) !== root) throw new ModSecurityViolationError('Mod manifest escape denied');
        const json = JSON.parse(await readFile(filenamePath, 'utf8')) as Record<string, unknown>;
        raw = filename === 'package.json' ? json['claude.mod'] : json;
        if (raw !== undefined) break;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const manifest = validateModManifest(raw);
    const entry = await realpath(path.resolve(root, manifest.entrypoint));
    const relative = path.relative(root, entry);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.(?:c?js|mjs)$/.test(entry)) throw new ModSecurityViolationError('Mod entrypoint escape or unsupported format');
    return { manifest, source: await readFile(entry, 'utf8'), root };
  }

  static createMiddleware(loaded: LoadedClaudeMod, options: Omit<WorkerSandboxOptions, 'source' | 'manifest' | 'root'> = {}): ModMiddleware {
    const manifest = validateModManifest(loaded.manifest);
    const sandbox = new WorkerSandbox({ ...options, ...loaded, manifest });
    // Metadata is host-owned and may contain secrets. Only explicit public context crosses.
    const context = (value: ModExecutionContext): ModExecutionContext => ({ sessionId: value.sessionId, turnIndex: value.turnIndex, ...(value.toolName === undefined ? {} : { toolName: value.toolName }), metadata: {} });
    return Object.freeze({
      name: manifest.name, version: manifest.version, priority: manifest.priority ?? 100,
      observe: async event => { await sandbox.invoke('observe', [{ ...event, context: context(event.context) }]); },
      rewriteToolInput: async (input, ctx) => await sandbox.invoke('rewriteToolInput', [input, context(ctx)], input) as Record<string, unknown>,
      rewritePromptFragment: async (fragment, ctx) => await sandbox.invoke('rewritePromptFragment', [fragment, context(ctx)], fragment) as string,
      interceptToolCall: async (input, ctx) => await sandbox.invoke('interceptToolCall', [input, context(ctx)], { handled: false }) as { handled: boolean; result?: unknown; reason?: string },
    } satisfies ModMiddleware);
  }

  /** Capture once at session startup and append only to the scopedPrefix tail. */
  static scopedPromptContribution(manifest: ClaudeModManifest): string {
    const valid = validateModManifest(manifest);
    const contribution = valid.systemPromptContribution?.replace(/\r\n?/g, '\n').trim();
    return contribution ? `[Mod: ${valid.name}]\n${contribution}` : '';
  }
}
