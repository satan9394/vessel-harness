/**
 * 「安装态冒烟」纯判据单测（run-release-gates.ts §V1.1-G）。
 *
 * 只测**纯函数**（解析 / 判定 / 开关），不跑任何真实命令、不联网、不写盘 —— 真跑 npm 的那部分
 * （`buildInstallSmokeExecutor().run`）刻意不进单测，以免把秒级离线套件拖成分钟级。
 * 它不会因此「假绿」：executor 只负责**采集事实**，全部三态判定都由这里测过的 `judgeInstallSmoke`
 * 承担；executor 唯一的自有逻辑（④ 未启用即零命令返回）由最后一条用例直接锁死。
 *
 * 判别性：把任一 fail 分支放宽成 pending/pass、或把 pending 通道收紧成 fail，都会在此变红。
 */
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildInstallSmokeExecutor,
  hasMissingBuiltinConfigWarn,
  installSmokeRequested,
  judgeInstallSmoke,
  parseSystemLayerPath,
  systemPathInInstalledPackage,
  type InstallSmokeFacts,
} from './run-release-gates.js';

const PROJECT = path.join(path.parse(process.cwd()).root, 'tmp', 'vessel-install-smoke', 'project');
const IN_PKG = path.join(PROJECT, 'node_modules', '@vessel', 'cli', 'dist', 'configs', 'policy.default.yaml');

/** 基线事实 = 全绿（安装态读路径命中包内、无缺配置警告），各用例只覆盖被测字段。 */
function facts(o: Partial<InstallSmokeFacts> = {}): InstallSmokeFacts {
  const base: InstallSmokeFacts = { enabled: true, tempPathUsable: true, npmAvailable: true, timedOut: false, closureResolved: true, packOk: true, packBlockedOffline: false, tarballCount: 3, expectedPackages: 3, installOk: true, installBlockedOffline: false, workspaceDepMissing: [], cliEntryExists: true, policyStatusOk: true, systemPath: IN_PKG, systemPathInPackage: true, systemConfigFileExists: true, usageWarnsMissingConfig: false, detail: [] };
  return { ...base, ...o };
}
const status = (o: Partial<InstallSmokeFacts> = {}): string => judgeInstallSmoke(facts(o)).status;

describe('install-smoke 纯判据（V1.1-G）', () => {
  it('解析 system 层路径：--json 优先，人类输出行退回，两者都取不到则 undefined', () => {
    expect(parseSystemLayerPath(JSON.stringify({ layers: [{ layer: 'project', path: '/p/.harness/policy.yaml' }, { layer: 'system', path: IN_PKG }] }))).toBe(IN_PKG);
    expect(parseSystemLayerPath(`  system 存在  声明 1 条  sha256:abc  ${IN_PKG}\n  生效层序: system`)).toBe(IN_PKG);
    expect(parseSystemLayerPath('  system  缺失  声明 0 条  -  (未配置路径)')).toBeUndefined();
  });

  it('读路径判据：必须逐字落在安装态包内；仓库/cwd 下的 configs 一律不算', () => {
    expect(systemPathInInstalledPackage(IN_PKG, PROJECT)).toBe(true);
    expect(systemPathInInstalledPackage(path.join(PROJECT, 'configs', 'policy.default.yaml'), PROJECT)).toBe(false);
    expect(systemPathInInstalledPackage(path.join(PROJECT, 'node_modules', '@vessel', 'application', 'dist', 'configs', 'policy.default.yaml'), PROJECT)).toBe(false);
    expect(systemPathInInstalledPackage(undefined, PROJECT)).toBe(false);
  });

  it('启用开关只认 =1；缺配置警告标记只认逐字文案', () => {
    expect(installSmokeRequested({ VESSEL_GATE_INSTALL_SMOKE: '1' })).toBe(true);
    expect(installSmokeRequested({ VESSEL_GATE_INSTALL_SMOKE: 'true' })).toBe(false);
    expect(installSmokeRequested({})).toBe(false);
    expect(hasMissingBuiltinConfigWarn('[vessel] 未找到内置配置：/x/dist/configs/pricing.json')).toBe(true);
    expect(hasMissingBuiltinConfigWarn('=== 使用统计（/tmp/usage.json）===')).toBe(false);
  });

  it('pending 通道（环境不具备，绝不 fail）：未启用 / 路径不可用 / 闭包解析不出 / npm 缺失 / 超时 / 离线装不上 / 输出不可解析', () => {
    const cases: Array<Partial<InstallSmokeFacts>> = [
      { enabled: false }, { tempPathUsable: false }, { closureResolved: false }, { npmAvailable: false },
      { timedOut: true }, { packOk: false, packBlockedOffline: true },
      { installOk: false, installBlockedOffline: true }, { systemPath: undefined, systemPathInPackage: false },
    ];
    for (const c of cases) expect(status(c), JSON.stringify(c)).toBe('pending');
  });

  it('fail 通道（包真的坏了）：pack 非环境性失败 / tarball 缺 / 依赖图不自洽 / 非环境性安装失败 / 无入口 / CLI 非 0 / 读路径落包外 / 缺 configs / 缺配置警告', () => {
    const cases: Array<Partial<InstallSmokeFacts>> = [
      { packOk: false, packBlockedOffline: false }, { tarballCount: 2 },
      { installOk: false, installBlockedOffline: true, workspaceDepMissing: ['@vessel/llm'] },
      { installOk: false, installBlockedOffline: false }, { cliEntryExists: false }, { policyStatusOk: false },
      { systemPath: path.join(PROJECT, 'configs', 'policy.default.yaml'), systemPathInPackage: false },
      { systemConfigFileExists: false }, { usageWarnsMissingConfig: true },
    ];
    for (const c of cases) expect(status(c), JSON.stringify(c)).toBe('fail');
  });

  it('全绿 → pass（summary 点明判据是「读路径在包内」而非「命令 exit 0」）', () => {
    const v = judgeInstallSmoke(facts());
    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect(v.evidence.summary).toContain('包内');
    expect(v.evidence.summary).toContain('缺配置警告');
  });

  it('executor：第 9 道、未启用时**零命令**即 pending（既有 8 道不变慢）', async () => {
    const ex = buildInstallSmokeExecutor({ env: {} });
    expect(ex.gate.id).toBe('install-smoke');
    expect(ex.gate.position).toBe(9);
    let calls = 0;
    const v = await ex.run({ repoRoot: process.cwd(), reportsDir: process.cwd(), exec: async () => { calls += 1; return { code: 0, stdout: '', stderr: '' }; } });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(calls).toBe(0);
    expect(v.note).toContain('VESSEL_GATE_INSTALL_SMOKE');
  });
});
