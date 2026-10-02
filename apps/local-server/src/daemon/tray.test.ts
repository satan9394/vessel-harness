import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { residentTrayScript, startResidentTray } from './tray.js';
import type { DaemonInfo } from './types.js';
const info: DaemonInfo = { pid: 12345, port: 30001, startedAt: '2026-10-01T00:00:00Z', uptimeSeconds: 0, memoryBytes: 1024, tokenPath: "C:\\fake user's home\\daemon.token", version: '0.10.0', instanceId: 'owned-instance' };
describe('Windows resident tray (native process mocked)', () => {
  it('launches one hidden native helper with no token bytes in arguments', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const launch = vi.fn((_command: string, _args: string[], _options: object) => child);
    startResidentTray(info, 'win32', launch as never);
    expect(launch).toHaveBeenCalledTimes(1); expect(launch.mock.calls[0]![0]).toBe('powershell.exe');
    expect(launch.mock.calls[0]![1]).toContain('-STA');
    expect(launch.mock.calls[0]![2]).toMatchObject({ windowsHide: true, stdio: 'ignore', detached: false });
    const script = Buffer.from(launch.mock.calls[0]![1].at(-1)!, 'base64').toString('utf16le');
    expect(script).toContain('System.Windows.Forms.NotifyIcon'); expect(script).not.toContain('BurntToast'); expect(script).toContain("user''s home");
    expect(script).toContain('ReadAllText($tokenPath)'); expect(script).toContain("Authorization=('Bearer '+$token)"); expect(script).not.toMatch(/[0-9a-f]{48}/);
  });
  it('checks authenticated instance ownership and bounded liveness before retaining the tray', () => {
    const script = residentTrayScript(info);
    expect(script).toContain('/api/daemon/status'); expect(script).toContain('$status.instanceId -ne $instanceId'); expect(script).toContain('$status.pid -ne $daemonPid');
    expect(script).toContain('-TimeoutSec 1'); expect(script).toContain('$timer.Interval=1000'); expect(script).toContain('$context.ExitThread()');
    expect(script).toContain('/api/health'); expect(script).toContain('/api/daemon/stop'); expect(script).toContain('$icon.Dispose()'); expect(script).toContain('finally');
  });
  it('does not create a Windows helper on macOS/Linux or fail task execution when unavailable', () => {
    const launch = vi.fn(); startResidentTray(info, 'darwin', launch as never); startResidentTray(info, 'linux', launch as never); expect(launch).not.toHaveBeenCalled();
    expect(() => startResidentTray(info, 'win32', (() => { throw new Error('no desktop'); }) as never)).not.toThrow();
  });
});
