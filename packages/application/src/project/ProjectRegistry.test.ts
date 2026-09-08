import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectRegistry } from './ProjectRegistry.js';

describe('ProjectRegistry', () => {
  let dir: string;
  let home: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-project-'));
    home = path.join(dir, 'vessel-home');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('open validates the directory exists and de-dupes by resolved root', () => {
    const reg = new ProjectRegistry({ vesselHome: home });
    const ws = path.join(dir, 'proj-a');
    fs.mkdirSync(ws, { recursive: true });

    const first = reg.open(ws);
    expect(first.root).toBe(path.resolve(ws));
    expect(first.openedAt).toBeTruthy();

    // re-open returns the SAME object (de-dup, original openedAt preserved)
    const again = reg.open(ws);
    expect(again).toBe(first);
    expect(reg.list()).toHaveLength(1);
  });

  it('open throws for a missing directory', () => {
    const reg = new ProjectRegistry({ vesselHome: home });
    expect(() => reg.open(path.join(dir, 'nope'))).toThrow(/does not exist/);
    expect(reg.list()).toHaveLength(0);
  });

  it('list returns all opened projects in order', () => {
    const reg = new ProjectRegistry({ vesselHome: home });
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    reg.open(a);
    reg.open(b);
    const list = reg.list();
    expect(list.map((p) => p.root)).toEqual([path.resolve(a), path.resolve(b)]);
  });

  it('persists across instances (a fresh registry sees prior opens)', () => {
    const ws = path.join(dir, 'persist-proj');
    fs.mkdirSync(ws, { recursive: true });

    const reg1 = new ProjectRegistry({ vesselHome: home });
    const opened = reg1.open(ws);

    // second instance reads the same persisted projects.json
    const reg2 = new ProjectRegistry({ vesselHome: home });
    const [first] = reg2.list();
    expect(first!.root).toBe(opened.root);
    expect(first!.openedAt).toBe(opened.openedAt);
  });

  it('missing persistence file yields an empty registry (no throw)', () => {
    const reg = new ProjectRegistry({ vesselHome: path.join(dir, 'empty-home') });
    expect(reg.list()).toHaveLength(0);
  });
});