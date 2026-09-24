# C6 收尾前半：最终门禁 + 落 `tasks/120` 卡 + 冻结当前 diff

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：P0
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：planned（依赖 C2/C3/C4/C5/C5b；提交留给 C7）

## 目标（三件事，顺序固定）
1. **冻结当前 diff**（供 C7 的全新上下文评审当唯一评审对象）：
   - `git diff > <mission>\backup\turn-end-slice-final.patch`（**当前工作区全量 diff**，含 C2/C3 收窄后的内容；用 git 自带 `diff --output=` 避免管道转写）
   - 把新增的未跟踪测试文件 `packages/telemetry/src/turnEndBoundary.test.ts` 原样拷进 `<mission>\backup\`
   - 记录补丁与副本的 SHA256、字节数
   - 保真性校验：`git apply --check --reverse <final 补丁>` → **exit 0**
2. **跑最终门禁**（E4）：`npx tsc -b`（exit 0）与 `npm run test:all`（两个 root exit 0）
   - **必须在最后一次编辑之后**；tsc ≤1 次、test:all ≤1 次
   - 全量偶发红**不等于**回归（Windows 原子写 rename EPERM flaky 有 CI 注释与 tasks/113 记录）⇒ 必须**原样保留完整输出**再判定，不得先过滤
3. **落卡** `tasks/120-turn-end-telemetry-slice.md`：按项目既有卡格式（参考 `tasks/` 里既有卡与 `AGENTS.md` 约定）写清：
   - 目标与验收标准
   - 证据指针：`docs/ai/evo` 之外的关键证据位置、`_review` 报告、两份 mutation record（`C5-mutation-record.md` / `C5b-mutation-record.md`）
   - **完整链路**：独立验收 FAIL（三处被证伪断言）→ 收窄（C2）→ 连带矛盾（C3）→ 判别性用例（C4）→ 突变实测证明绊线（C5/C5b）→ 待 C7 独立重评后提交
   - 明确登记未闭合项：`telemetry.test.ts:81` 的过时指针；"回合重叠时 M03 该怎么算"的口径裁决属人类；C4① 的 `:210`/`:211` 因 fail-fast 未单独实测（可接受，理由与补测法一并写下）

## 限制条件 / 禁止事项
- **不得再改运行时源码或测试**（本卡只做冻结/门禁/落卡）；**若门禁红**：停下把原始输出交回来报告，**不得**自行改实现或放宽断言
- 不得 install / 改 lockfile；不得 `git add/commit/stash/restore/checkout/clean`（提交是 C7 的事）
- 不得删除文件；命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）
- 只允许新增：`<mission>\backup\turn-end-slice-final.patch`、`<mission>\backup\turnEndBoundary.test.ts`、`tasks/120-turn-end-telemetry-slice.md`

## 验收标准（客观门禁）
- [ ] final 补丁存在 + SHA256/字节数；`git apply --check --reverse` **exit 0**
- [ ] `npx tsc -b` exit 0（贴输出）
- [ ] `npm run test:all` 两个 root 均 exit 0（贴两个 root 的汇总行与退出码；若出现 flaky，原样保留输出并说明）
- [ ] `tasks/120-turn-end-telemetry-slice.md` 存在、格式合规、含上述四项内容
- [ ] `git status --short` 恰为 **10 项**（原 9 项 + `tasks/120`），运行时源码未再改动
- [ ] 未 commit（`git log -1` 仍是 `ba173d4`）

## 依赖
- 依赖任务卡：C2、C3、C4、C5、C5b

## 预期证据（执行器回填）
- [ ] final 补丁哈希 + reverse-check 输出
- [ ] `tsc -b` 与 `test:all` 的原始输出与退出码
- [ ] `tasks/120` 全文（或要点 + 行数）
- [ ] `git status --short` 与 `git log -1`
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）
- **PASS** → 自动合入（**E4 达成**：最终门禁在最后一次编辑之后全绿）
- 指挥侧独立复验：
  - 冻结产物：`turn-end-slice-final.patch` **46803 B / `6C01A6E4…26CCA`**；`turnEndBoundary.test.ts` **16334 B / `56F413C9…BBF86`**；**我亲自跑** `git apply --check --reverse` → **exit 0**
  - 门禁日志：根 **169 files / 2179 passed + 6 skipped**；`apps/web` **11 files / 120 passed**；`tsc -b` 日志 **0 B**（无输出=成功）——单次全量即过，**无 flaky、无先过滤**
  - `tasks/120-turn-end-telemetry-slice.md` **154 行**已落盘；`git status` 恰 **10 项**；`HEAD` 仍 `ba173d4`（**未提交**，留给 C8）
  - `git diff --numstat` 与 C4 后逐字一致 ⇒ **本卡运行时源码与测试零改动**
- 相对基线 168 文件 / 2177 passed 的增量恰好是 C4 新增测试文件的 2 条用例（+1 文件 / +2 用例）——**增量可解释**
- 刻意偏差（已披露）：日志落在 Mission 侧 `evidence\`，项目仓库内只新增 `tasks/120` 一份
- 执行器：子代理 d74ee4dd