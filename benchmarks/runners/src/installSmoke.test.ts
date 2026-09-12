/**
 * 「安装态冒烟」纯判据单测（run-release-gates.ts §V1.1-G）。只测纯函数：不跑真实命令、不联网、不写盘。
 * 真跑 npm 的那部分刻意不进单测（保持秒级离线）也不会假绿：executor 只**采集事实**，三态判定全部由
 * `judgeInstallSmoke` 承担（下方全覆盖）；executor 唯一的自有逻辑（未启用 → 零命令）由最后两条用例锁死。
 *
 * Round 20 追加**升级 / 覆盖安装阶段**的判定用例：pending（环境性）与 fail（包坏了 / 旧产物残留）
 * 两侧都表格化覆盖，每条注明「删掉哪个分支会红」。
 * 升级阶段同样**不假绿**：executor 在升级轮的每一处早退（准备失败 / pack 失败 / 安装失败 / 无入口 /
 * 非 0 退出）都只是把已采集的 `InstallSmokeUpgradeFacts` 交回 `judgeInstallSmoke` —— 没有任何一处
 * executor 自己判 pass；因此「升级后旧产物残留」这类结论只可能出现在上表的 pending/fail 用例里
 * （`installedVersion` / `*EntrySha256` 两行即锁死这两条升级特有判据）。
 */
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { INSTALL_SMOKE_ENTRY_REL, INSTALL_SMOKE_PACKAGE_REL, INSTALL_SMOKE_PACKED_ENTRY_REL, buildInstallSmokeExecutor, bumpInstallSmokeVersion, hasMissingBuiltinConfigWarn, installSmokeUpgradeEntryMarker, installSmokeRequested, judgeInstallSmoke, parseSystemLayerPath, systemPathInInstalledPackage, type InstallSmokeFacts, type InstallSmokeUpgradeFacts } from './run-release-gates.js';

const PROJECT = path.join(path.parse(process.cwd()).root, 'tmp', 'vessel-install-smoke', 'project');
const IN_PKG = path.join(PROJECT, 'node_modules', '@vessel', 'cli', 'dist', 'configs', 'policy.default.yaml');
/** 基线 = 全绿（读路径命中包内、无缺配置警告）；各用例只覆盖被测字段。 */
function facts(o: Partial<InstallSmokeFacts> = {}): InstallSmokeFacts {
  return { enabled: true, tempPathUsable: true, npmAvailable: true, timedOut: false, closureResolved: true, packOk: true, packBlockedByEnv: false, tarballCount: 3, expectedPackages: 3, installOk: true, installBlockedByEnv: false, workspaceDepMissing: [], cliEntryExists: true, policyStatusOk: true, systemPath: IN_PKG, systemPathInPackage: true, systemConfigFileExists: true, usageWarnsMissingConfig: false, detail: [], ...o };
}
const status = (o: Partial<InstallSmokeFacts> = {}): string => judgeInstallSmoke(facts(o)).status;

/** 升级轮入口字节基线（sha256 形态的 64 位 hex；两侧相同 = 入口来自本次 pack）。 */
const UP_SHA = 'a'.repeat(64);
const UP_SHA_OLD = 'b'.repeat(64);
/**
 * 升级阶段基线 = 全绿：首装版本 0.10.0 → 本轮新版本 0.10.1，安装树已是新版本且入口字节与 pack 源一致。
 * `expectedPackages` 由 `facts()` 固定为 3，故 tarballCount 基线也是 3。
 */
function upgrade(o: Partial<InstallSmokeUpgradeFacts> = {}): InstallSmokeUpgradeFacts {
  return { attempted: true, prepOk: true, npmAvailable: true, timedOut: false, packOk: true, packBlockedByEnv: false, tarballCount: 3, installOk: true, installBlockedByEnv: false, workspaceDepMissing: [], cliEntryExists: true, policyStatusOk: true, systemPath: IN_PKG, systemPathInPackage: true, systemConfigFileExists: true, usageWarnsMissingConfig: false, previousVersion: '0.10.0', upgradedVersion: '0.10.1', installedVersion: '0.10.1', installedEntrySha256: UP_SHA, packedEntrySha256: UP_SHA, ...o };
}
const upStatus = (o: Partial<InstallSmokeUpgradeFacts> = {}): string => judgeInstallSmoke(facts({ upgrade: upgrade(o) })).status;

describe('install-smoke 纯判据（V1.1-G / Round 20 升级路径）', () => {
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

  it('升级轮新版本号：+patch 成为严格更大的正式版本（保证覆盖安装真的发生，且不破坏依赖范围）', () => {
    expect(bumpInstallSmokeVersion('0.10.0')).toBe('0.10.1');
    expect(bumpInstallSmokeVersion('1.2.9')).toBe('1.2.10');
    expect(bumpInstallSmokeVersion('0.10.0-beta.1')).toBe('0.10.1');
    expect(bumpInstallSmokeVersion('0.10.0')).not.toBe('0.10.0');
    // 退化分支（上游版本号不是 x.y.z）：仍返回**不同**且合法的 semver，不静默沿用旧版本号。
    expect(bumpInstallSmokeVersion('dev')).toBe('0.0.1-install-smoke');
    expect(bumpInstallSmokeVersion('dev')).not.toBe('dev');
  });

  it('路径不变量：入口（安装态）/ 包内入口 / 入口包 manifest 指向同一条目录链（防两处漂移）', () => {
    expect(INSTALL_SMOKE_ENTRY_REL).toBe(`node_modules/@vessel/cli/${INSTALL_SMOKE_PACKED_ENTRY_REL}`);
    expect(INSTALL_SMOKE_ENTRY_REL.startsWith('node_modules/@vessel/cli/')).toBe(true);
    expect(INSTALL_SMOKE_PACKAGE_REL.startsWith('node_modules/@vessel/cli/')).toBe(true);
    expect(INSTALL_SMOKE_PACKAGE_REL.endsWith('/package.json')).toBe(true);
  });

  it('升级轮入口字节标记：把「本轮产物」确定性地与首轮产物区分开（删掉它 ⇒ 字节溯源判据②失去判别力）', () => {
    const marker = installSmokeUpgradeEntryMarker('0.10.1');
    expect(marker.startsWith('\n//')).toBe(true); // JS 行注释：追加到入口末尾不改变 CLI 行为
    expect(marker).toContain('0.10.1');
    const prev = 'console.log(1);\n';
    expect(`${prev}${marker}`).not.toBe(prev); // 字节确实变了（否则「sha256 == 本轮 pack 源」对旧树同样成立）
    expect(`${prev}${marker}`.startsWith(prev)).toBe(true); // 只追加、不改写既有字节
  });

  it('升级 pending 通道（环境/输入不成立，绝不 fail）', () => {
    // 每条用例名即「删掉该分支会红在哪」：删掉对应 return pending 后，该行会退化成 pass/fail。
    const cases: Array<[string, Partial<InstallSmokeUpgradeFacts>]> = [
      ['prepOk=false（升级轮新的判据输入构造不出来）', { prepOk: false }],
      ['npmAvailable=false（升级轮 npm 不可用）', { npmAvailable: false }],
      ['timedOut=true（升级轮超时）', { timedOut: true }],
      ['packOk=false + packBlockedByEnv（升级轮 pack 环境性失败）', { packOk: false, packBlockedByEnv: true }],
      ['installOk=false + installBlockedByEnv（升级轮 install 环境性失败：离线装不上）', { installOk: false, installBlockedByEnv: true }],
      ['systemPath=undefined（升级后输出不可解析）', { systemPath: undefined, systemPathInPackage: false }],
      ['previousVersion === upgradedVersion（版本号不可区分 → 溯源判据失效）', { previousVersion: '0.10.1', upgradedVersion: '0.10.1' }],
    ];
    for (const [name, c] of cases) expect(upStatus(c), name).toBe('pending');
  });

  it('升级 fail 通道（包坏了 / 旧产物残留）', () => {
    const cases: Array<[string, Partial<InstallSmokeUpgradeFacts>]> = [
      ['packOk=false（升级轮 pack 非环境性失败）', { packOk: false, packBlockedByEnv: false }],
      ['tarballCount 不足（升级轮少产出发布物）', { tarballCount: 2 }],
      ['installOk=false + workspaceDepMissing（自家依赖未被新 tarball 满足）', { installOk: false, installBlockedByEnv: true, workspaceDepMissing: ['@vessel/llm'] }],
      ['installOk=false（升级轮 install 非环境性失败）', { installOk: false, installBlockedByEnv: false }],
      ['cliEntryExists=false（升级后无入口）', { cliEntryExists: false }],
      ['policyStatusOk=false（升级后 CLI 跑不起来）', { policyStatusOk: false }],
      ['systemPathInPackage=false（升级后读路径落包外）', { systemPath: path.join(PROJECT, 'configs', 'policy.default.yaml'), systemPathInPackage: false }],
      ['systemConfigFileExists=false（新 tarball 缺 configs）', { systemConfigFileExists: false }],
      ['usageWarnsMissingConfig=true（升级后 pricing/model-catalog 读不到）', { usageWarnsMissingConfig: true }],
      ['installedVersion 仍是旧版本（覆盖安装没生效，旧产物残留）', { installedVersion: '0.10.0' }],
      ['installedVersion 读不到（安装树 manifest 不可读）', { installedVersion: undefined }],
      ['installedEntrySha256 != packedEntrySha256（入口不是本次 pack 写下的）', { installedEntrySha256: UP_SHA_OLD }],
      ['installedEntrySha256 读不到（入口文件缺失）', { installedEntrySha256: undefined }],
      ['packedEntrySha256 读不到（本轮 pack 源缺失，判据不成立）', { packedEntrySha256: undefined }],
    ];
    for (const [name, c] of cases) expect(upStatus(c), name).toBe('fail');
  });

  it('升级全绿 → pass（首装两条硬判据 + 升级溯源都成立）', () => {
    const v = judgeInstallSmoke(facts({ upgrade: upgrade() }));
    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect(v.evidence.summary).toContain('覆盖升级');
    expect(v.evidence.summary).toContain('包内');
    expect(v.evidence.summary).toContain('缺配置警告');
  });

  it('首装/首跑没通过时升级事实不参与判定（同一口径：先按首装结论返回）', () => {
    // 升级事实全绿，但首装 install 失败 → 仍是首装的 fail（升级块在首装全部 pass 之后）。
    expect(status({ installOk: false, installBlockedByEnv: false, upgrade: upgrade() })).toBe('fail');
    // 首装因环境原因 pending → 同样不被升级事实“救”成 pass。
    expect(status({ installOk: false, installBlockedByEnv: true, upgrade: upgrade() })).toBe('pending');
    // 未尝试升级（upgrade 缺省）→ 判定与 Round 20 之前一致。
    expect(judgeInstallSmoke(facts()).status).toBe('pass');
  });

  it('executor：第 9 道、未启用时**零命令零 IO**即 pending（既有 8 道不变慢）', async () => {
    let calls = 0;
    const ex = buildInstallSmokeExecutor({ env: {} });
    expect([ex.gate.id, ex.gate.position]).toEqual(['install-smoke', 9]);
    const v = await ex.run({ repoRoot: process.cwd(), reportsDir: process.cwd(), exec: async () => { calls += 1; return { code: 0, stdout: '', stderr: '' }; } });
    expect([v.status, v.pending, calls]).toEqual(['pending', true, 0]);
    expect(v.note).toContain('VESSEL_GATE_INSTALL_SMOKE');
    // 零 IO 旁证：executor 在 `resolveInstallClosure`（第一处 IO：读 root package.json）之后才会写
    // 「闭包 N 个包」这行 detail —— 它不出现 ⇒ 该步未执行（升级阶段更在其后，同样未触碰）。
    expect((v.evidence.detail ?? []).some((l) => l.includes('闭包'))).toBe(false);
    expect((v.evidence.detail ?? []).some((l) => l.includes('升级阶段'))).toBe(false);
  });

  it('executor：开关取值不是 "1" 时同样零命令（默认门禁不因扩展而变慢）', async () => {
    let calls = 0;
    const ex = buildInstallSmokeExecutor({ env: { VESSEL_GATE_INSTALL_SMOKE: 'true' } });
    const v = await ex.run({ repoRoot: process.cwd(), reportsDir: process.cwd(), exec: async () => { calls += 1; return { code: 0, stdout: '', stderr: '' }; } });
    expect([v.status, v.pending, calls]).toEqual(['pending', true, 0]);
  });
});

