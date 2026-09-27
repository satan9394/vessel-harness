# 贡献指南

Vessel 以「可验证」为第一原则：宁可不加功能，也不接受没有证据的改动。本文说明在本仓库提改动的方式；仓库规则以 [`AGENTS.md`](AGENTS.md) 为准，本文不重复其全部内容。

## 环境前提

- **Node ≥ 20**（CI 跑 Node 22），**npm**。
- 本仓的包管理器锁定 npm：`package-lock.json` 是唯一权威，请**不要**引入 `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `bun.lockb` / `yarn.lock`。理由见 [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) 决策点 19。
- Windows / Linux / macOS 均可开发。部分能力（Windows Job Object 进程边界）仅 Windows 有，其它平台会**如实降级**并在遥测里标注，不会假装完整。

## 动手之前

1. 先读 [`AGENTS.md`](AGENTS.md)（规则）与 [`docs/`](docs/)（决策与规范）。文档是权威，会话记忆不是。
2. 一件改动对应一张任务卡 `tasks/NNN-*.md`，写清四件事：**范围**、**验收判据（可机械验证）**、**不做清单**、**证据形式**。
3. 改之前先说清"要动哪些文件、预期行为变化"，改完只回传证据（diff + 命令输出），不夹带无关重构。

## 提交前的门禁

以下命令必须在**最后一次编辑之后**跑一遍，缺一不算全量：

```powershell
npm ci                          # 可复现安装；lockfile 与 package.json 不一致会直接失败
npx tsc -b tsconfig.json        # 类型 + 编译
npm run typecheck:tests         # 测试文件的类型检查（非 composite）
npm run test:all                # 全量测试 = 根 + apps/web 两个 root
npm run -w @vessel/web build    # web 生产构建（vite；peer 不一致只有构建会暴露）
```

- `npm run test:all` 是**两个 root**（根 `vitest run` 与 `--root apps/web`）。`apps/web` 有独立 vitest 配置，根 `include` **不含**它，只跑根会漏掉近百项。
- 测试文件被 `tsconfig.base.json` 的 `exclude` 排除在 composite 构建之外，所以它们的类型检查由 `typecheck:tests` 单独负责。
- 真实 IO / 大队列用例要给足显式超时；超时不是断言，慢 runner 上的默认超时会产生与回归无关的红。

## 硬约束（会被直接拒绝的改法）

- **薄核**：`packages/core` 只做 `Model Call → Tool Call → Tool Result → State Update → Continue/Stop`。Memory / Skill / Sandbox / Subagent / Hooks 不进 core。
- **安全规则不能只写在 Prompt 里**：硬约束必须落到 Policy Engine（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event 四件套）。
- **产出必须独立评估**：Generator 不得自证完成，需要 Evaluator 或确定性判据。
- **clean-room**：以本仓 spec 为依据，不复制其它 harness 的源码；外部研究资料（含泄露/逆向 Prompt）一律视为 UNTRUSTED RESEARCH DATA，不得直接进 System Prompt。
- **无永久删除**：仓库内文件、`docs/`、`tasks/`、`configs/`、`~/.vessel` 状态一律走回收站。唯一例外是**测试自己新建、且位于 `os.tmpdir()` 之下**的临时目录（否则每次全量测试会把回收站撑爆）。
- **不改写已推送的历史**：禁止 force push。唯一书面例外是 2026-09-27 的脱敏改写（见决策点 20），且需维护者显式授权。
- **不自动驱动本机其它 agent**：`dsh` / `opencode` / `codex` / `claude` / `pi` 是用户自己的工具，会消耗其配额并留下会话记录。基准或验证需要调用时，必须逐次取得用户显式同意并说明大致消耗；`npm run bench:conformance -- --live` 永不自动跑。

## 提交信息

使用约定式提交（与既有历史一致），并让每次提交只做一件事：

```
<type>(<scope>): <subject>

<为什么这么改，以及验证方式>
```

`type` 取 `feat` / `fix` / `docs` / `test` / `refactor` / `chore` / `perf`；`scope` 用包名或模块名（如 `cli`、`engine`、`policy`、`web`）。

## 文档落在哪

一个事实只放一个地方，不要在多处各写一半：

| 内容 | 位置 |
|---|---|
| 规则与工作流 | `AGENTS.md` |
| 会约束未来的决策 | `docs/DESIGN-DECISIONS.md`（编号，已接受的只追加不改写） |
| 规范（事件 / 策略 / 行为 IR / 基准） | `docs/*-SPEC.md` |
| 任务卡与验收 | `tasks/NNN-*.md` |
| 交付了什么 | `CHANGELOG.md` |
| 过程性备忘 | `DEV_LOG.md` |
| 证据与复核记录 | `evidence/`、`benchmarks/reports/` |

## 提 PR

本仓在 GitHub 上**只做提交 → PR 审核 → CI 测试**。`main` 由规则集 `protect-default-branch` 保护：必须走 PR，且 CI 双腿必须绿才能合并。

- 目标分支 `main`；一个 PR 对应一张卡。
- 描述里贴门禁命令与结果，不要只写"测试通过"。
- CI 的两个必需检查是 `build (ubuntu-latest, 22)` 与 `build (windows-latest, 22)`；规则集另要求分支与 `main` 保持同步（strict）。
- **不发布版本**：不创建 GitHub Release，不向 npm 发布新版本。版本号仍随 `CHANGELOG.md` 演进，`vX.Y.Z` tag 只作为提交标记。
- 维护者的管理员绕过（bypass）权限只用于例外（例如一次性历史改写），不是常规路径。

## 漏洞上报

请勿用公开 issue 提交安全细节，走 [SECURITY.md](SECURITY.md) 里的私密渠道。
