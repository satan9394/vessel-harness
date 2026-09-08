import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ProviderStore } from '../providers/ProviderStore.js';
import { dispatchSlash, runChat, makeLineReader, type ChatSessionIO } from './chat.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // apps/cli/src/tui → repo root
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

/** Scripted chat IO: feeds inputs from an array, captures output lines. */
function scriptedIO(inputs: string[]): { io: ChatSessionIO; output: string[]; consumed: () => number } {
  const output: string[] = [];
  let i = 0;
  return {
    output,
    io: {
      async readLine() {
        if (i < inputs.length) return inputs[i++] ?? null;
        return null; // EOF
      },
      write(line: string) {
        output.push(line);
      },
    },
    consumed: () => i,
  };
}

describe('chat TUI — slash dispatch (task 021)', () => {
  let root: string;
  let store: ProviderStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tui-'));
    store = new ProviderStore({ rootDir: root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('/help lists the slash commands', async () => {
    const { io, output } = scriptedIO([]);
    const res = await dispatchSlash('/help', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('/provider');
    expect(res?.output).toContain('/models');
    expect(res?.output).toContain('/permission');
    expect(res?.output).toContain('/quit');
    void output;
  });

  it('/quit returns quit=true', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/quit', { store, io, sessionWorkspace: root });
    expect(res?.quit).toBe(true);
  });

  it('unknown command gets a hint', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/nope', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('未知命令');
  });

  it('/models on mock current prints a guidance line', async () => {
    const { io } = scriptedIO([]);
    const res = await dispatchSlash('/models', { store, io, sessionWorkspace: root });
    expect(res?.output).toContain('mock');
  });
});

describe('chat TUI — runChat loop (task 021)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tui-run-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('exits cleanly on /quit after the welcome line', async () => {
    const { io, output } = scriptedIO(['/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    expect(output.some((l) => l.includes('交互会话开始'))).toBe(true);
  });

  it('runs a natural-language turn against mock and prints a reply', async () => {
    const { io, output } = scriptedIO(['你好', '/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    // the mock smoke script answers read/summary; a plain hello yields the mock fallback text
    expect(output.length).toBeGreaterThan(1);
    void code;
  });

  it('EOF (null input) exits cleanly', async () => {
    const { io } = scriptedIO([]);
    const code = await runChat({ workspaceRoot: dir, policySystemPath: POLICY, behaviorIRPath: BEHAVIOR, io });
    expect(code).toBe(0);
  });

  it('runs three rounds (/help → 你好 → /quit) without exiting early (task 023 regression)', async () => {
    const { io, output, consumed } = scriptedIO(['/help', '你好', '/quit']);
    const code = await runChat({
      workspaceRoot: dir,
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      io,
    });
    expect(code).toBe(0);
    // all three scripted inputs were served — the loop did NOT break after round 1
    expect(consumed()).toBe(3);
    const joined = output.join('\n');
    expect(joined).toContain('/provider'); // round 1: /help table rendered
    expect(joined).toContain('mock'); // round 2: NL turn hit the mock fallback reply
  });
});

describe('makeLineReader — sequential reads over ONE readline interface (task 023)', () => {
  /** Real node:readline over in-memory streams — same code path createStdioIO uses. */
  function setup() {
    const input = new PassThrough();
    const rl = readline.createInterface({ input, output: new PassThrough(), terminal: false });
    const reader = makeLineReader(rl);
    return { input, rl, reader };
  }
  const tick = () => new Promise<void>((r) => setImmediate(r));

  it('serves 3 sequential reads from the same interface without EOF', async () => {
    const { input, rl, reader } = setup();
    // strict one-read-at-a-time: exactly how runChat consumes stdin
    const a = reader.readLine();
    input.write('/help\n');
    await expect(a).resolves.toBe('/help');

    const b = reader.readLine();
    input.write('你好\n');
    await expect(b).resolves.toBe('你好');

    const c = reader.readLine();
    input.write('/quit\n');
    await expect(c).resolves.toBe('/quit');

    reader.close();
    rl.close();
    input.end();
  });

  it('buffers lines that arrive before the next read is requested', async () => {
    const { input, rl, reader } = setup();
    input.write('one\ntwo\n');
    await tick(); // let readline emit both 'line' events with no waiter attached
    await expect(reader.readLine()).resolves.toBe('one');
    await expect(reader.readLine()).resolves.toBe('two');
    reader.close();
    rl.close();
    input.end();
  });

  it('resolves a pending read with null when the interface closes (EOF)', async () => {
    const { input, rl, reader } = setup();
    const read = reader.readLine();
    input.end(); // EOF → rl 'close' → reader end
    await expect(read).resolves.toBeNull();
    rl.close();
  });

  it('close() ends the reader with null — the SIGINT path', async () => {
    const { rl, reader } = setup();
    const read = reader.readLine();
    reader.close(); // exactly what createStdioIO's SIGINT handler does
    await expect(read).resolves.toBeNull();
    await expect(reader.readLine()).resolves.toBeNull();
    rl.close();
  });
});
