import { ProviderRoutes } from '@vessel/local-server';
import type { ProviderStore } from './ProviderStore.js';
import { emitJson, fail, isJson } from '../output.js';

const USAGE = '用法: vessel provider profile list [--json] | save <name> --provider <id> [--model m] [--base-url u] [--label text] | use <name> [--json] | delete <name>';
const ERRORS: Record<string, string> = {
  invalid_profile_name: 'profile 名称须为 1–64 字符且不含空白。',
  invalid_profile_input: 'profile 字段须为非空文本。',
  invalid_base_url: '请提供不含凭据、查询或片段的 HTTP(S) --base-url。',
  unknown_provider: '供应商不存在，请先运行 vessel provider list。',
  unknown_profile: 'profile 不存在，请先运行 vessel provider profile list。',
  dangling_profile_provider: 'profile 引用的供应商已删除，请重新保存 profile。',
  builtin_provider: '内置 mock 不支持 profile，请选择已配置的供应商。',
  provider_profiles_corrupted: 'provider-profiles.json 损坏，请修复后重试。',
};

export function profileCommands(store: ProviderStore, args: string[], flags: Map<string, string>): number {
  const [command, name] = args;
  try {
    switch (command) {
      case 'list': {
        const profiles = store.listProfiles();
        if (isJson(flags)) emitJson({ profiles });
        else if (!profiles.length) console.log('无 profile。');
        else for (const profile of profiles) console.log(`${profile.name}  provider=${profile.provider}  model=${profile.model ?? '-'}  baseUrl=${profile.baseUrl ?? '-'}`);
        return 0;
      }
      case 'save': {
        const provider = flags.get('provider');
        if (name === undefined || !provider) return fail(2, 'save 需要 <name> 和 --provider <id>。', flags);
        const profile = store.saveProfile(name, {
          provider, model: flags.get('model'), baseUrl: flags.get('base-url'), label: flags.get('label'),
        });
        if (isJson(flags)) emitJson({ profile });
        else console.log(`已保存 profile ${profile.name}`);
        return 0;
      }
      case 'use': {
        if (name === undefined) return fail(2, USAGE, flags);
        // Share the HTTP DTO whitelist; the route delegates to store.useProfile().
        const provider = new ProviderRoutes(() => store).useProfile(name);
        if (!provider) return fail(2, ERRORS.unknown_profile!, flags);
        if (isJson(flags)) emitJson({ provider });
        else console.log(`已启用 profile ${name.trim()}（provider=${provider.name}）`);
        return 0;
      }
      case 'delete': {
        if (name === undefined) return fail(2, USAGE, flags);
        const deleted = store.deleteProfile(name);
        if (isJson(flags)) emitJson({ ok: true });
        else console.log(deleted ? `已删除 profile ${name.trim()}` : 'profile 不存在，无需删除。');
        return 0;
      }
      default: return fail(2, USAGE, flags);
    }
  } catch (error) {
    const message = error instanceof Error ? ERRORS[error.message] : undefined;
    return fail(2, message ?? 'profile 操作失败，请检查供应商配置与存储权限。', flags);
  }
}
