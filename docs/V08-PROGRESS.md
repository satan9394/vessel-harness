# V0.8 执行进度（V08-PROGRESS.md）— TUI 修复 + Vessel 改名/哲学 + 供应商/UI

> 接力：tasks 023-025。触发：用户实测 TUI 每轮退出 + 要求改名 Vessel 融哲学 + opencode 式分栏 UI。
> 最后更新：2026-09（024 完成待验收；023/025 执行中）。

## 0. 基线

- 276 测试绿；tsc 0。

## 1. 里程碑

| 卡 | 标题 | 状态 |
|---|---|---|
| 023 | 修复交互 TUI 每轮退出 bug | 执行中 |
| 024 | 改名 Vessel + 六条哲学 IR 化 + 三角色 | 待验收 |
| 025 | 供应商可见性 + 补第三方 + 分栏 UI 设计稿 | 执行中 |

## 2. 关键决策

- Vessel 哲学以 behavior IR 条目落地（不自相矛盾地写死 prompt）。
- 改名只动品牌/命令层（bin vessel），内部 @cah/* 保留防爆炸。

## 3. 任务 025 执行记录（2026-09 子代理回填，待指挥验收）

- 供应商目录 52 → **56**：补 `amazon-bedrock` / `google-vertex`（官方云，env 鉴权占位端点，同 azure-openai 先例）/ `baseten` / `scaleway`（国际推理，真实 key 端点），来源 models.dev 2026-09 快照；长尾中转不收。
- picker 可见性：presets.ts 新增 `PICKER_CATEGORY_TAG` + `providerPickerOptions()`，label 前缀 `[官方]/[国产]/[国际]/[聚合]/[本地]`；custom 项末位固定（value `__custom__`，label 含"自定义"）。确认 @clack/prompts v1.7 默认 filter 匹配 label|hint|value（子串），56 条全可搜，maxItems=12 仅视口。
- 测试：presets.data.test.ts ≥50→≥55 + 新增 picker 分组/可搜性 4 断言；setup.ts pickProvider 改用新助手。全量 `npx vitest run` = **35 文件 285 测试全绿**（基线 276 → 285）；`npx tsc -b` exit 0。
- 设计稿：`docs/ui-split-layout.html`（opencode 式左对话/右面板，深色自包含，每块 HTML 注释标数据源：AgentLoop/bus 事件、ProviderStore、policy.default.yaml 权限档、compose.ts mcpClients、telemetry M06/M07 × pricing.json resolvePrice、M11 成本位）；无头 Chrome 截图渲染验证正常（1280×860）。MCP 实时 online/offline 心跳与成本卡落库 = 待实现。

## 4. 024 交付记录（改名 Vessel + 六条哲学 IR 化 + 三角色，执行器回填，卡置待验收）

- `configs/behavior.default.yaml`：新增 **6 条 `vessel.*` IR**（channel=prompt_guidance，default: true，class: vessel）——Constitution 六条逐条对应：`vessel.replaceable`（无器之器）/ `vessel.minimal_complexity`（器以载道）/ `vessel.harness_carries`（大器不争）/ `vessel.soft_guidance_hard_boundaries`（软引导硬边界）/ `vessel.no_self_certification`（不以自证为证）/ `vessel.human_above_loop`（人在循环之上）。render 为"该怎么做"精炼句，全文见 `configs/behavior.default.yaml` 与 `docs/VESSEL.md` 映射表。
- `packages/context/src/builder/Builder.ts` L93 固定句：`你是 Composable Agent Harness V0.1 的编码代理。` → **`你是 Vessel 系统中的一个 Agent（Composable Agent Harness 核心）。`**（context.test.ts 不断言旧句，无需同步）。
- `apps/cli/package.json`：bin 增 `"vessel": "dist/cli.js"`（保留 `"cah"` 别名）；description 注明 Vessel 品牌。
- `apps/cli/src/cli.ts`：USAGE 首行 → `Vessel CLI v${VERSION} — 可组合 Agent Harness（原名 … cah；命令别名 cah 仍可用）`；帮助示例与错误提示 `cah` → `vessel`（`[cah]` → `[vessel]`；CAH_* 环境变量为历史遗留保留）；`--version` → `Vessel CLI v${VERSION}`。
- `apps/cli/src/tui/chat.ts`：问候语 → `Vessel — 交互会话开始（命令 vessel · 别名 cah；…）`（chat.test 仅断言"交互会话开始"，兼容）。
- `apps/cli/src/cli.test.ts` L38：版本断言同步为 `Vessel CLI v0.1.0`（断言意图不变：打印 shared VERSION）。
- `docs/VESSEL.md`（新）：品牌宣言 + 命名分层（命令/品牌 vessel，内部包历史遗留 @cah/* 说明，根无 README 故落此） + 六条哲学→IR 映射 + Vessel Constitution 全文 + Lead/Developer/Reviewer 三角色角色卡（决策点 12：角色=配置，仅文档化不写代码 preset）。
- `docs/agent-cli-analysis.html`：title/h1/徽章/一句话定位/3.6 比较卡 → Vessel（原 cah）；3.2 固定句、3.3（10 条 IR 含 6 条 vessel.*）、3.5 完整拼接同步为现网 system；落地位置文案 cah → vessel；footer 加更名注。
- 验证：`npx vitest run` = **35 文件 285 测试全绿** exit 0；`npx tsc -b` exit 0；行为 IR 直编译 loadBehaviorIR+compilePolicyYaml+compileBehavior：entries=10（vessel 6）· promptSections=10 · **warnings=0**。
- 未完成项：无（HTML/代码/文档全部落盘；未做永久删除，临时检查文件已走回收站）。
