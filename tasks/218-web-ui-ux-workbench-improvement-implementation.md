# 任务卡 218：Vessel Web UI/UX 工作台整改规范落地 (Web UI/UX Workbench Improvement Implementation)

**状态**：就绪待执行（2026-10-12）  
**负责人**：Codex (GPT-6.1 Sol / Medium 思考深度)  
**模式**：standard（一卡一闭环，交证即停）  
**第一事实源**：`docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md` (VESSEL-UI-2026-01)  
**前置基线**：Card 217 之后  
**交付证据**：本卡验收记录 + Web 定向测试 + Playwright 截图脚本验证 + Web 生产构建 exit 0  

---

## 1. 任务目标

全面依据 `docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md`，落地 **UI-P0 级核心产品工作台规范**，将当前“设置弹窗 + 会话列表”转型为“可组合 Agent 工作台”：

1. **信息架构重组（IA，第 2 节）**：
   - 确立清晰的一级区域划分：Workbench（工作台）、Activity（活动/跨项目运行）、Agent Studio（行为组装器）、Settings（设置）；
   - 规范化核心对象关系：Project（项目）→ Session（会话）→ Run（运行状态机）→ Subagent（子代理）；
2. **首页与任务启动流一体化（第 3 节）**：
   - 告别静态欢迎卡片与强制弹窗阻断，工作台中央常驻大任务输入区（选择项目 → 输入任务 → 开始）；
   - 模型选择与权限预设在输入区旁可视化直选，保留高级设置抽屉入口；
3. **命令面板语义化分组（Ctrl+K，第 5 节）**：
   - 消除大段 `sess_...` 裸 ID 与绝对路径，按“系统操作”、“最近项目”、“活跃会话”进行语义折叠；
4. **展示模块与系统权限解耦（第 5 节）**：
   - 明确“工作台视图定制”仅改变前端组件布局与显隐，不影响底层 Policy 与 Agent 权限；
5. **800px 移动端/窄屏响应式自适应（第 6 节）**：
   - 窄屏下侧边栏自动折叠为抽屉/底部导航，顶部状态紧凑化展示。

---

## 2. 纪律红线（硬门禁）

- **薄核零侵入**：`packages/core` 行修改必须严格为 0；
- **纯本地开发**：遵循 2026-10-06 规约，绝对不执行 git push，不向 npm 发布包；
- **Web 构建纪律**：构建命令必须携带 `-- --emptyOutDir false`，严禁清空 dist 目录；
- **全量测试**：必须通过 `npm run -w @vessel/web test`、`npm run -w @vessel/web typecheck` 与 `npm run test:all`。

---

## 3. 验收标准 (Acceptance Criteria)

- [ ] 完全遵照 `docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md` 落地 UI-P0 级工作台体验；
- [ ] 编写或更新对应的组件单测，定向测试 100% 通过；
- [ ] 运行 `python scripts/generate-screenshots.py` 重新捕获中英文双语 Retina 截图并验证视觉效果；
- [ ] Web 构建 `npm run -w @vessel/web build -- --emptyOutDir false` exit 0；
- [ ] 全量双 Root 测试全绿。
