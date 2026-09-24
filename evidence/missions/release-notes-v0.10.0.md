# Vessel v0.10.0 — 产品化第一里程碑 / First productisation milestone

**中文** — Vessel（器）是一个**本地优先、模型无关、可组合**的 Agent Harness：核心是一条足够薄的状态机（Model Call → Tool Call → Tool Result → State Update → Continue/Stop），行为由可版本化的 **Behavior IR** 编译进每个 agent 的 stable system，安全规则由 **Policy 硬执法**（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event）而不只是写在 prompt 里，并配有 CLI 与本地 Web 双表面。器可以一件件换掉，系统不因此失效。

**English** — Vessel is a local-first, model-agnostic, composable agent harness. Its core is a deliberately thin loop (model call → tool call → tool result → state update → continue/stop); behaviour is compiled from a versioned **Behaviour IR** into every agent's stable system; safety rules are **enforced**, not merely suggested (prompt guidance + tool interceptor + runtime deny + audit event); and it ships a CLI with a local web surface. Every component is replaceable without the system failing.

---

## 本版内容 / In this release

### Added

- 统一产品版本号 `0.10.0`（原 `apps/cli` 的 `0.1.0` 对齐）与干净安装基线。
- 抽离 `@vessel/application` 组合根（`composeHarness`），CLI 组合入口可移植。
- `SessionController` / `ProjectRegistry` / `SessionRegistry`：会话与应用层可编程接口。
- 一次性状态迁移命令 `vessel migrate`：`~/.dsh` → `~/.vessel`（数据复制 + 旧目录进回收站）。
- `vessel serve`（本地服务 `127.0.0.1:5678`）与 `vessel web`（起服务并打开浏览器）。
- 公开产品文档：`README.md`、`LICENSE`、`SECURITY.md`、`CHANGELOG.md`。

- One product version (`0.10.0`) and a clean-install baseline; the composition root extracted into `@vessel/application`; session/project registries for the app layer; `vessel migrate` (`~/.dsh` → `~/.vessel`); `vessel serve` / `vessel web`; and the public documents.

### Changed

- 项目状态与用户配置根目录由 `~/.dsh` 迁移到 `~/.vessel`；环境变量 `CAH_*` → `VESSEL_*`。
- CLI 帮助文本、版本号、存储路径全面对齐 Vessel 命名。

- State and user configuration moved from `~/.dsh` to `~/.vessel`, environment variables from `CAH_*` to `VESSEL_*`, and the CLI help/version/paths aligned with the Vessel naming.

---

## 跑起来 / Run it

```bash
git clone https://github.com/satan9394/composable-agent-harness.git
cd composable-agent-harness
npm install
npm run build              # tsc -b

# 无需任何配置即可跑（内置离线 mock，不发网络请求）
npm run vessel -- run --prompt "说一句你好"
npm run smoke              # 等价的离线冒烟（用已编译产物）

# 接真实模型
npm run setup              # 交互向导：选供应商 → 输 key → 拉模型 → 设为默认
# 或
npm run vessel -- provider add deepseek --protocol openai-compatible \
  --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
npm run vessel             # 无参进交互 TUI

# 让 vessel 命令全局可用
npm link ./apps/cli
```

**验证门禁（在本 tag 对应的提交上实测）**：`npm run build` exit 0；`npm run test:all` ⇒ 根 **171 文件 / 2195 passed + 6 skipped**、`apps/web` **11 文件 / 120 passed**；`npm run smoke` ⇒ `kind=success`。

**Gates verified on this commit**: `tsc -b` exit 0; the two-root suite at 2195 + 120 passing; an offline CLI smoke returning `kind=success`.

---

## 已知边界 / Known boundaries

- Web 界面（`vessel serve` / `vessel web`）仍在推进，不是本版重点。
- `benchmarks/reports/release-report.{md,json}` 是历史快照，未随最近改动刷新。
- Windows 上未接入 job object 时，进程树沙箱在遥测里**如实报 `degraded`**（不假装已隔离）。
- 本仓库自 2026-09-13 起才推送到 GitHub；更早的历史提交保留在 git 历史里，但当时没有打 tag —— 版本对应关系以 [`CHANGELOG.md`](https://github.com/satan9394/composable-agent-harness/blob/main/CHANGELOG.md) 为准（V0.1 → V0.10，每版中英双语）。

- The web surface is still in progress; the tracked release report is a historical snapshot; the process-tree sandbox reports `degraded` honestly when the Windows job object backend is not attached; and this repository was first pushed on 2026-09-13, so the version map comes from the CHANGELOG rather than from historical tags.

**完整版本历史（中英双语）**：[CHANGELOG.md](https://github.com/satan9394/composable-agent-harness/blob/main/CHANGELOG.md)

---

## npm

```bash
npm install -g composable-agent-harness
# 或免安装：npx composable-agent-harness --version
```nn
CLI 自包含单文件、**运行时零依赖**：<https://www.npmjs.com/package/composable-agent-harness>

