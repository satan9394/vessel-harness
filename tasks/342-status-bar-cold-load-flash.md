# 任务卡 342: 冷启动/刷新先闪一条「Local server not connected」

- Status: 已验收（2026-10-27 验收：T1 实现 + 独立复核，协调者独立复跑 web 59 文件 / 525 passed、三处 tsc exit 0；真实浏览器刷新采样仍未做，见 §7）
- 实现方式：交由 Codex 应用执行，指令见 `tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md` 的 T1（`gpt-6.1-terra` / `medium`）
- PDW task: none
- 来源：卡 260 第一轮真实运行，刷新后的第一帧 AX 快照；协调者读码确认结构性成因。

## 1. Goal

页面冷启动或刷新时，在第一个 `/api/health` 响应回来之前，不要显示「Local server not connected — please run `vessel serve`」这条红色断连提示。它把「还没连上」说成了「连不上」，用户会以为服务挂了。

## 2. 事实

- `apps/web/src/App.tsx:58` 的初始值是 `const [health, setHealth] = useState<Health | null>(null)`；`connect()`（`:150-165`）要等 `api.health()` 返回才 `setHealth(h)`。
- `apps/web/src/components/StatusBar.tsx:13` 判据是 `const isOk = !error && !!health?.ok`，`health === null && error === false` 落到 `else` → 红点 + `t('statusDown')`。
- 也就是说首帧必然是「断连」，与真实服务状态无关；慢网/冷启动时可见时间更长。
- 实测（卡 260 §7）：刷新后第一帧 AX 为 `Local server not connected — please run vessel serve (127.0.0.1:5678).`，下一帧变为 `Vessel local server ok (v0.10.0)`。

## 3. Not Doing

- 不改「真的连不上」时的红色提示语义与文案，也不隐藏真实失败。
- 不加轮询、不改 health 端点、不给状态栏加新面板。
- 不动 `serverError` 的产生条件（任何请求失败即置位）。

## 4. Acceptance

1. 三态明确：`connecting`（尚未拿到首个响应，中性文案/灰点）、`ok`（绿点 + 版本）、`down`（红点 + 现有文案）；`down` 只在确实失败后出现。
2. 组件测试覆盖三态：`health=null & error=false` → 不出现 `statusDown`；`health=ok` → 绿点；`error=true` → 红点 + `statusDown`。
3. 真实浏览器复验（可走 `scripts/ui-geom-check.mjs` 的本地 Chrome 路径）：刷新页面，连续采样 `aria`/DOM，断言第一帧不含 `statusDown` 文案、随后出现 ok。
4. 门禁：`npm run -w @vessel/web test`、`npm run -w @vessel/web typecheck`、`npx tsc -b` exit 0。

## 5. Blast Radius

`apps/web/src/App.tsx`、`apps/web/src/components/StatusBar.tsx`、`apps/web/src/i18n.ts`（可能需要一个 `statusConnecting` 词条，中英双语）、对应测试。服务端零改动。

## 6. Expected Evidence

新词条中英文本、三态组件测试名与断言、刷新采样的前后两帧文案、门禁退出码。

## 7. Result

2026-10-27 T1 实现：Codex 应用原生宿主辅助模式，`gpt-6.1-terra` / `medium`，按交接单的单模块改动选型；未启用 Fast / Ultra。状态栏增加灰点连接态，中英各增 `statusConnecting`；错误优先显示原有断连提示，健康态显示版本。组件测试在中英两种语言分别覆盖连接、健康、错误（含旧健康值）。未改 App 健康检查时序。

- `node node_modules/vitest/vitest.mjs run --root apps/web`：exit 0，59 文件 / 525 测试通过。日志 `C:\work\AppData\Local\Temp\vessel-wave1-wVrbzr\t1-web-vitest.log`。
- `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`：exit 0，无诊断。日志 `C:\work\AppData\Local\Temp\vessel-wave1-wVrbzr\t1-web-tsc.log`。
- `node node_modules/typescript/bin/tsc -b tsconfig.json`：exit 2，4 处 TS2322（`benchmarks/runners/src/runner.ts:665`、`soak/soak-driver.ts:406,534`、`apps/local-server/src/goalSeam.ts:301`；workspace dispose 返回类型不匹配）。原始诊断日志 `C:\work\AppData\Local\Temp\vessel-wave1-wVrbzr\t1-root-tsc.log`；未越界修复。
- T2 完成获授权的返回类型修复后，同一 root 构建命令复跑：exit 0，无诊断。日志 `C:\work\AppData\Local\Temp\vessel-wave1-wVrbzr\t1-root-tsc-final.log`。独立静态复核 PASS。
- 真实浏览器刷新采样及全量门禁未在此自验中执行；交接单交由协调者统一处理。

#### 协调者验收（2026-10-27，独立复跑，不采信实现者自述）

- 代码复核：`StatusBar.tsx` 判据改为 `error ? down : isOk ? ok : connecting`，灰点用内联 `background: var(--dim)`（该 token 在 `styles.css:65` 存在；内联带 token 的写法与 `TalkingMetricsBar`、`UsageBar` 同风格）；`i18n.ts` 中英各一条 `statusConnecting`，英文侧无 CJK。`StatusBar.test.tsx` 三条用例对中英各跑一遍，中文侧断言不含英文 `statusDown`、英文侧断言无 CJK。
- 独立复跑（我的命令，日志在 `%TEMP%\opencode\wave1-verify\`）：`vitest run --root apps/web` exit 0、59 文件 / **525 passed**；`tsc -p apps/web/tsconfig.json --noEmit`、`tsc -b tsconfig.json`、`tsc -p tsconfig.test.json --noEmit` 均 exit 0。
- 残留（不阻塞验收，未改）：`health` 非空但 `ok:false` 且 `error===false` 时走的是「正在连接」而不是「未连接」。当前 `App.connect()` 只在健康检查成功路径写入 `health`，这条分支实际不可达；若将来允许 `health()` 返回 `ok:false` 需补第四态。真实浏览器首帧采样仍列为待验（交给 T10 第二轮，IAB 无法真缩放但首帧可读）。
