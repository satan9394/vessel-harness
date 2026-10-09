# 194 — Mod 权限清单静态审计、CLI 控制面与 Doctor 诊断 (Mod Permissions Audit, CLI & Doctor)

- 编号：194
- 优先级：P1
- 关联模块：`apps/cli`, `packages/application`, `packages/policy`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：实现与单卡门禁通过（待 Epic 195 全仓集成验收）
- 创建日期：2026-10-08

---

## 1. 目标与意图

在支持外部 Mod 与中间件后，终端用户与运维需要直观透明的手段来审查当前加载了哪些 Mod、它们声明了什么权限、是否存在已知的安全隐患。

本任务旨在为 CLI 控制面与系统诊断引擎构建 **Mod 管理与权限静态审计体系**：
1. **`vessel mod` CLI 控制面**：
   - `vessel mod list`：表格化列出当前启用的 Mod、版本、优先级以及拦截能力（Observe / Rewrite / Intercept）；
   - `vessel mod inspect <name>`：下钻查看特定 Mod 的完整权限清单（文件白名单、网络声明、系统提示词贡献与来源）；
   - `vessel mod verify <path>`：对本地或外部 Mod 进行静态安全扫描，检查是否存在高危特征（直接 require 原生模块、试图反射获取主进程 process.env 密钥等）；
2. **`vessel doctor` 工业级自检引擎扩展**：
   - 在 `vessel doctor` 诊断报告中追加 `category: 'mods'` 检查项；
   - 自动验证加载 Mod 的沙箱完整性与清单合法性，若发现越权声明或未知来源，输出清晰的 `[!]` 警告及修复建议。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 静态审计引擎 (`packages/policy/src/mods/audit/ModPermissionsAuditor.ts`)

```typescript
export interface ModAuditResult {
  modName: string;
  safe: boolean;
  violations: string[];
  warnings: string[];
  declaredPermissions: Record<string, unknown>;
}

export class ModPermissionsAuditor {
  static auditSource(sourceCode: string, manifest: Record<string, unknown>): ModAuditResult;
}
```

### 2.2 CLI 子命令实现 (`apps/cli/src/commands/modCommand.ts`)

```typescript
export async function modCommand(args: string[], options: { workspaceRoot?: string }): Promise<number>;
```
- 支持 `list`、`inspect` 与 `verify` 子命令。

---

## 3. 架构红线与禁做准则

1. **薄核铁律**：`packages/core` 保持 0 改动；
2. **无永久删除**：除在 `os.tmpdir()` 创建的测试自建临时目录外，严禁硬删任何文件；
3. **包管理器锁定**：锁定 npm，禁止产生其它锁文件。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/policy/src/mods/audit/ModPermissionsAuditor.test.ts`
   - `npx vitest run apps/cli/src/commands/modCommand.test.ts`
2. 类型构建通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0

## 5. 本地工作证明（2026-10-08）

- 统一复用 shared 的 `validateModManifest`；policy 增加只读源审计与 `.harness/mods` 静态发现。
- 清单优先级与 runtime 对齐：`vessel.mod.json` → `claude.mod` → `package.json["claude.mod"]`；更高优先级清单非法时拒绝回退。
- CLI `mod list/inspect/verify/audit` 已接入；列表明确显示静态发现、推断 Hook（仅建议性）、未启用与沙箱要求，不伪报正在加载的实例。
- `doctor --mods` 独立检查清单与受限 Worker；只运行固定可信空探针，不执行发现的 Mod，且不读取供应商凭据、不创建 SQLite/daemon 状态。默认 doctor 在存在 Mod 时附加诊断，空目录保持既有六项。
- 扫描覆盖 require、环境密钥、动态执行、原生导入与安全权限篡改；未知字段、逃逸路径、network 与非白名单工具均拒绝。扫描只报告已知特征，Worker 硬边界是运行时安全依据。
- 最后一次源代码修改后的验证：定向 **4 文件 / 26 测试通过**；`tsc -b` exit 0；`typecheck:tests` exit 0。
- 证据：`evidence/sessions/2026-10-08-v2.2/card194-focused.log`、`card194-tsc.log`、`card194-typecheck-tests.log`（均含 `EXIT_STATUS=0`）。
- `packages/core` 无本卡变动，无依赖修改、提交、推送、发布或真实外部 Agent 调用。
