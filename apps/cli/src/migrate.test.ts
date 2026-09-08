import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runVesselMigration,
  KNOWN_STATE_ENTRIES,
  defaultLegacyRoot,
  defaultVesselRoot,
} from './migrate.js';

function tmpHome(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('vessel migrate — one-time ~/.dsh -> ~/.vessel (task 033)', () => {
  let home: string;
  let legacy: string;
  let vessel: string;

  beforeEach(() => {
    home = tmpHome('cah-migrate-');
    legacy = path.join(home, '.dsh');
    vessel = path.join(home, '.vessel');
  });

  afterEach(() => {
    // 迁移测试绝不做任何永久删除之外的操作：清理只走 tests 的临时目录（vitest 自带回收）。
    for (const d of [home]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('copies known state entries from ~/.dsh to ~/.vessel and recycles the legacy dir', async () => {
    // build a fake legacy home with the known state entries
    fs.mkdirSync(path.join(legacy, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\nbody\n', 'utf8');
    fs.mkdirSync(path.join(legacy, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'memory', 'note.md'), '# n\n', 'utf8');
    fs.mkdirSync(path.join(legacy, 'learned', 's'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'learned', 's', 'sug.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(legacy, 'providers.json'), JSON.stringify([{ id: 'x' }]), 'utf8');
    fs.writeFileSync(path.join(legacy, 'current.json'), JSON.stringify({ id: 'mock' }), 'utf8');
    fs.writeFileSync(path.join(legacy, 'usage.json'), '{}', 'utf8');
    // an unrelated dir that must NOT be migrated (not in KNOWN_STATE_ENTRIES)
    fs.mkdirSync(path.join(legacy, 'unrelated'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'unrelated', 'junk.txt'), 'junk', 'utf8');

    const recycle = vi.fn().mockResolvedValue(undefined);
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });

    expect(res.status).toBe('migrated');
    expect(res.legacyRoot).toBe(legacy);
    expect(res.vesselRoot).toBe(vessel);
    expect(res.recycled).toBe(true);
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle).toHaveBeenCalledWith(legacy);

    // data present in .vessel
    expect(JSON.parse(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8'))).toEqual([{ id: 'x' }]);
    expect(JSON.parse(fs.readFileSync(path.join(vessel, 'current.json'), 'utf8'))).toEqual({ id: 'mock' });
    expect(fs.existsSync(path.join(vessel, 'usage.json'))).toBe(true);
    expect(fs.existsSync(path.join(vessel, 'memory', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(vessel, 'learned', 's', 'sug.json'))).toBe(true);
    expect(fs.readFileSync(path.join(vessel, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo');
    // unlisted top-level dir is NOT migrated
    expect(fs.existsSync(path.join(vessel, 'unrelated'))).toBe(false);

    // copiedCount counts files (skills 1 + memory 1 + learned 1 + providers 1 + current 1 + usage 1 = 6)
    expect(res.copiedCount).toBe(6);
  });

  it('skips when ~/.dsh does not exist (legacy-absent)', async () => {
    const recycle = vi.fn();
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('legacy-absent');
    expect(fs.existsSync(vessel)).toBe(false);
    expect(recycle).not.toHaveBeenCalled();
  });

  it('skips when ~/.vessel already exists (vessel-present), leaving ~/.dsh untouched', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'keep', 'utf8');
    fs.mkdirSync(vessel, { recursive: true });
    fs.writeFileSync(path.join(vessel, 'providers.json'), 'new', 'utf8');

    const recycle = vi.fn();
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('vessel-present');
    // .dsh untouched, .vessel keeps its own content
    expect(fs.readFileSync(path.join(legacy, 'providers.json'), 'utf8')).toBe('keep');
    expect(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8')).toBe('new');
    expect(recycle).not.toHaveBeenCalled();
  });

  it('keeps the copy and reports recycled=false when the recycle step fails (never permanent-deletes)', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'boo', 'utf8');

    const recycle = vi.fn().mockRejectedValue(new Error('no recycle bin on this platform'));
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('migrated');
    expect(res.recycled).toBe(false);
    expect(res.recycleError).toContain('no recycle bin');
    // data still copied and preserved (legacy not permanently deleted by us)
    expect(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8')).toBe('boo');
  });

  it('default roots point at ~/.dsh and ~/.vessel under the given home', () => {
    expect(defaultLegacyRoot('fake')).toBe(path.join('fake', '.dsh'));
    expect(defaultVesselRoot('fake')).toBe(path.join('fake', '.vessel'));
    // sanity: the default ~/.vessel follows the brand
    expect(KNOWN_STATE_ENTRIES).toContain('providers.json');
    expect(KNOWN_STATE_ENTRIES).toContain('skills');
  });
});