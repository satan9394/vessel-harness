# 任务卡 219：全量功能端到端交互与真实点击测试套件 (Full Surface Interactive E2E & Click-Testing Suite)

**状态**：已验证（2026-10-13；standard 交证即停）  
**负责人**：Codex (GPT-6.1 Sol / Medium 思考深度)  
**模式**：standard（一卡一闭环，交证即停）  
**Source**：human-requested（用户要求对全部功能进行真实点击走查测试）  
**Risk**：low（测试证据 + 用户授权的 apps/web 会话历史回放定向修复；core 零侵入）  
**前置基线**：HEAD `26ba6fe`（Card 217、Card 218 之后）  
**交付证据**：本卡验收记录 + 全功能点击测试报告 + 浏览器点击执行日志与断言回执  

---

## 1. 任务目标与背景

在完成 V2.7 架构底座（ARC-01..05）与 V2.8 可组合 Agent 工作台（VESSEL-UI-2026-01）后，需要对系统所有前端用户界面进行**全量、地毯式的真实点击与交互测试（Click-Testing Walkthrough）**。

使用真实无头/有头浏览器（Playwright），模拟用户鼠标点击、键盘输入、快捷键触发、表单交互与弹窗流转，逐一验证全部 UI 按钮与可交互元素的响应性、状态流转正确性，并硬性断言无任何未捕获异常（Uncaught Exception）、控制台报错（Console Error）或布局断裂。

---

## 2. 全量功能点击测试矩阵 (Full Click-Test Matrix)

测试套件必须对以下 7 个核心产品区域进行 100% 交互覆盖与断言：

### 2.1 导航与一级区域切换 (Primary Navigation)
- [ ] 点击侧边栏 **Workbench**：高亮激活，中央展示工作台主界面；
- [ ] 点击侧边栏 **Activity**：高亮激活，展示全局子代理运行列表与历史会话活动；
- [ ] 点击侧边栏 **Agent Studio**：高亮激活，展示认知数据与只读行为声明视图；
- [ ] 点击侧边栏 **Settings**：高亮激活，展示全局偏好设置。

### 2.2 工作台任务启动器 (Task Composer)
- [ ] 点击项目选择器下拉框：展开项目列表，点击选择指定项目；
- [ ] 点击任务输入框：正确聚焦，模拟文本键入；
- [ ] 空输入点击“开始任务”：触发校验提示，阻止无意义创建；
- [ ] 点击模型选择 Pill：展开模型下拉列表，切换不同接入模型；
- [ ] 点击权限预设 Pill：切换只读/确认/完全访问权限模式；
- [ ] 有效任务输入点击“开始任务”：成功创建会话并平滑过渡至执行工作台。

### 2.3 会话与对话执行工作台 (Conversation Surface)
- [ ] 会话列表项点击：切换不同历史会话，右侧即时加载对应消息树；
- [ ] 消息输入框输入与发送：点击发送按钮或回车，消息进入队列；
- [ ] 流式思考折叠：点击思考卡片折叠/展开按钮，内容无抖动展开；
- [ ] 单 Hunk 补丁操作：点击“采纳补丁 (Apply)”与“放弃 (Discard)”按钮，状态正确更新；
- [ ] Docked Inspector Tab 切换：逐个点击 Goals / Changed Files / Tool Activity / Logs 四个选项卡，内容正确切换展示。

### 2.4 供应商管理与多模型中枢 (Provider Settings)
- [ ] 点击顶部“模型/供应商设置”按钮：唤出 ProviderSettingsModal 抽屉；
- [ ] 切换预设模板：点击选择 DeepSeek / OpenAI / Claude / Ollama 预设，表单自动填充对应协议与默认 Base URL；
- [ ] 表单输入：输入 Base URL 与 API Key；
- [ ] 点击“测试连接”：展示连通性加载指示器并断言延迟返回结果；
- [ ] 点击“拉取模型”：展示探测状态，成功解析模型列表并回填逗号分隔框；
- [ ] 点击“保存配置”：保存至本地存储，并在模型下拉列表中可见；
- [ ] 点击“删除配置”：确认后成功移除并级联清理凭据。

### 2.5 全局命令面板 (Command Palette, Ctrl+K)
- [ ] 键盘触发 `Ctrl+K`：命令面板即时弹出，输入框自动聚焦；
- [ ] 键盘上下方向键导航：选项高亮随光标移动；
- [ ] 分类点击：直接鼠标点击“系统操作”、“最近项目”、“活跃会话”中的具体项目并执行对应动作；
- [ ] 键盘 `Escape` 键点击：弹窗关闭且焦点恢复至触发前的原始元素。

### 2.6 视图显隐定制面板 (Display Customization)
- [ ] 点击顶部“视图定制”按钮：展开 CustomizePanel 面板；
- [ ] 复选框点击：逐一勾选与取消勾选各个模块（Goals, Changed Files, Tool Activity 等），验证仅控制界面显示隐藏，不影响底层 Policy；
- [ ] 点击“重置默认布局”按钮：所有复选框恢复初始状态。

### 2.7 窄屏与移动端响应式抽屉 (≤800px Responsive)
- [ ] 调整视口至 800px 宽度：侧边栏自动收缩为汉堡抽屉按钮；
- [ ] 点击汉堡按钮：自适应抽屉滑出，底层内容进入 inert 状态；
- [ ] 键盘 `Tab` 键循环：焦点严格锁定在抽屉内部可见控件中；
- [ ] 点击遮罩层或按 `Escape`：抽屉平滑关闭，主视口恢复可交互。

---

## 3. 纪律红线与硬门禁

1. **薄核零侵入**：`packages/core` 行修改必须严格为 0；
2. **纯本地开发**：遵循 2026-10-06 规约，绝对不执行 git push，不向 npm 发布包；
3. **删除铁律**：全仓禁止彻底删除，任何临时文件自建自理；
4. **依赖锁定**：包管理器严格锁定 npm，严禁引入非 npm 锁文件；
5. **门禁命令**：测试必须跑通全量双 Root `npm run test:all` 与 Web 编译构建。

---

## 4. 验收标准 (Acceptance Criteria)

- [x] 落地完整的点击走查自动化脚本（如 `tests/e2e/full-surface-walkthrough.test.ts` 或 `evidence/sessions/2026-10-13-card219/click-walkthrough.py`）；
- [x] 上述 7 大区域共 20+ 个具体交互点击项全部执行并断言通过；
- [x] 运行期间无任何未捕获控制台错误（Console errors = 0）；
- [x] 产出结构化的点击测试报告（含通过步骤与证据回执）；
- [x] 全量门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run test:all` 均 exit 0；
- [x] `git diff --stat packages/core` 变动行数严格为 0。

## 5. 执行边界（用户澄清，2026-10-12）

- 保持纯测试，不修改产品 UI 或权限模型。
- Inspector 按现有 Swarm / Rules / Cache / Impact / Patch 五个 Tab 验证，报告原任务措辞差异。
- 记录 Reset default layout 与 full-access 控件缺失；空任务按现有禁用开始按钮验证。
- Blast Radius：本卡、任务索引、evidence/sessions/2026-10-13-card219 及用户授权的 apps/web 会话回放修复；packages/core、后端和依赖锁零修改。
- Expected Evidence：逐步点击/断言回执、console/pageerror、隔离真实服务读回、截图、最终门禁日志与 PROOF.md。

### 范围变更（用户授权，2026-10-13）

历史消息树点击读回已真实复现失败。用户授权针对性修复，严格仅限 apps/web/，以会话切换时的消息重载与状态回放为目标；packages/core 与后端仍为 0 diff。修复后重跑完整点击套件、Web 单测与全部硬门禁。原始红证据保留于 history-readback.json/log。

## 6. Result / 验收收口

已按用户澄清后的矩阵完成真实点击走查，并完成授权的 apps/web 会话切换回放修复。结果、根因、原始红证据、最终门禁、已知控件缺项与 live workbuddy 测试边界统一见 [PROOF.md](../evidence/sessions/2026-10-13-card219/PROOF.md)；结构化验收见同目录 completion-audit.json。本卡已验证；未提交、未推送、未发布，不续下一卡。

原 §2 保留初始矩阵文字作为来源记录；其完成映射与用户批准的现有控件差异见 PROOF.md / CLICK-REPORT.md，未把不存在的控件虚报为点击通过。
