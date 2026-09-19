# 148 — 全量偶发红：`cli.test.ts` 的 real-IO 用例补显式超时（残留清算）

- 编号：148
- 状态：已合入（2026-09-19）
- 优先级：P2（防未来与回归无关的假红）
- 创建日期：2026-09-19
- 关联：`AGENTS.md`「构建与依赖纪律」（"测试超时不是断言"）、`tasks/147`（同步 #4 期间实测到该 flake）
- 执行器：指挥侧

## 1. 现象（实测，非推断）

记忆同步 #4 的 `test:all` 首次跑红：

```
apps/cli/src/cli.test.ts > vessel provider export/import + endpoint (task 095/096)
  > endpoint add/list/remove：候选池落盘，baseUrl 不变
Error: Test timed out in 30000ms.   （实际耗时 36846ms）
```

同文件单独跑 **106 passed**；随后 `test:all` 重跑 **exit 0（178 文件 / 2237 passed + 6 skipped）**。
⇒ 与回归无关的负载型 flake，正是 `AGENTS.md` 点名的「慢 runner 上默认 30s 把真实 IO 用例
打成假红」类。该文件 106 个用例此前**零显式超时**，全依赖默认 30s。

## 2. 改动（只加超时，零断言 / 零逻辑改动）

`apps/cli/src/cli.test.ts` 的四个**真实文件系统 IO** 的 `describe` 加 suite 级
`{ timeout: 120_000 }`（与仓内既有 120s 先例一致）：

- `vessel usage recompute / pricing override (task 091/092)`
- `vessel pricing sync / provider costMultiplier (task 093/094)`
- `provider 成本倍率：读盘失败必须可见（静默降级族）`
- `vessel provider export/import + endpoint (task 095/096)` ← 本次实测 flake 所在

## 3. 验收与实测

- 定向：`npx vitest run apps/cli/src/cli.test.ts` ⇒ **106 passed**（suite 超时生效）。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` exit 0
  （根 **178 文件 / 2237 passed + 6 skipped**；web **11 / 120**）、web `vite build` exit 0、CLI 冒烟 exit 0。

## 4. 边界

- 只加超时；不动任何断言、不动被测逻辑。
