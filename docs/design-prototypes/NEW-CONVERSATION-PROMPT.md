# 新对话开局 Prompt（整段复制）

> 用途：把下面代码块里的内容**整段复制**为新对话的第一条消息。
> 设计意图：让新会话**不依赖上一轮上下文**也能独立完成 UI 落地，且不会漏掉已实现功能。

```text
【任务】把 Vessel Web 界面的 UI 改造正式落地到 apps/web 真实代码。

【背景】原型与规范已定稿并留档，你这一步只做"实施"，不做设计探索：
- 视觉 = 玻璃（Glass）；信息架构 = 四栏工作台/审阅台
  （58px 图标轨 + 232px 会话/项目栏 + 中央过程流 + 300px 审阅栏）
- 唯一权威视觉参考：docs/design-prototypes/prototype-full-glass.html
- 视觉规格：docs/DESIGN.md
- 实施规划：docs/design-prototypes/IMPLEMENTATION-PLAN.md  ← 主依据
- 功能回归基准：docs/design-prototypes/FEATURE-COVERAGE.md  ← 不许漏功能
- 原型截图总览：evidence/sessions/2026-10-14-card223/ui/index.html

【开工顺序】先读，再动手：
1) HANDOFF.md（接管协议与现状）
2) AGENTS.md（硬性约束 10 条 + 禁做清单）
3) docs/design-prototypes/IMPLEMENTATION-PLAN.md（P1–P8 分阶段与验收）
4) docs/design-prototypes/FEATURE-COVERAGE.md（B1–B18 逐条回归清单）
5) docs/DESIGN.md（玻璃令牌表、四栏规格、各区域职责）
6) docs/UI-THEME.md（浅色默认 + 跟随系统）
读完先复述：你打算怎么分阶段、每阶段怎么验证、哪些是"绝不能丢"的功能。

【硬约束（违反即失败）】
- packages/core 零改动（git diff --stat packages/core/ 必须为空）
- 不引入新依赖；包管理器锁 npm；禁止 pnpm/bun/yarn 锁文件；不引入 Tailwind
- 浅色默认 + 深色跟随 prefers-color-scheme；产品不提供手动浅深切换
- 颜色只写 CSS 变量，禁止组件内硬编码 hex
- Web 构建用 `npm run -w @vessel/web build`（默认保留 dist，无需额外参数；要清空时用 `npm run -w @vessel/web build:clean`）
- 中英双语不回退，文案一律走 apps/web/src/i18n.ts 字典
- 删除一律进回收站，禁止任何永久删除命令
- 纯本地：不 commit / 不 push / 不 publish；不驱动本机其它 agent
- 尊重 prefers-reduced-motion；动效只动 transform / opacity

【实施步骤】按 IMPLEMENTATION-PLAN.md §4 的 P1–P8 顺序执行，每阶段跑定向测试再进下一步：
P1 令牌层（styles.css 换玻璃令牌，旧变量名保留为别名）
P2 玻璃外壳（导航轨/顶栏 backdrop-filter；面板改浮动）
P3 四栏骨架（含检视器，必须是真实 8 个 Tab）
P4 中央过程流（常驻计划清单 + 就地 diff + 三档授权卡）
P5 输入区与计量（项目/模型/审批档位/模式胶囊 + 常驻计量）
P6 修丑点（1px 灰框、裸 slug 与长路径、空/加载/错误态、Agent Studio 卡片墙）
P7 功能覆盖对齐（B1–B18 全部接回真实代码，每项都要有可达入口）
P8 门禁与截图证据

【关于检视器的硬事实（此前设计稿曾写错，务必照此实现）】
真实定义在 apps/web/src/components/layout/DualSurfaceLayout.tsx：
INSPECTOR_TABS = ['swarm','cognition','context','cache','ast','patch','tasks','trace']（8 个）
中文标签取字典原值：代理网络 / 认知规则 / 上下文 / 模型缓存 / 影响范围 / 代码补丁 / 任务树 / 追踪
面板名＝画布检视器；保留 Ctrl/Cmd+I 开关、vessel.inspector 持久化、
以及 ≤1023px 转为模态（焦点陷阱 + Esc 关闭 + 回焦）的既有行为。
注意：改动文件属于 ChangedFiles 模块，不是检视器 Tab。

【完成定义（DoD）】
- FEATURE-COVERAGE.md 的 B1–B18 逐条有可达入口，并在该表上标注证据
- 门禁四项全 exit 0：npx tsc -b / npm run typecheck:tests /
  npm run -w @vessel/web build / npm run test:all（根 + apps/web 双 root）
- packages/core 零改动；双 root 测试全绿
- 中英双语无新增硬编码；prefers-reduced-motion 生效；≤1023px 检视器模态正确
- 截图矩阵（中英 × 浅/深 × 桌面/1366/1023/800）齐备并留档
- 未 commit / 未 push / 无永久删除

【交付证据】
evidence/sessions/<日期>-ui-landing/：门禁日志 + 截图矩阵 + 画廊页
并把回归结果写回 docs/design-prototypes/FEATURE-COVERAGE.md（逐项打勾 + 证据）

【最重要的提醒】
本次第一风险不是"做得不好看"，而是**改完 UI 之后功能缺失**。
以 FEATURE-COVERAGE.md 为准，改之前核一遍、改之后必须再核一遍；
凡是你认为"这个功能好像没必要放在界面上"的，先列出来问我，不要自行删减入口。
不确定就再对比代码（组件 / api.ts 的端点注释 / i18n.ts 的字典键），不要凭印象下结论。

现在开始：先读上述 6 份文件，然后向我复述分阶段计划与"绝不能丢的功能"清单，等我确认后再动代码。
```

## 用法提示

- 若新会话上下文充裕，可省掉"先复述计划"那一步，直接按 P1–P8 执行。
- 若只想先做视觉、暂不动功能对齐，把 P7 单独拆成第二个会话（但**P8 的回归不可省**）。
- 需要对照真实界面时，用仓库既有命令：`vessel serve`（默认 `http://127.0.0.1:5678`）或 `vessel web`。
