# 128 — `vessel diff`：会话改动的只读提示（G-10 的克制替代）

- 编号：128
- 状态：已合入（2026-09-18）
- 优先级：P3（GAP-MAP 的 LATER 项；非 1.0 门槛）
- 创建日期：2026-09-18
- 关联：`docs/product-evolution/PRODUCT-GAP-MAP.md` LATER（`vessel diff --last` 只读回滚提示）、G-10、`docs/product-audit/CAPABILITY-MATRIX.md` §12/§4.4 项 4、`apps/cli/src/sessions/resume.ts`
- 执行器：指挥侧

## 1. 缺口

G-10（会话级快照/回滚）在能力矩阵里记为"缺面向用户的出口"，而 GAP-MAP 明确把
**`vessel diff --last` 只读回滚提示**列为它的**克制替代**（不做自动 commit、不做 revert）。
此前既无 `diff` 命令，用户也无法在不读原始 JSONL 的情况下知道"这次 run 改了什么"。

## 2. 交付

`apps/cli/src/cli.ts` 新增 `cmdDiff`（`vessel diff [<id>|--last]`），**只读**：

- 复用 `resolveResumeTarget` 解析目标会话（`--last` / 指定 id；未知 id 或日志缺失 exit 2）。
- 从会话日志 `session.jsonl` 读 `tool/call` 记录，聚合 **Write/Edit 触碰的文件**（`path` 或 `file_path`，含出现次数）与**执行过的 shell 命令**；忽略只读工具（Read 等）。
- 附一次工作区 `git status --short`（`spawnSync`，只读）；**不是 git 仓库或 git 不可用 → 给一行提示，绝不报错**。
- `--json` → `{ sessionId, workspaceRoot, touched, shellCommands, gitStatus? }`（stdout 只出一段可解析 JSON）。
- 人类模式末尾显式声明"只读提示，不执行任何回滚"。

## 3. 验收与实测

- 单测 `apps/cli/src/sessions/diffCommand.test.ts`（3 例，经真实 `main()`，`VESSEL_SESSION_ROOT` + 临时工作区注入）：
  - 同一文件 Write+Edit 计 2 次、`file_path` 形式也识别、Read 被忽略、shell 单独列出；`--json` 结构正确；
  - `--last` 取最近一条（注入单调时钟），人类输出含会话 id 与"只读提示"；
  - 未知 id ⇒ exit 2。
  ⇒ **3 passed**。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿、CI 两腿绿。

## 4. 边界（未做，如实）

- **不做自动 revert / checkpoint**：GAP-MAP 与 §6-4 都判定"自动 commit 形态会污染用户历史、与行为受控哲学不合"，克制形态就是只读提示；回滚动作留给用户自己的 git。
- 不解析 shell 命令是否真的改了文件（只列出来，交给用户判断）；不跟踪会话外/并发改动（那是 `git status` 的职责）。
- TUI 斜杠命令（`/diff`）未加。
