# 142 — `toolIdByIndex`/`toolNameByIndex` 的 by-design 单值覆盖标注

- 编号：142
- 状态：已合入（2026-09-18）
- 优先级：P3（防误读；**非缺陷**）
- 创建日期：2026-09-18
- 关联：`packages/llm/src/stream/parseAnthropic.ts`、`tasks/141`（同批诚实化）、`docs/product-evolution/PRODUCT-STATE.md`（"by design、非丢数据"）
- 执行器：指挥侧

## 1. 目标

`PRODUCT-STATE` 已记「`toolIdByIndex`/`toolNameByIndex` 在"未 started 阶段"的单值覆盖
（**by design、非丢数据**）」。但两个 `Map` 的声明此前只写 "index -> id/name"，
读者极易把它与**紧邻的** `toolInputJsonByIndex`（Round 70 因**确实会丢数据**才改成 APPEND）
混为一谈，误判成同一类丢数据。本卡就地补一条 by-design 论证，不改任何行为。

## 2. 改动（纯注释）

`packages/llm/src/stream/parseAnthropic.ts` —— 在两个 `Map` 声明上方补文档块：

- **未 started 时**没有 `tool_call_start` 发出 ⇒ 消费侧不存在可寻址的 call；后帧补全/替换
  identity 是 Round 52 的 identity-late 恢复，且只有**补全后**的值会被读
  （`flushToolBlock` / chunk loop 的 start 分支）。
- **已 started 时** identity 被 `identityFrozen` 冻结，首 start 处的两处 `set()` 不会重写它。
- 与 `toolInputJsonByIndex` 的**关键区别**：后者的值在未 started 时**会被读**，
  故 Round 70 改成 APPEND；本 `Map` 无该读者，`set()` 足够，追加只会是死状态。

## 3. 验收与实测

- 门禁（**全在最后一次编辑之后**，各带显式退出码）：`npm ci` exit 0、`tsc -b` exit 0、
  `typecheck:tests` exit 0、`test:all` exit 0（根 **178 文件 / 2236 passed + 6 skipped**；
  web **11 文件 / 120 passed**）、web `vite build` exit 0、CLI 冒烟 exit 0。
- 判别性证据：改动**纯注释**（`git diff` 无 `expect`/`it(` 增删、无逻辑分支），
  测试数字与基线逐字一致 ⇒ 无回归。
- 行为**早已被测试钉死**（本卡只补论证、不改行为）：`parseAnthropic.test.ts` 的
  ③（`!identityFrozen` 死写入）与 ④（identity-late 补全逐字不变），以及 Round 68 的
  "删掉 `identityFrozen` ⇒ 红" 判别线。

## 4. 边界

- 不改解析行为；不新增、不放宽、不删除任何断言。
- 不重写已存在的 Round 52/68/69/70 论证（那部分已完备）。
