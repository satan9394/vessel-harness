# 任务卡 360: 沙箱拒绝时的错误信息不可读（管道里变成问号）

- Status: 已验收（2026-10-29，协调者复跑：白名单内 `hi` 逐字不变；越界写 exit 1 + 可读 `[hint]`，目标文件不存在）
- PDW task: none
- 来源：卡 180/183 的真机执法验证。白名单内写成功、越界写被拒都成立，但**被拒时模型读不懂原因**。

## 1. 现象与证据

用生产 `createShellTool` 在已 provision 的工作区里跑 `echo escaped> %USERPROFILE%\vessel-escape.txt`：工具返回 `TOOL_FAILURE: exit code 1`，`content` 是 `[stderr]` 加十几个到二十个问号。

机制：`cmd.exe` 的拒绝信息由系统按本地代码页（本机 GBK）格式化后写入管道，而 `PlatformSandboxRunner` 按 UTF-8 解码，非 ASCII 全部变成替换字符。模型与用户都看不出「是权限被拒」还是「命令写错了」。

## 2. Goal

让「被沙箱拒绝」这件事在工具结果里**可读且可判别**，不依赖输出语言与本地代码页。

## 3. 建议做法（择一，报告写明理由）

1. **结构化补充**：Shell 工具在 `exitCode !== 0` 且 stderr 含替换字符时，附加一条 ASCII 说明，例如「命令以非零退出；若涉及写盘，目标可能不在沙箱写根白名单内」。不宣称具体原因，只给可操作方向。
2. **代码页解码**：解码 stderr 时按系统 OEM 代码页回退，而不是硬按 UTF-8。注意跨语言，别把英文环境弄坏。
3. 两者都做也可以；**不要**为了可读性把非零退出改判成成功。

## 4. Acceptance

- A1 越界写场景下，工具返回的 `content` 不再是一串问号：要么能读出「拒绝/权限」语义，要么带一条明确的 ASCII 提示。
- A2 正常命令（`echo hi`）的输出逐字不变，不引入额外噪音。
- A3 有新测试：构造非 UTF-8 的 stderr 字节，断言不会原样透出乱码（至少覆盖「含替换字符 → 附提示」或「按 OEM 解码」）。
- A4 `node node_modules/vitest/vitest.mjs run packages/tools`、`tsc -b`、`tsc -p tsconfig.test.json --noEmit` 均 exit 0；不跑全量门禁。

## 5. Blast Radius

`packages/tools/src/shell/**`、`packages/tools/src/execution/sandbox/**`（仅解码与提示），对应测试。不改 policy、不改审计字段、不改 core。

## 6. Result

待执行。

## 2026-10-29 remaining run — evidence only; sign-off reserved

A1–A4: 通过 / PASS. Added an ASCII hint only for nonzero native results with replacement characters or repeated question marks in stderr; preserves raw output and does not infer a denial. This avoids locale-specific decoding and leaves successful output unchanged. Regression cases cover GBK bytes decoded as UTF-8, literal question marks, readable failures and success. Tools: 19 files, 169 passed + 3 skipped; build and test typecheck exit 0. Real provisioned fixture: `echo hi` → 0 / `hi`; `echo x> in.txt` → 0, file `x\r\n`; `echo x> %USERPROFILE%\vessel-remaining-escape.txt` → 1 / TOOL_FAILURE plus ASCII hint, escaped file absent. ACL revoked (SID removed=True; Low label=False). Evidence: `evidence/sessions/2026-10-29-remaining/t1-native.json`, `t1-types.json`; raw log in TEMP recorded by environment.json. Requested route gpt-6.1-sol / medium, Fast off (bounded multi-file task); no Agent CLI/model probe.

## 7. Result（协调者验收，2026-10-29）

**通过。** 我自己复跑（隔离夹具、真 provision）：

| 用例 | 结果 |
|---|---|
| 工作区内 `echo hi` | exit 0，content 仍是 `hi`（逐字未变） |
| 越界写 `%USERPROFILE%\vessel-t1-escape-*.txt` | exit **1**，content 带原文问号 + `[hint] Command failed; stderr may use a non-UTF-8 code page. If writing files, check that the target is inside the sandbox allowed write roots.`，目标文件不存在 |

非零退出没有被改判成功，提示是「可能」而不是断言权限拒绝——符合卡里要求的口径。门禁里 tools+policy 从 324 涨到 329（新增 5 条：含替换字符与 `?{3,}` 两变体、以及「成功输出不带 hint」「可读 stderr 不带 hint」的反向用例）。收尾 `-Revoke` 已执行。

遗留（不阻塞）：提示是英文常量。若要中文化，需按语言注入，本轮没做也不要求。
