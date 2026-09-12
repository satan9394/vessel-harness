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
 *      exits. The holder must stay alive: when the last job handle closes, the
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

/** The spawn-time confinement handle fed to `runCommand`. */
export interface JobObjectConfinement {
  /** durable name of the Job Object (used to reopen + terminate). */
  jobName: string;
  /** pid the job was created around (the confinement root). */
  rootPid?: number;
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

export const WindowsJobObject = {
  isSupported(platform: NodeJS.Platform = process.platform): boolean {
    return platform === 'win32';
  },

  /**
   * Spawn the detached job-holder: creates the named job, best-efforts the
   * active-process cap, assigns the target PID, then holds the handle until the
   * target exits. The holder writes `<dir>/ready` on success or `<dir>/error`
   * on failure; `createJobObject` waits for one of them so the runtime never
   * calls `terminate()` before the assignment is durable.
   */
  hold(jobName: string, targetPid: number, limits: JobObjectLimits): { holder: ChildProcess; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'vessel-holder-'));
    const readyFile = join(dir, 'ready');
    const errorFile = join(dir, 'error');
    const script =
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
      ' if($proc -eq [IntPtr]::Zero){ throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }\n' +
      ' $assigned=[JobHolder]::AssignProcessToJobObject($job,$proc)\n' +
      ' [JobHolder]::CloseHandle($proc)\n' +
      ' if(-not $assigned){ throw "AssignProcessToJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }\n' +
      ' [IO.File]::WriteAllText($ready, "assigned")\n' +
      ' while($true){ Start-Sleep -Milliseconds 300; $p=[System.Diagnostics.Process]::GetProcessById($tpid) 2>$null; if(-not $p){ break } }\n' +
      ' [JobHolder]::CloseHandle($job)\n' +
      '} catch { Write-Err "$($_.Exception.Message)" }\n' +
      'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\n';
    const psFile = join(dir, 'holder.ps1');
    writeFileSync(psFile, script, 'utf8');
    const debug = !!process.env.VESSEL_HOLDER_DEBUG;
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
    // Reap the holder's temp dir once it exits (or on holder spawn error).
    const cleanup = (): void => {
      if (debug) return; // keep dir for debugging
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    holder.on('exit', cleanup);
    holder.on('error', cleanup);
    return { holder, dir };
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
 * Create a confined Job Object around an already-spawned target PID. Waits for
 * the holder to confirm assignment (marker file) so `terminate()` is reliable.
 * Returns a durable `JobObjectConfinement` (job name + terminate) that
 * `runCommand` uses to kill the whole tree on timeout / 050 interrupt.
 */
export async function createJobObject(
  targetPid: number,
  limits: JobObjectLimits = {},
  timeoutMs = 10_000,
): Promise<JobObjectConfinement> {
  if (!WindowsJobObject.isSupported()) {
    throw new Error('windows-job-object backend requires win32');
  }
  const jobName = `VesselJob_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 0xffff)}`;
  const { holder, dir } = WindowsJobObject.hold(jobName, targetPid, limits);
  const readyFile = join(dir, 'ready');
  const errorFile = join(dir, 'error');
  // Poll for readiness (Add-Type compile + assignment). Fail loudly if the
  // holder reports an error, so callers know confinement did NOT engage.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) break;
    if (existsSync(errorFile)) {
      const why = readFileSync(errorFile, 'utf8').trim();
      void holder.kill();
      throw new Error(`job-holder failed to confine pid ${targetPid}: ${why}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!existsSync(readyFile)) {
    void holder.kill();
    throw new Error(`job-holder did not confirm confinement of pid ${targetPid} within ${timeoutMs}ms`);
  }
  return {
    jobName,
    rootPid: targetPid,
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
}