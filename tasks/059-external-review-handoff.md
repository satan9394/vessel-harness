# 059 — External Review Handoff（.vessel/reviews/<id>/handoff.md）

- 状态：待验收
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：058（Internal Review 后接外部评审）；060（UI：Copy Handoff / Open Folder / Import Result）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §9（L1082-1138）：External Review Adapter
  不是 ChatProvider；handoff artifact 存 .vessel/reviews/<review-id>/handoff.md，内容含 Task /
  Acceptance Criteria / Changed Files / Diff Summary / Test Results / Architecture Constraints /
  Review Checklist / Required Output Schema

## 目标

External Review Handoff：把待外部评审的任务打包成 handoff artifact（.vessel/reviews/<id>/handoff.md
+ 相关元数据），并支持导入外部评审结果（用户在 AGY/Gemini 等外部跑完后粘贴/导入 → 落库）。AGY CLI
  不伪装进 ChatProvider——走 artifact 交换而非 API provider。

## 验收标准（执行器逐条勾选）

- [x] Handoff 生成：给定任务+验收标准+改动文件+diff 摘要+测试结果 → 生成
      .vessel/reviews/<review-id>/handoff.md（§9.1 八个 section 齐）+ 元数据（状态/时间戳/来源）
- [x] 结果导入：外部评审结果（met/not_met+意见，形状与 058 内部评审结论兼容）导入并落库，与
      内部评审结论可区分来源（external vs internal）
- [x] 存储走项目既有 ~/.vessel 或项目 .vessel 目录约定（与既有 session/registry 一致）；review-id
      生成与复用既有 id 约定
- [x] CLI seam：能触发生成 handoff（如 vessel review handoff <任务>）与导入结果——最小可测即可，
      UI（Copy/Open/Import 按钮）留 060
- [x] 测试：handoff 生成内容完整/导入落库/来源区分/路径与 id 约定，新增 ≥6 例；全量 vitest/tsc 绿
      （426+前卡新增数 无回归）
- [x] 文档同步（External Review 工作流）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- artifact 交换（生成/导入）+ CLI seam。不把 AGY 当 API provider（明确不做 Local CLI Adapter
  shell hack）；UI 按钮（060）与自动重试（Wave 3）不在本卡。

## 涉及文件（指针，执行器自行精化）

- 项目 .vessel 目录约定与存储（packages/application 或既有 registry/storage）
- 任务/验收标准/改动元数据来源（058 评审上下文 + git 状态）
- CLI（apps/cli 命令 seam）
- 058 评审结论类型（结果形状复用）

## 方法

- 读 §9.1-9.2；handoff 生成/导入走文件 + 元数据，复用既有存储与 id 约定
- 导入结果解析为结构化结论与内部评审同型

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填

### 改动文件（新）

- `packages/application/src/review/ExternalReviewHandoff.ts` —— §9.1 载荷/记录/结果类型
  （ReviewHandoffContent / ReviewHandoffRecord / ReviewResultEntry.source external|internal /
  HandoffCreateInput / ReviewStatus pending→imported）
- `packages/application/src/review/ReviewHandoffStore.ts` —— 目录存储 + 渲染 + 导入：
  - `defaultReviewsRoot()`（缺省 `~/.vessel/reviews`，env `VESSEL_REVIEWS_ROOT` 覆盖）
  - `newReviewId()` = `review_<ts>_<hex>`（既有 `sess_/team_/sub_/del_` 同款约定）
  - `renderHandoffMarkdown()` —— 八 section artifact（metadata 头 + Task / Acceptance Criteria /
    Changed Files / Diff Summary / Test Results / Architecture Constraints / Review Checklist /
    Required Output Schema，空字段占位、结构永不塌）
  - `ReviewHandoffStore.createHandoff / get / list / importResult`；布局
    `<root>/<id>/handoff.md`（生成时快照，import 不重写）+ `meta.json`（记录：id/状态/时间戳/来源
    + 载荷快照 + results[]），meta 写走 tmp+rename 原子替换
  - `importResult`：文本经 `@vessel/agents` `parseReviewConclusion` 解析（058 同一解析器单点）；
    解析失败 = verdict 'error' 如实记录；同型结构化结论（source internal）可并列写入 —— 来源区分
- `packages/application/src/review/index.ts` + `application/src/index.ts` 导出 review 模块
- `apps/cli/src/review/reviewCommands.ts` —— `vessel review <handoff|import|list>`（cmdReview 分发，
  io/root 可注入；root 解析 --root > env > ~/.vessel/reviews）
- `apps/cli/src/cli.ts` —— USAGE 三行 + `first === 'review'` 分发
- `docs/EXTERNAL-REVIEW.md` —— External Review 工作流文档（设计决策表/存储布局/CLI/与 058 同型）
- `docs/INTERNAL-REVIEW.md` —— §5 范围边界补 059 文档指针

### 测试（新增 19 例，全部绿）

- `packages/application/src/review/review-handoff.test.ts`（12 例）：default root / id 约定；
  create 目录布局 + 元数据；八 section 齐；checklist 缺省/覆盖；external met 导入落库 + 跨实例
  读回；叙述+JSON / 垃圾文本→error；not_met unmet/suggestions 与 058 同型；external+internal
  并存来源区分；路径与持久化 round-trip + list 倒序；未知 id / 空 task fail loud；渲染八节独立可用
- `apps/cli/src/review/reviewCommands.test.ts`（7 例）：handoff 生成打印 id/路径；import 落库
  verdict 打印；--source internal 来源区分；list 输出；参数缺失 exit 2；未知子命令 exit 2；
  import 未知 id exit 1；main() 分发 `vessel review ...`

### 验证输出

- `npx tsc -b tsconfig.json` → EXIT=0（无类型错误）
- `npx vitest run` → Test Files 64 passed (64) / **Tests 537 passed (537)**（基线 518 + 新增 19，
  无回归）；EXIT=0
- git 状态：本卡改动 + docs/INTERNAL-REVIEW.md + docs/EXTERNAL-REVIEW.md，一次 commit

### 设计选择与理由

1. **存储层放 application**（`packages/application/src/review/`）：与 SessionRegistry/ProjectRegistry
   同居 registry/storage 层；CLI 与 060 local-server 都经 `@vessel/application` 消费（无需给 cli 加
   agents 依赖边）；application 本就依赖 agents（compose 已用 SubagentManager），复用
   parseReviewConclusion 无新跨层边。
2. **结果同型 + 单点解析**：导入不经新解析器，直接委托 058 的 `parseReviewConclusion`
   （→ evaluator parseVerdict 唯一实现），`ReviewConclusion`/`TeamReviewConclusion` 字段一一对应，
   绝不漂移；解析失败照 058 语义记 verdict 'error'（不误判 met，Generator 不得自证完成）。
3. **来源区分**：记录级 `source:'external'`（handoff 面向外部评审）+ `results[].source`
   external|internal（外部粘贴与 058 内部结论可并存、可按来源筛选回读）。
4. **目录即记录 + 快照语义**：`handoff.md` 只在 create 时生成（复制发送给外部工具的原样 artifact），
   import 只改 `meta.json`（状态/results）—— Open Folder / Copy Handoff（060）读到的就是发送时的
   原版；meta.json 原子写防半写。
5. **review-id 复用既有 id 约定**：`review_<ts>_<hex>`（sess_/team_/sub_/del_ 同款），无新造 id 体系。
6. **明确不做 Local CLI Adapter**：059 只做 artifact 交换 + CLI seam；AGY/Gemini 不作为 ChatProvider，
   无 shell hack（§9.2 Wave 3 前不研究机器调用）。

### 踩坑记录

- 无阻塞性踩坑。tsc/vitest 直跑一次成功（本会话非受限环境）；未触发 EPERM/spawn 重试铁律。
- vitest 基线数字为 518，但本卡实际统计显示 537 = 518 + 新增 19（12 application + 7 cli），
  与任务卡验收行 "426+前卡新增数" 表述的旧基线不同——以当前实际基线 518 为准，全绿无回归。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
