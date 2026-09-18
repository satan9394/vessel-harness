# 025 — 供应商可见性 + 补 cc-switch 常用第三方 + opencode 式分栏 UI 设计稿

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：CHANGELOG.md V0.7/V0.8（provider picker/UI）。
- 优先级：P1
- 创建日期：2026-09
- 关联：goal-a0b7e372

## 问题（用户实测）

用户在向导里"依旧没有 XX 供应商"、觉得 cc-switch 那么多供应商没进去；且要"custom 自定义供应商"（opencode /connect Other 那样）。另外要求 UI 设计：opencode 启动后左边对话框、右边显示 MCP + 消耗模型成本。

## 验收标准

- [ ] **供应商可见性排查**：确认 presets.data.ts 的 52 条在 setup 向导 autocomplete picker 全部可选（含类别分组显示）；若 maxItems/分组导致部分不可见则修
- [ ] **custom 自定义入口保证**：向导/autocomplete 里"自定义端点"项可搜索到（如输入 custom/自定义 能命中）且流程完整（自定义协议+base-url→key→手动/拉模型）
- [ ] **补常用第三方/中转**：从 docs/ideas/data/cc-switch-presets-parsed.tsv 挑用户生态常用且稳定的第三方/中转/聚合（如 PackyCode 类知名者需审慎——优先 302AI/OpenRouter 已有时，补 Azure/Bedrock/Claude 官方 OAuth 之外的稳定项；宁少而准），补充到 presets.data.ts，≥55 条
- [ ] **opencode 式分栏 UI 设计稿**：产出 HTML 设计稿（docs/ui-split-layout.html）：深色、左对话区（消息流+输入框）、右面板（MCP servers 状态 + 当前模型 + token/成本估算 + 权限档）；标注哪些数据源已具备（telemetry/pricing.json 有成本数据、EVENT-SPEC 有事件）哪些待实现（MCP 实时状态）
- [ ] 设计稿浏览器截图验证渲染正常
- [ ] `npx vitest run` 全绿；tsc exit 0；卡置"待验收"

## 涉及文件

- `apps/cli/src/providers/presets.data.ts`（补条目 + 测试同步）
- `apps/cli/src/providers/presets.data.test.ts`（≥55 断言更新）
- `docs/ui-split-layout.html`（新设计稿）
- `docs/V08-PROGRESS.md`

## 设计锚点

- 用户参考：opencode TUI（左对话右面板）；cc-switch 供应商多 + 分类；custom 第一公民
- 设计稿 = HTML mock（可截图），非本期实现全屏 TUI（那是独立大活，先定稿）
- 成本数据源：configs/pricing.json（models/protocols 价目）+ telemetry usage；MCP 状态源：compose 的 mcpClients
- 截稿 UI 布局要可落地（标注每块数据从哪来）

## 工作证明（执行器回填）

- [ ] diff / 测试 / 设计稿

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
