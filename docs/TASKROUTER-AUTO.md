# TaskRouter Auto —— 用户只选 Auto / Fast / Pro（task 056）

> 实现卡：`tasks/056-task-router-auto.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §10（L1140-1182）+ §8.2（L1040-1051：小→Single / 中→Developer+Reviewer / 复杂→Lead+Developer+Reviewer）+ §8.3（L1057-1078：角色与模型解绑）。
> 代码位置：`packages/llm/src/router/autoRouter.ts`（AutoTaskRouter + 解析链纯函数 + pin），
> 经 `packages/llm/src/index.ts` 从 `@vessel/llm` 导出；接线：`packages/application/src/compose.ts`
> `ComposeOptions.taskRouter`（默认 Auto）+ `ComposedHarness.route`（实际选择展示）。

## 1. 一句话

用户不再手动选模型，只选 **Auto / Fast / Pro**（**默认 Auto**）；Auto 内部走
`classify category → choose role → choose tier → resolve provider/model`，
UI/CLI 展示实际选择（`Auto → deepseek-chat` 样式）并可 **Pin for this session**
（本 session 锁定该选择，不再自动重判）。

## 2. 模式与解析链

| 用户选择 | 行为 |
|---|---|
| `auto`（默认） | 完整解析链：分类 → §8.2 角色 → §8.3 档位 → 绑定模型 |
| `fast` | **绕过 classify** 直达 `fast` 档（单执行角色 developer） |
| `pro` | **绕过 classify** 直达 `pro` 档（单执行角色 developer） |

Auto 解析链（`resolve()` 内部，每步都有可独立单测的纯函数导出）：

```text
task → classifyCategory()        # 现有确定性分类器 / 注入 classify
     → complexityForCategory()   # 类别 → 复杂度（§8.2 三档；DEFAULT_CATEGORY_COMPLEXITY）
     → rolesForComplexity()      # 复杂度 → 角色计划（DEFAULT_COMPLEXITY_ROLES）
     → roleTierFor()             # 角色 × 复杂度 → 档位（DEFAULT_ROLE_TIERS）
     → resolveTierBinding()      # 档位 → { providerId, model }（bindings，provider 层注入）
```

默认数据表（均可注入覆盖）：

- 类别 → 复杂度：`search/simple_fix → small`；`implementation/review/planning → medium`；
  `architecture → complex`；`unknown → medium`。与 V0.4 `DEFAULT_PRESETS` 的类别主档
  等价（small→fast、其余→pro），保证既有 compose/bench 路由行为不回退。
- 复杂度 → 角色（§8.2）：`small → ['developer']`；`medium → ['developer','reviewer']`；
  `complex → ['lead','developer','reviewer']`。
- 角色 × 复杂度 → 档位（§8.3）：`lead → pro`（恒）；`developer → small=fast / 中、复杂=pro`；
  `reviewer → review`（档位意图；绑定具体模型在 bindings）。

## 3. tier → provider/model 解析（分层说明）

**角色与模型解绑**：preset/角色只声明档位意图（pro/fast/review…），不写死模型名。
档位 → 具体模型由**调用方（provider/config 层）注入的 bindings** 决定：

```ts
type TierBindings = Readonly<Record<string, { providerId: string; model: string }>>;
// 例：{ pro: {providerId:'deepseek', model:'deepseek-chat'},
//        fast: {...}, review: {providerId:'deepseek', model:'deepseek-v4-flash'} }
```

- llm 层（本模块）只做"档位 → 绑定"的查找与校验，零模型名写死。
- `review` 档是本卡扩展的语汇（054/055 reviewer preset 的 `modelTier:'review'` 挂接点）；
  compose 里 `taskRouter.bindings` 可扩展任意档位，缺省与 `tierModel`（pro/fast/mini）合并。
- **未配置的档位 → 清晰回落默认档（`defaultTier`，默认 `'pro'`）+ `route.hints` 提示**，
  绝不静默；默认档也未配置则抛错并列出已配置 tiers（fail loud）。
- providers 里缺少绑定指向的 provider id 同样抛错列出可用项。

## 4. Pin for this session

- `router.pinCurrent()` 锁定**最近一次 Auto 解析结果**（无结果时抛错带指引）；
  `isPinned()` / `unpin()` 查询与解除。
- pin 后再次 `resolve()`（auto，需要自动重判的场景）直接返回锁定选择
  （`route.pinned === true`，不再分类/重判）。
- **显式 Fast/Pro 是用户最新意图，永远现场解析**，不被 pin 吞掉。
- compose 层：`ComposeOptions.taskRouter.pin: true` 在组装时即锁定本 session 的选择。

## 5. 组装/接线（compose seam —— CLI 与 web 后端共用）

```ts
composeHarness({
  provider: fallbackProvider, model: 'fallback',      // 触发路由时被 route.primary 覆盖
  taskRouter: {
    providers: { pro, fast, review },                  // provider 实例表
    tierModel: { pro: {...}, fast: {...}, mini: {...} }, // legacy 核心档绑定
    bindings: { review: { providerId: 'review', model: 'review-model' } }, // 扩展档（可选）
    taskPrompt: '请实现一个用户登录功能',               // Auto 触发（首次任务）
    mode: 'auto',                                       // auto(默认)/fast/pro
    pin: false,                                         // pin for this session（可选）
  },
});
// → harness.route: { mode, category, complexity, roles, roleModels, primary, hints, pinned }
//   harness.route.primary.model 即会话实际模型（UI「Auto → <model>」取 routeSelectionLabel(route)）
```

触发条件：给了 `taskPrompt`（Auto 全链），或给了显式 `mode: 'fast'|'pro'`（绕过分类）。
只给 providers/tierModel 而无触发条件 = 维持显式 provider/model（V0.4 契约，不回退）。
UI 打磨与 TeamRuntime 真跑三角色分别在 057/060；本卡只交付路由解析与最小接线。

## 6. 与既有词汇/机制的关系

- V0.4 `TaskRouter.ts`（类别 preset 表 + 显式 hints 优先）**原样保留**，
  engine/selection、bench 既有消费方不回退；`autoRouter.ts` 是其产品化包装层。
- 角色出参是 preset id 字符串（`lead/developer/reviewer`，与 agents/presets registry 对齐）；
  本层不 import agents —— 角色 → `AgentPreset` 规格解析、per-role 会话构造归 057。
- 事件面：`session/created.agentPreset` 与 A22/A23 的 `preset` 载荷即角色 id，
  由 057 会话构造方落盘（本卡不改事件）。
