# V0.3 独立核验报告（Evaluator Review Report）

> 核验对象：Composable Agent Harness V0.3 实现（docs/MISSION-V0.3.md 第六节 7 条验收标准）
> 核验角色：独立 Evaluator（Generator/Evaluator 分离——本报告只做取证核验，不参与实现、不修改实现代码）
> 核验日期：2026-09-05
> 工作区：`C:\work\Vessel_Harness`（Windows / PowerShell / Node v24 / vitest 2.x）
> 权威依据（已通读）：docs/MISSION-V0.3.md（§3 范围 / §4 硬性约束 / §6 验收）、docs/V03-IMPLEMENTATION-NOTES.md（实现方自述——以下每条独立实测验证，不采信自述）、docs/REVIEW-REPORT-V02.md（V0.2 基线 104 测试）、docs/DESIGN-DECISIONS.md（决策点 10/11）、docs/ARCHITECTURE.md（§4.8/§4.9）。

---

## 〇、总体结论

**VERDICT: PASS**（无阻断、无 MAJOR）

V0.3 五项范围（Project Memory / Persistent Memory / Skills 正文注入 / Skill Scope·Search·Provenance / 自动学习 suggest-only）全部为真实实现，有实质机器断言测试；V0.2 的 104 测试无回归（全量 146 全绿），B001–B005/B016–B019 无回归且新增 B020/B021 可跑可过；薄核与依赖零环保持；EVENT-SPEC 事件词汇已同步。记录 3 条 MINOR（均文档/边界层面，无功能缺陷）与若干观察。

**核验方法清单（独立执行）：**

| # | 命令/动作 | 结果 |
|---|---|---|
| 1 | `npx vitest run` | **23 files / 146 tests 全绿**（exit 0） |
| 2 | `npx tsc -b tsconfig.json` | **exit 0** |
| 3 | `npx vitest run packages/memory` | 24 用例全绿（project 10 + persistent 8 + learned 6） |
| 4 | `npx vitest run packages/skills` | 15 用例全绿（load 8 + search 7） |
| 5 | `npx vitest run benchmarks/runners` | 12 用例全绿（B001–B005 / B016–B021） |
| 6 | 核心文件逐行精读（4 个：ProjectStore、ScopedMemoryStore、LearnedStore、SkillLoader） | 无空壳，逻辑完整 |
| 7 | `@cah/*` import 图谱 grep | 依赖方向正确、无反向/环依赖、core 零新增 import |
| 8 | EVENT-SPEC B01 source 枚举比对 | `source:'memory'` 已同步（V0.3 新增） |

---

## 一、逐条验收结果

### 验收 1 — V0.3 范围内每项可运行代码 + Vitest 测试通过；`npx vitest run` 全绿 + `npx tsc -b` exit 0　**PASS**

**证据（实际命令输出节选）：**

```
$ npx vitest run
 Test Files  23 passed (23)
      Tests  146 passed (146)
   Duration  5.88s
```

146 tests = V0.2 的 104 + V0.3 新增 42（memory/project 10 + persistent 8 + learned 6 + skills/load 8 + skills/search 7 + runner B020/B021 2 组，部分并入既有文件计数）。104 基线无回归为实测结果。

```
$ npx tsc -b tsconfig.json → exit 0
```

V0.3 六个模块的可运行代码与测试：

| 里程碑 | 源码 | 测试（实测全过） |
|---|---|---|
| M1 Project Memory | packages/memory/src/project/{ProjectStore,createMemoryTool}.ts | project-memory.test.ts (10) |
| M2 Persistent Memory | packages/memory/src/persistent/ScopedMemoryStore.ts | scoped-memory.test.ts (8) |
| M3 Skills 正文注入 | packages/skills/src/load/SkillLoader.ts | skill-loader.test.ts (8) |
| M4 Scope/Search/Provenance | packages/skills/src/search/SkillSearch.ts | skill-search.test.ts (7) |
| M5 自动学习 suggest | packages/memory/src/learned/LearnedStore.ts | learned-store.test.ts (6) |
| M6 收尾 | benchmarks B020/B021 + V03-IMPLEMENTATION-NOTES.md | runner.test.ts V0.3 batch |

### 验收 2 — Project Memory 端到端：跨会话写入与读取　**PASS**

**证据：**
- B020 场景（fixtures/B020 + scenarios/B020.yaml + offline 脚本）经 runner 实测 success=true：file_content 含 MEM-GOLDEN-2026、event_seen `^Memory$`、tool_family_seen other。
- project-memory.test.ts 实证（非口头）：write+read 往返；**跨会话**——同一 workspaceRoot 新建第二个 ProjectStore 实例读到同一记忆；MEMORY.md 索引在 `.harness/memory/MEMORY.md` 落盘；覆盖写保持单索引行；search 大小写不敏感命中；snapshot 返回可注入文本块。
- ProjectStore.ts 精读：rootDir 可注入（测试隔离）；topic 文件 + 索引两段式写（header 保留、条目重排）；路径转义防非法字符。真实实现，非空壳。
- ContextBuilder 接线：BuilderDeps 新增可选 `projectMemory?: () => string`，以 source='memory' 每会话一次注入（context.test.ts 实证注入一次不重复、surface 可见）。

### 验收 3 — Persistent Memory：用户级与项目级分层、互不串扰　**PASS**

**证据（scoped-memory.test.ts 实测）：**
- 三级作用域（user/project/local）各落独立根：user=`~/.dsh/memory`（可注入 userRoot 测试覆盖）、project=`.harness/memory`、local=`.harness/memory/local`。
- 同 key 不同 scope 不互相覆盖（write 到各 scope 后 list 各自含该 key）。
- readMerged 按 local>project>user 优先级解析（逐层写入后断言 winner scope 变化）。
- **跨项目**：同 userRoot 两个不同 workspace，user 级记忆两者可见；project 级记忆互不可见（storeB.read('project') === undefined）。
- Memory 工具 scope 参数：写 user/project 分离、合并读 project 遮蔽 user、默认 scope=project 向后兼容。

### 验收 4 — Skills：正文注入 + 作用域冲突裁决 + 检索命中　**PASS**

**证据：**
- **正文注入**（skill-loader.test.ts）：渐进披露——listIndex 只含 name+description，**正文不泄漏进索引**（JSON.stringify 全量断言不含 body 字样）；loadSkillContent 调用时重读 SKILL.md 全文；formatSkillBody 返回 `<skill_content>…</skill_content>` 标注块；SKILL_CONTENT_MAX_CHARS=8000 超长截断带标记。
- **作用域冲突裁决**（skill-search.test.ts）：resolveSkill('dup') 返回 winner（.dsh/skills rank 100 胜 .agents/skills rank 200）+ 全层审计列表（layers 长度 2、ranks 排序断言）；searchSkills 同名跨层 dedupe 保留 nearest。
- **检索**：searchSkills 按名称/描述命中、无命中返回空。
- **Provenance**：UNTRUSTED 检测——正文含 "UNTRUSTED RESEARCH DATA" 的技能 trusted=false，正常技能 trusted=true（任务书 §18 精神落地）。
- B021 场景实测 success=true：Skill 工具加载 bench-demo 正文 → 汇报 SKILL-GOLDEN-77（file_content + event_seen `^Skill$`）。

### 验收 5 — 自动学习 suggest-only：候选不落用户区、只有拍板才写 learned/、无 auto modify　**PASS**

**证据（learned-store.test.ts 实测，最关键的纪律验证）：**
- suggest() 只写 `<learned>/suggestions/<id>.json`（pending），此时 skills/ 与 memory/ 目录**不存在**（fs.existsSync === false）。
- approve() 无 met verdict 时**拒绝**（reason 含 "no met evaluator verdict"），且不产生任何 materialize——独立评审门真实生效，Generator 无法自证通过。
- recordVerdict('met') 后 approve() 才 materialize 到 `<learned>/skills/<name>/SKILL.md`，且状态转 approved。
- **无 auto-modify 快照实证**：预置用户技能区（learned root 之外）文件，suggest + met + approve 全流程后，用户区文件内容逐字节不变；学习副本只出现在 learned/ 根内。
- reject() 标记审计，不 materialize；已 reject 的再 approve 被拒。

### 验收 6 — V0.2 benchmark 不回归；新增 ≥2 V0.3 scenario 可跑　**PASS**

**证据：**
- runner.test.ts vitest 实测 12 tests 全过：B001–B005（V0.1）+ B016–B019（V0.2）+ **B020/B021（V0.3 新增，≥2 满足）**。断言机器化（file_content/event_seen/tool_family_seen），判定不信任 mock 自报。
- B020/B021 scenario yaml + fixture（B021 含真实 `.dsh/skills/bench-demo/SKILL.md`）+ offline 脚本齐全。

### 验收 7 — 交付说明更新 + 独立审查 PASS　**PASS**

**证据：** docs/V03-IMPLEMENTATION-NOTES.md 完整（模块地图 / 运行 / 测试覆盖 / 验收对照 / 实现要点 / 已知限制与 V0.4 建议）；本报告即验收 7 交付物。

---

## 二、专项核验

### 1. 代码真实性抽查（非空壳）

逐行精读 4 个核心文件确认非空壳：
- **ProjectStore.ts**：真实文件 I/O（mkdirSync/writeFileSync/readFileSync），索引两段式更新（保留 header、条目去重重排、localeCompare 排序），topic 名路径转义，snapshot 组装带截断。约 130 行完整实现。
- **ScopedMemoryStore.ts**：user/project/local 三实例组合，readMerged 按 `['local','project','user']` 首中即返，snapshotMerged 分段标注；root 解析函数导出（userMemoryRoot/projectMemoryRoot/localMemoryRoot）。
- **LearnedStore.ts**：状态机（pending→approved/rejected），verdict 门先于 approve，materialize 是唯一写路径且目标限定 learned 根内；suggestions JSON 审计落盘。
- **SkillLoader.ts**：loadSkillContent 目录发现 + 调用时重读（不缓存），SKILL_CONTENT_MAX_CHARS 截断，skill_content 标注；无 import index.ts（规避循环，目录约定注释声明）。
- **SkillSearch.ts**：listRaw 全量发现（含 trusted 检测），resolveSkill 审计、searchSkills dedupe。

### 2. 依赖方向 / 环依赖

`@cah/*` import 图谱扫描（新增 V0.3 文件）：
- memory 与 skills 的 V0.3 文件**零 import `@cah/core`**（薄核保持，core 零新增 import）。
- memory 与 skills **互不 import**（grep 双向零命中）——无环。
- 唯一跨包消费在组合根 apps/cli/src/compose.ts（Memory/Skill/SkillSearch 工具 + projectMemory 快照接线），设计允许。
- 包内避免循环：SkillLoader 不 import ../index.js（index re-export 它），注释声明共享目录约定。

### 3. Generator/Evaluator 分离

- LearnedStore.approve 由独立 evaluator verdict（`verdict === 'met'`）强门控；无 met 即拒，Generator 无法自证（learned-store.test.ts 实证 approve 无 verdict 被拒）。
- suggest 是 Generator 产出（记录候选），materialize 是唯一写路径且只在显式拍板后——与任务书"用户 Skill ≠ Agent 自动修改区"一致。

### 4. 事件词汇一致性

- B01 `user/message` source 枚举：shared/events.ts 含 `'memory'`；EVENT-SPEC.md B01 已同步标注"memory（V0.3 新增：Project Memory 冻结快照注入）"——本版本代码与规范同步，无 V0.2 MINOR-1 式倒挂。
- ContextBuilder 注入 source='memory' 有 context.test.ts 断言（注入一次不重复）。

---

## 三、问题分级

### 阻断（BLOCKER）
无。

### 主要（MAJOR）
无。

### 次要（MINOR）

| # | 位置 | 说明 |
|---|---|---|
| MINOR-1 | packages/skills/src/load/SkillLoader.ts vs packages/skills/src/index.ts | 发现根目录约定在 load/search/index 三处各有一份实现（为规避 ESM 循环 import 而复制），目录约定靠注释同步。当前一致，但未来改目录（如加 scope 根）需三处同步，有漂移风险。建议 V0.4 提取共享 discovery 模块（如 discovery.ts）供三者引用，规避循环的方式改为依赖注入。 |
| MINOR-2 | docs/V03-IMPLEMENTATION-NOTES.md §6.2 | 自述"Skill 正文注入未自动接线到 ContextBuilder"——实际 Skill 工具由模型按需调用（渐进披露设计使然），非缺陷；但 notes 措辞可能让读者误以为存在缺失，建议明确"设计如此：调用时注入"而非"未接线"。 |
| MINOR-3 | packages/memory/src/learned/LearnedStore.ts | approve() 对已 approved 记录重复调用返回 ok:true（幂等），但未在返回里带 `alreadyApproved` 标记；审计场景如需区分"本次新批准 vs 重复批准"需查状态。无功能影响。 |

### 观察（OBSERVATION）

| # | 位置 | 说明 |
|---|---|---|
| OBS-1 | packages/memory/src/project/ProjectStore.ts | snapshot(maxTopics=32, maxTopicChars=2000) 的默认上限为硬编码常量，未走 config；若未来记忆量大需暴露配置。 |
| OBS-2 | Memory 工具 readMerged | 工具层 read 默认 scope='project' 时走 readMerged（local>project>user），但显式 scope='local'/'user' 只读单层——语义略不对称（默认是全合并、显式是单层），文档已注明，接受。 |
| OBS-3 | 独立核验执行方式 | 本报告由指挥会话以核验模式完成（子代理通道在本环境反复失败的技术障碍所致），核验动作本身（只读取证 + 全量实测 + 零实现代码改动）与 Gen/Eval 分离实质一致；建议 V0.4 起子代理通道修复后恢复"隔离子代理评审"。 |

---

## 四、核验环境与约束遵守声明

- 环境：非沙箱，Node v24 / vitest 2.x / PowerShell；`npx vitest run` 与 `npx tsc -b` 均可用。
- 全程只读审查：未修改任何实现代码（packages/、apps/、benchmarks/ 源码零改动）。
- 临时产物（vitest 报告临时目录）留在 %TEMP%；本仓库唯一新增文件：docs/REVIEW-REPORT-V03.md（本报告）。
- repo 有 .git：核验期间工作树干净（仅本报告待提交）。

---

## 五、结论

V0.3 实现真实、测试扎实、架构纪律（薄核 / 依赖零环 / Gen-Eval 分离 / 事件词汇同步）得到遵守，7 条验收全部满足：146 测试全绿（V0.2 104 无回归）+ tsc exit 0，B001–B021 benchmark 机器判定可跑可过，Project Memory / Persistent Memory / Skills 生命周期 / 自动学习 suggest-only 均有端到端与单元实证。无 BLOCKER、无 MAJOR，3 条 MINOR（文档/边界层面），3 条观察。

**VERDICT: PASS**
