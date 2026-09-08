# 054 — AgentPreset spec（角色 = 配置，非新原语）

- 状态：待验收
- 优先级：P0（Wave 2 / Milestone D 首发）
- 创建日期：2026-09-08
- 关联：055（三角色 presets）；056（TaskRouter Auto）；057（TeamRuntime）——本卡打地基
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8（L992-1080，三 Agent 体系代码化）

## 目标

定义并实现 AgentPreset 规格与运行时形态：**角色 = preset/profile，不是新的 runtime primitive**。
确立 preset 的 schema（id/role/model_tier/tools/capabilities）、校验、解析与取用 API，放
`packages/agents/src/presets/`。为 055（Lead/Developer/Reviewer 三角色）与 056（TaskRouter
Auto 用 preset 选型）铺路。角色与模型解绑（preset 只声明 model_tier，不绑定具体模型）。

## 验收标准（执行器逐条勾选）

- [x] preset schema 类型：`AgentPreset { id, role, modelTier, tools?, write?, canDelegate?, … }`
      （字段命名遵循项目 TS 惯例；role 取 orchestrator/generator/evaluator 或等价判别；与
       §8.1 示例语义一致：lead=orchestrator/pro/can_delegate、developer=generator/write、
       reviewer=evaluator/no-write）
- [x] 校验与解析：preset 定义可来自代码/配置（参考 configs/ 既有 yaml 载入方式或内联 TS 对象），
      非法 preset 报清晰错误；提供注册/取用 API（如 getPreset(id) / listPresets() / registry）
- [x] 与 @vessel/shared / core 契约兼容：preset 里的 tools/write/canDelegate 等能力最终映射到
      既有运行时开关（tool 可见性、是否可 delegate、budget 等）——本卡只定义映射点与形状，
      实际接线在 055/057；tools 字段若已由 configs/policy 表达则不重复造
- [x] 文档：preset 体系说明（schema/默认值/扩展方式）落 docs/ 或包 README
- [x] 测试：schema 校验/注册取用/非法拒绝/默认 preset 形状，新增 ≥6 例；全量 vitest/tsc 绿
      （426+ 无回归）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 preset 规格/形状/注册/取用。三角色实例（055）、TaskRouter 接线（056）、TeamRuntime（057）
  各自成卡，不在本卡实现。不新增 runtime primitive（角色仍是配置）。
- 角色与模型解绑：preset 不硬编码模型名，只声明 modelTier（tier→model 的解析归 056/provider 层）。

## 涉及文件（指针，执行器自行精化）

- packages/agents/src/presets/（新目录：types.ts / registry.ts / 默认集可为空待 055 填）
- packages/agents/src/index.ts（导出）
- docs/（preset 说明文档）
- 参考：packages/agents 现有结构（EvaluatorAgent/SubagentManager 等，看能力开关现如何表达）、
  configs/ 配置载入方式、@vessel/shared 类型契约

## 方法

- 读路线 §8.1-8.3 与现有 agents 包结构；定 schema（TS 类型为源，可序列化到配置）
- registry 提供注册/查取；校验失败抛带 id 的清晰错误
- tools/write/canDelegate 在 preset 上声明但映射留给 055/057——本卡用类型与文档把映射点讲清

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（隔离子代理 session-fc88ff78-a2c7-4aa8-a183-da60e28c9961）

### 改动文件与 diff 摘要

| 文件 | 类型 | 摘要 |
|---|---|---|
| `packages/agents/src/presets/types.ts` | 新增 | `AgentRole`(orchestrator/generator/evaluator)、`ModelTier`(开放 string)、`DEFAULT_MODEL_TIER='pro'`、`AgentPresetInput`(modelTier 可选)/`AgentPreset`(modelTier 必有)，字段 id/role/modelTier/tools?/write?/canDelegate?/description?，映射点以注释讲清 |
| `packages/agents/src/presets/registry.ts` | 新增 | `validatePreset(raw: unknown)`（fail loud，未知字段/snake_case 直接报错）、`normalizePreset`（默认值+冻结）、`PresetRegistry`（seed/registerPreset/hasPreset/getPreset/listPresets/ids/size，同 id 拒绝）、`PresetValidationError`/`PresetNotFoundError`（均携带 preset id + 明细/已注册提示）、`PRESET_SCHEMA_FIELDS` 扩展白名单 |
| `packages/agents/src/index.ts` | 修改 | +2 行导出 presets/types、presets/registry（`export * from './presets/…js'`） |
| `packages/agents/src/presets/presets.test.ts` | 新增 | 11 例测试（默认形状/注册取用/插入序/未知 id 报错带提示/非法 role/id/tools/boolean/未知字段拒绝/重复注册/§8.1 语义锚定/冻结+JSON 可序列化/自定义 tier 与空 tools） |
| `docs/AGENT-PRESETS.md` | 新增 | preset 体系文档：schema 表/默认值/§8.1 对齐/注册 API/错误契约/能力映射点表（tools→可见性收窄、write→file_write 族+requiredPermission、canDelegate→Subagent 工具+SubagentManager 上限、modelTier→056 provider 层）/扩展方式/与 llm TaskRouter 词汇关系 |
| `tasks/054-agent-preset-spec.md` | 修改 | 本工作证明 + 6 条验收勾选 + 状态→待验收 |

### 新增测试数与命令输出（本环境 vitest/tsc 均可直跑，无 EPERM/受限降级）

- presets 单测：`npx vitest run packages/agents/src/presets/presets.test.ts` → **11 passed (11)**，0 failed。
- 全量 vitest（最终文件状态重跑）：`npx vitest run` → **54 files / 437 passed**（基线 426 + 新增 11，无回归），`VITEST_EXIT=0`。
- 全量类型：`npx tsc -b tsconfig.json --pretty false` → `TSC_EXIT=0`（exit 0）。
- 环境备注：无命令失败；无需后台降级，全部命令正常直跑。

### schema 设计选择与理由

1. **camelCase 字段命名**（id/role/modelTier/tools/write/canDelegate/description）：遵循项目 TS 惯例；§8.1 yaml 的 snake_case（model_tier/can_delegate）只作权威语义来源，不照搬键名——且校验对未知字段 fail loud，防止把 §8.1 yaml 直接粘贴进配置时静默失效。
2. **role 判别值 orchestrator/generator/evaluator**：与 §8.1 一一对应（lead=orchestrator 可委派、developer=generator write、reviewer=evaluator no-write），呼应 Generator/Evaluator 分离纪律；55 三角色实例复用同一判别。
3. **modelTier 用开放 string 而非枚举**：preset 只表达档位意图不绑定模型（角色与模型解绑，tier→(provider,model) 归 056/provider 层）；默认 `'pro'` 与 llm/router `DEFAULT_PRESETS` 的 `?? 'pro'` 兜底一致；tier 非空且无空白即合法。
4. **可选能力字段缺省即不落键**：可区分「未指定」（继承运行时默认）与显式 false（如 reviewer 强只读 write:false）；normalizePreset 只落显式字段并 `Object.freeze`（防经返回值篡改 registry，tools 数组一并冻结）。
5. **错误契约带 id**：PresetValidationError.presetId+issues 明细、PresetNotFoundError.presetId+已注册列表——满足"校验失败抛带 id 的清晰错误"，且给 056 选型自愈空间。
6. **API 形状**：registry 用类（可播种/独立实例，056/057 各自持有）+ 纯函数 validatePreset/normalizePreset 独立导出（配置载入与测试可复用，validatePreset 收 unknown 直喂反序列化结果）。
7. **零接线**：tools/write/canDelegate 只声明形状与映射点（文档 §5 表 + 类型注释），不触碰任何运行时文件——符合范围纪律（055/056/057 各自成卡）。

### 踩坑记录

- vitest 断言：避免依赖 `expect.unreachable()`（2.1.9 环境下可用性不确定），改用 try/catch 捕获 + `toBeInstanceOf` 断言，语义等价且稳健。
- 负例测试的字面量会先被 TS 拦下（TS2322 role:'writer' 非 AgentRole）——测试文件在 `tsc -b` 全图类型检查范围内，需 `as unknown as AgentPresetInput` 绕过类型再喂 registerPreset 验证运行时校验路径。
- 命名撞车与既有体系：llm/router 已有 `AgentPresetRef`（类别→agentPreset 标签路由表）；054 的 `AgentPreset` 是这些标签背后的完整角色规格。registry id 词汇与 TaskRouter 的 agentPreset 标签（developer/reviewer 等）保持同源，056 对接时未知标签可 fail loud 或回落标签透传（文档 §6 已记）。
- git 纪律：dist/ 与 *.tsbuildinfo 均被 .gitignore 忽略，`tsc -b` 不污染工作树；提交只含本卡文件与 docs，tasks/055-057 卡不混入本提交。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
