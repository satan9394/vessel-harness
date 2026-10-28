# W2 端到端验证 · 2026-10-27（协调者，非浏览器）

> 目的：W2 的组件测试只能证明「给一个 widget 就能只读渲染」，不能证明「真实进程里 `Write` 之后确实会发出 widget」。
> 这里用真实 `vessel serve` + 本地脚本桩 provider + 会话 SSE 来补这一段，不涉及浏览器。

## 环境

- `vessel serve --port 5678 --workspace <空临时工作区>`；工作区 `C:\work\AppData\Local\Temp\vessel-w2-e2e-14824531`（无 `fixture.txt`）。
- `VESSEL_PROVIDER_ROOT` = `%TEMP%\vessel-iab-run2-1b21431d\providers`（`provider use fixture` 已切到 `fixture`，`baseUrl` 指向 `127.0.0.1:58948/v1`）。
- `VESSEL_USAGE_ROOT` = `%TEMP%\vessel-iab-run2-1b21431d\usage`；`VESSEL_TRASH_TTL_DAYS=0`（避免启动清理干扰）。
- 脚本桩 provider：每轮先返回 `tool_calls: Write({path:'fixture.txt',content:'before\nsecond\n'})`，收到 tool 结果后返回文本 `Fixture complete`。

## 步骤与结果

1. `POST /api/sessions`（`provider: 'fixture'`, `model: 'fixture-model'`, `permission: 'workspace-write'`）→ 201。
2. 先订阅 `GET /api/sessions/:id/events`（SSE），再 `POST /api/sessions/:id/turns {prompt:'write the fixture file'}` → 200，`kind: success`，`steps: 2`。
3. SSE 收到 `widget_block` 与 `widget`，均为 `kind: 'diff_inspector'`：

```json
{"id":"write:<session>:13","kind":"diff_inspector","status":"resolved","turnIndex":0,
 "payload":{"filePath":"fixture.txt","additions":2,"deletions":0,
 "patch":"--- /dev/null\n+++ b/fixture.txt\n@@ -0,0 +1,2 @@\n+before\n+second\n"}}
```

4. 磁盘 `fixture.txt` 字节：`before\nsecond\n`；会话日志里 `tool/call` 与 `tool/result` 的 `Write` 各 1 条；脚本桩日志每轮恰好两次请求（工具 + 收尾）。
5. **覆盖写边界**：在同一工作区再发一轮（`fixture.txt` 已存在）→ `steps: 2`、Write 各 1 条、**0 个 diff widget**，文件字节不变。

## 结论与边界

- W2 的「新建文件才发只读 Diff」在真实进程里成立；覆盖写不发，符合声明的范围。
- widget `payload` 不带任何 hunk 动作字段；前端只读性由 `DualSurfaceLayout.test.tsx` 断言（两种面板各只有「折叠」一个按钮，无 Accept/Discard/Revert，`applyPatch` 未被调用）。
- **未覆盖**：真实浏览器视口渲染与截图。本宿主 `bsk daemon start` 被 Job Object 拦（`cannot start an independent Windows daemon`），需在独立终端起守护进程后再补。
- 之后两端口已停止，`Get-NetTCPConnection 5678,58948 -State Listen` 计数为 0。
