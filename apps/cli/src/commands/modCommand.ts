import path from 'node:path';
import { auditModDirectory, discoverMods } from '@vessel/policy';

export async function modCommand(args: string[], options: { workspaceRoot?: string } = {}): Promise<number> {
  const sub = args[0] ?? 'list';
  if (!['list', 'inspect', 'verify', 'audit'].includes(sub) || (sub === 'list' ? args.length > 1 : args.length !== 2)) {
    console.error('Usage: vessel mod list | inspect <name> | verify <path> | audit <path>'); return 2;
  }
  const workspace = path.resolve(options.workspaceRoot ?? process.cwd());
  try {
    if (sub === 'list') {
      const mods = await discoverMods(workspace);
      console.log(['Discovered manifests (not loaded instances): name | version | priority | static hooks (advisory) | status', ...mods.map(mod => `${mod.manifest?.name ?? path.basename(mod.root)} | ${mod.manifest?.version ?? '?'} | ${mod.manifest?.priority ?? 100} | ${mod.staticHooks?.join(', ') || 'not evaluated/none detected'} | ${mod.audit.safe ? 'sandbox-required; disabled until explicit opt-in' : 'invalid; disabled'}`)].join('\n'));
      return mods.some(mod => !mod.audit.safe) ? 1 : 0;
    }
    const mod = sub === 'inspect' ? (await discoverMods(workspace)).find(item => item.manifest?.name === args[1]) : await auditModDirectory(path.resolve(workspace, args[1]!));
    if (!mod) { console.error('Mod not discovered.'); return 1; }
    console.log(JSON.stringify({ ...mod, status: 'disabled; sandbox required before explicit opt-in' }, null, 2));
    return mod.audit.safe ? 0 : 1;
  } catch { console.error('Mod discovery failed; check local manifest and directory permissions.'); return 1; }
}
