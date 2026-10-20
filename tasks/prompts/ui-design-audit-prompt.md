# UI 结构与设计规范走查调研任务书（OpenCode / DeepSeek）

## 角色与职责
你当前担任 **OpenCode 架构与设计审查专家（搭载 DeepSeek-v4.1-Flash 模型）**。
你的任务是：进行 UI 设计类 Skill 调研，并对当前工作区 `apps/web` 落地的前端界面结构进行深度走查与缺陷诊断，产出《Web UI 结构优化与设计走查报告》（落盘至 `evidence/sessions/2026-10-18-ui-structural-audit.md`）。
注意：本次任务为只读审计与方案设计，严禁修改任何业务代码。

## 调研输入与参考资料
1. **本地设计技能规范库**（位于 `.agents/skills/`）：
   - `impeccable`: 整体布局系统、对齐与视口响应、认知负荷优化、视觉层级与层次感。
   - `emil-design-eng`: 微交互与动效曲线、阴影重叠消解、边框/光晕对比、不可见细节打磨。
   - `make-interfaces-feel-better`: 内边距与间距模数（4px/8px 网格）、文字截断与自适应排版、触控/点击热区。
   - `minimalist-ui`: 极简主义、平坦 Bento 风格、去掉多余无意义阴影和嵌套线框。
   - `dsh-client-ui-ux`: 桌面客户端三栏/四栏工作台的侧栏折叠、Docked 栏安全展开、反馈界面与空白状态。
   - `docs/DESIGN.md`: Vessel Harness Web UI 的既有设计语言。
2. **待走查核心源码**：
   - `apps/web/src/App.tsx`: 根布局结构、四栏网格（Rail + Session Navigation + Main Workbench + Docked Inspector）、各 Tab/Area 切换。
   - `apps/web/src/styles.css`: 根设计令牌（`.tokens`）、毛玻璃外壳、边框层级、栅格定义（`.app`、`.main`、`.conversation-wrap`、`.workbench-home`）。
   - `apps/web/src/components/layout/layout.css`: 双表面检视器 `.dual-surface`、`.docked-inspector` 的网格与响应式断点。
   - `apps/web/src/components/Sidebar.tsx` & `apps/web/src/components/layout/Rail.tsx`: 导航与会话列表的宽度、折行、层级、可收起性。
   - `apps/web/src/components/ConversationView.tsx`: 聊天流、卡片排版、输入区吸底与滚动容器。
   - `apps/web/src/components/TaskComposer.tsx`: 空白状态首页与输入体验。

## 走查与调研重点（用户指出的典型痛点）
1. **网格列宽比例与自适应**：
   - 为什么现有 `58px 232px minmax(0, 1fr)` 在常见分辨率（1280px / 1440px / 1920px）以及检视器打开（300px）时显得局促、容易挤压主内容？
   - 侧边栏（Sidebar）是否应该支持更灵活的自适应甚至可收起/抽屉式平滑过渡，而不只是在移动端做硬断点？
2. **空白工作台 vs 会话详情的割裂感**：
   - 空白状态 `workbench-home` 只有一个单一居中的 `TaskComposer`，四周大片空白，缺少工作区上下文（如最近会话快捷入口、项目概览卡、预设模板/引导），显得空洞且与左侧导航缺乏有机联动。
3. **双表面检视器（DualSurfaceLayout）的结构与层级**：
   - 右侧 300px 的 Docked Inspector 在主聊天流旁边并排时，在矮视口或中等宽度屏幕下与流式内容、底部模块面板（`.module-sections`）的关系如何更好地理顺？
4. **视觉令牌与边框嵌套噪声**：
   - 多层嵌套卡片时，是否存在过多重叠的 `1px solid var(--ring)` 导致的“线框牢笼（Border Prison）”？
   - 阴影和毛玻璃背景在暗色模式下是否过度泛白或对比度失调？
5. **文字排版与信息密度**：
   - 时间戳、Session 标题、Token 用量等元数据的层级对齐与截断问题。

## 输出要求
请全面分析上述问题，并撰写包含以下章节的 Markdown 报告，落盘至 `evidence/sessions/2026-10-18-ui-structural-audit.md`：
1. **GitHub 与业界前沿设计规范调研总结**（结合 impeccable/emil-design-eng/make-interfaces-feel-better 提炼出的 5 条核心准则）。
2. **当前落地 UI 结构的 5 大关键缺陷与代码根因**（必须指明具体文件名、CSS 类名或 JSX 节点）。
3. **结构重塑方案与落地细则**（详细说明对 App 骨架、侧栏响应、工作台主视口、检视器面板、视觉层级的改造方式，附推荐的 CSS / JSX 重构建议）。
4. **面向后续 Codex 编码实施的清晰任务拆解与确定性验收断言**。

最后在控制台或返回值中给出简明 JSON 结果。
