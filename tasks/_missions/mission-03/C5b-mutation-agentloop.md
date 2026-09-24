# C5b 变异实测之二：AgentLoop 异常路径（证明 C4① 是绊线，而非橡皮图章）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（C5 如实上报：C4① 尚未被突变证明；不补掉就是留一个"看起来钉住了其实没钉"的用例）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：**blocker**（C5 交证 §5 的诚实缺口）

## 背景（C5 已证与未证）
- **已证**：删 `Telemetry.ts` 的 `case 'turn/end':`（435–445 行）→ ⑯ `:746`、⑰ `:798`、C4② `:325` **三条变红**；删 `:442` 的 `if (this.liveTurnIds.has(r.turnId)) break;` → ⑰ `:790`、C4② `:319` **两条变红**
- **未证**：**C4①（异常路径用例）** 的 Telemetry 侧断言（`replay.turns === 0`、`replay.turns !== live.turns`）在"删 `case 'turn/end'`"下是**重言式**——该场景本就没有 `turn/end` 记录，删不删分支都一样 ⇒ 对那次变异不可判别
- C4① 的真实绊线在：`packages/core/src/agent-loop/AgentLoop.ts:462-463` 的 `else { throw err; }`（不落 `turn/end`）、`:208-212` 的 `before_turn`、以及 `llm/retry{kind:'abort', attemptNo:1}` 的落盘

## 目标
在同款 `%TEMP%` 副本内，变异 **`AgentLoop.ts`** 使"不可重试错误也能收尾并落 `turn/end`"，跑定向 vitest，确认 **C4① 的指定断言变红**；若单点变异做不到，找出**最小可行变异组合**并如实说明。

## 建议的变异方向（可自行选最小者，但须说明理由）
- 把 `:462-463` 的 `else { throw err; }` 改为"记录该轮为错误收尾后继续走到 `:528` 的 `appendSync({type:'turn/end', …})`"，或
- 在 `:462-463` 前插入等价于"该回合仍落 `turn/end`"的最小改动
- 预期变红：C4① 的 `expect(ends).toHaveLength(0)`（`turnEndBoundary.test.ts:189`）、`expect(replay.turns).toBe(0)`（`:210`）、`:211` 的 `not.toBe(live.turns)`

## 硬约束（与 C5 同款，已由 C5 实测出坑）
- **只在副本内变异**；真实工作树零写入（收尾须附 `Telemetry.ts` 与 `AgentLoop.ts` 的 SHA256 前后一致 + `git status --short` 仍 9 项）
- 副本用 `robocopy /E /XJ /XD node_modules dist .vitest .turbo coverage .git` 建；`node_modules` 必须**逐条 Junction**（C5 实证：整目录 Junction 会把 `node_modules/.vite/vitest/results.json` **写穿到真实树**）；`.vite` 刻意跳过
- vitest **≤2 次且都在副本内**，不跑 `tsc -b` / `test:all`
- 不得 install / 改 lockfile / 对真实仓库做任何 git 状态变更 / 删除真实树文件
- 副本清理**走回收站**（回收前先用哑数据排练，确认 Junction 指向的真实目录不被跟随删除）
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）

## 验收标准（客观门禁）
- [ ] 副本路径与创建方式（含逐条 Junction 说明）
- [ ] 变异内容（精确文件:行号 + 逐字删除/替换内容）
- [ ] 变异跑的**原始输出**中：C4① 的哪条断言变红（贴原文）；其余用例的绿/红状态一并如实记录
- [ ] 真实树未被污染：`Telemetry.ts` 与 `AgentLoop.ts` SHA256 前后一致 + `git status --short` 9 项
- [ ] **明确结论**：C4① 是否已被突变证明为绊线（是/否）；若"否"，给出最小可行变异方案与为什么本卡做不到
- [ ] 副本清理情况（回收站）

## 依赖
- 依赖任务卡：C4、C5

## 预期证据（执行器回填）
- [ ] 变异内容与原始失败输出
- [ ] 真实树哈希前后对照 + `git status --short`
- [ ] 绊线结论（含"否"的可能）
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）
- **PASS** → **C4① 已被突变证明是绊线**（两轮独立变异均杀死它）
- 指挥侧独立复验：真实树 `Telemetry.ts` = `A6A0F935D978C261…`、`AgentLoop.ts` = `8085DFF430C131C8…`（均与开工一致）；`git status` 仍 **9 项**、HEAD `ba173d4`；**两道写穿守卫**（真实根与 `apps/web` 的 `node_modules/.vite/vitest/results.json`）mtime 与哈希两轮后均未变；TEMP 零残留；证据 6 件齐全（`C5b-mutation-record.md` 16038 B + 两份日志）
- 变异 A（`throw err;` → 错误收尾，等价"总能收尾"）→ C4① **红在 `:176`**（promise resolved instead of rejecting）⇒ 变异体被杀死
- 变异 B（最小变体：rethrow 前插入一条 `turn/end` append）→ C4① **精确红在点名行 `:189`**（`expected [...] to have a length of +0 but got 1`）
- 比 C5 更严一格（**方法论收获**）：把 `@vessel` 的 18 个子包在副本里指向**副本自身源码**，排除"变异了副本却解析到真实源码"的假阴性
- **残余（已记录、不阻断）**：`:210`/`:211` 因同一 `it()` 内 `:189` 先失败（fail-fast）未被执行；补测法 = 摘掉 `:189`/`:190` 后再跑变异 B（需 1 次 vitest 额度）→ **交由 C7 独立评审判断是否值得补**
- 执行器：子代理 472fad59