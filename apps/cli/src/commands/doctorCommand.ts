import * as fs from 'node:fs';
import * as path from 'node:path';
import { diagnoseMemoryDatabase } from '@vessel/memory';
import { PlatformSandboxRunner } from '@vessel/tools';
import { DaemonLifecycle } from '@vessel/local-server';
import { discoverMods } from '@vessel/policy';
import { WorkerSandbox } from '@vessel/application';
import { createDefaultProviderStore } from '../providers/defaultStore.js';
import { memoryDatabasePath } from './memoryCommand.js';
import type { ProviderConfig } from '../providers/ProviderStore.js';
import { checkToolPins, type ToolPinCheck } from '@vessel/shared';

export interface DoctorCheckItem {
  name: string;
  category: 'runtime' | 'sandbox' | 'database' | 'providers' | 'daemon' | 'mods' | 'toolchain';
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
  modSandbox?: () => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
  toolPins?: () => ToolPinCheck[];
}

export { diagnoseMemoryDatabase } from '@vessel/memory';

export class VesselDoctorEngine {
  constructor(private readonly deps: DoctorDependencies = {}) {}
  async diagnose(options: { probeNetwork?: boolean; modsOnly?: boolean } = {}): Promise<DoctorReport> {
    const checks: DoctorCheckItem[] = [];
    const check = async (name: string, category: DoctorCheckItem['category'], remedy: string, run: () => Promise<Pick<DoctorCheckItem, 'status' | 'message'>>) => {
      const start = performance.now();
      try { const result = await run(); checks.push({ name, category, ...result, ...(result.status !== 'pass' ? { remedy } : {}), durationMs: Math.round(performance.now() - start) }); }
      catch { checks.push({ name, category, status: 'fail', message: 'Check failed; inspect local configuration.', remedy, durationMs: Math.round(performance.now() - start) }); }
    };
    const workspace = path.resolve(this.deps.workspace ?? process.cwd());
    const mods = await discoverMods(workspace);
    const checkMods = async () => {
      await check('Mod manifests and static permissions', 'mods', 'Fix permission/source violations; keep unsigned Mods disabled until explicitly enabled in the Worker sandbox.', async () => ({
        status: mods.some(mod => !mod.audit.safe) ? 'fail' : mods.length ? 'warn' : 'pass',
        message: mods.length ? mods.map(mod => `${mod.manifest?.name ?? path.basename(mod.root)}: ${[...mod.audit.violations, ...mod.audit.warnings].join(' ')}`).join('\n') : 'No Mod manifests discovered. Static scan only; no loaded sandbox attestation.',
      }));
      await check('Restricted Mod Worker', 'mods', 'Use a Node version supporting permission-denied Workers (Node >=22.13/23.5); keep Mods disabled if this probe fails.', async () => {
        // Fixed trusted inert source probes the runtime boundary, never discovered Mod code.
        const available = await (this.deps.modSandbox ?? (async () => {
          const sandbox = new WorkerSandbox({ root: workspace, manifest: { name: 'doctor-probe', version: '1', entrypoint: 'probe.js' }, source: 'module.exports = {};', timeoutMs: 5000 });
          await sandbox.invoke('observe', []);
          return true;
        }))();
        return { status: available ? 'pass' : 'fail', message: available ? 'Trusted inert Worker probe passed; discovered Mod instances were not executed or attested.' : 'Restricted Worker unavailable; Mod execution must remain disabled.' };
      });
    };
    if (options.modsOnly) {
      await checkMods();
      return { timestamp: Date.now(), checks, allPassed: checks.every(item => item.status === 'pass') };
    }
    await check('Node.js', 'runtime', 'Install Node.js >=26 (npm >=12 ships with it).', async () => {
      const version = this.deps.nodeVersion ?? process.versions.node;
      return { status: /^\d+\./.test(version) && Number(version.split('.')[0]) >= 26 ? 'pass' : 'fail', message: `Node.js ${version}; required >=26.` };
    });
    await check('npm lockfile', 'runtime', 'Keep package-lock.json as the only lockfile; use npm.', async () => {
      const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(file => fs.existsSync(path.join(workspace, file)));
      return { status: locks.length === 1 && locks[0] === 'package-lock.json' ? 'pass' : 'fail', message: `Lockfiles: ${locks.join(', ') || 'none'}.` };
    });
    await check('Toolchain pins', 'toolchain', 'Upgrade/downgrade the CLI to match configs/tool-pins.json, or update the pin if the bump is intended.', async () => {
      const pins = (this.deps.toolPins ?? (() => checkToolPins(workspace)))();
      return { status: pins.some(pin => pin.status === 'warn') ? 'warn' : 'pass', message: pins.map(pin => pin.message).join('\n') };
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
      const hasCredential = (p: ProviderConfig) => Boolean(p.apiKey?.trim()) || Boolean(p.secretRef);
      if (configured.some(p => !hasCredential(p) && !localWithoutAuth(p))) return { status: 'fail', message: 'One or more configured providers have unavailable credentials.' };
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
    if (mods.length) await checkMods();
    return { timestamp: Date.now(), checks, allPassed: checks.every(item => item.status === 'pass') };
  }
}

export async function doctorCommand(args: string[], flags = new Map<string, string>(), engine?: VesselDoctorEngine): Promise<number> {
  if (args.length) { console.error('Usage: vessel doctor [--probe-network] [--mods] [--json]'); return 2; }
  const report = await (engine ?? new VesselDoctorEngine({ workspace: flags.get('workspace') })).diagnose({ probeNetwork: flags.has('probe-network'), modsOnly: flags.has('mods') });
  console.log(flags.has('json') ? JSON.stringify(report) : ['Vessel doctor', ...report.checks.map(item => `[${item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : '✗'}] ${item.name}: ${item.message} (${item.durationMs} ms)${item.remedy ? `\n    Fix: ${item.remedy}` : ''}`)].join('\n'));
  return report.checks.some(item => item.status === 'fail') ? 1 : 0;
}
