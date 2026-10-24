# 卡 278 证据：一次工具失败不再锁死会话

日期：2026-10-23。真实模型 `deepseek/deepseek-v4.1-flash`（Command GOTA），
`vessel serve` + `POST /api/sessions`，`permission: danger-full-access`，
工作区是**未做沙箱准备**的临时目录，provider/usage 根均指向临时目录。

## 复现（修复前）

卡 276 的同型会话里，第一次 Shell 被沙箱拒绝后，后续写入全部失败：

```
[DENIED] Error: OUTCOME_UNKNOWN: pending session effect requires reconciliation before further writes
```

模型重试三次全部命中，最终向用户报告「Shell 工具不可用」。

## 修复后（同一路径重跑）

| 轮次 | 模型调用 | 工具结果 |
|---|---|---|
| 1 | `Shell {"command":"echo hi"}` | `errorClass: DENIED`，消息含 `sandbox execution denied: ... requires provisioned Low Integrity and restricted SID ACL: <ws>` |
| 2 | `Write notes.txt` | 成功，`wrote notes.txt (18 bytes)`，文件实际落盘 |

模型自己在第 1 轮结尾引用了解法：`按提示需先运行 scripts/provision-sandbox.ps1 -Path "<ws>"`。

`GET /api/sessions/<id>/effects` → `{"pending":[]}`。

`execution.jsonl`（节选，两条 intent 都已结算）：

```json
{"kind":"intent","key":"...:12:call_00_bn46...","attempt":1,"effects":"non_idempotent"}
{"kind":"outcome","key":"...:12:call_00_bn46...","attempt":1,"status":"observed"}
{"kind":"intent","key":"...:36:call_00_59is...","attempt":1,"effects":"idempotent_write"}
{"kind":"outcome","key":"...:36:call_00_59is...","attempt":1,"status":"observed"}
```

## 仍未闭环

真未知（进程崩溃、被 kill、超时）依旧要求人工 reconcile，而消费面只有 HTTP 端点——
Web UI 无入口、CLI 无命令。保守设计保留，但「普通用户无路可走」需要单独一张卡。
