import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectStore, type MemoryIndexEntry } from '../project/ProjectStore.js';
import { vesselHome } from '@vessel/shared';

/**
 * memory/persistent — scoped memory over user/project/local levels
 * (ARCHITECTURE §4.8: user/project/local 三级作用域; task 002 V0.3-M2).
 *
 * Each scope has its own on-disk root, backed by the same ProjectStore engine
 * (file-based MEMORY.md index + topic files) so there is a single storage
 * abstraction, not two drifted implementations:
 *
 *   user    — ~/.vessel/memory            (跨项目, per-user persistent)
 *   project — <ws>/.harness/memory     (per-project, from task 001)
 *   local   — <ws>/.harness/memory/local (session/ephemeral-local notes)
 *
 * Read/merge semantics: a scope-scoped read hits only that scope; the merged
 * view (`readMerged`) resolves the same topic name by precedence local >
 * project > user (more specific shadows more general). Writes always target an
 * explicit scope and never cross-contaminate another scope's files.
 */

export type MemoryScope = 'user' | 'project' | 'local';

export const MEMORY_SCOPES: MemoryScope[] = ['user', 'project', 'local'];

/** user-level memory lives under the user home (跨项目 persistent). */
export function userMemoryRoot(home = os.homedir()): string {
  return path.join(vesselHome(home), 'memory');
}

/** project-level root (matches task-001 ProjectStore default). */
export function projectMemoryRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.harness', 'memory');
}

/** local-level root — under the project memory dir, clearly marked local. */
export function localMemoryRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.harness', 'memory', 'local');
}

export interface ScopedMemoryOptions {
  workspaceRoot: string;
  /** override user root (tests inject a temp home) */
  userRoot?: string;
  /** override project root (tests inject a temp dir) */
  projectRoot?: string;
}

export class ScopedMemoryStore {
  private readonly stores: Record<MemoryScope, ProjectStore>;

  constructor(opts: ScopedMemoryOptions) {
    const user = new ProjectStore(opts.workspaceRoot, { rootDir: opts.userRoot ?? userMemoryRoot() });
    const project = new ProjectStore(opts.workspaceRoot, { rootDir: opts.projectRoot ?? projectMemoryRoot(opts.workspaceRoot) });
    const local = new ProjectStore(opts.workspaceRoot, { rootDir: localMemoryRoot(opts.workspaceRoot) });
    this.stores = { user, project, local };
  }

  /** write a topic into an explicit scope. */
  write(scope: MemoryScope, name: string, content: string): { name: string; updatedAt: string } {
    return this.stores[scope].write(name, content);
  }

  /** read a topic from ONE scope only (no fallthrough). */
  read(scope: MemoryScope, name: string): string | undefined {
    return this.stores[scope].read(name);
  }

  /** read a topic across scopes with local > project > user precedence (first hit wins). */
  readMerged(name: string): { scope: MemoryScope; content: string } | undefined {
    for (const scope of ['local', 'project', 'user'] as const) {
      const content = this.stores[scope].read(name);
      if (content !== undefined) return { scope, content };
    }
    return undefined;
  }

  /** list topics within one scope. */
  list(scope: MemoryScope): MemoryIndexEntry[] {
    return this.stores[scope].list();
  }

  /** search within one scope. */
  search(scope: MemoryScope, keyword: string): MemoryIndexEntry[] {
    return this.stores[scope].search(keyword);
  }

  /** per-scope frozen snapshot (for injection). */
  snapshot(scope: MemoryScope): string {
    return this.stores[scope].snapshot();
  }

  /** merged frozen snapshot across scopes (user base + project + local overlays). */
  snapshotMerged(): string {
    const parts: string[] = [];
    for (const scope of ['user', 'project', 'local'] as const) {
      const snap = this.stores[scope].snapshot();
      if (snap) parts.push(`[${scope} memory]\n${snap}`);
    }
    return parts.join('\n\n');
  }
}
