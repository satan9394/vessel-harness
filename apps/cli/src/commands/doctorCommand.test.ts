import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HybridMemoryStore } from '@vessel/memory';
import { VesselDoctorEngine, doctorCommand, diagnoseMemoryDatabase } from './doctorCommand.js';
import { memoryDatabasePath } from './memoryCommand.js';
import { main } from '../cli.js';

afterEach(() => vi.restoreAllMocks());
function fixture(root: string) {
  return { workspace: root, nodeVersion: '24.14.0', toolPins: () => [], sandbox: async () => true, database: async () => ({ status: 'pass' as const, message: 'healthy' }),
    providers: () => [{ id: 'fake', name: 'Fake', protocol: 'openai-compatible' as const, model: 'mock-model', apiKey: 'SECRET', baseUrl: 'https://mock.invalid/v1' }], daemon: async () => true };
}
it('checks seven health categories offline and renders diagnosis without credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cli-')); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {}); const fetcher = vi.fn();
  try {
    const engine = new VesselDoctorEngine({ ...fixture(root), fetch: fetcher });
    const report = await engine.diagnose(); expect(report.allPassed).toBe(true); expect(report.checks).toHaveLength(7); expect(fetcher).not.toHaveBeenCalled();
    expect(await doctorCommand([], new Map(), engine)).toBe(0); expect(log.mock.calls[0]![0]).toContain('[✓]'); expect(log.mock.calls[0]![0]).not.toContain('SECRET');
    const diagnose = vi.spyOn(VesselDoctorEngine.prototype, 'diagnose').mockResolvedValue(report);
    expect(await main(['doctor'])).toBe(0); expect(await main(['diagnose'])).toBe(0); expect(diagnose).toHaveBeenCalledTimes(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it('fails old Node and competing lockfiles; warns unavailable sandbox/daemon and missing providers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-bad-')); fs.writeFileSync(path.join(root, 'yarn.lock'), '');
  try {
    const report = await new VesselDoctorEngine({ ...fixture(root), nodeVersion: '18.0.0', sandbox: async () => false, providers: () => [], daemon: async () => false }).diagnose();
    expect(report.checks.map(check => check.status)).toEqual(['fail', 'fail', 'pass', 'pass', 'warn', 'warn', 'warn']);
    expect(report.checks[0]!.remedy).toContain('Node.js');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it('uses bounded mock credential probe and redacts failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-network-')); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  try {
    const fetcher = vi.fn(async () => { throw new Error('SECRET'); });
    const report = await new VesselDoctorEngine({ ...fixture(root), fetch: fetcher }).diagnose({ probeNetwork: true });
    expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.stringify(report)).not.toContain('SECRET'); expect(report.checks[5]!.status).toBe('fail');
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it('keeps toolchain version drift advisory (warn is not fail)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-pins-')); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  try {
    const report = await new VesselDoctorEngine({ ...fixture(root), toolPins: () => [{ tool: 'codex', declared: '>=0.164.0', found: null, status: 'warn', message: 'codex: not installed; skipped' }] }).diagnose();
    expect(report.checks[2]).toMatchObject({ name: 'Toolchain pins', category: 'toolchain', status: 'warn' });
    // allPassed keeps its original meaning (every check is `pass`); a warn is not a fail,
    // and the CLI exit code already only checks for `fail`.
    expect(report.allPassed).toBe(false);
    expect(report.checks.every(check => check.status !== 'fail')).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it('diagnoses real temporary SQLite WAL and preserves corrupted file bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-sqlite-')); const file = memoryDatabasePath(root); const store = new HybridMemoryStore(file); let closed = false;
  try {
    expect((await diagnoseMemoryDatabase(file)).status).toBe('pass'); await store.close(); closed = true;
    fs.writeFileSync(file, 'corrupt database'); await expect(diagnoseMemoryDatabase(file)).rejects.toThrow(); expect(fs.readFileSync(file, 'utf8')).toBe('corrupt database');
  } finally { if (!closed) await store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
