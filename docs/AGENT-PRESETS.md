# AgentPreset 体系（preset = 角色配置，非 runtime primitive）

> 实现卡：`tasks/054-agent-preset-spec.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md` §8.1-8.3（L992-1080）。
> 代码位置：`packages/agents/src/presets/`（types.ts / registry.ts），经 `packages/agents/src/index.ts` 从 `@vessel/agents` 导出。
> 范围：本体系只定义 preset 的规格/形状/注册/取用。三角色实例（Lead/Developer/Reviewer）→ 055；
> TaskRouter Auto 用 preset 选型 → 056；TeamRuntime/TeamProjection → 057。能力字段的运行时接线
> 也在 055/056/057，本层只定义「映射点」并用类型与本文档讲清。

## 1. 概念

- **角色 = preset/profile 配置，不是新的 runtime primitive**（决策点 12：机制先于角色）。Evaluator 不是新原语
  的先例（`agents/evaluator` = 独立会话 + 只读工具面 + 独立模型档位的 preset）在本仓库已确立，054 把它
  正式化为通用 `AgentPreset` 规格。
- **角色与模型解绑**：preset 只声明 `modelTier`（档位意图），不硬编码模型名；tier → (provider, model)
  的绑定归 056 / provider 层（参照 `packages/llm/src/router/TaskRouter.ts` 的 `ModelTier` + `TierModelMap`）。
- preset 是**可序列化的普通数据**（TS 类型为源；camelCase 键；JSON/YAML 均可承载），不是类、不是机制。

## 2. Schema

```ts
// packages/agents/src/presets/types.ts
export type AgentRole = 'orchestrator' | 'generator' | 'evaluator';
export type ModelTier = string;              // 开放档位词汇（pro/fast/review/mini…）

export interface AgentPresetInput {          // 注册输入：modelTier 可省
  id: string;                                // 稳定唯一标识（registry 内唯一；建议小写 kebab-case）
  role: AgentRole;                           // 角色判别
  modelTier?: ModelTier;                     // 缺省 → 'pro'
  tools?: string[];                          // 工具名 allow-list（可见性收窄，shrink-only）
  write?: boolean;                           // false = 只读面
  canDelegate?: boolean;                     // 是否可委派子代理
  description?: string;
}

export interface AgentPreset extends AgentPresetInput { modelTier: ModelTier }  // 规范化后：必有值
```

### 2.1 字段表

| 字段 | 类型 | 必填 | 默认 | 语义 |
|---|---|---|---|---|
| `id` | string | ✔ | — | 唯一标识；非空、无空白、≤64 字符 |
| `role` | `'orchestrator'\|'generator'\|'evaluator'` | ✔ | — | 判别值（见 §3 与 §8.1 对齐） |
| `modelTier` | string | ✘ | `'pro'` | 档位意图；不绑定具体模型（与 llm/router 兜底一致） |
| `tools` | string[] | ✘ | 未指定 | 工具名 allow-list；只收窄不放宽 |
| `write` | boolean | ✘ | 未指定 | `false` = 只读面（reviewer）；缺省 = 继承运行时默认 |
| `canDelegate` | boolean | ✘ | 未指定 | `true` = 可委派（orchestrator）；缺省 = 继承运行时默认 |
| `description` | string | ✘ | — | 人类可读说明 |

**可选字段的缺省语义**：显式 `false` 与「未指定」可区分——`write: false` 是强只读声明，
`write` 缺省是「不额外限制，继承运行时默认」。规范化后的 preset 只保留显式声明的可选键（`Object.freeze`）。

## 3. §8.1 语义对齐（期望形状）

```ts
{ id: 'lead',      role: 'orchestrator', modelTier: 'pro',    canDelegate: true  }  // 编排：可委派
{ id: 'developer', role: 'generator',    modelTier: 'pro',    write: true        }  // 产出：可写
{ id: 'reviewer',  role: 'evaluator',    modelTier: 'review', write: false       }  // 评估：只读
```

对应关系：orchestrator ↔ Lead（编排/可委派）；generator ↔ Developer（产出/可写）；
evaluator ↔ Reviewer（独立评估/只读，Generator 不得自证完成）。三角色的**具体实例**由 055 注册，
054 的 registry 默认集为空。

## 4. 校验、规范化与注册 API（`packages/agents/src/presets/registry.ts`）

```ts
validatePreset(raw: unknown): AgentPresetInput        // 非法抛 PresetValidationError
normalizePreset(input: AgentPresetInput): AgentPreset // 校验 + 默认值 + 冻结
class PresetRegistry {
  constructor(seed?: readonly AgentPresetInput[])      // 播种；任一非法即抛（带该 preset 的 id）
  registerPreset(input): AgentPreset                   // 校验 + 查重（同 id 拒绝，抛错带 id）
  hasPreset(id): boolean
  getPreset(id): AgentPreset                           // 未知 id 抛 PresetNotFoundError（带已注册列表）
  listPresets(): readonly AgentPreset[]                // 插入序
  ids(): readonly string[]
  readonly size: number
}
```

错误契约：

- `PresetValidationError`：`presetId?` + `issues: string[]`；message 含 id，如
  `invalid agent preset "dev": role must be one of orchestrator|generator|evaluator (got "writer")`。
- `PresetNotFoundError`：`presetId` + 已注册列表提示，如
  `unknown agent preset "ghost" (registered presets: lead, reviewer)`。
- **未知字段 fail loud**：schema 白名单外的键（如 yaml 里的 `model_tier` / `can_delegate` snake_case）
  直接报错而不是静默失效——防配置拼写错误产生「看起来生效实则没用」的 preset。

## 5. 能力映射点（本卡只定义形状，接线在 055/056/057）

| preset 字段 | 既有运行时开关 | 现状/接线位置 |
|---|---|---|
| `tools` | 工具可见性收窄 | 现状：`SubagentManager.delegate({ toolFilter })` 是 shrink-only 收窄；`EvaluatorAgent` 以只读工具集构造会话。接线：preset.tools → 会话构造时对工具集过滤 / toolFilter |
| `write` | file_write 族可见性 + 权限档 | 现状：`ToolSpec.requiredPermission: 'read'\|'workspace-write'\|'danger-full-access'`（@vessel/shared tools.ts）；Evaluator 只读面先例 `createReadOnlyExplorationTools`。接线：`write:false` → 剔除 file_write 族/降档 workspace-write |
| `canDelegate` | Subagent 工具可见性 + 服务端上限 | 现状：`SubagentManager.canDelegate`（maxDepth/maxConcurrent，fail-closed）；delegationDepth 随委派持久。接线：`canDelegate:false` → 不注册 Subagent 工具 |
| `modelTier` | 模型档位 → 具体模型 | 现状：`llm/router` `ModelTier` + `TierModelMap`；TaskRouter `preset.modelTier ?? 'pro'`。接线：056 TaskRouter Auto 用 preset.modelTier 走 tier 绑定 |
| `budget` / `maxSteps` 等 | （未来） | 本卡不设字段，扩展见 §7；接线留后续卡 |

design 总则：**preset 只声明意图（形状），运行时开关仍由机制层权威裁决**；preset 收窄能力，
不能放大（角色只能收窄父权限，参照 BEHAVIOR-IR-SPEC §7.2 覆盖规则 `default < project < preset < role < flag`）。

## 6. 与既有 preset 词汇的关系

- `packages/llm/src/router/TaskRouter.ts` 的 `DEFAULT_PRESETS` 是「任务类别 → { agentPreset?, modelTier }」
  的路由表数据（`agentPreset` 字段目前是透传标签，记录进会话 B10）。054 的 `AgentPreset` 是这些标签
  背后的**完整角色规格**（带 role/tools/write/canDelegate）。056 应把类别 preset 的 `agentPreset` 标签
  解析到本 registry 的 `AgentPreset`（标签不在 registry 时 fail loud 或回落标签透传，由 056 定）。
- `EVENT-SPEC` A22/A23 的 `preset` 载荷字段与 `session/created.agentPreset` 即本 registry 的 id。
- 现有 Evaluator Agent 硬编码只读工具面、Subagent 委派标签透传，是 054 之前「preset 语义未成形」的
  过渡形态；054 后新形态由 055 按 preset 重新装载，旧路径保留兼容。

## 7. 扩展方式

1. **新增自定义 preset**：`registry.registerPreset({ id, role, modelTier?, tools?, write?, canDelegate?, description? })`，
   或播种 `new PresetRegistry([...])`。任意进程内注册表可组合（默认空表由 055 播种三角色）。
2. **配置源**：preset 是纯数据，可放代码常量、JSON 或 YAML（camelCase 键与 TS 形状一致；
   yaml 载入先例见 `packages/policy/src/risk/Compiler.ts` / `packages/behavior/src/ir/BehaviorIR.ts` 的 js-yaml）。
   反序列化结果直接喂 `validatePreset`（unknown 入参已支持），fail loud 兜住格式错误。
3. **新增字段**：同步 `types.ts` 接口 + `registry.ts` 的 `PRESET_SCHEMA_FIELDS` 白名单 + 校验逻辑，
   否则未知字段会报错（这是有意为之的显式扩展点）。
4. **运行时接线（055/056/057）**：取用 `getPreset(id)` 后按 §5 映射表落到工具集构造 / Subagent 开关 /
   tier 绑定；本层不直接改动任何运行时文件。
