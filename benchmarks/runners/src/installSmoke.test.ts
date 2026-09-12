/**
 * 「安装态冒烟」纯判据单测（run-release-gates.ts §V1.1-G）。只测纯函数：不跑真实命令、不联网、不写盘。
 * 真跑 npm 的那部分刻意不进单测（保持秒级离线）也不会假绿：executor 只**采集事实**，三态判定全部由
 * `judgeInstallSmoke` 承担（下方全覆盖）；executor 唯一的自有逻辑（未启用 → 零命令）由最后一条用例锁死。
 */
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildInstallSmokeExecutor, hasMissingBuiltinConfigWarn, installSmokeRequested, judgeInstallSmoke, parseSystemLayerPath, systemPathInInstalledPackage, type InstallSmokeFacts } from './run-release-gates.js';

const PROJECT = path.join(path.parse(process.cwd()).root, 'tmp', 'vessel-install-smoke', 'project');
const IN_PKG = path.join(PROJECT, 'node_modules', '@vessel', 'cli', 'dist', 'configs', 'policy.default.yaml');
/** 基线 = 全绿（读路径命中包内、无缺配置警告）；各用例只覆盖被测字段。 */
function facts(o: Partial<InstallSmokeFacts> = {}): InstallSmokeFacts {
  return { enabled: true, tempPathUsable: true, npmAvailable: true, timedOut: false, closureResolved: true, packOk: true, packBlockedByEnv: false, tarballCount: 3, expectedPackages: 3, installOk: true, installBlockedByEnv: false, workspaceDepMissing: [], cliEntryExists: true, policyStatusOk: true, systemPath: IN_PKG, systemPathInPackage: true, systemConfigFileExists: true, usageWarnsMissingConfig: false, detail: [], ...o };
}
const status = (o: Partial<InstallSmokeFacts> = {}): string => judgeInstallSmoke(facts(o)).status;

describe('install-smoke 纯判据（V1.1-G）', () => {
  it('解析 system 层路径：--json 优先 / 人类输出行退回 / 都取不到 → undefined', () => {
    expect(parseSystemLayerPath(JSON.stringify({ layers: [{ layer: 'project', path: '/p/x.yaml' }, { layer: 'system', path: IN_PKG }] }))).toBe(IN_PKG);
    expect(parseSystemLayerPath(`  system 存在  声明 1 条  sha256:abc  ${IN_PKG}`)).toBe(IN_PKG);
    expect(parseSystemLayerPath('  system  缺失  声明 0 条  -  (未配置路径)')).toBeUndefined();
  });

  it('读路径必须逐字在包内；开关只认 =1；缺配置警告只认逐字文案', () => {
    expect(systemPathInInstalledPackage(IN_PKG, PROJECT)).toBe(true);
    expect(systemPathInInstalledPackage(path.join(PROJECT, 'configs', 'policy.default.yaml'), PROJECT)).toBe(false);
    expect(systemPathInInstalledPackage(path.join(PROJECT, 'node_modules', '@vessel', 'application', 'dist', 'configs', 'policy.default.yaml'), PROJECT)).toBe(false);
    expect(systemPathInInstalledPackage(undefined, PROJECT)).toBe(false);
    expect(installSmokeRequested({ VESSEL_GATE_INSTALL_SMOKE: '1' })).toBe(true);
    expect(installSmokeRequested({ VESSEL_GATE_INSTALL_SMOKE: 'true' })).toBe(false);
    expect(hasMissingBuiltinConfigWarn('[vessel] 未找到内置配置：/x/configs/pricing.json')).toBe(true);
    expect(hasMissingBuiltinConfigWarn('=== 使用统计（/tmp/usage.json）===')).toBe(false);
  });

  it('pending 通道（环境不具备，绝不 fail）', () => {
    const cases: Array<Partial<InstallSmokeFacts>> = [{ enabled: false }, { tempPathUsable: false }, { closureResolved: false }, { npmAvailable: false }, { timedOut: true }, { packOk: false, packBlockedByEnv: true }, { installOk: false, installBlockedByEnv: true }, { systemPath: undefined, systemPathInPackage: false }];
    for (const c of cases) expect(status(c), JSON.stringify(c)).toBe('pending');
  });

  it('fail 通道（包真的坏了）', () => {
    const cases: Array<Partial<InstallSmokeFacts>> = [{ packOk: false, packBlockedByEnv: false }, { tarballCount: 2 }, { installOk: false, installBlockedByEnv: true, workspaceDepMissing: ['@vessel/llm'] }, { installOk: false, installBlockedByEnv: false }, { cliEntryExists: false }, { policyStatusOk: false }, { systemPath: path.join(PROJECT, 'configs', 'policy.default.yaml'), systemPathInPackage: false }, { systemConfigFileExists: false }, { usageWarnsMissingConfig: true }];
    for (const c of cases) expect(status(c), JSON.stringify(c)).toBe('fail');
  });

  it('全绿 → pass（判据是「读路径在包内」，不是「命令 exit 0」）', () => {
    const v = judgeInstallSmoke(facts());
    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect(v.evidence.summary).toContain('包内');
    expect(v.evidence.summary).toContain('缺配置警告');
  });

  it('executor：第 9 道、未启用时**零命令**即 pending（既有 8 道不变慢）', async () => {
    let calls = 0;
    const ex = buildInstallSmokeExecutor({ env: {} });
    expect([ex.gate.id, ex.gate.position]).toEqual(['install-smoke', 9]);
    const v = await ex.run({ repoRoot: process.cwd(), reportsDir: process.cwd(), exec: async () => { calls += 1; return { code: 0, stdout: '', stderr: '' }; } });
    expect([v.status, v.pending, calls]).toEqual(['pending', true, 0]);
    expect(v.note).toContain('VESSEL_GATE_INSTALL_SMOKE');
  });
});
