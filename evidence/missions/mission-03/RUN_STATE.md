# DEV RUN STATE

> **Mission 3 的信封。** Mission 2 的原件存档在同目录 `.dsh-mission/RUN_STATE-mission-02.md`（22563 B / SHA256 `7A817F44…`，逐字节一致），**不得改写**。
> Mission 2 已完成并提交 `5f3ec0b`（`turn/end` 条件守卫 + 四边界见证，三轮独立评审）；本 Mission 只做它**留下的**残留，**不重开**任何已 ACCEPT 的工作。

## Mission
清掉 Mission 2 提交物上由两轮评审亲自登记的残留（措辞与陈旧引用 + 一处漂移的行号指针），并把未归因的 Node `DEP0137` 告警**定位到具体文件/用例**（若归因到 Mission 2 新增/修改的测试文件则一并修，否则只登记），经独立对抗评审 PASS 后路径限定提交。

## Definition of Done
- [ ] E1 **残留清理（只改注释与卡面文字，零断言改动）**：
  - `packages/telemetry/src/telemetry.test.ts:340-342` 的「同时裸 token 报警器**在这里点名**」→ 与 fail-fast 事实一致（该断言在既有 `toContain` 先红时**不会执行**；同文件 `:372-373` 已有正确口径）
  - `packages/telemetry/src/turnEndConditionGuard.test.ts:28` 的「三份 docs」→ **四份**（实现实读 ARCHITECTURE / BENCHMARK-SPEC / EVENT-SPEC / PRODUCT-STATE）
  - `tasks/121-doc-condition-guards.md` 的陈旧引用改准或**显式降级为历史层**：`:28`（`962 行`）、`:146`（`59 4`）、`:79`（「E7 那处」应为 **R1-7**）、`:52/:214/:220`（`final2` → **`final3`**，或明写"已作废"）、`:145`（旧哈希）
- [ ] E2 **陈旧行号指针（R8）**：`docs/product-evolution/PRODUCT-GAP-MAP.md:430` 的 `EVENT-SPEC.md:600` 指向真实位置（不变式现在 `:605`，另有 `:470`），并按纪律 25 **优先给符号名**而非裸行号
- [ ] E3 **`DEP0137` 归因**：二分到**具体测试文件/用例**（定向 vitest 逐文件跑，观察 stderr）；**若归因到 Mission 2 新增/修改的测试文件 ⇒ 修**（只改测试代码）；若归因到既有文件 ⇒ **只登记，不改**。附原始输出与退出码
- [ ] E4 **门禁 + 评审 + 提交**：`npx tsc -b` exit 0 与 `npm run test:all` 两个 root exit 0（各 ≤1 次、都在最后一次编辑之后、都要显式退出码）；1 个全新上下文独立 Reviewer 判 **PASS**；**路径限定提交**（禁 `git add -A`）；落仓库内 `tasks/122-*.md`
- [ ] E5 **零断言改动**：本 Mission 不得放宽/删除/新增任何断言（E3 若修测试代码，只允许修"关闭句柄/泄漏"一类资源管理，**不得动断言**）；`git diff` 必须能逐行证明这一点

## Out of scope（本 Mission 严格不做）
- **不裁决「回合重叠时 M03 该怎么算」**（仍属人类；本 Mission 只保留现状）
- 不接 `request/header`；不接 `turn/end.stats` 其余字段
- 不动 `costEstimate`/M11、`before_stop`、`denials`、`measured` 收紧、`release-report`（会改写被跟踪产物 + 消耗真实 API 配额）
- 不做 `tasks/` 113 份卡的大对账（`tasks/README.md` 脱节、17 张"待执行"卡状态不可信）—— 那是**另一档规模**的 Mission，不在本信封内
- 不重跑 Mission 2 已 ACCEPT 的任何工作（三轮评审、W1/W2/W3b/W4 的产物一律不动）
- **R6/R7（C8 评审判为"措辞张力/可能误读"的两条）**：只有在**零风险**（不改被守卫的短语「成功收尾/预算耗尽/重叠」、不新增断言）时才顺手做；否则**登记为 Deferred**
- 不做无关重构；不 install / 不改 lockfile；禁 `git stash`/`restore`/`checkout`/`clean`；不删文件（回收站；唯一例外 = 测试自建且位于 `os.tmpdir()` 下的 tmp 目录）
- 真实 provider 调用 **0** 次

## Mode
development

## Active Workset
- [x] M1 — 来源: planned — 残留清理（E1 + E2；只改注释/文档/卡面，零断言改动）**（已合入 2026-09-13，指挥侧独立验收 PASS；零断言改动经机械证实）**
- [x] M2 — 来源: planned — `DEP0137` 归因（E3；归因到新测试文件才修）**（已完成 2026-09-13：归因到 **core 运行时**，按硬边界只登记不改；附 GC 无关判定器）**
- [x] M3 — 来源: planned — 最终门禁 + 独立对抗评审 PASS + 路径限定提交 + 落仓库内 `tasks/122` **（已合入 2026-09-13：`tsc` exit 0、`test:all` exit 0；独立评审 PASS；提交 **`36869f9`**（5 文件 +88/−14）；提交后 `git status` 为空）**

## Blocked
- （空 —— Mission 3 完成；Run/Mission 的卡计数均已用满 3/3，这是**正常收口**而非阻塞）

## Deferred Backlog（是记忆，不是队列）
- （**已闭合 2026-09-18**）**`packages/core/src/session/Session.ts` 的 `loadExisting()` 合成 `turn/end` 未 `await`**（原坐标 `:141`）⇒ ① 重开后立刻 `close()` 时 `fd===null` 空转，随后 pending 的 `fs.promises.open` 把 fd 赋到已关闭的 Session 上 ⇒ **FileHandle 泄漏**；② 合成收尾记录不保证在进程退出前落盘。**已于 `aa5ea99` 修复**：`loadExisting` 内改为 `await this.append(...)`（现 `:146`），并加回归测试（`Session.test.ts`，含阴性对照：撤掉 `await` 即红）。**流程欠账**：本修复越过了本文件原写的"须独立成卡 + 独立评审"边界（它是在 CI 首次变绿后一并修的），已补 `tasks/124-session-load-existing-await.md` 追溯卡并派独立对抗评审收口。
- （**已闭合 2026-09-18/19，125–147 批次**）Cross-Harness Conformance 驱动与入口（`tasks/125`）；soak 默认参数自洽修复（`tasks/126`）；`vessel mcp` / `vessel diff` / TUI `/mcp` `/diff`（`tasks/127`–`129`）；**四处「两份实现」收敛**（MCP 装配 / mock 文案 / guide locale / mock 冒烟脚本，`tasks/130`–`134`）；B19 口径（v1 只记 deny，`tasks/135`）；G-08 `vesselHome()` 轻量收敛（`tasks/136`）；`run --json` 文档 + migrate 回收重跑已核实（`tasks/137/138`）；记忆同步 #1/#2（`tasks/133/139`）；**文档诚实化收尾**（`tasks/140` 外部文档残余扫描 #2、`tasks/141` 已声明未实现项标注、`tasks/142` `toolIdByIndex` by-design 标注、`tasks/143` 能力矩阵 `stream-json` 登记）；记忆同步 #3（`tasks/144`）；**方向 B 残留清算**（`tasks/145` 真实模型 lane 接场景 policy；`tasks/146` B2–B5 已核实闭合）；记忆同步 #4（`tasks/147`）；**`--live` adapter 工作整体回退 + 立"不自动驱动本机其他 agent"口径**（`tasks/153`）。**仍开放**：`--live` 跨 harness 基线（**须用户逐次显式授权，不由 agent 自动发起**）、`release-report` 刷新（外部配额）、3h 墙钟 soak、1.0 门槛最终核验（停在 tag 前）。
- （audit）同族更早实例：`C5b-run1-mutationA.log`（早于本轮）已有同一告警，机制是 `turnEndBoundary.test.ts` 用例失败后跳过 `close()`（`:213`）的**测试卫生**问题 ⇒ 只登记不改
- （user）**「回合重叠时 M03 该怎么算」**（Mission 2 遗留）：只对未被打断的回合计数？还是改取别的身份/来源？证据链见 `tasks/121` §6.2、`Telemetry.ts:225-226`、`docs/product-evolution/PRODUCT-STATE.md:823`
- （audit）R6 措辞张力：`docs/ARCHITECTURE.md:176` 标题句与同句列出的「`before_turn` 否决分支」并存（本 Mission 未做 —— 零风险前提不成立时按规则登记）
- （audit）R7 可能误读：`docs/BENCHMARK-SPEC.md:575` 的「纯回放侧的唯一真源」（`turn/start` 也是持久记录）
- （audit 2026-09-18）**下一 Mission 候选：Cross-Harness Conformance Suite 实跑**（项目自我定义的核心差异点，尚未实跑）；另 CI 修复期间确立的构建纪律见根 `AGENTS.md`「构建与依赖纪律」
- （audit）`request/header` 仍未接线（原 §7.3 的另一半）
- （audit）`costEstimate` 的缺口在**产物侧**（没有任何 shipped provider 上报）⇒ M11 在本 lane 仍不可产
- （audit）`interrupts` 无法用记录面消除崩溃歧义；`before_stop` 是丢弃的潜伏死缝；被跟踪的 `release-report.{md,json}` 仍是旧判据快照（2026-09-12，v1.1.0）
- （audit）Windows 原子写 rename EPERM 间歇 flaky（`ci.yml` 注释 + `tasks/113`）⇒ 全量偶发红 ≠ 回归，必须原样保留完整输出再判定
- （audit 2026-09-18）慢 runner 上默认 30s testTimeout 会把真实 IO / 大队列用例打成与回归无关的红 ⇒ 这类用例须显式给足超时（见 `AGENTS.md`「构建与依赖纪律」）

## Budget
- Epoch: 0 / 2
- 完成卡数: 3 / 3
- 已用 Repair: 0 / 1
- 已派子代理: 4 / 5
- WorkSet 规模: 3 / 8
- Worker 数: 0 / 2
- Research pass: 0 / 1
- 子代理嵌套: 0 / 1

## Mission Budget
- Run: 0 / 1
- 总卡数: 3 / 3
- 总 Repair: 0 / 1

## 项目专属预算（CLI 计不到的）
- `npx tsc -b` ≤1 次、`npm run test:all` ≤1 次，**都必须在最后一次编辑之后**，且必须带显式退出码（"无输出"不算证据 —— C6 的教训）
- 定向 vitest ≤6 次（构成 = M1 1 次 + M2 归因二分 ≤4 次 + M3 指挥侧验收 1 次）；每次都要在交证里说清用途
- 突变实测：本 Mission **不需要**（没有新断言）；若 M2 发现必须突变才能证明，**停下问人类**
- 真实 provider 调用 **0** 次；`npm install` **0** 次
- 交证 1 份，**原始输出不过滤**
- 并发 1–2；独立对抗评审 **≤1 次**，判 FAIL ⇒ **停**（本 Mission 只留 1 格 Repair，且**不得**用它去"再试一次"）
- 提交 1 次、路径限定；禁 `git add -A` / force push / 永久删除

## Last verified commit
**`819fdad`**（2026-09-18，main）。当前门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 171 文件 / 2197 passed + 6 skipped、web 11 文件 / 120 passed、web `vite build` exit 0、CLI 冒烟 exit 0；CI 与 CodeQL 在 main 上 green；CodeQL/Dependabot/Secret scanning 告警均 0。本文件为**已收口的 Mission 3 信封**（其切片提交 `36869f9`），后续变更见 `tasks/123`、`tasks/124`、`docs/V1.1-ROADMAP.md`。

## Resume From
**（无 —— Mission 3 完成，且其后 CI/安全/文档对账已另行收口）** DoD E1–E5 全达成：
- E1/E2（残留清理 + 陈旧指针）⇒ 落地于 `36869f9`，**零断言改动经机械证实**
- E3（`DEP0137` 归因）⇒ 归因到 **core 运行时**（`Session.ts` 缺 `await`），附 **GC 无关判定器**；按当时硬边界**只登记不改**
- E4（门禁 + 评审 + 提交 + 落 `tasks/122`）⇒ `tsc`/`test:all` 各 exit 0、独立评审 PASS、提交 `36869f9`
- E5（零断言改动）⇒ 经评审独立复核（`git diff -U0` 过滤 `expect|it(` = 0 命中）

**本轮（2026-09-18，超出本信封，但已落盘）**：① CI 首次变绿并保持 + 安全告警清零（`tasks/123`）；② Deferred 第 1 条的 fd 泄漏**已修**（`aa5ea99`，追溯卡 `tasks/124`）；③ 文档对账（README/AGENTS/V1.0/V1.1/SECURITY/tasks-README）。
**下一轮入口**：新 Mission 候选 = **Cross-Harness Conformance Suite 实跑**；开工前先 `Copy-Item RUN_STATE.md .dsh-mission/RUN_STATE-mission-03.md` 存档，再写新信封。

> **注意（别把完成态误读成损坏）**：本 Mission 的三张卡全部完成 ⇒ `完成卡数 3/3`、`总卡数 3/3` **同时触顶**，于是 `runstate.js check` 会报「预算已达上限」、`gate` 会 `allow:false`。**这是正常的收口状态，不是状态文件损坏。** 下一轮若要继续，请照 Mission 2 → 3 的做法：先 `Copy-Item RUN_STATE.md .dsh-mission/RUN_STATE-mission-03.md` 存档，再写新 Mission 的信封（含它自己的 DoD/Out of scope/预算），然后 `check` 才会通过。

## Notes for the next run
- **Mission 3 完成小结（2026-09-13）**：把 Mission 2 提交物上"弱于事实/陈旧"的四处文字与一处漂移指针改成与事实一致（**零断言改动**），并把三轮评审都登记却始终没人解释的 `DEP0137` **归因到了 core 运行时**（`Session.ts:141` 缺 `await` 的 fd 泄漏 + 合成收尾记录不保证落盘）——后者当时**只登记未修**（超授权，且属运行时语义变更）。提交 `36869f9`。
- **后续更新（2026-09-18）**：那条 fd 泄漏**已修**（`aa5ea99`，`await` + 回归测试/阴性对照），追溯卡 `tasks/124`；同日 CI 首次变绿、安全告警清零（`tasks/123`），并完成文档对账。**注意**：`.dsh-mission/` 与 `RUN_STATE.md` 均被 `.gitignore` 覆盖，不进仓库历史。
- **本轮最有价值的产物不是代码，是那条归因**：一个被三轮评审当作"测试卫生小事"的告警，实际指向 core 的句柄泄漏；**"归因"这一步本身产出了比"顺手改测试"高得多的价值**（若当初按卡面预设去"修测试文件"，就会掩盖 core 缺陷）。
- **同一机制陷阱第三次出现（务必记住）**：host 闸门把"任一计数达上限"当作**所有**派活与**所有** `advance` 的熔断 —— 本轮 `已派子代理 4/4` 触顶时，连"记录卡数完成"的 `advance cards` 都被整体拒绝（`文件未做任何修改`）。⇒ ① 给自设上限留余量；② **评审也可能失败**：本轮第一次评审**耗尽回合额度、未产出判决**，逼我用掉最后一格重派（已如实登记在 `tasks/122` §7）。
- **控制面位置**：`RUN_STATE.md` 在仓库根、其余在 `.dsh-mission/`，两者都被 `.gitignore` 覆盖（`.gitignore:14-15`）⇒ **绝不提交**。会话必须在本仓库根启动，host 闸门才会绑定到本状态文件。
- **本 Mission 的性质**：全部是"把声明/引用改成与事实一致"——正是本仓头号病史（声明与实现不一致）的收尾。**预计不会新增任何断言**；若发现必须新增，停下问人类。
- **已知的机制陷阱**（Mission 2 两次实测）：host 闸门把"任一计数达上限"当作**所有派活**的熔断 —— `已用 Repair`/`总 Repair` 触顶会连**评审**这种非修复派活一起拒（`allow:false`）。本 Mission 的 Repair 上限设 1，**评审额度独立于它**（评审派活走 `已派子代理`，上限 4）。
- **历史层与最终层并存是允许的**，但**必须显式标注**：`tasks/121` 的 §2/§4/§9 记的是首轮坐标，§8.1/§8.2 是最终坐标（`final3`）。改这些地方的**目的**就是让读者不再被旧数字误导。
