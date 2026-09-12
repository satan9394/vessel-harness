import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { WindowsJobObject, createJobObject, parseAttachMarker, buildHolderScript, holderDebugEnabled } from './windows-job-object.js';

/**
 * windows-job-object — the "target already exited" split (BRIEF ①).
 *
 * Why this file exists: `OpenProcess` errno 87 (`ERROR_INVALID_PARAMETER` = the
 * PID does not exist) used to be folded into the same throw as errno 5
 * (`ERROR_ACCESS_DENIED`) and every other failure. For a short-lived command —
 * the normal case, because the holder's `Add-Type` compile takes 1–10 s and runs
 * AFTER the child spawns — that produced `job-object-attach-failed` plus a stderr
 * warning for every command, i.e. "the sandbox is broken" when the truth is
 * "the command was already over".
 *
 * BRIEF ② closed the mirror-image hole: the SAME 87 can come back from
 * `AssignProcessToJobObject`, when the target exits in the window between a
 * successful `OpenProcess` and the assign. That was still routed to the error
 * file ⇒ a spurious `job-object-attach-failed` + stderr warning. Both phases are
 * now pinned by the script assertions below.
 *
 * Nothing here needs PowerShell to run: the marker → outcome decision is a pure
 * function, and the holder script itself is produced by the pure
 * `buildHolderScript` (no spawn, no I/O). The one case that must talk to the real
 * OS (a PID that no longer exists) is `it.skipIf(!onWindows)` — skipped, never
 * faked, elsewhere.
 */
describe('windows-job-object — holder script errno contract (pure, no PowerShell)', () => {
  const script = buildHolderScript({
    jobName: 'VesselJob_test',
    targetPid: 4242,
    limits: { maxActiveProcesses: 4 },
    readyFile: 'C:\\vessel-test\\ready',
    errorFile: 'C:\\vessel-test\\error',
  });
  // Anchors are the CALL sites, not the P/Invoke declarations (both names appear
  // in the Add-Type source block as well).
  const openPhase = script.slice(
    script.indexOf('$proc=[JobHolder]::OpenProcess(0x101'),
    script.indexOf('$assigned=[JobHolder]::AssignProcessToJobObject'),
  );
  const assignPhase = script.slice(script.indexOf('$assigned=[JobHolder]::AssignProcessToJobObject'));

  it('phase 1 — OpenProcess errno 87 ⇒ "target-exited", never the error file', () => {
    expect(openPhase).toContain('if($code -eq 87){ [IO.File]::WriteAllText($ready, "target-exited"); $gone=$true }');
    expect(openPhase).toContain('else { throw "OpenProcess failed: $code" }');
  });

  it('phase 2 — AssignProcessToJobObject errno 87 ⇒ the SAME "target-exited" marker', () => {
    // Delete this one line and the test goes red: the assign-phase 87 would fall
    // through to the `throw` below and re-introduce the false "sandbox failed"
    // alarm for short commands (the exact regression BRIEF ② names).
    expect(assignPhase).toContain('if($acode -eq 87){ [IO.File]::WriteAllText($ready, "target-exited"); $gone=$true }');
    // every other errno (5 = ERROR_ACCESS_DENIED, …) stays a REAL attach failure
    expect(assignPhase).toContain('else { throw "AssignProcessToJobObject failed: $acode" }');
    // both phases mean the same thing ⇒ exactly one marker value for it
    expect(script.match(/WriteAllText\(\$ready, "target-exited"\)/g)).toHaveLength(2);
  });

  it('phase 2 — reads the errno BEFORE CloseHandle can clobber it', () => {
    // Reading the errno after CloseHandle would turn a real errno 5 into a bogus
    // "target-exited" — i.e. it would swallow a genuine confinement failure.
    const read = assignPhase.indexOf('$acode=[Runtime.InteropServices.Marshal]::GetLastWin32Error()');
    const close = assignPhase.indexOf('[JobHolder]::CloseHandle($proc)');
    expect(read).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(read);
    // …and the read happens unconditionally right after the assign, so no other
    // managed statement can run in between.
    expect(assignPhase).toContain(
      '$assigned=[JobHolder]::AssignProcessToJobObject($job,$proc)\n  $acode=[Runtime.InteropServices.Marshal]::GetLastWin32Error()\n',
    );
  });
});

describe('windows-job-object — attach marker → outcome (pure, no PowerShell)', () => {
  it('maps the holder\'s "assigned" marker to a real attach', () => {
    expect(parseAttachMarker('assigned')).toBe('attached');
    expect(parseAttachMarker('  assigned\n')).toBe('attached');
  });

  it('maps "target-exited" to its OWN outcome (never attach-failed)', () => {
    expect(parseAttachMarker('target-exited')).toBe('target-exited');
    expect(parseAttachMarker(' target-exited \r\n')).toBe('target-exited');
  });

  it('treats an empty/partial/unrecognised marker as "no answer yet" — never a guess', () => {
    // WriteAllText creates the file before writing it, so a poll can catch it
    // empty; guessing "attached" there would be a silent lie.
    expect(parseAttachMarker('')).toBe('pending');
    expect(parseAttachMarker('   ')).toBe('pending');
    expect(parseAttachMarker('ass')).toBe('pending');
    expect(parseAttachMarker('target-exit')).toBe('pending');
    expect(parseAttachMarker('anything else')).toBe('pending');
  });

  it('stays win32-gated', () => {
    expect(WindowsJobObject.isSupported('win32')).toBe(true);
    expect(WindowsJobObject.isSupported('linux')).toBe(false);
    expect(WindowsJobObject.isSupported('darwin')).toBe(false);
  });
});

/**
 * `VESSEL_HOLDER_DEBUG` —— **调试开关**（不是状态根）：判据是「存在即开」。
 *
 * 本卡有意**不改行为**（依据见 `holderDebugEnabled` 的注释）：没有「默认值」可回落、
 * 取值本身不被使用（只当布尔），而 `=1` / `=true` / `=yes` 都是调试开关的通行写法；
 * 改成 `=== '1'`（对照 `VESSEL_GATE_INSTALL_SMOKE === '1'` 那种「执行门禁的显式启用」）
 * 会**静默关掉**这些拼写的诊断输出，属于改变已发布行为且没有补偿收益。
 *
 * 判别性（「删掉修复就红」）：把 `holderDebugEnabled` 改成 `env.VESSEL_HOLDER_DEBUG === '1'`
 * ⇒ 下面 `=true`/`=yes`/`=0`/`=false`/纯空白 五条立即红——这正是本用例存在的意义：
 * 把「存在即开（含 '0'）」这一**有意**语义钉死，防止将来被"顺手"改成严格比较。
 * 另一侧：未设置与空串 ⇒ 关（与其它「空 ⇒ 未设置」的判据结论一致，无需特判）。
 */
describe('windows-job-object — VESSEL_HOLDER_DEBUG（存在即开；行为未改，由本用例钉住）', () => {
  it('存在即开：任何非空取值（含 "0"/"false"/纯空白）都是开', () => {
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: '1' })).toBe(true);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: 'true' })).toBe(true);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: 'yes' })).toBe(true);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: '0' })).toBe(true); // ← 容易意外的一点，注释已写明
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: 'false' })).toBe(true);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: '   ' })).toBe(true);
  });

  it('未设置 / 空串 ⇒ 关（默认路径不产生任何诊断开销）', () => {
    expect(holderDebugEnabled({})).toBe(false);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: '' })).toBe(false);
    expect(holderDebugEnabled({ VESSEL_HOLDER_DEBUG: undefined })).toBe(false);
  });
});

describe('windows-job-object — real-machine attach outcome (win32 + PowerShell)', () => {
  const onWindows = process.platform === 'win32';

  // BRIEF ③: this test drives a REAL job holder, whose own budget is 30 s
  // (`createJobObject` default) — numerically identical to vitest's default
  // `testTimeout: 30000` (`vitest.config.ts:47`). Inheriting the default would
  // make the outcome a race between the holder giving up and the runner killing
  // the test. The timeout is therefore EXPLICIT and 4× the holder budget; the
  // assertions are untouched (no skip, no relaxation).
  it.skipIf(!onWindows)(
    'an already-exited PID RESOLVES as target-exited instead of throwing an attach failure',
    async () => {
      const child: ChildProcess = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      const pid = child.pid;
      expect(pid).toBeTruthy();
      await once(child, 'exit');
      // let the OS tear the process object down (the PID must be really gone)
      await new Promise((r) => setTimeout(r, 300));
      // PREMISE of this test: the PID no longer exists. If that ever stops
      // holding, fail HERE — loudly — instead of silently asserting something
      // the test is not about.
      expect(() => process.kill(pid!, 0)).toThrow();

      // The old behaviour threw here ("job-holder failed to confine pid …:
      // OpenProcess failed: 87"); the fixed behaviour resolves with its own reason.
      const conf = await createJobObject(pid!);
      expect(conf.attached).toBe(false);
      expect(conf.reason).toBe('target-exited');
      await conf.dispose();
    },
    120_000,
  );
});
