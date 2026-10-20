# Vessel Web UI & 架构全景审查包 (Export for GPT Review)

> 本目录为交付给网页端 / Chat 模式下 GPT（如 GPT-4o、o1、GPT-5 等）进行全面审美审查、交互走查与架构优化的完整资料包。
> 包含全部核心功能模块的真实高清 Retina 截图（深色/浅色）、架构设计文档、UI 设计规范以及最新基于 Taste-Skill 的审美审查报告。

---

## 一、项目定位与界面设计哲学

**Vessel（历史代号 Composable Agent Harness）** 是一个可组合、可验证、可替换行为层的下一代 Agent Harness，旨在为工程师提供像 Linear、Zed、VS Code、GitHub 那样专业、严正、沉浸的工业级工作台生产力体验。

### 核心设计原则（Taste-Skill Anti-Slop 准则）
1. **Edge-to-Edge 全屏通栏**：摒弃任何浮动孤岛卡片、大圆角弧形和四周留白缝隙；Rail（58px 图标轨）、Sidebar（232px 会话侧边栏）与主工作区（Main）顶天立地贴满视口（100vw × 100dvh），三栏之间以严格的 1px Hairline 细分割线划分。
2. **诚实材质与去浮华**：坚决剔除模糊毛玻璃、渐变光晕与大面积软阴影；深色模式采用平实深邃的炭黑底色（`#0d1117` / `#161b22`），浅色模式采用纯净纸白与暖灰底色（`#ffffff` / `#f6f8fa`）。
3. **控件几何克制**：除状态小圆点与极简圆标外，所有按钮、输入框、面板收敛为 4px–6px 实用微圆角，避免玩具般的过度圆润弧度。
4. **信息密度与工程层级**：强调色仅用于关键行为指引与执行状态提示；支持 GFM 增强 Markdown 排版与 OpenUI 生成式微组件卡片。

---

## 二、模块截图索引 (Screenshots Directory)

所有截图均已保存在 `screenshots/` 目录下（采用 Retina 2x 高清分辨率渲染），覆盖全部功能模块的深色（Dark）与浅色（Light）模式：

| 模块序号 | 功能区域与界面状态 | 截图文件 (深色模式) | 截图文件 (浅色模式) | 核心审查要点 |
|---|---|---|---|---|
| **01** | **工作台首页 (Workbench Home)** | `screenshots/01_workbench_home_dark.png` | `screenshots/01_workbench_home_light.png` | 全屏 Edge-to-Edge 贴边、58px 图标轨、232px 会话树、右侧 8 Tab 检视器展开态 |
| **02** | **任务启动输入框 (Task Composer)** | `screenshots/02_task_composer_focused_dark.png` | `screenshots/02_task_composer_focused_light.png` | 聚焦输入态、微圆角外壳、模型/权限直选胶囊、常驻计量指示 |
| **03** | **会话对话流 (Conversation View)** | `screenshots/03_conversation_view_dark.png` | `screenshots/03_conversation_view_light.png` | 多轮历史对话、Markdown 表格/列表渲染、工具调用状态展开折叠 |
| **04** | **设置中心：模型供应商中枢 (Provider Hub)** | `screenshots/04_provider_hub_settings_dark.png` | `screenshots/04_provider_hub_settings_light.png` | 全屏独立平铺大视图、供应商预设库、CC-Switch 级别多模型支持 |
| **05** | **供应商卡片与预设详情 (Preset Details)** | `screenshots/05_provider_hub_preset_detail_dark.png` | `screenshots/05_provider_hub_preset_detail_light.png` | 飞书 Lark 等大厂预设展开、多模型选择芯片（ModelChips）、实时过滤 |
| **06** | **团队活动与任务树 (Activity & Tasks)** | `screenshots/06_activity_tab_dark.png` | `screenshots/06_activity_tab_light.png` | 团队 DAG 任务树编排、集中审批队列、跨会话执行流可观察性 |
| **07** | **Agent 工作室 (Agent Studio)** | `screenshots/07_agent_studio_tab_dark.png` | `screenshots/07_agent_studio_tab_light.png` | 交互式 Agent Composer、Behavior IR 语义阶梯只读检查面板 |
| **08** | **全局命令面板 (Command Palette)** | `screenshots/08_command_palette_ctrl_k_dark.png` | *(通过快捷键 Ctrl+K 唤出)* | 浮层快捷检索、按系统/项目/会话语义折叠、快速导航 |
| **09** | **底部模型快速切换器 (Model Quick Switcher)** | `screenshots/09_model_quick_switcher_popover_dark.png` | *(底栏 Popover 浮层态)* | 在线状态指示灯、供应商分组模型选择器 |
| **10** | **移动端/窄屏响应式 (800px Responsive)** | `screenshots/10_mobile_responsive_800px_dark.png` | `screenshots/10_mobile_responsive_800px_light.png` | 窄视口下的无障碍折叠抽屉、全宽布局流式伸缩 |

---

## 三、文档目录导引 (Documentation)

### 1. `01_architecture/`（核心架构）
- **`ARCHITECTURE.md`**：系统分层、模块边界与 14 个 packages 的薄核职责划分；
- **`DESIGN-DECISIONS.md`**：全仓 21 项核心不可违背的架构决策（包括 Thin Core、Zero Push、Clean Room 等）；
- **`ARCHITECTURE_IMPROVEMENT_PLAN.md`**：ARC-01 至 ARC-11 架构整改白皮书。

### 2. `02_ui_ux_design/`（UI/UX 规范与设计系统）
- **`DESIGN.md`**：设计系统令牌规范（CSS Tokens、栅格比例、颜色表、字体体系）；
- **`UI_UX_IMPROVEMENT_PLAN.md`**：UI-001 至 UI-017 工作台重构实施方案；
- **`TASTE_SKILL_AUDIT.md`**：Codex 独立产出的 5 大审美缺陷审查与全屏重构方案；
- **`TASTE_SKILL_APP_SCREENS_REFERENCE.md`**：Taste-Skill 官方 app-screens 界面设计法则参考。

### 3. `03_feature_specifications/`（功能与协议规格）
- **`EVENT_SPEC.md`**：不可变事件流规范与 D5 事件词汇；
- **`POLICY_SPEC.md`**：Policy 安全硬执法拦截引擎规约；
- **`BEHAVIOR_IR_SPEC.md`**：可移植 Agent Behavior IR 与行为编译器规约；
- **`BENCHMARK_SPEC.md`**：Cross-Harness 机械验证与评估基准。

### 4. `04_project_status_and_tasks/`（任务状态与交接）
- **`TASKS_README.md`**：全任务卡看板与演进路线表；
- **`TASK_234_OPENUI_POLISH.md`**：Task 234 交互痛点与 OpenUI 方案卡；
- **`TASK_235_TASTE_REFACTOR.md`**：Task 235 Taste-Skill 全屏通栏重构交付卡；
- **`HANDOFF.md`**：最新工程交接备忘录。

---

## 四、建议给 ChatGPT 网页端的审查提示词 (Prompt Template)

你可以直接将以下提示词与本目录下的截图及文档发送给网页端 GPT 进行全方位审查：

```markdown
请你扮演一位顶级的全栈系统架构师与工业级前端设计工程师（对标 Linear、Zed、VS Code、GitHub 设计团队）。
我向你提供了 Vessel Agent Harness Web 工作台的完整审查包（包含 18 张高清全景截图及架构/UI文档）。

【审查背景与核心原则】
我们彻底摒弃了浮动毛玻璃卡片岛与多余大圆角，重构落地了顶天立地、以 1px Hairline 细分割线划分的 Edge-to-Edge 全屏工整工作台（深浅双色，极简 4-6px 实用微圆角）。

【审查重点】
1. 视觉审美与排版审查（对标 Taste-Skill / Linear / Zed）：
   - 检查各个功能模块（Workbench、Activity、Studio、ProviderHub、Conversation）在深色与浅色下的层次对比、字体对比度、间距严整度；
   - 是否还有任何视觉杂质、多余弧度、不对齐或破坏工业级质感的地方？
2. 交互可用性与信息架构（IA）审查：
   - 会话树、任务启动器、模型切换浮层、全局命令面板的交互流是否直觉、无多余操作负担？
   - ProviderHub 全屏中枢的预设库分类、模型 Chips 多选与搜索机制是否达到 CC-Switch 顶级水准？
3. 后续演进建议：
   - 结合 01_architecture 与 03_feature_specifications，在保持 Thin Core 极薄核心（修改行数为 0）的前提下，前端还能引入哪些令人惊艳的微交互或工作流优化？
```
