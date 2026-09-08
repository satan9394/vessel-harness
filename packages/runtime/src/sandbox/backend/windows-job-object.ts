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
}

/** The spawn-time confinement handle fed to `runCommand`. */
export interface JobObjectConfinement {
  /** durable name of the Job Object (used to reopen + terminate). */
  jobName: string;
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
      ' $lim.Flags=0x4\n' + // JOB_OBJECT_LIMIT_ACTIVE_PROCESS
      ' if($maxProc -gt 0){ $lim.Active=$maxProc }\n' +
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
    async terminate(): Promise<void> {
      await WindowsJobObject.terminate(jobName);
    },
    async dispose(): Promise<void> {
      await WindowsJobObject.terminate(jobName);
    },
  };
}