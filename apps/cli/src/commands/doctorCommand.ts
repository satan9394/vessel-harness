import * as fs from 'node:fs';
import * as path from 'node:path';
import { diagnoseMemoryDatabase } from '@vessel/memory';
import { PlatformSandboxRunner } from '@vessel/tools';
import { DaemonLifecycle } from '@vessel/local-server';
import { createDefaultProviderStore } from '../providers/defaultStore.js';
import { memoryDatabasePath } from './memoryCommand.js';
import type { ProviderConfig } from '../providers/ProviderStore.js';

export interface DoctorCheckItem {
  name: string;
  category: 'runtime' | 'sandbox' | 'database' | 'providers' | 'daemon';
  status: 'pass' | 'warn' | 'fail';
  message: string;
  remedy?: string;
  durationMs: number;
}
export interface DoctorReport { timestamp: number; checks: DoctorCheckItem[]; allPassed: boolean }
export interface DoctorDependencies {
  workspace?: string;
  nodeVersion?: string;
  sandbox?: () => Promise<boolean>;
  database?: () => Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }>;
  providers?: () => ProviderConfig[];
  daemon?: () => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
}

export { diagnoseMemoryDatabase } from '@vessel/memory';

export class VesselDoctorEngine {
  constructor(private readonly deps: DoctorDependencies = {}) {}
  async diagnose(options: { probeNetwork?: boolean } = {}): Promise<DoctorReport> {
    const checks: DoctorCheckItem[] = [];
    const check = async (name: string, category: DoctorCheckItem['category'], remedy: string, run: () => Promise<Pick<DoctorCheckItem, 'status' | 'message'>>) => {
      const start = performance.now();
      try { const result = await run(); checks.push({ name, category, ...result, ...(result.status !== 'pass' ? { remedy } : {}), durationMs: Math.round(performance.now() - start) }); }
      catch { checks.push({ name, category, status: 'fail', message: 'Check failed; inspect local configuration.', remedy, durationMs: Math.round(performance.now() - start) }); }
    };
    await check('Node.js', 'runtime', 'Install Node.js >=20 (>=22.13 for built-in SQLite).', async () => {
      const version = this.deps.nodeVersion ?? process.versions.node;
      return { status: /^\d+\./.test(version) && Number(version.split('.')[0]) >= 20 ? 'pass' : 'fail', message: `Node.js ${version}; required >=20.` };
    });
    const workspace = path.resolve(this.deps.workspace ?? process.cwd());
    await check('npm lockfile', 'runtime', 'Keep package-lock.json as the only lockfile; use npm.', async () => {
      const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(file => fs.existsSync(path.join(workspace, file)));
      return { status: locks.length === 1 && locks[0] === 'package-lock.json' ? 'pass' : 'fail', message: `Lockfiles: ${locks.join(', ') || 'none'}.` };
    });
    await check('SQLite WAL', 'database', 'Check memory database permissions and restore from preserved journals; do not delete state.', this.deps.database ?? (() => diagnoseMemoryDatabase(memoryDatabasePath(workspace))));
    await check('Native sandbox', 'sandbox', 'Configure Windows Low Integrity/restricted SID ACLs, Linux bwrap, or macOS Seatbelt.', async () => {
      const available = await (this.deps.sandbox ?? (() => new PlatformSandboxRunner().isAvailable()))();
      return { status: available ? 'pass' : 'warn', message: available ? 'Native isolation probe passed.' : 'Native isolation unavailable; check platform helper and permissions.' };
    });
    await check('Provider credentials', 'providers', 'Configure provider credentials with vessel setup; verify the endpoint when network probing is enabled.', async () => {
      const providers = (this.deps.providers ?? (() => createDefaultProviderStore().load()))();
      const configured = providers.filter(provider => provider.protocol !== 'mock');
      if (!configured.length) return { status: 'warn', message: 'No external provider configured; offline mock remains available.' };
      const localWithoutAuth = (provider: ProviderConfig) => {
        if (provider.secretRef || !provider.baseUrl) return false;
        const host = new URL(provider.baseUrl).hostname;
        return ['localhost', '127.0.0.1', '[::1]'].includes(host);
      };
      if (configured.some(provider => !provider.apiKey?.trim() && !localWithoutAuth(provider))) return { status: 'fail', message: 'One or more configured providers have unavailable credentials.' };
      if (options.probeNetwork) for (const provider of configured) {
        if (!provider.baseUrl) return { status: 'fail', message: 'A configured provider has no endpoint.' };
        const endpoint = provider.baseUrl.replace(/\/+$/, '');
        const response = await (this.deps.fetch ?? globalThis.fetch)(`${endpoint}/models`, {
          headers: provider.apiKey ? provider.protocol === 'anthropic' ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${provider.apiKey}` } : {}, signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        if (!response.ok) return { status: 'fail', message: 'A configured provider rejected the credential/network probe.' };
      }
      return { status: 'pass', message: `${configured.length} provider credential(s) available locally.${options.probeNetwork ? ' Authenticated endpoint probes passed.' : ' Network probe disabled.'}` };
    });
    await check('Daemon', 'daemon', 'Start the local service with vessel daemon start.', async () => {
      const running = await (this.deps.daemon ?? (async () => !!await new DaemonLifecycle({ launch: async () => { throw new Error('doctor never launches daemon'); } }).status()))();
      return { status: running ? 'pass' : 'warn', message: running ? 'Authenticated local daemon is running.' : 'Local daemon is not running.' };
    });
    return { timestamp: Date.now(), checks, allPassed: checks.every(item => item.status === 'pass') };
  }
}

export async function doctorCommand(args: string[], flags = new Map<string, string>(), engine?: VesselDoctorEngine): Promise<number> {
  if (args.length) { console.error('Usage: vessel doctor [--probe-network] [--json]'); return 2; }
  const report = await (engine ?? new VesselDoctorEngine({ workspace: flags.get('workspace') })).diagnose({ probeNetwork: flags.has('probe-network') });
  console.log(flags.has('json') ? JSON.stringify(report) : ['Vessel doctor', ...report.checks.map(item => `[${item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : '✗'}] ${item.name}: ${item.message} (${item.durationMs} ms)${item.remedy ? `\n    Fix: ${item.remedy}` : ''}`)].join('\n'));
  return report.checks.some(item => item.status === 'fail') ? 1 : 0;
}
