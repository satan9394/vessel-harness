/**
 * runtime/sandbox/backend — process-tree tracking, audit & escape detection (task 072).
 *
 * 071 gave us a Job Object that terminates the whole tree, but it kept only ONE
 * durable number (the job name) and the root pid. There was no way to ask "which
 * processes belong to this execution", no parent/child record, no way to learn a
 * grandchild walked out of the tree. This module is the tree-facing bookkeeping
 * half of process-tree confinement:
 *
 *   - `ProcessTreeTracker` is a pure, cross-platform state machine: register a
 *     spawn (pid + parent), mark a process exited, enumerate children, snapshot
 *     the whole tree, and keep an append-only audit log. It has ZERO OS calls so
 *     it can be unit-tested on any platform; the OS-facing enumeration/attach
 *     lives in `windows-job-object.ts`.
 *   - `detectEscapes` is the escape-detection rule, also pure: given the set of
 *     pids the OS reports as live descendants of the confined root TODAY, and
 *     the set of pids we have positively confined (root + everything attached to
 *     the job), it returns the pids that are running but not confined — i.e.
 *     they escaped the constraint boundary. The caller decides whether to
 *     terminate them (mechanism-level hard enforcement).
 *
 * Honest boundary: the tracker records what WE observe through TS spawn/CIM
 * enumeration. A child that detaches into its own job (BREAKAWAY) or that forked
 * inside the window between tl+k and attach is *detected* by `detectEscapes`
 * when we re-enumerate, but a pre-attach forked grandchild is only retroactively
 * confined if the driver calls the attach-descendants pass (see Sandbox.ts). We
 * never claim to retroactively confine processes we never saw.
 */

/** One node in the confined process tree. */
export interface ProcessNode {
  pid: number;
  /** parent pid at registration; undefined for the recorded root. */
  parentPid?: number;
  /** the command string that was spawned (best-effort, may be empty). */
  command?: string;
  spawnedAt: number;
  exitedAt?: number;
  exitCode?: number | null;
  /** inferred: still running at the time of the last snapshot/markExit. */
  alive: boolean;
}

/** Append-only audit event kinds produced by the tracker + escape detection. */
export type ProcessTreeAuditKind =
  | 'spawn' // a process was registered into the tree
  | 'exit' // a process was observed exiting
  | 'attached' // a pid was pulled into the Job Object
  | 'escape-detected' // a live descendant was found outside the confined set
  | 'escape-terminated' // an escaped pid was terminated
  | 'window-closed' // the attach-timing window was closed for a root pid
  ;

export interface ProcessTreeAuditEvent {
  kind: ProcessTreeAuditKind;
  pid?: number;
  /** human-readable detail. */
  detail: string;
  at: number;
}

/** Per-node record kept internally (alive is computed on demand from exitedAt). */
interface NodeRecord extends Omit<ProcessNode, 'alive'> {
  exitedAt?: number;
  exitCode?: number | null;
}

export interface ProcessTreeSnapshot {
  rootPid?: number;
  nodes: ProcessNode[];
  aliveCount: number;
  exitedCount: number;
}

/**
 * Cross-platform process-tree bookkeeping. Pure state: no I/O, no OS calls.
 * All mutations are O(1)-ish map operations; snapshots derive `alive` from
 * whether the exit has been recorded.
 */
export class ProcessTreeTracker {
  private readonly nodes = new Map<number, NodeRecord>();
  private readonly audit: ProcessTreeAuditEvent[] = [];
  private rootPid?: number;

  /** Register a spawn into the tree. Idempotent for an already-known pid. */
  registerNode(pid: number, parentPid?: number, command?: string): void {
    if (this.nodes.has(pid)) return;
    this.nodes.set(pid, {
      pid,
      parentPid,
      command: command ?? '',
      spawnedAt: Date.now(),
    });
    if (this.rootPid === undefined) this.rootPid = pid;
    this.audit.push({ kind: 'spawn', pid, detail: `registered pid ${pid}`, at: Date.now() });
  }

  /** Mark a process as exited (sets its exit record + audit entry). */
  markExit(pid: number, exitCode?: number | null): void {
    const rec = this.nodes.get(pid);
    if (!rec) {
      // exit for an unregistered pid — record a synthetic node so the audit
      // trail is complete rather than silently dropping it.
      this.audit.push({ kind: 'exit', pid, detail: `exit for unknown pid ${pid}`, at: Date.now() });
      return;
    }
    if (rec.exitedAt !== undefined) return; // already exited
    rec.exitedAt = Date.now();
    rec.exitCode = exitCode ?? null;
    this.audit.push({ kind: 'exit', pid, detail: `pid ${pid} exited code=${rec.exitCode}`, at: Date.now() });
  }

  /** The recorded root pid (first registered). */
  get root(): number | undefined {
    return this.rootPid;
  }

  /** All direct children of `pid`. */
  childrenOf(pid: number): ProcessNode[] {
    const out: ProcessNode[] = [];
    for (const rec of this.nodes.values()) {
      if (rec.parentPid === pid) out.push(this.nodeView(rec));
    }
    return out;
  }

  /** A node snapshot (deriving `alive`). */
  node(pid: number): ProcessNode | undefined {
    const rec = this.nodes.get(pid);
    return rec ? this.nodeView(rec) : undefined;
  }

  /** All recorded nodes, oldest-first. */
  nodesList(): ProcessNode[] {
    return [...this.nodes.values()].map((r) => this.nodeView(r));
  }

  /** Whether `pid` is a descendant of `ancestor` in the recorded tree. */
  isDescendantOf(pid: number, ancestor: number): boolean {
    let cur = this.nodes.get(pid);
    let hops = 0;
    while (cur && cur.parentPid !== undefined && hops < 10_000) {
      if (cur.parentPid === ancestor) return true;
      cur = this.nodes.get(cur.parentPid);
      hops += 1;
    }
    return false;
  }

  /** Snapshot of the whole recorded tree with alive/exited tallies. */
  snapshot(): ProcessTreeSnapshot {
    const nodes = this.nodesList();
    let aliveCount = 0;
    for (const n of nodes) {
      if (n.alive) aliveCount += 1;
    }
    const exitedCount = nodes.length - aliveCount;
    return { rootPid: this.rootPid, nodes, aliveCount, exitedCount };
  }

  /** Copy of the audit log (append-only; callers get a defensive copy). */
  auditLog(): ProcessTreeAuditEvent[] {
    return this.audit.map((e) => ({ ...e }));
  }

  /** Record an audit event (used by escape detection + the driver). */
  record(kind: ProcessTreeAuditKind, detail: string, pid?: number): void {
    this.audit.push({ kind, pid, detail, at: Date.now() });
  }

  /** Number of registered nodes (test aid / diagnostics). */
  get size(): number {
    return this.nodes.size;
  }

  private nodeView(rec: NodeRecord): ProcessNode {
    return {
      pid: rec.pid,
      parentPid: rec.parentPid,
      command: rec.command,
      spawnedAt: rec.spawnedAt,
      exitedAt: rec.exitedAt,
      exitCode: rec.exitCode,
      alive: rec.exitedAt === undefined,
    };
  }
}

/** Result of running escape detection. */
export interface EscapeDetectionReport {
  /** pids found running outside the confined set. */
  escapedPids: number[];
  /** pids we chose to terminate (subset of escapedPids). */
  terminatedPids: number[];
  /** pids confined and accounted for (no action). */
  confinedPids: number[];
}

/** Options controlling escape detection + hard-response. */
export interface EscapeDetectionOptions {
  /** whether to actually terminate escaped pids (mechanical hard enforcement). */
  terminateEscaped: boolean;
  /** a terminate(pids) callback; required when terminateEscaped is true. */
  terminate?: (pids: number[]) => Promise<void> | void;
  /** record audit entries on the tracker (default true). */
  audit?: boolean;
}

/**
 * Pure escape-detection rule. `liveDescendants` is the CURRENT set of live
 * descendant pids reported by the OS for the confined root. `confinedPids` is
 * the set we have positively pulled into the Job Object (root + attached
 * descendants + self-registered spawns). Any live descendant not in the
 * confined set is an escape — it runs outside the constraint boundary.
 */
export async function detectEscapes(
  rootPid: number,
  liveDescendants: number[],
  confinedPids: Set<number>,
  opts: EscapeDetectionOptions,
): Promise<EscapeDetectionReport> {
  confinedPids.add(rootPid);
  const escapedPids = liveDescendants.filter((pid) => !confinedPids.has(pid));
  const terminatedPids: number[] = [];
  if (opts.terminateEscaped && escapedPids.length > 0 && opts.terminate) {
    await opts.terminate(escapedPids);
    terminatedPids.push(...escapedPids);
  }
  return {
    escapedPids,
    terminatedPids,
    confinedPids: [...confinedPids],
  };
}