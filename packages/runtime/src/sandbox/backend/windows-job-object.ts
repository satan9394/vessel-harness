/**
 * runtime/sandbox/backend — Windows Job Object confinement (task 071).
 *
 * Mechanism-level process-tree confinement for Windows without a native Rust
 * sidecar. Core mechanics:
 *
 *   1. A hidden "job-holder" PowerShell process creates a NAMED Job Object
 *      via `CreateJobObjectW`, best-efforts a `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`
 *      cap (anti fork-bomb, OS-enforced — not polling), then assigns the
 *      already-spawned target PID with breakaway disabled so the whole tree
 *      stays inside the job. It signals readiness via a marker file (Add-Type
 *      compile + assignment are async), then holds the handle until the target
 *      exits. If the target is ALREADY gone when the compile finishes (errno 87
 *      — the normal case for a short-lived command) the holder reports
 *      `target-exited` instead: there is nothing left to confine, so that is
 *      neither an attach failure nor a warning. The SAME 87 answer can come from
 *      the assign step itself — the target may exit in the window between a
 *      successful `OpenProcess` and the `AssignProcessToJobObject` — and it means
 *      exactly the same thing there (see `buildHolderScript`), so it gets the
 *      same `target-exited` marker and no warning. The holder must stay alive:
 *      when the last job handle closes, the
 *      OS destroys the job and kills everything in it. The holder is spawned
 *      WITHOUT `detached:true` — a detached PowerShell 5.1 console app cannot
 *      initialize and exits immediately (verified on this machine).
 *   2. Node keeps only the durable *job name*. Named Job Objects live in the
 *      local namespace and can be reopened by ANY process in the same session
 *      with `JOB_OBJECT_TERMINATE` access, so the runtime can call
 *      `TerminateJobObjectW` from a separate process — a reliable tree kill that
 *      removes grandchildren even if the direct child already exited or forked.
 *      This is the kill-tree semantic 071 requires, and it plugs into the 050
 *      interrupt / runCommand `signal` path via `CommandConfinement`.
 *
 * Good-faith limitation (documented, not hidden): Windows restricted-token /
 * privilege-drop via `CreateRestrictedToken` needs spawning the target with a
 * low-integrity restricted token from the launching process — not reachable from
 * a TS/PowerShell path without a native helper (no Rust toolchain here). It is
 * NOT implemented; `status()` reports the honest backend and delivered subset.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Resource caps applied to a confined Job Object (best-effort). */
export interface JobObjectLimits {
  /** max number of processes allowed in the job (anti fork-bomb). */
  maxActiveProcesses?: number;
  /**
   * per-process CPU time limit in MILLISECONDS (task 072). Mapped to
   * `JOBOBJECT_BASIC_LIMIT_INFORMATION.PerProcessUserTimeLimit` (100ns ticks)
   * with `JOB_OBJECT_LIMIT_PROCESS_TIME`. OS-enforced: a process exceeding its
   * own CPU budget is terminated. Best-effort (struct P/Invoke — see notes).
   */
  maxProcessTimeMs?: number;
  /**
   * per-process working-set ceiling in BYTES (task 072). Mapped to
   * `MaximumWorkingSetSize` with `JOB_OBJECT_LIMIT_WORKINGSET`. Note: the
   * working-set limit is a *soft* target on many Windows configs (a process
   * can be allowed above it under memory pressure); it is NOT a hard commit
   * cap and we do not claim otherwise.
   */
  maxWorkingSetBytes?: number;
}

/**
 * Why a job handle does NOT confine its target.
 *
 * `'target-exited'` — errno 87 (`ERROR_INVALID_PARAMETER`) means, from either
 * attach phase, **the PID does not exist**: the command finished before the
 * holder's `Add-Type` compile + assignment completed. That is the NORMAL case for
 * a short-lived command (measured: the compile takes 1–10 s, see
 * `createJobObject`), NOT an attach failure — there is nothing left to confine,
 * so it gets its own outcome, its own status reason and **no stderr warning**.
 *
 * Both phases use the same marker, because both report the same fact:
 *   - `OpenProcess` answered 87 — the PID was already gone before the attach.
 *   - `AssignProcessToJobObject` answered 87 — the target exited inside the
 *     attach window (after a SUCCESSFUL `OpenProcess`). Reporting this one as
 *     `job-object-attach-failed` would emit a false "the sandbox failed" alarm
 *     for a short command, i.e. exactly the false positive this split exists to
 *     remove; the safety direction is unchanged because `target-exited` still
 *     never terminates anything and never claims confinement.
 *
 * Any other errno — notably 5 `ERROR_ACCESS_DENIED` (missing
 * `PROCESS_SET_QUOTA`/`PROCESS_TERMINATE` rights) — IS a real failure: the holder
 * writes `<dir>/error` and the runtime degrades loudly. The two must never be
 * folded together, or a 3 ms `echo` looks like a broken sandbox.
 */
export type JobObjectAttachReason = 'target-exited';

/** The spawn-time confinement handle fed to `runCommand`. */
export interface JobObjectConfinement {
  /** durable name of the Job Object (used to reopen + terminate). */
  jobName: string;
  /** pid the job was created around (the confinement root). */
  rootPid?: number;
  /**
   * Whether the target is REALLY inside the job. `false` only for
   * `reason:'target-exited'`; mocks may omit the field, and absence means a
   * genuine attach, so minimal fakes stay compatible.
   */
  attached?: boolean;
  /** machine-readable reason when `attached === false` (absent otherwise). */
  reason?: JobObjectAttachReason;
  /**
   * Pull existing descendant pids into the job (task 072: closes the 071 attach
   * timing window for pre-attach grandchildren). Returns count assigned. Optional
   * so minimal mocks / degraded backends stay compatible.
   */
  attachDescendants?(pids: number[]): Promise<number>;
  /** terminate the ENTIRE job tree (all descendant processes). */
  terminate(): Promise<void>;
  /** release the confinement (terminates the tree too — idempotent). */
  dispose(): Promise<void>;
}

const PS = 'powershell';
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

/** Safely embed a string as a PS single-quoted literal. */
function psSq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Parse the JSON pid array emitted by the kill helpers. Anything unparseable
 * yields an EMPTY list — a failed read must never be mistaken for "all killed".
 */
function parseVerifiedPids(out: string): number[] {
  try {
    const parsed: unknown = JSON.parse(out.trim() || '[]');
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** Run PowerShell; resolve stdout trimmed, reject on non-zero. */
function runPs(script: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(PS, [...PS_ARGS, '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`powershell exited ${code}: ${err.trim() || out.trim()}`));
      else resolve(out.trim());
    });
  });
}

/**
 * Build the job-holder PowerShell script. Pure — no spawn, no I/O — and exported
 * so the errno→marker policy can be asserted deterministically WITHOUT a real
 * PowerShell. That matters because the failure mode this encodes (the target
 * exiting between a successful `OpenProcess` and the `AssignProcessToJobObject`)
 * cannot be constructed reliably on a machine; the generated script is the only
 * deterministic artifact that pins those branches down.
 *
 * The contract, identical for BOTH phases:
 *   - `OpenProcess` errno 87             ⇒ ready=`target-exited`
 *   - `AssignProcessToJobObject` errno 87 ⇒ ready=`target-exited` (the process
 *     exited inside the attach window; there is nothing left to confine, so it is
 *     the same fact and must not be reported as an attach failure)
 *   - anything else (5 = ERROR_ACCESS_DENIED, …) ⇒ `<dir>/error` ⇒ the runtime
 *     degrades LOUDLY. Never folded into `target-exited`.
 *
 * Ordering detail that is part of the contract: each phase reads its errno
 * IMMEDIATELY after the P/Invoke and BEFORE `CloseHandle` — a second P/Invoke is
 * free to clobber the thread's last-error value, which would silently turn an
 * errno-5 access-denied into a bogus "target-exited".
 */
export function buildHolderScript(opts: {
  jobName: string;
  targetPid: number;
  limits: JobObjectLimits;
  readyFile: string;
  errorFile: string;
}): string {
  const { jobName, targetPid, limits, readyFile, errorFile } = opts;
  return (
    '$ErrorActionPreference="Stop"\n' +
    `$name=${psSq(jobName)}\n` +
    `$tpid=${Math.trunc(targetPid)}\n` +
    `$maxProc=${Math.trunc(limits.maxActiveProcesses ?? 0)}\n` +
    `$procMs=${Math.trunc(limits.maxProcessTimeMs ?? 0)}\n` +
    `$wsBytes=${Math.trunc(limits.maxWorkingSetBytes ?? 0)}\n` +
    `$ready=${psSq(readyFile)}\n` +
    `$errFile=${psSq(errorFile)}\n` +
    '$src=@"\n' +
    'using System; using System.Runtime.InteropServices;\n' +
    'public class JobHolder {\n' +
    ' [StructLayout(LayoutKind.Sequential)] public struct BLI { public long Ppt; public long Pjt; public uint Flags; public IntPtr MinW; public IntPtr MaxW; public uint Active; public IntPtr Aff; public uint Prio; public uint Sched; }\n' +
    ' [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a,string n);\n' +
    ' [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j,int cls,IntPtr i,int len);\n' +
    ' [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);\n' +
    ' [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,uint pid);\n' +
    ' [DllImport("kernel32.dll")] public static extern void CloseHandle(IntPtr h);\n' +
    '}\n' +
    '"@\n' +
    'function Write-Err($m){ try { [IO.File]::WriteAllText($errFile, $m) } catch {} }\n' +
    'try {\n' +
    ' Add-Type -TypeDefinition $src -ErrorAction Stop\n' +
    ` $job=[JobHolder]::CreateJobObject([IntPtr]::Zero,$name)\n` +
    ' if($job -eq [IntPtr]::Zero){ throw "CreateJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }\n' +
    ' $lim=New-Object JobHolder+BLI\n' +
    // JOB_OBJECT_LIMIT_WORKINGSET=0x1, JOB_OBJECT_LIMIT_PROCESS_TIME=0x2,
    // JOB_OBJECT_LIMIT_ACTIVE_PROCESS=0x8. (071 hard-coded 0x4 which is
    // actually JOB_OBJECT_LIMIT_JOB_TIME, not ACTIVE_PROCESS — fixed in 072.)
    ' $flags=0\n' +
    ' if($maxProc -gt 0){ $flags=$flags -bor 0x8; $lim.Active=$maxProc }\n' +
    ' if($procMs -gt 0){ $flags=$flags -bor 0x2; $lim.Ppt=[long]($procMs*10000) }\n' +
    ' if($wsBytes -gt 0){ $flags=$flags -bor 0x1; $lim.MaxW=[IntPtr]$wsBytes }\n' +
    ' $lim.Flags=$flags\n' +
    ' $sz=[Runtime.InteropServices.Marshal]::SizeOf([type][JobHolder+BLI])\n' +
    ' $ptr=[Runtime.InteropServices.Marshal]::AllocHGlobal($sz)\n' +
    ' [Runtime.InteropServices.Marshal]::StructureToPtr($lim,$ptr,$false) | Out-Null\n' +
    ' [JobHolder]::SetInformationJobObject($job,2,$ptr,$sz) | Out-Null\n' + // BasicLimits=2 (best-effort)
    ' [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)\n' +
    ' $proc=[JobHolder]::OpenProcess(0x101,$false,$tpid)\n' + // PROCESS_SET_QUOTA|PROCESS_TERMINATE
    // NOTE: no `exit` inside this try block — whether `catch` would intercept
    // `exit` is version-dependent, and a swallowed `exit` would write $errFile
    // and turn "the command already finished" into "the sandbox failed". A
    // plain flag keeps the two paths unambiguous.
    ' $gone=$false\n' +
    ' if($proc -eq [IntPtr]::Zero){\n' +
    '  $code=[Runtime.InteropServices.Marshal]::GetLastWin32Error()\n' +
    // 87 = ERROR_INVALID_PARAMETER => the PID does NOT exist: the process has
    // already exited (the holder's Add-Type compile takes 1-10s, so a short
    // command always finishes first). NOT a failure: write the distinct ready
    // marker and fall through WITHOUT touching $errFile, so the runtime never
    // reports job-object-attach-failed and never warns on stderr for it.
    '  if($code -eq 87){ [IO.File]::WriteAllText($ready, "target-exited"); $gone=$true }\n' +
    // any other errno (5 = ERROR_ACCESS_DENIED when PROCESS_SET_QUOTA /
    // PROCESS_TERMINATE rights are missing, plus anything unexpected) IS a real
    // failure: go through the error file => degraded + warn, never swallowed.
    '  else { throw "OpenProcess failed: $code" }\n' +
    ' }\n' +
    ' if(-not $gone){\n' +
    '  $assigned=[JobHolder]::AssignProcessToJobObject($job,$proc)\n' +
    // Read the errno IMMEDIATELY (unconditionally) and BEFORE CloseHandle: the
    // bind call is free to clobber the thread's last error, and reading it after
    // CloseHandle would turn a real errno 5 into a bogus "target-exited".
    '  $acode=[Runtime.InteropServices.Marshal]::GetLastWin32Error()\n' +
    '  [JobHolder]::CloseHandle($proc)\n' +
    '  if(-not $assigned){\n' +
    // 87 here = the target exited in the window between the successful
    // OpenProcess and this assign. Same fact as the OpenProcess branch (nothing
    // left to confine) ⇒ same marker, no error file, no stderr warning. Any
    // other errno stays a REAL attach failure and degrades loudly.
    '   if($acode -eq 87){ [IO.File]::WriteAllText($ready, "target-exited"); $gone=$true }\n' +
    '   else { throw "AssignProcessToJobObject failed: $acode" }\n' +
    '  }\n' +
    ' }\n' +
    ' if(-not $gone){\n' +
    '  [IO.File]::WriteAllText($ready, "assigned")\n' +
    '  while($true){ Start-Sleep -Milliseconds 300; $p=[System.Diagnostics.Process]::GetProcessById($tpid) 2>$null; if(-not $p){ break } }\n' +
    '  [JobHolder]::CloseHandle($job)\n' +
    ' }\n' +
    '} catch { Write-Err "$($_.Exception.Message)" }\n' +
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\n'
  );
}

/**
 * Whether to keep + capture the job-holder's diagnostics (`VESSEL_HOLDER_DEBUG`).
 *
 * 语义是**存在即开**（这是有意的，不是「空串口径漏了」）：
 *   - 未设置 / `VESSEL_HOLDER_DEBUG=`（空串）⇒ `false`；
 *   - **任何非空取值 ⇒ `true`，包括 `'0'`、`'false'`、`'   '`**。
 *
 * 为什么保留「存在即开」而**不**改成 `=== '1'`（对照 `run-release-gates.ts` 的
 * `VESSEL_GATE_INSTALL_SMOKE === '1'`，那是**执行门禁**的显式启用开关，语义不同）：
 *   1. 它是**调试开关**，不是状态根，不参与 `envRoot` 那套「空 ⇒ 未设置」的判据
 *      （这里没有「默认根」可回落，值本身也不被使用，只被当布尔）；
 *   2. 「存在即开」是调试开关的通行约定（`DEBUG=*` 同款）：用户敲 `=1`、`=true`、
 *      `=yes` 都能开——改成 `=== '1'` 会**静默关掉**这些拼写的调试输出，
 *      属于改变已发布行为且没有任何补偿收益；
 *   3. 唯一会让人意外的点（`'0'` 也是开）由本注释与下方判别性用例显式钉住，
 *      而不是靠改语义去「猜」用户意图。
 * 调用点：`hold()` 的 stdio 与 `cleanup()` 的「保留临时目录」。**行为未改**，
 * 只是把这一行表达式提成具名函数以便被测试钉住。
 */
export function holderDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.VESSEL_HOLDER_DEBUG;
}

export const WindowsJobObject = {
  isSupported(platform: NodeJS.Platform = process.platform): boolean {
    return platform === 'win32';
  },

  /**
   * Spawn the detached job-holder: creates the named job, best-efforts the
   * active-process cap, assigns the target PID (via `buildHolderScript`), then
   * holds the handle until the target exits. The holder writes `<dir>/ready`
   * with the attach outcome — `assigned` on success, `target-exited` when the
   * PID was already gone at EITHER phase (errno 87 from `OpenProcess` or from
   * `AssignProcessToJobObject`; the short-command case, NOT written to
   * `<dir>/error`) — or `<dir>/error` on a REAL failure. `createJobObject` waits
   * for one of them so the runtime never calls `terminate()` before the
   * assignment is durable.
   */
  hold(
    jobName: string,
    targetPid: number,
    limits: JobObjectLimits,
  ): { holder: ChildProcess; dir: string; disposeDir: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'vessel-holder-'));
    const readyFile = join(dir, 'ready');
    const errorFile = join(dir, 'error');
    const script = buildHolderScript({ jobName, targetPid, limits, readyFile, errorFile });
    const psFile = join(dir, 'holder.ps1');
    writeFileSync(psFile, script, 'utf8');
    // 存在即开（含 `'0'`/纯空白；空串/未设置 ⇒ 关）——理由见 `holderDebugEnabled` 的注释。
    const debug = holderDebugEnabled();
    const holder = spawn(PS, [...PS_ARGS, '-File', psFile], {
      windowsHide: true,
      // NOTE: do NOT use `detached: true` here — on Windows a detached
      // PowerShell 5.1 console app cannot initialize and exits immediately
      // without running the script. A normal (attached, hidden) child works.
      detached: false,
      stdio: debug ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });
    if (debug) {
      const outLog = createWriteStream(join(dir, 'out.log'));
      const errLog = createWriteStream(join(dir, 'err.log'));
      holder.stdout?.pipe(outLog);
      holder.stderr?.pipe(errLog);
    }
    const disposeDir = (): void => {
      if (debug) return; // keep dir for debugging
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    // NOTE: deliberately NOT wired to 'exit'. The holder on the target-exited path
    // writes `ready` and exits immediately; deleting the dir on exit raced the
    // poller below, so a stalled event loop (loaded CI runner, many workers) could
    // miss the marker entirely and time out on a holder that had already succeeded.
    // The directory now lives until `createJobObject` has read the outcome, and
    // `createJobObject`'s finally is the single owner of its lifetime. The 'error'
    // listener stays so a failed spawn surfaces instead of crashing the process.
    holder.on('error', disposeDir);
    return { holder, dir, disposeDir };
  },

  /** Terminate the ENTIRE job tree from a separate process (idempotent). */
  async terminate(jobName: string): Promise<void> {
    const script =
      '$ErrorActionPreference="SilentlyContinue"\n' +
      `$name=${psSq(jobName)}\n` +
      '$src=@"\n' +
      'using System; using System.Runtime.InteropServices;\n' +
      'public class JobKill {\n' +
      ' [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenJobObject(uint a,bool i,string n);\n' +
      ' [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr j,uint c);\n' +
      ' [DllImport("kernel32.dll")] public static extern void CloseHandle(IntPtr h);\n' +
      '}\n' +
      '"@\n' +
      'Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue\n' +
      `$h=[JobKill]::OpenJobObject(0x8,$false,$name)\n` + // JOB_OBJECT_TERMINATE
      'if($h -ne [IntPtr]::Zero){ [JobKill]::TerminateJobObject($h,0x42) | Out-Null; [JobKill]::CloseHandle($h) }\n' +
      "'ok'\n";
    try {
      await runPs(script);
    } catch {
      // job already gone — idempotent
    }
  },

  /**
   * Enumerate the CURRENT live descendants of `rootPid` (by ParentProcessId
   * walk in CIM). Task 072: this is the OS truth used to (a) close the attach
   * timing window and (b) detect tree escapes. Returns [] on failure (callers
   * treat an empty read as "nothing observed", not "nothing alive").
   */
  async enumerateDescendants(rootPid: number): Promise<number[]> {
    if (!WindowsJobObject.isSupported()) return [];
    const script =
      '$ErrorActionPreference="SilentlyContinue"\n' +
      `$all = @(Get-CimInstance Win32_Process 2>$null)\n` +
      `$root = ${Math.trunc(rootPid)}\n` +
      'if($all.Count -eq 0){ exit 0 }\n' +
      '$found = New-Object System.Collections.Generic.List[int]\n' +
      '$queue = New-Object System.Collections.Generic.Queue[int]\n' +
      '$queue.Enqueue($root)\n' +
      'while($queue.Count -gt 0){\n' +
      '  $cur = $queue.Dequeue()\n' +
      '  foreach($p in $all){ if($p.ParentProcessId -eq $cur){ $found.Add($p.ProcessId); $queue.Enqueue($p.ProcessId) } }\n' +
      '}\n' +
      '$found\n';
    try {
      const out = await runPs(script);
      return out
        .split(/\s+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    } catch {
      return [];
    }
  },

  /**
   * Attach a list of existing pids into a running named job. Used to pull
   * pre-attach grandchildren into the confinement boundary (closes the 071
   * timing window). Best-effort: a pid that already exited or is already in
   * the job is skipped. Returns the number successfully assigned.
   */
  async attachPidsToJob(jobName: string, pids: number[]): Promise<number> {
    if (!WindowsJobObject.isSupported() || pids.length === 0) return 0;
    const pidList = pids.map((p) => Math.trunc(p)).filter((p) => p > 0);
    if (pidList.length === 0) return 0;
    const script =
      '$ErrorActionPreference="SilentlyContinue"\n' +
      `$name=${psSq(jobName)}\n` +
      `$pidList=@(${pidList.join(',')})\n` +
      '$src=@"\n' +
      'using System; using System.Runtime.InteropServices;\n' +
      'public class JobAttach {\n' +
      ' [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr OpenJobObject(uint a,bool i,string n);\n' +
      ' [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);\n' +
      ' [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,uint pid);\n' +
      ' [DllImport("kernel32.dll")] public static extern void CloseHandle(IntPtr h);\n' +
      '}\n' +
      '"@\n' +
      'Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue\n' +
      '$h=[JobAttach]::OpenJobObject(0x8,$false,$name)\n' + // JOB_OBJECT_TERMINATE enough
      'if($h -eq [IntPtr]::Zero){ "0"; exit 0 }\n' +
      '$done=0\n' +
      'foreach($p in $pidList){\n' +
      '  $proc=[JobAttach]::OpenProcess(0x101,$false,$p) 2>$null\n' + // PROCESS_SET_QUOTA|PROCESS_TERMINATE (same as holder)
      '  if($proc -ne [IntPtr]::Zero){ if([JobAttach]::AssignProcessToJobObject($h,$proc)){ $done++ }; [JobAttach]::CloseHandle($proc) }\n' +
      '}\n' +
      '[JobAttach]::CloseHandle($h)\n' +
      '"$done"\n';
    try {
      const out = await runPs(script);
      const n = Number(out.split(/\s+/)[0]);
      return Number.isInteger(n) ? n : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Terminate a list of pids directly (task 072 tree-escape hard response).
   * Unlike `terminate()` this does not touch the job tree — it targets only the
   * escaped processes.
   *
   * Returns the pids **verified terminated** (TerminateProcess returned true).
   * A pid that no longer exists, could not be opened, or whose termination was
   * refused is NOT in the result — callers must audit those separately instead
   * of assuming the whole input died.
   */
  async terminatePids(pids: number[]): Promise<number[]> {
    const clean = pids.map((p) => Math.trunc(p)).filter((p) => p > 0);
    if (clean.length === 0) return [];
    const script =
      '$ErrorActionPreference="SilentlyContinue"\n' +
      `$pidList=@(${clean.join(',')})\n` +
      '$src=@"\n' +
      'using System; using System.Runtime.InteropServices;\n' +
      'public class ProcKill {\n' +
      ' [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,uint pid);\n' +
      ' [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr p,uint c);\n' +
      ' [DllImport("kernel32.dll")] public static extern void CloseHandle(IntPtr h);\n' +
      '}\n' +
      '"@\n' +
      'Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue\n' +
      '$done=New-Object System.Collections.Generic.List[int]\n' +
      'foreach($p in $pidList){\n' +
      '  $h=[ProcKill]::OpenProcess(0x0001,$false,$p) 2>$null\n' + // PROCESS_TERMINATE
      '  if($h -ne [IntPtr]::Zero){ if([ProcKill]::TerminateProcess($h,0x42)){ $done.Add([int]$p) }; [ProcKill]::CloseHandle($h) }\n' +
      '}\n' +
      '[Console]::Out.Write((ConvertTo-Json -InputObject @($done) -Compress))\n';
    try {
      const out = await runPs(script);
      return parseVerifiedPids(out);
    } catch {
      // enumeration/termination failed outright: NOTHING may be claimed dead.
      return [];
    }
  },
};

/**
 * Readiness marker the job-holder writes into `<dir>/ready`:
 *   - `'assigned'`      → the target is inside the job (confinement is in force)
 *   - `'target-exited'` → the PID was already gone (errno 87 from `OpenProcess`
 *     or from `AssignProcessToJobObject` — see `buildHolderScript`)
 *   - anything else     → NOT an answer yet. `WriteAllText` creates the file
 *     before it writes, so a poll can catch it empty/partial — that must be
 *     treated as "keep waiting", never guessed as success.
 */
export function parseAttachMarker(marker: string): 'attached' | 'target-exited' | 'pending' {
  const m = marker.trim();
  if (m === 'assigned') return 'attached';
  if (m === 'target-exited') return 'target-exited';
  return 'pending';
}

/**
 * Create a confined Job Object around an already-spawned target PID. Waits for
 * the holder to confirm assignment (marker file) so `terminate()` is reliable.
 * Returns a durable `JobObjectConfinement` (job name + terminate) that
 * `runCommand` uses to kill the whole tree on timeout / 050 interrupt.
 *
 * Two honest outcomes (①: never folded together):
 *   - `attached:true`  → the target is in the job; confinement is in force.
 *   - `attached:false, reason:'target-exited'` → the PID was already gone (errno
 *     87 from either attach phase). This RESOLVES (it does not throw) so callers
 *     can report "confinement was not needed for this command" instead of "the
 *     sandbox failed". A real failure (errno 5 / holder error / timeout) still
 *     THROWS.
 *
 * Timeout budget: 30 s. Rationale (measured on this machine): the holder's
 * PowerShell `Add-Type` compile costs 1–10 s (a real run in `tasks/078:59`
 * measured 10759 ms) and it runs AFTER the child spawns. The old 10 s budget was
 * inside the measured spread, so a concurrent load (several holders compiling at
 * once, plus AV scanning) could miss it and degrade a command that would have
 * been confined. 30 s is ~3× the worst measured compile while still bounding a
 * hung holder.
 *
 * ⚠ The 30 s holder budget can still race `vitest.config.ts` `testTimeout: 30000`
 * (BRIEF ③): a real attach that legitimately needs the whole budget is abandoned
 * by the holder at the same instant the runner kills the test, so every test that
 * drives a REAL job object passes an explicit larger timeout instead of inheriting
 * the default (`Sandbox.test.ts` job tests, `windows-job-object.test.ts`). Do NOT
 * "fix" this by lowering this budget.
 *
 * A second, unrelated race was fixed here (CI run 35329332608): the holder used to
 * delete its own temp dir from its 'exit' handler. On the `target-exited` path it
 * writes `ready` and exits immediately, so a stalled event loop could let that
 * cleanup remove the marker before the poll above ever observed it — turning a
 * holder that had already succeeded into a 30 s timeout. The dir is now disposed
 * in the `finally` below, after the outcome is read, so it cannot race the poll.
 */
export async function createJobObject(
  targetPid: number,
  limits: JobObjectLimits = {},
  timeoutMs = 30_000,
): Promise<JobObjectConfinement> {
  if (!WindowsJobObject.isSupported()) {
    throw new Error('windows-job-object backend requires win32');
  }
  const jobName = `VesselJob_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 0xffff)}`;
  const { holder, dir, disposeDir } = WindowsJobObject.hold(jobName, targetPid, limits);
  try {
    const readyFile = join(dir, 'ready');
    const errorFile = join(dir, 'error');
    // Poll for readiness (Add-Type compile + assignment). Fail loudly if the
    // holder reports an error, so callers know confinement did NOT engage.
    const deadline = Date.now() + timeoutMs;
    let outcome: 'attached' | 'target-exited' | 'pending' = 'pending';
    while (Date.now() < deadline) {
      if (existsSync(readyFile)) {
        outcome = parseAttachMarker(readFileSync(readyFile, 'utf8'));
        if (outcome !== 'pending') break;
      }
      if (existsSync(errorFile)) {
        const why = readFileSync(errorFile, 'utf8').trim();
        void holder.kill();
        throw new Error(`job-holder failed to confine pid ${targetPid}: ${why}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (outcome === 'pending') {
      void holder.kill();
      throw new Error(`job-holder did not confirm confinement of pid ${targetPid} within ${timeoutMs}ms`);
    }
    if (outcome === 'target-exited') {
      // nothing to confine: the process is already gone. The holder exits on its
      // own right after writing the marker; kill() is a belt-and-braces no-op that
      // guarantees no PowerShell lingers.
      void holder.kill();
    }
    return {
      jobName,
      rootPid: targetPid,
      attached: outcome === 'attached',
      ...(outcome === 'attached' ? {} : { reason: 'target-exited' as const }),
      async attachDescendants(pids: number[]): Promise<number> {
        return WindowsJobObject.attachPidsToJob(jobName, pids);
      },
      async terminate(): Promise<void> {
        await WindowsJobObject.terminate(jobName);
      },
      async dispose(): Promise<void> {
        await WindowsJobObject.terminate(jobName);
      },
    };
  } finally {
    // Single owner of the holder temp dir: the outcome has been read (or the call
    // failed), so removing it can no longer race the poll above.
    disposeDir();
  }
}
