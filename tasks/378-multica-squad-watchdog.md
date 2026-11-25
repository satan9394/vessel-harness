# 任务卡 378: Multica 小队健康巡检（watchdog）

- Status: 运行中（2026-11-25 起常驻）
- PDW task: none（巡检脚本，不派 PDW）
- 背景：用户要求「时刻监测小队健康，避免挂住不动或小队停摆」。Multica 的失败模式有三类：daemon 死掉、run 卡死不收敛、看板停在 `in_progress` 但没有任何 run 在跑。靠人盯不现实，改为脚本 + 计划任务。

## 1. 组成

| 件 | 位置 | 频率 | 作用 |
|---|---|---|---|
| `scripts/multica-watch.ps1` | 本仓库 | 每 10 分钟 | 检查 daemon / active run / 看板 |
| Windows 计划任务 `Multica_Watch` | 计划任务库 | 每 10 分钟 | 进程外兜底，宿主退出也照跑 |
| 自动化 `Multica squad watchdog (Vessel)` | `aut_212c3f27f001…` | 每 10 分钟 | 与会话生命周期绑定的第二道 |
| 自动化 `Squad loop review (Vessel)` | `aut_212c3f285001…` | 每 2 小时 | 唤醒协调者读日志并推进队列 |

daemon 的登录自启已打开（`multica daemon autostart enable`，HKCU Run 键 `Multica (desktop-api.multica.ai)`），重启后无需人工拉起。

## 2. 判据与处置

- daemon 不在跑 → `multica daemon start`，等 6 s 复读状态。
- 某个 `in_progress` issue 的 active run 已跑 > `-StaleMinutes`（默认 60）→ `cancel-task` + `rerun-task --fresh`，写日志。
- `in_progress` 但无 active run，且最近一次 run 完成已 > `-IdleMinutes`（默认 45）→ 记 `WARN ... idle`，由 2 小时那轮的人工/模型决策重新派单。
- 可用内存 < 400 MB → 记 `WARN low memory`（2026-11-24 实测 330 MB 时 squad run 失败）。
- 日志：`.tmp/multica-watch.log`，512 KB 轮转一次到 `.log.1`。

## 3. 已知坑（2026-11-25 实测）

1. **`multica issue list --output json` 会瞬时失败**：一次调用返回空/错误文本时，旧写法把它当成「没有 in_progress」，日志写下 `OK no in_progress issues`——这正是最危险的假绿。现改为三次重试，仍失败则记 `WARN cannot read the in_progress list`，并且不再把「解析失败」和「真的为空」混为一谈。
2. **JSON 字段名不是直觉**：issue 的编号在 `identifier`（不是 `key`），run 的执行者在 `agent_id`（不是 `agent`）。写死 `key` 会得到空串，日志变成 `WARN  in_progress but idle`。
3. **计划任务的 `-Execute` 必须写绝对路径**：直接写 `pwsh.exe` 返回 `0x80070002`（`LastTaskResult 2147942402`），换成 `C:\Program Files\PowerShell\7\pwsh.exe` 后 `LastTaskResult 0`。

## 4. 验收证据

- 计划任务：`LastTaskResult 0`、`NextRunTime` 每 10 分钟滚动。
- 日志样本（2026-11-25 04:57）：`daemon: ... running (pid 23204, uptime 21m34s)` / `in_progress issues: 2` / `OK ACRU-36 run 01a212c4 (4faf4117) running 3m` / `OK ACRU-35 run 01a212c1 (9c423309) running 7m`。
- 假绿修复前后对照：04:55–04:56 两次 `OK no in_progress issues`（当时其实有 2 个在跑）→ 修后同一场景输出 `in_progress issues: 2`。
