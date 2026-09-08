# 024 — 改名 Vessel + 六条哲学融入系统提示词（IR 形态）+ 三角色

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09
- 关联：goal-a0b7e372

## 目标（用户原话）

项目改名 **Vessel**（"大器免成/无器之器"，命令如 vessel run；GitHub 无压倒性同名 Agent）。把用户给的 Vessel 六条哲学（无器之器/器以载道/大器不争/软引导硬边界/不以自证为证/人在循环之上）真正变成 Agent 共同操作原则（Vessel Constitution），并定义 Lead/Developer/Reviewer 三角色。

## 验收标准

- [ ] **改名（品牌/命令层）**：apps/cli package.json bin 加 `vessel`（保留 cah 别名或文档说明）；问候/欢迎语 "Vessel"；help/HTML/文档标题 Vessel
- [ ] 内部 @cah/* 包别名保留（避免全仓重命名爆炸）——在 README/文档注明"内部包名历史遗留 @cah/*，命令/品牌为 vessel"
- [ ] **哲学进 system 提示词（必须 IR 形态，不写死）**：Vessel Constitution 的 6 条主张转成 `configs/behavior.default.yaml` 的新 IR 条目（channel=prompt_guidance，id 前缀 vessel.*，render 为精炼中文主张），经 Behavior Compiler 编译进 stable system（沿用现有管线）——这正是"哲学以行为 IR 存在"的自洽
- [ ] Builder.ts 固定句改 "你是 Vessel 系统中的一个 Agent（Composable Agent Harness 核心）。"（或等价，含 Vessel）
- [ ] **三角色 constitution**：定义 Lead/Developer/Reviewer 三 preset（角色卡，含 Vessel 哲学继承句），落到 `docs/`（如 docs/VESSEL.md 或 agent-roles 更新）——不强制实现成代码 preset，先文档化（机制决策点 12：角色=配置）
- [ ] `docs/VESSEL.md`：品牌宣言 + 六条哲学 + constitution 全文 + 三角色
- [ ] `npx vitest run` 全绿（改固定句后 context 测试若断言旧句需同步改）；`npx tsc -b` exit 0
- [ ] 卡置"待验收"

## 涉及文件

- `apps/cli/package.json`（bin + vessel）、`apps/cli/src/cli.ts`（问候/帮助）
- `packages/context/src/builder/Builder.ts`（固定句）
- `configs/behavior.default.yaml`（新增 vessel.* IR 条目）
- `configs/policy.default.yaml`（如哲学含硬边界条目则加，如"安全规则硬执法"已有）
- `docs/VESSEL.md`（新）、`docs/agent-cli-analysis.html`（标题/文案 Vessel）、README（如根有）
- 相关测试同步 + `docs/V08-PROGRESS.md`

## 设计锚点

- 用户给的六条哲学全文在对话里（已在任务描述语境），以 Vessel Constitution 精简 6-8 条 IR 条目落地
- render 用"该怎么做"语句（非人设散文）——符合 behavior IR 语义
- 决策点 12：三角色是 preset 配置非新机制
- 硬边界哲学（软引导硬边界/不以自证为证）与既有 runtime_policy 条目呼应（不重复加，引用即可）

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
