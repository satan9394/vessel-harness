# 044 — vessel web / vessel serve：Local Server 接入 CLI

- 状态：待执行
- 优先级：P0（Milestone B 闭环；路线 §3.3、§5.1）
- 创建日期：2026-09
- 关联：路线卡 044；goal（V1.0 产品化）；依赖 039（local-server 已合入 5d76be7）

## 目标

让 `vessel serve`（只起服务）与 `vessel web`（起服务 + 打开默认浏览器）作为 CLI 子命令可用，固定 127.0.0.1:5678，作为产品入口。

## 验收标准

- [ ] `vessel serve`：启动 local server（默认 127.0.0.1:5678），打印地址，不自动开浏览器，进程常驻（Ctrl+C 优雅退出）
- [ ] `vessel web`：启动 server + 打开系统默认浏览器（Windows `start http://127.0.0.1:5678` 或 node open 方式，零依赖实现：`child_process.spawn('cmd', ['/c','start',url])` 或 `start` 命令）
- [ ] 端口占用处理：5678 被占 → 提示并选 5679/5678+n（或直接报清晰错误；按路线"检查 5678 若未启动则启动"，被占用给明确提示）
- [ ] 会话默认工厂：未注入 sessionFactory 时默认 mock（039 已有），`--workspace` 可指定工作区
- [ ] 命令进 USAGE 帮助 + `vessel --help` 显示
- [ ] 测试：CLI 分发（serve/web 解析）、端口逻辑（注入）、帮助文本含 serve/web；server 本身已有测试不重测
- [ ] 全量 vitest/tsc 绿（323+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- `apps/cli/src/cli.ts`（加 serve/web 分发 + USAGE）
- 可能 `apps/local-server/src/server.ts` 补一个 startAndOpenBrowser helper（或放 cli 层）
- 测试 + 文档（README 命令表的 serve/web 从"开发中"改为可用；CHANGELOG 补）

## 依赖

- 039（已合入）；043（web shell）不依赖本卡——本卡先起服务+占位页

## 方法

- serve：`node:http` server 已封装在 createVesselServer；cli 里创建后 listen，打印 URL，进程挂起（如 setInterval noop 或 await new Promise）
- web：serve + spawn('cmd',['/c','start',url])（Windows）或 node open 兼容
- 帮助文本更新

## 工作证明（执行器回填）

- [ ] CLI 分发 diff / 测试 / 端口逻辑 / tsc/vitest

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：