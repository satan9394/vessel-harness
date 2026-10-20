# bsk 浏览器功能走查（2026-10-15）

> 工具：`browser-skill`（`bsk` CLI + 用户 Chrome 扩展）。会话：独立 Agent Window（未借用用户标签页）。
> 目标：对 `apps/web` 新 UI 做真实浏览器功能走查。
> 入口：`http://127.0.0.1:5173/`（Vite dev，`/api` 代理到 `127.0.0.1:5678` 本地服务器）。

## 0. 环境

```powershell
# 本宿主会回收子进程：守护进程须在持久后台任务里 --foreground
$env:BSK_AUTO_START='0'; bsk daemon start --foreground      # 后台任务
$env:BSK_AUTO_START='0'; bsk session start --browser <instance> --width 1440 --height 1000
$env:BSK_AUTO_START='0'; bsk navigate http://127.0.0.1:5173/ --session <id>
```

> **PowerShell 坑**：`@eN` 会被当作 splatting 语法吞掉，必须 `bsk click --ref '@e2' ...`。

## 1. 走查覆盖与结果

| 区域 / 功能 | 结果 | 证据 |
|---|---|---|
| 四栏骨架 + 图标轨（工作台/活动/Agent Studio/设置） | ✅ | `01-activity.png`、`08-overlap-fixed.png` |
| 活动页：跨项目运行 + 集中审批队列（真实数据） | ✅ | `01-activity.png` |
| Agent Studio：行为库加载 + 加入规则 + 排序 + 校验一致性（L0–L4） | ⚠️→✅ 见 §2.1 | `04-studio-verify-fixed.png` |
| 会话视图：模型选择 / 模型能力 / 沙箱审计 / 计划清单 / 四胶囊 / 常驻计量 | ✅ | `08-overlap-fixed.png` |
| 命令面板（Ctrl/Cmd+K：系统操作 / 最近项目 / 活跃会话 分组） | ✅ | `05-command-palette.png` |
| 设置页（模型设置 / 视图 / 语言 / 通知） | ✅ | `09-settings.png` |
| 语言切换 中文 ↔ English（含导航 aria-label） | ✅ | `10-settings-en.png` |
| 会话创建（mock）、runTurn、SSE、健康检查 | ✅ | 网络 200；`POST /sessions` 201 |
| `/api` 全部请求 | ✅ | 修复后无 403 |

## 2. 发现的缺陷与处理

### 2.1 【已修复·阻断级】Vite 代理使同源门禁误判 → 所有带 Origin 的写请求 403

**现象**：Agent Studio「校验一致性」报错；`POST /api/behavior/compose` 返回 **403**。

**根因**：`apps/web/vite.config.ts` 的代理用字符串简写，而 **Vite 8 代理默认 `changeOrigin: true`**，会把 Host 改写成 `127.0.0.1:5678`。
本地服务器的同源门禁：

```ts
function trustedOrigin(req, url, authenticated) {
  return (authenticated || ['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    && (!req.headers.origin || req.headers.origin === url.origin);
}
```

`url` 由 `req.headers.host` 构造，于是 `url.origin = http://127.0.0.1:5678`，而浏览器 `Origin = http://127.0.0.1:5173` → **不相等 → 403**。
（GET 不带 Origin 所以侥幸通过，POST/PUT/PATCH/DELETE 全挂。）

**影响面**（经代理实测）：

| 请求 | 修复前 | 修复后 |
|---|---|---|
| `GET /api/models`（带 Origin） | 403 | 200 |
| `GET /api/behavior/library`（带 Origin） | 403 | 200 |
| `POST /api/behavior/compose` | 403 | 400（正常）→ 应用内 200 |
| `POST /api/providers` / `providers/test` / `DELETE providers/:id` | 403 | 200 |
| `POST /api/sessions`（真实供应商，非 mock） | 403 | 200 |

**修复**（`apps/web/vite.config.ts`，保留后端安全门禁不变，只让代理保留浏览器 Host）：

```ts
'/api': { target: 'http://127.0.0.1:5678', changeOrigin: false },
```

**复验**：应用内点「校验一致性」→ `POST /api/behavior/compose` **200**，UI 渲染 L0–L4 兼容阶梯（`04-studio-verify-fixed.png`）。

> 未改后端 `trustedOrigin`——那是防跨站写请求的安全控制，只应在开发代理侧修正。

### 2.2 【已修复】矮视口下计划/模块面板与输入区重叠

**现象**：会话视图里「目标任务」模块卡浮在输入区上方，与胶囊行/输入框重叠。

**根因**：`.conversation-wrap` 为 flex 列，`.dual-surface`（会话）`flex:1; min-height:0` 会被同级 `.module-sections` 挤到 229px，而会话内容（头 + 消息区 + 计量 + 沙箱审计 + 输入区）需 ~375px；溢出部分（`overflow: visible`）压到模块面板上。

实测几何（修复前，视口 1201×567）：
`dual.h=229`、`composerShell.top=309`、`modules.top=288` → **overlap ≈ 124px**。

**修复**：
- `layout.css`：`.dual-surface { flex: 1 0 auto; min-height: 420px; }`（会话区保底可用高度）。
- `styles.css`：`.conversation-wrap { overflow-y: auto; }`、`.module-sections { flex: none; }`（放不下就滚动，不重叠）。

**复验**：同视口 `overlap: 0`；`composerShell 498–622`、`modules 622–870`（`08-overlap-fixed.png`）。

### 2.3 【已修复】活动页运行卡显示完整绝对路径 + 时间格式

活动审批队列卡片原先显示 `项目: C:\Users\SATANC~1\AppData\Local\Temp\vessel-uilanding-fixture-OPAtVt`（完整临时路径），
时间为 `toLocaleString()` 长格式。

**修复**（`ActivityQueue.tsx`）：项目 → `shortPathLabel(run.projectRoot)`（只显示可读叶名，完整路径收进 `title`）；
时间 → `formatStamp(run.updatedAt)`（`MM-DD HH:mm`）。

**复验**：活动卡现为 `项目: vessel-uilanding-fixture-OPAtVt`、`更新于: 10-15 00:25`（截图 `12-activity-path-fixed.png`）。

> 未改 `TeamTaskTree.tsx` 的 `projectRoot` —— 它渲染在 `<code>` 详情块内，正是 `DESIGN.md §6.2` 要求的
> 「完整值收进详情等宽块」，属正确行为。
> 附带观察（未改）：`ActivityQueue` 对**无 topic 标题**的会话会显示裸 id（`sess_…`）；该值来自服务端聚合
> `run.title`，正常建会话流程会写入确定性标题，我的 API 直建测试会话才出现。

### 2.4 【已修复】输入区「模型」胶囊显示 `default`（用户反馈）

**现象**：会话视图输入区胶囊行的「模型」显示字面 `default`，无信息量。

**根因**：`ComposerCapsules` 直接渲染 `session.model`，而服务端该字段就是 `default`（`GET /api/sessions` 实测 `provider:"mock", model:"default"`）。

**修复**：`ComposerMeters.tsx` 新增纯函数 `resolveModelLabel(provider, model)`：
- `provider === 'mock'` → 走字典 `modelOffline`（「演示模型（不连接真实供应商）」）；
- 真实会话 → `provider / model`；
- 占位值（`default`/`unknown`/`n/a`/`none`/`-`/`—`/空）→ 回退为仅 provider；
- 全空 → `—`。

**复验**：中/英双语实测胶囊 —— `模型 演示模型（不连接真实供应商）` / `Model Demo model (no real provider connection)`（截图 `11-model-capsule-fixed.png`）。
单测新增 3 项（占位值不回显、`provider / model` 拼装、offline 走字典）。

## 3. 说明与边界

- **`vessel serve` / `vessel web` 不提供本 Web UI**：它们服务 `apps/local-server/public/`（一张「Vessel Local Server running」着陆页）。构建产物 `apps/web/dist` 未被复制进该目录，也没有相应脚本。因此当前查看 Web UI 的**唯一可用入口是 Vite dev**（本次已修好其 403）。
- 本会话使用 **mock provider**（`演示模型（不连接真实供应商）`）；未做真实供应商联网走查。
- 未测试：SOUL/守护进程/TUI；未做移动端真机。

## 4. 本轮改动（走查期间）

```
apps/web/vite.config.ts                     代理 changeOrigin:false（修 403）
apps/web/src/components/layout/layout.css   .dual-surface 保底高度（修重叠）
apps/web/src/styles.css                     .conversation-wrap 滚动 + .module-sections flex:none
evidence/sessions/2026-10-15-ui-landing/bsk-functional/*.png   10 张走查截图
```

门禁（改动后重跑）：`npx tsc -b` / `npm run typecheck:tests` / `npm run -w @vessel/web typecheck` /
`npm run -w @vessel/web build -- --emptyOutDir false` / `npm run test:all` 全 exit 0；
根 289 文件 3037 passed + 6 skipped，web 40 文件 337 passed；`packages/core` 零改动。
