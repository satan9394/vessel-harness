# EVALUATION-REPORT-11 — G-10 resume 最小切片（独立 Evaluator / Round 9）

> 静态审查，未复跑命令（指令硬性）；只读源码 + 测试 + 文档。需求源 IMPLEMENTATION-BRIEF-09（AC1–6）、SCOPING-G10 §4/§6。
> 立场：先假设实现有错、验收假绿。指挥侧运行证据按「证词」处理，不照抄。

## 逐条判定

**1) AC1 模型真看到历史 —— 无法判定（不足以证伪假绿）**
证据：`compose.ts:164`（sessionId → `Session.open`）→ `Session.ts:125-148`（loadExisting 读全量日志）→ `Builder.ts:151-168`（history = `session.replay()` 投影，每步重建）。**机制链静态成立**，代码层面无假绿。
但「记录型 provider 探针」的产物不在仓库内（全仓 grep `SEES_HISTORY` 仅命中 `PRODUCT-STATE.md:141` 的叙述），我无法审阅其断言；且 `SECOND_TURN_MESSAGE_COUNT=1` 与真实回放的形状不一致：第二轮重建历史后 messages 至少应为（系统/指令层）+ 第一轮 user + 第一轮 assistant + 本轮 user ≥3。若该计数就是 `messages.length`，则「看到历史」为真时不该是 1；若是「命中口令的条数」则无异常——报告未定义该字段语义。
可能的替代解释（未被现有证据排除）：口令同时出现在第二轮的 `--prompt`（则命中来自本轮输入而非回放）；口令来自工作区文件 / 指令层（`Builder.ts:124` 的 instruction 注入）；探针把历史文本写进了 system prompt。
能证伪的最小补充验证（判别性）：
 (a) 两轮用**不同随机口令** NONCE_A / NONCE_B（第二轮的 prompt 只含 B），断言第二轮捕获的 messages 含 A；并断言 `messages.filter(m=>m.role==='user').length>=2`、`messages.length>=3`、`messages[0].role!=='system' || !messages[0].content.includes(NONCE_A)`；
 (b) **负对照**：同样跑第二轮但换一个新 sessionId，断言 NONCE_A **不出现**（这一条才是判别性核心——它排除工作区文件/上下文注入/供应商侧记忆）；
 (c) 断言 tmp 工作区内无任何文件包含 NONCE_A。
结论前不得把 AC1 记为「已实证」。

**2) fail-closed 未被放宽 —— 通过**
`Session.ts:88-92`：pid 存活 → 直接 throw（含 pid 与目录，文案 `Session is already open by process <pid>: …`），不删除、不重取；`Session.ts:116-123`：EPERM → 视为存活（fail-closed）；`Session.ts:84-86`：`attempt>0` 兜底仍在（回收失败 → 抛 `already open by another writer`）。`close()`（`:250-260`）仍 `rmSync(leasePath)`，无「回收后永远锁不住」路径：回收成功后第二轮 `openSync` 成功即 return。
残留风险（brief 已授权，记录不阻断）：`openSync('wx')` 成功与 `writeSync` 之间存在空租约窗口，此时内容不可解析 → 被判陈旧可被并发进程抢占（`Session.ts:105-113` 返回 null → `:94-99` 回收）。窗口为同 tick 内两条同步调用，实际概率极低。

**3) 绝不静默新建 —— 通过**
`cli.ts:1542-1546`：`resolveResumeTarget` 在 `cmdRun`（进而 `composeHarness`）之前执行，失败即 return，不进入 harness；`resume.ts:50-56`：登记表命中但 `session.jsonl` 缺失 → exit 2；`resume.ts:41-47`：id 不在登记表 → exit 2。`resolveResumeTarget`（`:27-58`）只做 `SessionRegistry.list/get` + `fs.existsSync`，无 mkdir/write（唯一副作用是 `SessionRegistry` 构造时确保登记根存在，非会话目录）。测试 `resume.test.ts:218-231` 用 existsSync 反向锁死 `sessionDir`/`session.jsonl`/`.harness` 三者均不存在。

**4) 登记接线真实性 —— 通过**
`cli.ts:297-318`：`composeHarness` 之后 `registry.put(meta)`；`id = harness.session.sessionId`（`:306`，未另生成）；`createdAt` 取 `registry.get(...)` 于 `put` **之前**（`:304` → `:311` → `:314`）成立；整段包在 try/catch，失败仅 `console.warn`（`:315-318`）不阻断。resume 路由透传 `session-id`（`:1548`）并把 workspace 钉到 `meta.workspaceRoot`（`:1547`）。
小瑕疵：`:1547` 静默覆盖用户 `--workspace`，而 SCOPING §3 风险⑥ 建议跨 cwd fail loud——行为可接受但不合物议建议。

**5) 测试真实性 —— 通过（1 处宽松）**
`SessionLease.test.ts:68-74` `pickDeadPid()` 从 999999 递减并用 `process.kill(pid,0)` 实测确认无主（非随意数字）；`:98-120` 断言租约 ownership 换成 `process.pid`、warn 恰好 1 次且含原 pid；`:122-136` 存活分支用 `process.pid`，并断言 lease 未被抢占、`session.jsonl` 未创建；`:138-155` 覆盖空/垃圾/0/-5 内容；`:157-166` 覆盖 close 后可重开。
宽松但不永真：`:87` 与 `:130` 的 `/already open|正在被进程 \d+ 使用/` 双备选使「活 pid 分支」与「重试兜底」不可区分（仍附带 lease 未变等硬断言）。
`resume.test.ts` 用例 7（`:218-231`）确为否定事实断言。用例 3a 明确把「sessions.json 损坏 → 静默空表」写成期望（与 brief 错误场景「留档+警告」不一致，但属既有 `SessionRegistry.load()` 行为，非本轮引入）。

**6) 回归 / 越界 —— 通过（1 处未落地）**
`Session.test.ts:58` 的 `/already open/` 仍匹配：活 pid 文案 `Session.ts:90` 含 `already open`（同进程二次 open → 走该分支），不回归。USAGE（`cli.ts:98-111`）已无 `--session-dir`，全仓 `*.ts` grep 无任何残余引用（原即死旗帜）。`compose.ts` 未改（`sessionId` 选项 `:49` 早已存在）；`SessionRegistry` 仅在 `:39-50` 新增根解析、`:129-138` 新增排序（字段名/结构未变，local-server 消费不受影响）；`migrate.ts:24` 已补 `sessions.json`；`application/src/index.ts:9` 已导出两函数。
未落地项：brief §涉及模块/目标 4 的 TUI 通道（`chat.ts:266-277` 的 `composeHarness` 仍不传 sessionId，全仓无 `resumeSessionId`）——不在 AC1–6 内，但与本轮「最小切片」自述不符，应明确为遗留或另卡。
测试覆盖缺口：`resolveSessionRoot()` / `VESSEL_SESSION_ROOT` 覆盖分支**零执行**（`resume.test.ts:112-113` 只把 env 当兜底，所有用例都显式传 `vesselHome`），AGENTS.md §8 的隔离前提「env 覆盖」无断言（若指挥 E2E 未设该 env，`cmdRun` 的 `put` 会写真实 `~/.vessel`）。

## 结论

**ACCEPT（有条件）**：2/3/4/5/6 判定通过，AC1 的机制在代码上成立、但「模型真收到历史」的现有证据**不足以证伪假绿**，不得据此把 AC1 结案为已实证。最小必做项：按 §1(a)(b)(c) 补一个带**负对照**的记录型探针（20 分钟内可完成，仓库内留脚本或测试），并给 `SECOND_TURN_MESSAGE_COUNT` 明确语义。遗留（不阻断本切片）：TUI `resumeSessionId` 未实现、`VESSEL_SESSION_ROOT` 覆盖无单测、空租约抢占总窄竞态、resume 静默改写 `--workspace`。
