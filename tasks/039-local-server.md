# 039 — Local Server（127.0.0.1:5678，API + SSE + 静态资源）

- 状态：待验收（实现完成，执行器回填工作证明）
- 优先级：P0（Milestone B；路线 §五 Local Server、§5.2 API）
- 创建日期：2026-09
- 关联：路线卡 039/040；goal（V1.0 产品化）；依赖 037/038（已合入）

## 目标

新建 `apps/local-server/`：同一个 Node 进程提供 HTTP API + SSE 事件流 + 静态 Web 资源，固定 `http://127.0.0.1:5678`（本机只读，不绑 0.0.0.0）。基于 @vessel/application 的 SessionController/SessionRegistry/ProjectRegistry，不复制 wiring。

## 验收标准

- [ ] `apps/local-server/` 包（name `@vessel/local-server` 或 apps/local-server，Node http 或 express 均可，优先零依赖 http 模块避免新依赖）
- [ ] 固定 `127.0.0.1:5678`（检查占用，被占换 5679 并提示）
- [ ] API 最小集合（§5.2）：
  - `GET /api/health` → ok
  - `GET /api/projects` / `POST /api/projects/open`（ProjectRegistry）
  - `GET /api/sessions` / `POST /api/sessions` / `GET /api/sessions/:id` / `POST /api/sessions/:id/turns`（SessionRegistry/SessionController.runTurn）
  - `POST /api/sessions/:id/interrupt` / `POST /api/sessions/:id/steer`（controller 占位即可，真实现入 C）
  - `GET /api/sessions/:id/events` → SSE（第一版可先发 ping/心跳 + turn 完成事件；真增量事件入 040）
- [ ] 静态资源目录（`apps/local-server/public/`，放占位 index.html 说明）
- [ ] `vessel serve` 命令（只起服务不开浏览器）；`vessel web`（起服务 + 开默认浏览器）——若 CLI 接入放本卡或 044，本卡至少 serve
- [ ] 测试：server 启动（随机端口注入）、health、open project、create session、runTurn（mock provider）、events SSE 头；用注入端口避免占用 5678
- [ ] 全量 vitest/tsc 绿（311+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `apps/local-server/{package.json,tsconfig.json,src/server.ts,src/index.ts,public/index.html}`
- `apps/cli/src/cli.ts`（加 serve/web 子命令分发；或本卡只建 server + 直跑验证，CLI 接入留 044）
- 根 tsconfig references / vitest aliases

## 依赖

- 037（application）、038（SessionController/Registry）
- 零依赖 http server（node:http）优先；不引 express 除非必要

## 方法

- `createServer({ port, projectRegistry, sessionRegistry, staticDir })` 返回 {listen, close}
- 路由用原生 http 的 request handler 分发
- SSE：`res.writeHead(200, {'Content-Type':'text/event-stream', ...})`，事件格式 `data: {...}\n\n`；订阅 controller.bus 转发 after_turn/after_model 等
- 测试注入 port=0（随机）拿实际端口

## 工作证明（执行器回填）

- [x] server 文件 / 测试 / API 冒烟 curl / tsc/vitest
  - 文件：`apps/local-server/{package.json,tsconfig.json,src/server.ts,src/index.ts,public/index.html}` + `src/server.test.ts`（7 例）
  - 冒烟：`tsx` 起服务于 127.0.0.1:5678，`/api/health` → `{"ok":true,"version":"0.10.0"}`，`/` → text/html
  - tsc -b exit 0；vitest 全量 323 全绿（基线 316 + 新增 7）
  - 根注册：tsconfig references + vitest alias/include

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：