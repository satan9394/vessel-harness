# V0.3 Implementation Notes — Composable Agent Harness 第三阶段交付说明

> 阶段：第三阶段（MISSION-V0.3.md）· 验收状态：见文末 · 日期：2026-09-05
> 总指挥签发任务：在 V0.2（104 测试）之上增量实现 Project Memory / Persistent Memory / Skills 生命周期 / 自动学习 suggest（任务书第十二节）。

---

## 1. 模块地图（V0.3 增量，相对 V0.2）

```text
packages/memory/src/
  project/ProjectStore.ts         V0.3-M1 文件式项目记忆：MEMORY.md 索引 + topics/<name>.md；
                                  write/read/list/search/snapshot；rootDir 可注入
  project/createMemoryTool.ts     V0.3-M1/M2 单一 Memory 工具（ToolSpec）：
                                  op = read/write/list/search/snapshot + scope(user/project/local)
  persistent/ScopedMemoryStore.ts V0.3-M2 三级作用域：user(~/.dsh/memory) / project(.harness/memory)
                                  / local(…/memory/local)；readMerged 按 local>project>user 合并；
                                  snapshotMerged 供注入；跨项目 user 可见、project 隔离
  learned/LearnedStore.ts         V0.3-M5 自动学习 suggest 通道：suggest→pending→recordVerdict→
                                  approve(需 verdict==met + 显式拍板)/reject；只写 learned/ 区，
                                  用户 skill/memory 区零改动（快照测试实证）
packages/skills/src/
  load/SkillLoader.ts             V0.3-M3 正文按需装载：loadSkillContent(name) 调用时重读 SKILL.md
                                  （D3 决策点 11 渐进披露 + 调用时重读）；createSkillTool 返回
                                  <skill_content> 标注正文；SKILL_CONTENT_MAX_CHARS token 上限
  search/SkillSearch.ts           V0.3-M4 Search/Provenance：searchSkills 跨层检索 dedupe nearest；
                                  resolveSkill 冲突审计（列出所有层 + winner）；trusted/UNTRUSTED
                                  检测（任务书 §18：泄露/逆向技能标 UNTRUSTED）；createSkillSearchTool
packages/shared/src/events.ts     B01 user/message source 增 'memory'（冻结快照注入）
packages/context/src/builder/Builder.ts  BuilderDeps 增 projectMemory?: () => string——冻结快照
                                  以 source='memory' 每会话一次注入（可回放可压缩）
apps/cli/src/compose.ts           接线：Memory/Skill/SkillSearch 工具 + projectMemory 快照
                                  （memory.enabled 默认 true）
benchmarks/
  scenarios/B020.yaml B021.yaml   V0.3 场景：project memory 读写 / skill 正文加载
  fixtures/B020/ B021/            （B021 含 .dsh/skills/bench-demo/SKILL.md fixture）
  runners/src/offline.ts          B020/B021 offline mock 脚本
  runners/src/runner.test.ts      V0.3 batch 组（B020–B021）
docs/V03-PROGRESS.md              里程碑进度（M1–M5 合入，M6 收尾）
```

## 2. 运行方式

```powershell
npx tsc -b tsconfig.json                 # 类型构建
npx vitest run                           # 全量 146 用例（offline，无网络）
npx vitest run packages/memory           # memory 包（24 用例）
npx vitest run packages/skills           # skills 包（15 用例）
npx vitest run benchmarks/runners        # runner（12 用例：B001–B005/B016–B021）
node apps/cli/dist/cli.js run --workspace <dir> --prompt "..."   # CLI（Memory/Skill 工具默认可用）
```

## 3. 测试与覆盖（验收 1）

`npx vitest run` → **23 文件 / 146 用例全绿**（V0.2 基线 104 + V0.3 新增 42）：

| 包 | V0.3 新增覆盖 |
|---|---|
| memory/project (10) | 读写往返 / 跨会话持久 / MEMORY.md 索引 / 覆盖写 / search / snapshot / 工具层 |
| memory/persistent (8) | 三级作用域隔离 / readMerged 优先级 / 跨项目 user 可见 / project 隔离 / snapshotMerged / 工具 scope |
| memory/learned (6) | suggest 只写 suggestions / approve 需 met 评审门 / 只落 learned/ / reject 审计 / **无 auto-modify 快照实证** |
| skills/load (8) | 渐进披露（索引无正文）/ 正文装载 / skill_content 标注 / token 截断 / Skill 工具 |
| skills/search (7) | 跨层检索 / 冲突裁决审计 / dedupe nearest / UNTRUSTED 检测 / SkillSearch 工具 |
| benchmarks/runners (B020/B021) | project memory 场景 / skill 场景 machine 断言 |

## 4. 验收对照（MISSION-V0.3 第六节 7 条）

1. **可运行代码 + Vitest 通过**：✔ 146/146（§3）；`npx tsc -b` exit 0
2. **Project Memory 端到端**：✔ B020 场景（write topic → read → 汇报，file_content 含 MEM-GOLDEN-2026 + event_seen Memory）；单元测试跨会话实证双 store 实例读同一记忆
3. **Persistent Memory 端到端**：✔ scoped-memory.test 实证同 user root 两 project 共享 user 记忆、project 记忆互不可见
4. **Skills 端到端**：✔ B021 场景（Skill 工具加载 bench-demo 正文 → 汇报 SKILL-GOLDEN-77）；渐进披露测试实证默认上下文只有索引
5. **自动学习 suggest**：✔ learned-store.test 实证 suggest 只写 suggestions/、approve 需 met 评审门、materialize 只进 learned/、**用户区快照对比零改动**（无 auto modify）
6. **benchmark 不回归 + 新增 ≥2**：✔ B001–B005/B016–B019 不回归；新增 B020/B021 可跑可过（runner 12 用例全绿）
7. **交付说明 + 独立审查**：✔ 本文档 + docs/REVIEW-REPORT-V03.md（独立 Evaluator 核验，见 §7）

## 5. 实现要点（与 DESIGN-DECISIONS/ARCHITECTURE 的对应）

- **Project Memory = 文件式非 DB**（ARCHITECTURE §4.8 行 344 蓝图）：MEMORY.md 索引 + topic 文件；不用 SQLite（V0.3 范围未要求 storage 后端）。
- **单一 memory 工具**（§4.8）：Memory 工具走同一 ToolSpec 管线（BeforeTool→Policy→Execute→AfterTool），policy 可 deny；工具只收窄不放大（workspace-write，scope 限 user/project/local 根）。
- **冻结快照注入带 source**（EVENT-SPEC B01）：ContextBuilder 新可选依赖 projectMemory()，每会话一次以 source='memory' 注入（可回放、可压缩）——与 source='instruction'/'plan' 同纪律；EVENT-SPEC B01 source 枚举已同步（'memory' V0.3 新增）。
- **Skills 渐进披露**（决策点 11）：索引只含 name+description（V0.1 既有）；正文经 Skill 工具调用时重读（不缓存整库）；token 上限常量 8000 字符 + 截断标记。
- **Skill 作用域/Provenance**（ARCHITECTURE §4.9）：发现根四层（system/user/project/session）+ ~/.claude/skills、~/.codex/skills 兼容；同名 nearest-wins 且 resolveSkill 保留全层审计；UNTRUSTED 检测防泄露语料直入 prompt（任务书 §18）。
- **suggest-only 学习**（任务书 §12/§13）：LearnedStore 状态机 pending→(verdict met)→approved 或 rejected；approve 是唯一写路径且只写 learned/；用户 Skill ≠ Agent 自动修改区硬隔离。
- **薄核纪律**：所有 V0.3 机制挂在 core 之外 seam；core/ 零新增 import；context 只加可选依赖不破坏既有；接线全在组合根 compose.ts。
- **依赖零环**：memory→{shared,core}；skills→{shared,core}；agents 不反向依赖 memory/skills；compose 为组合根。

## 6. 已知限制与后续（V0.4 建议）

1. **learned/ 完整化属 V0.4**：V0.3 只落 suggest 通道（状态机 + 评审门 + learned/ 隔离）；Background Review 自动采纳、Snapshot/Rollback、Curator 属任务书第十三节 V0.4。
2. **Skill 正文注入未自动接线到 ContextBuilder**：Skill 工具返回正文由 Agent/调用方决定注入（渐进披露）；context 层默认不含技能正文（只有 projectMemory 快照自动注入）。若需"命中即自动注入"是 V0.3 之后的增强。
3. **user 级记忆默认写 ~/.dsh/memory**：跨项目共享符合 Persistent Memory 定义；如需沙箱内隔离测试注入 userRoot 覆盖。
4. **Memory/Skill 工具未在真实模型 live 车道验证**：offline mock lane 全绿；live 车道需真实端点（与 V0.1/V0.2 同限制）。
5. **V0.4 建议**：Task Router / Orchestration Policy（docs/ideas/001-task-router-orchestration.md，用户已排 V0.4）、可继续子代理（send_message/interrupt，EVENT-SPEC A25 预留）、Skill 命中自动注入、learned/ 完整化（Snapshot/Rollback/Curator）。

## 7. 独立核验

docs/REVIEW-REPORT-V03.md（独立 Evaluator 按 MISSION-V0.3 第六节 7 条逐条核验，Generator/Evaluator 分离——本实现方不自证）。
