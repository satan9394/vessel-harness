# 141 — 已声明未实现项统一标注

- 编号：141
- 状态：已合入（2026-09-18）
- 优先级：P2（诚实化：声明与实现一致）
- 创建日期：2026-09-18
- 关联：`tasks/140`（文档残余扫描 #2）、`tasks/135`（B19 口径，同款做法）、`docs/V1.6-STABLE-CHECKLIST.md` §未闭合清单
- 执行器：指挥侧

## 1. 目标

仓库里有若干"**已声明但未实现**"的接缝（seam）：类型/清单/文案先立在那里，本体尚未接线。
若不显式标注，后人会把它们误读成"丢数据"或"已完成"。本卡按 B19 的同款做法，
在每处就地标注「**已声明未实现** + 触发条件」，只改注释，不动行为。

## 2. 改动（纯注释，零断言 / 零逻辑改动）

| 文件 | 标注对象 | 标注内容 |
|---|---|---|
| `apps/web/src/App.tsx` | `UNIMPLEMENTED` 清单（Context/Logs/MCP/Policy） | 四模块在模块选择器可勾选、面板本体未实现，渲染 `t('unimplemented')` 占位；触发条件 = 对应后端投影/接口就绪，届时逐个移出清单 |
| `apps/web/src/i18n.ts` | `unimplemented` 消息键 | 指明该占位串由 `App.tsx` 的 `UNIMPLEMENTED` 清单消费，触发条件见该处 |
| `benchmarks/runners/src/report/report.ts` | `renderDashboardSeam` | web dashboard seam：未来 083-web 扩展渲染 HTML；触发条件 = 有 web 端消费者要渲染基准报告 |
| `packages/runtime/src/sidecar/mock-sidecar.ts` | 文件头 | 真实 Rust sidecar（V1.4 "Rust execution sidecar PoC"）未做，本文件仅**协议回环 mock**；触发条件 = 需真进程 / 语言隔离执行 |

## 3. 验收与实测

- 门禁（**全在最后一次编辑之后**，各带显式退出码）：`npm ci` exit 0、`tsc -b` exit 0、
  `typecheck:tests` exit 0、`test:all` exit 0（根 **178 文件 / 2236 passed + 6 skipped**；
  web **11 文件 / 120 passed**）、web `vite build` exit 0、CLI 冒烟 exit 0。
- 判别性证据：本卡改动**全部是注释**（`git diff` 逐行可见，无 `expect`/`it(` 增删、无逻辑分支），
  测试数字与改动前基线**逐字一致**（178/2236+6、11/120）⇒ 既无回归，也无"注释掩盖行为变更"。
- 核验：四处标注均含「**已声明未实现** + 触发条件」；`UNIMPLEMENTED` 清单与 `i18n.unimplemented`
  互相指认（注释 → 消费点 → 字符串）。

## 4. 边界

- 不改任何运行时 / UI 行为；不新增、不放宽、不删除任何断言。
- 不扩大范围到其它**已自述 declared** 的接缝（如 `packages/llm/src/router/taskCategory.ts:69`
  的 LLM 分类器 seam —— 其注释已自述 "declared; deterministic impl is the default"，无需重复标注）。
