# 任务卡 256 交付证据：受限沙箱真正跑起来了

**日期**：2026-10-23
**执行者**：Codex（候选方案）+ 协调者（定位并修正引号缺陷）
**结论**：原生验收通过。受限令牌 + Low + Job Object + 写根限制下，子进程能执行命令、能写 provisioned 写根、根外写入被拒。

---

## 1. 根因链（三步，逐步证伪）

卡 255 阶段已知：`CreateRestrictedToken` 的句柄没有 `TOKEN_ADJUST_DEFAULT`，必须在主令牌副本上降级；
`AccessCheck` 需要描述符自带 owner/group。这两处修完后，子进程仍以 `0xC0000142`（STATUS_DLL_INIT_FAILED）退出。

隔离矩阵（卡 255 证据）：

| 令牌 | 创建标志 | 结果 |
|---|---|---|
| 受限 + Low | `CREATE_NO_WINDOW` | `0xC0000142` |
| 受限 + Low | `CREATE_NEW_CONSOLE` | `0xC0000142` |
| 受限 + Low | `0`（继承父控制台） | 能启动 |
| 普通 + Low | `CREATE_NO_WINDOW` | 正常 |

即：受限令牌下**新建控制台**会崩。本轮采用 `CREATE_SUSPENDED | DETACHED_PROCESS (0x4|0x8)`，
不请求新控制台，标准输入接一条无写端的管道（立即 EOF），stdout/stderr 仍走既有管道。

## 2. 第二个缺陷：无条件加引号把 /c 变成 "/c"

换标志后子进程不再崩，但 `cmd.exe /c ver` 报 `'"ver' 不是内部或外部命令`。
用批处理回显 `%CMDCMDLINE%` 抓到真实命令行：

```
CMDLINE="cmd.exe" "/c" "C:\...\dump.bat"
```

原 `Quote()` 对所有参数无条件加引号。受限令牌下，cmd 对**内置命令**（ver/echo）在 `"/c"` 形式下的解析失败。
改为「仅在含空格/引号/控制字符时才加引号」，路径含空格仍走完整转义。修后内置命令与外部程序都能跑。

## 3. 第三个问题：whoami 在受限令牌下必崩

`whoami`、`whoami /groups`、`cmd /c whoami /groups` 全部 `0xC0000142`（不是权限拒绝，是 DLL 初始化失败），
所以不能用它来证明 Low。改为由启动器在创建子进程后，**直接查询子进程令牌的完整性 RID** 并回传
（`Result.ChildIntegrityRid` → `constraints.integrityRid`），探针据此判定。

## 4. 原生验收输出

`evidence/task256/native-smoke.json`（`node --import tsx evidence/task255/native-token-smoke.mts`，exit 0）：

- `echo`：`sandbox-ok`，退出 0
- `integrityRid`：**4096**（Low）
- 写 provisioned 根：写 `probe` 并读回成功，退出 0
- 写根外目录：退出 1，拒绝
- `checks`：`{echoOk:true, echoText:true, low:true, writeOk:true, outsideDenied:true}`
- `pass: true`

## 5. 未覆盖 / 边界

- 只验证了 `cmd.exe` 与内置命令；`whoami.exe` 在该令牌下无法运行，属已知限制，不代表沙箱失效。
- Job Object 的进程树清理沿用既有实现，本轮未改。
- 真实工具调用链（Tool → Sandbox）尚未在真实模型会话里端到端跑过，下一步可用 `commandgota-real` 验证。
