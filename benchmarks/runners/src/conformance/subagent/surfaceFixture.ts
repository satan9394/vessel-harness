import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { type ChildProcess, type spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VirtualProxyDependencies } from '@vessel/runtime';

/** Memory-only CLI fixture; the real outbound adapter still owns worktrees and policy. */
export function surfaceAgentFixture(mode: 'completed' | 'failed' | 'cancelled', outsidePath: string) {
  const live = new Set<number>();
  const replies: string[] = [];
  let cwd = '';
  let closeChild: (() => void) | undefined;
  const dependencies: VirtualProxyDependencies = {
    platform: 'win32',
    quietWindowMs: 1,
    enumerateDescendants: async () => [...live].slice(1),
    spawnProcess: ((_command, _args, options) => {
      cwd = String(options?.cwd);
      const child = new EventEmitter();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const pid = 2_900_001;
      live.add(pid);
      live.add(pid + 1);
      let closed = false;
      const close = (code: number | null) => {
        if (closed) return;
        closed = true;
        live.delete(pid);
        stdout.end();
        stderr.end();
        child.emit('close', code);
      };
      closeChild = () => close(null);
      const stdin = new Writable({
        write(chunk, _encoding, done) {
          const reply = String(chunk).trim();
          replies.push(reply);
          if (mode === 'completed' && reply === 'y') {
            fs.writeFileSync(path.join(cwd, 'delivered.txt'), 'preserved deliverable\n');
            stdout.write(JSON.stringify({ type: 'text_delta', text: 'artifact ready' }) + '\n');
            stdout.write(JSON.stringify({ type: 'usage', inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheCreationTokens: 2 }) + '\n');
            close(0);
          } else if (mode === 'failed') {
            stderr.write('controlled failure');
            close(17);
          }
          done();
        },
      });
      Object.assign(child, { pid, stdout, stderr, stdin, kill: () => { close(null); return true; } });
      setImmediate(() => {
        child.emit('spawn');
        const target = mode === 'failed' ? outsidePath : path.join(cwd, 'delivered.txt');
        stdout.write(`Overwrite ${target}? [y/N]\n`);
      });
      return child as ChildProcess;
    }) as typeof spawn,
    createJob: async (pid) => ({
      jobName: 'surface-fixture-job', rootPid: pid, attached: true,
      attachDescendants: async (pids) => pids.length,
      terminate: async () => { live.clear(); closeChild?.(); },
      dispose: async () => { live.clear(); },
    }),
    killWindowsTree: async () => { live.clear(); closeChild?.(); },
  };
  return { dependencies, live, replies, worktreePath: () => cwd };
}
