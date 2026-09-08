# 041 — apps/web shell（React + Vite，本地 Web UI 骨架）

- 状态：待验收
- 优先级：P0（Milestone B；路线 §6、卡 041）
- 创建日期：2026-09
- 关联：路线卡 041/042/043；goal（V1.0 产品化）；依赖 039/040（server + SSE 已合入）、044（serve/web 命令）

## 目标

新建 `apps/web/`（React + Vite + TypeScript，CSS Variables 浅色/深色跟随系统）——本地 Web UI 的壳：极简左侧栏（New Session / Projects / Recent Sessions / Settings）+ 主区占位（连接 local server 的 health/projects/sessions 列表）。**不是大而全 UI，先做能跑通的壳。**

## 验收标准

- [ ] `apps/web/`（React + Vite + TS；vite.config 指向 dev server 代理到 127.0.0.1:5678 或直接 fetch 同源；dev 时代理 `/api` 到 local server）
- [ ] 浅色/深色跟随系统（CSS variables + prefers-color-scheme，遵循 docs/UI-THEME.md；不放手切按钮）
- [ ] 左侧栏：Vessel 品牌 + `+ New Session` + Projects 列表 + Recent Sessions + Settings（极简，无 Agents/Modules 一级菜单——按路线 §6.1）
- [ ] 主区：连接检查（fetch /api/health 显示 server 状态）+ sessions 列表（fetch /api/sessions）+ 打开会话占位
- [ ] 依赖：React + Vite（可按 route 文档推荐）；**不引 UI 框架**（不引 shadcn/tailwind 大件，CSS 手写遵循"少阴影/少卡片/少颜色/大量留白"）
- [ ] 生产构建：`vite build` 产物可被 local-server 静态服务（index.html 放 apps/local-server/public 或 web 构建产物指向）；本卡至少 dev 模式可跑
- [ ] 全量 vitest/tsc 绿（不破坏现有）；web 侧可加最小测试（如 utils/API 客户端 fetch 封装单测）——React 组件测试可选（vitest + jsdom 若已有配置则加，没有就跳过组件测，以构建+手动冒烟为准）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `apps/web/{package.json,vite.config.ts,tsconfig.json,index.html,src/{main.tsx,App.tsx,styles.css,api.ts,components/...}}`
- 根 package.json workspaces 已含 apps/*（确认）；根 tsconfig 可不引 web（vite 独立 tsconfig）

## 依赖

- 039/040（local server API+SSE）、044（serve/web 命令）；web 的 SSE 消费可在本卡或 042

## 方法

- 零依赖 UI：手写 CSS + CSS variables；fetch /api/health、/api/sessions、/api/projects
- vite dev proxy：`server: { proxy: { '/api': 'http://127.0.0.1:5678' } }`
- 组件极简：App（布局）、Sidebar、SessionList、StatusBar

## 工作证明（执行器回填）

- [x] web 结构 / 构建 / dev 冒烟 / 测试
  - `apps/web/`（React 18 + Vite 5 + TS）：package.json（@vessel/web@0.10.0）、vite.config.ts（/api 代理到 127.0.0.1:5678）、tsconfig、index.html、src/{main.tsx,App.tsx,styles.css,api.ts,api.test.ts}、src/components/{Sidebar,StatusBar,NewSessionForm,VesselLogo}.tsx、vitest.config.ts
  - 主题：styles.css 双套 CSS 变量（:root 浅色 + @media prefers-color-scheme dark），遵循 UI-THEME.md；`color-scheme: light dark`
  - 布局：左侧栏固定 240px（品牌 + New Session + Projects + Recent Sessions + Settings）+ 主区（health 状态点/version + 欢迎占位）
  - api.ts：fetch 封装 health/projects/sessions/openProject/createSession/runTurn，base 默认 /api 可注入；网络失败抛友好"请先 vessel serve"ApiError
  - 测试：apps/web vitest 7 passed（mock fetch 断言 URL/方法/body + 错误路径）
  - 构建：`npx vite build` 成功，产出 dist/（gitignore 覆盖，不提交）
  - root vitest: 337 passed；apps/web tsc --noEmit exit 0
  - 注意：根 `tsc -b` 因**其他并行任务的未提交 WIP**（packages/application/src/credential/ + apps/cli/src/providers/ProviderStore.ts 重构）报错，与本卡无关；本卡未动这些文件

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：