# 任务卡 360: 沙箱拒绝时的错误信息不可读（管道里变成问号）

- Status: 待执行（2026-10-29 协调者实测于 HEAD `a974edd`）
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
