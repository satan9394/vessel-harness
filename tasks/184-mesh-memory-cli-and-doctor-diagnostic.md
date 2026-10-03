# 184 — Mesh/Memory CLI 控制面与 `vessel doctor` 系统健康自检引擎

- 编号：184
- 优先级：P2
- 关联模块：`apps/cli`, `packages/tools`, `packages/memory`, `packages/agents`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已合入（2026-10-03 本地验收）
- 创建日期：2026-10-03

---

## 1. 目标与意图

在任务 180、181 与 182 中，底层核心分别落地了：
1. 原生操作系统沙箱降权引擎（`NativeSandboxRunner` 与 Windows Low Integrity / bwrap / Seatbelt 探测）；
2. 纯 TS 向量余弦与 FTS5 BM25 的 RRF 混合记忆与反思规则库（`HybridMemoryStore`）；
3. 跨实例 Swarm Mesh 与事件总线（`NativeMeshEventBus`、HMAC 防重放、子图远程派发）。

然而，上述能力目前仅存在于底层库和 API 契约中，用户在日常终端使用 CLI 时无法直观查看集群节点状态、管理经验记忆库，更缺少一个像 `flutter doctor` / `brew doctor` 那样能一键排查系统环境健康状态的命令。

本任务旨在为 CLI 补齐控制台管理命令与全系统健康自检引擎：
1. **`vessel mesh` CLI 控制面**：
   - `vessel mesh status`：输出当前节点 UUID、Daemon 运行状态、已连接对等节点数量及延迟统计；
   - `vessel mesh peers`：表格化列出对等节点列表（Node ID、Endpoint、状态、角色能力、往返延迟）；
   - `vessel mesh ping <peer-id>`：向目标节点发送心跳并测试往返延迟（RTT）；
2. **`vessel memory` CLI 控制面**：
   - `vessel memory rules [--limit 20] [--category policy_denial|tool_failure]`：列出当前沉淀的自省经验规则；
   - `vessel memory search <query>`：通过 RRF 混合检索快速查找相关经验规则与记忆片段；
   - `vessel memory stats`：展示记忆库大小、规则总数、向量维度与命中频次；
3. **`vessel doctor` 工业级诊断引擎**：
   - 全面自检：Node.js 版本（≥20）、包管理器纯净性（lockfile 唯一性）、SQLite WAL 数据库可写性与完整性、Windows Job Object / bwrap 原生沙箱能力探测、已配置 Provider 凭据与网络延迟（支持超时熔断）、本地 Daemon 驻留状态；
   - 统一输出结构化 ASCII/Unicode 健康诊断看板（带 `[✓]` / `[!]` / `[✗]` 状态与一键修复建议）。

---

## 2. 接口契约规范 (Interface-First)

请在 `apps/cli/src/commands/` 落地挂载 `meshCommand.ts`、`memoryCommand.ts` 与 `doctorCommand.ts`：

```typescript
export interface DoctorCheckItem {
  name: string;
  category: 'runtime' | 'sandbox' | 'database' | 'providers' | 'daemon';
  status: 'pass' | 'warn' | 'fail';
  message: string;
  remedy?: string;
  durationMs: number;
}

export interface DoctorReport {
  timestamp: number;
  checks: DoctorCheckItem[];
  allPassed: boolean;
}

export class VesselDoctorEngine {
  diagnose(options?: { probeNetwork?: boolean }): Promise<DoctorReport>;
}
```

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **薄核（Thin Core）**：禁止修改 `packages/core`；CLI 命令通过 application 层或各包公开导出消费能力。
2. **离线测试与 Mock 隔离**：单元测试绝不进行真实的公网探测，所有网络请求与长耗时探测通过依赖注入或 Mock 桩执行。
3. **回收站纪律**：除在 `os.tmpdir()` 创建的临时目录外，禁止任何硬删除命令。
4. **包管理器锁定**：锁定 npm，严禁引入 `pnpm`/`bun`/`yarn`。

---

## 4. 完成门禁 (DoD)

1. 定向测试通过：
   - `npx vitest run apps/cli/src/commands/meshCommand.test.ts apps/cli/src/commands/memoryCommand.test.ts apps/cli/src/commands/doctorCommand.test.ts`
2. 类型构建通过：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run typecheck:tests` (exit 0)
3. 全量回归测试双 Root 保持全绿：
   - `npm run test:all`

## 本地交付证据（2026-10-03）

最终定向 4 文件 / 18 passed；类型构建与测试类型检查均 exit 0。
双 Root：根 225 文件 / 2554 passed + 6 skipped；Web 16 文件 / 154 passed。
修改清单、日志与运行边界见 [V2.0 交付记录](../docs/V2.0-IMPLEMENTATION-NOTES.md)。未 commit / push，待维护者验收。
