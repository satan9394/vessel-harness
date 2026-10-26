# T334 — 执行编排：PDW 迭代 → 四道并行 Codex → 门禁 → 提交 → PDW 复核

- Status: 待执行（2026-10-26；**每步执行前需用户确认**）

## 顺序（严格串行，不跳步）

### 第 1 步：完成 T333（PDW 项目级迭代）

按 `tasks/333-pdw-local-iteration.md` 落地 4 项；`gate-batched.ps1` 只做静态自检（不跑全量），
`pdw doctor` 复核五角色 ready。**完成后停下，向用户报 diff 与 doctor 结果。**

### 第 2 步：重置目录与基线

- 确认工作树里上一轮 Ultra 的 16 项残留仍在（未验收）；
- 用 `gate-batched.ps1` 跑一次当前基线，记录红/绿；
- 红项若不是本轮范围，先记入 `HANDOFF.md`，不顺手修。

### 第 3 步：四道并行 Codex（按 `tasks/332-codex-lanes-plan.md`）

| 道 | 段 | 模型 / 档位 |
|---|---|---|
| L1 | E→F→J→Q→L→P | `gpt-6.1-sol` / `medium` |
| L2 | G→H→K→M | `gpt-6.1-sol` / `medium` |
| L3 | I | `gpt-6.1-terra` / `low` |
| L4 | N | `gpt-6.1-terra` / `low` |

- Fast 关；每道只跑自己的 Verify 命令，不跑全量；
- 收齐后串行跑 L5（`D` 文档段，`gpt-6.1-terra` / `medium`）。

### 第 4 步：全量门禁与收口

- `scripts/gate-batched.ps1` 一次跑完 16 步；
- 红项按升级阶梯（`medium` → `xhigh` → `gpt-6-astra`）定向重跑，每次留失败命令作证据；
- 全绿后按卡拆分提交，同步 `tasks/README.md` 与 `HANDOFF.md` 门禁数字。

### 第 5 步：PDW 只读复核（DeepSeek 侧）

- 建 PDW `audit` 契约：范围=本轮提交的 diff；验收=逐卡 AC + 证据（命令退出码、`path:line`）；
- `review` 角色独立复核，`scan` 只读核对范围与遗漏；
- 复核不通过 → 回退对应提交再修；通过 → 在卡 Result 段记 `accepted_local` 与产物哈希。

## 停止规则

- 第 1/2/3/4/5 步之间都要停下来向用户报一行结果，等确认再进下一步；
- 任一步出现范围变化或需要外部输入，标 blocker，不硬推。

## Result

（待执行）
