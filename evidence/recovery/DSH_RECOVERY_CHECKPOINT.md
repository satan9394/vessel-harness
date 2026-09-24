# DSH Recovery Checkpoint

## 1. 原始目标
以 Product Evolution Orchestrator 身份自主推进 Vessel 产品演进：按 `docs/product-evolution/PRODUCT-GAP-MAP.md` 选下一片已具证据的缺口，走「拆卡 → 派隔离 Worker → 指挥跑真实证据 → 全新上下文对抗 Evaluator → 按 REJECT 修 → 复评」，每轮更新 PRODUCT-STATE 与路线图。

## 2. 已完成
- 本区间（Round 58→177）共 **103 个提交**，**全部已提交**，HEAD = `ba173d4`。
- 关闭五条主线：① 静默丢数据（两个 provider 流式解析的身份改写/覆盖、`{}` 种子、截断半帧、重复 `content_block_start` 全部形态）；② 失败被上报为成功（`kind='error'` 的全部已识别消费面、`length` 截断信号、BeforeTurn 拦截、mock 标记口径）；③ 口径收敛（`kind→stopReason`、`finishReason` 唯一表、CLI/TUI 判据、10 个状态根 + 1 个数值参数的环境变量读法）；④ 可观测性（`before_turn` 审计、流诊断计数、M13/M14 生产者、`llm/retry`/`request/header` 持久记录）；⑤ 描述与事实一致（文档/注释/判据表/守卫）。
- 收尾前实测：`tsc -b tsconfig.json` 干净；`npm run test:all` **exit 0** ⇒ 根 **2175 passed + 6 skipped**、`apps/web` **120 passed**（对照本段起点：根 138 passed / 1555 收集，`apps/web` 当时从未被跑过）。
- 三次独立对抗评审结论已落盘（`PRODUCT-GAP-MAP.md`），纪律 21–27 已写入 `PRODUCT-STATE.md`。

## 3. 当前代码/文件状态
- 工作树**干净**（`git status --short` 无输出、`git diff --stat` 为空）；HEAD = `ba173d4`。
- 本段主要改动模块：`packages/llm`（流式解析/唯一归一表）、`packages/core`（AgentLoop 记录与审计）、`packages/shared`（`envRoot`、事件类型、未接线守卫）、`packages/telemetry`、`apps/cli`、`apps/web`、`benchmarks/runners`、`configs/policy.default.yaml`。
- 关键记录文档：`docs/product-evolution/PRODUCT-STATE.md`（纪律 + 队列 + Round 175 最终交接 + Round 177 新账）、`docs/product-evolution/PRODUCT-GAP-MAP.md`。

## 4. 已知未完成
1. **四条需人类裁决**：`--model ''` 挡住 `VESSEL_MODEL` 回落；真实 provider 全链无 model 时发字面量 `"mock-model"`；`denials`/M12 在实跑里是真实拒绝数的 2 倍；`measured` 双向对账是否从 warn 收紧成 fail-loud。
2. `request/header` 与 `turn/end.stats` 加法字段仍无回放消费方（已如实标注，未接线）。
3. `compaction/summary`(B15)、`session/end-seed`(B11)、`audit/safety`(B21)：有声明、零类型零产零消（守卫已加，接线时会先红）。
4. `§3.1` 的 B006/B014 卡仍用未实现的 `claim_truthful`；`B003` 隐藏测试在 `scenarios/` 而非 `fixtures/`，与 §2.1 目录契约相悖。
5. 被跟踪的 `benchmarks/reports/release-report.{md,json}` 仍是旧判据快照（按纪律 27 应重跑刷新，非手改）。

## 5. 当前风险
1. 直接编辑生成物会掩盖"判据已改、产物未刷新"的不一致 ⇒ 现已用文档指引而非手改（纪律 27）。
2. 把 `measured` 收紧成 fail-loud 会打红 25 个场景里的 23 个，必须先补声明或补生产者。
3. `denials` 双计是既有语义（消费方用 `Math.max` 绕行），改它要动既有 `denials=2` 用例。
4. 重跑发布门禁会改写被跟踪产物**并调用真实模型接口**（消耗外部配额）。
5. 本会话上下文已接近上限，在同一会话里继续推进有质量下降风险 ⇒ 建议新会话接手。

## 6. 后台任务处理
- 已中断的 Subagent：**0 个**（`list_agents(scope="descendants")` 显示全部为 `ready`，**无 `running`**）。
- 已终止的 Job：**0 个**（`job_list` 显示全部 `completed`，**无 `running`**）。
- 无法确认的后台任务：**无法确认**是否存在本会话控制面之外的残留进程（按协议未做进一步检查）。

## 7. 推荐下一步
1. 先拍板 §4.1 的四条决策（其中 `measured` 收紧需先补声明/生产者）。
2. 若要继续工程欠账：先接 §4.2/§4.3 的消费者或标注，再清 §4.4 的文档一致性。
3. 若要刷新 `release-report`：单独执行并按纪律 27 处置产物（有意提交或写回 HEAD，不要 `git add -A`）。

## 8. 恢复方式
下一次新会话开始时：
1. 先阅读本文件
2. 再阅读必要的项目入口文件（`AGENTS.md`、`docs/product-evolution/PRODUCT-STATE.md`）
3. 只选择一个明确任务继续
4. 不自动恢复此前的全面审计循环
