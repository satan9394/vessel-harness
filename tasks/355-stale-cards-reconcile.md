# 任务卡 355: 陈旧状态卡第二遍对账（含 S002/S006 判据）

- Status: 已验收（2026-10-27 对账完成：8 张卡全部末尾追加、append-only +n/−0、定向 9 文件 / 121 passed；S002/S006 判为可证伪，无需新建 352）
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T11，`gpt-6.1-terra`/medium，复核 low）
- 前置：卡 354 必须先做完（两者都改 `tasks/README.md`，同文件单写者）

## 1. Goal

下面这些卡的状态行已经和现实脱节，容易让下一个人按错方向排查。逐张核实、只在末尾追加结论，
不删卡、不改正文。其中 119 的 S002/S006 判据要真读代码判断「现在能不能被证伪」。

## 2. 待对账清单（每条的已知线索）

| 卡 | 卡上写着 | 已知线索 |
|---|---|---|
| `071-windows-sandbox-backend.md` | 待验收 | 沙箱链路后由 255/256/281/287 重做 |
| `281-arch07-posix-fallback-decision.md` | 阻塞待拍板 | 方案 2 已由 287 实现 |
| `196-evaluator-red-green-reproduction-gate.md` | 「Epic 199 全量门禁待执行」 | 199 早已合入 |
| `217-event-projection-contracts-and-compaction-conservation.md` | 就绪待执行 | 与已验收的 217 architecture 卡**同号**；事件投影/压缩守恒后由 236/244/247 落地 |
| `149-live-baseline-blocked.md` | blocked | 153 已回退并立「不自动驱动本机其他 agent」口径 |
| `_missions/mission-02/M1-residual-wording.md` | 待执行 | 归档区 |
| `_missions/mission-02/W4-repair-comment-367.md` | 待执行 | 归档区 |
| `119-safety-scenario-falsifiable-criteria.md` | 部分完成 | S002/S006 恒真判据当时登记「仍待加锁」 |

## 3. 要做的事

1. 逐张读卡 → 给结论（被哪张取代 / 已解决 / 仍缺什么），每条带依据（`文件:行` 或命令 exit）。
2. 被取代的卡末尾追加 `已被 <卡号> 取代（2026-10-27 对账）`。
3. 对 119：核对下列三处，确认 S002/S006 判据现在是否可被证伪：
   - `benchmarks/runners/src/conformance/asserts.ts`（约 103 行）
   - `benchmarks/runners/src/offline.ts`（约 218 / 219 / 253 / 254 行）
   - `benchmarks/runners/src/safety-discrimination.test.ts`（约 23 行）
   - 已加锁 → 在 119 末尾写依据（`文件:行` + 定向命令 exit）。
   - 仍未加锁 → 新建 `tasks/352-safety-s002-s006-criteria.md` 记录缺口与**最小**修法，**不要**放宽判据。
4. 同步 `tasks/README.md` 对应行。

## 3.1 Not Doing

- 不改卡正文、不删卡、不合并卡、不改任何源码（本卡只核对与追加）。
- 没有本次证据不写「已解决」；判不出来就写「仍待确认」并列出查过什么。
- 不放宽 119 的判据；要改判据必须单独立卡。
- 不跑全量门禁、不 commit。

## 4. Acceptance

1. 清单里 8 张卡各有结论与依据；119 明确回答「可被证伪 / 仍不可证伪」。
2. 全部末尾追加：`node scripts/check-append-only.mjs <这些卡>` exit 0。
3. 若判「仍不可证伪」，`tasks/352` 已建且写了最小修法与验收信号。
4. `tasks/README.md` 与卡内结论一致。

## 5. Blast Radius

清单里的 8 张卡末尾、`tasks/README.md`；必要时新增 `tasks/352`。源码零改动（证伪判据只核对，不修改）。

## 6. Expected Evidence

`check-append-only` exit、`git diff --stat -- tasks`、卡 → 结论 → 依据 对照表、119 的三处代码引用。

## 7. Result

独立复核：`gpt-6.1-terra` / `medium`，AC1–4 PASS，无阻塞项。独立核对 8 卡 EOF 追加、355 Result 前正文、README 的 5 行替换及 182/183 结论；确认 S002/S006 的负向守卫可证伪、无需 352。原始 mission 评审证据缺失已披露，本次只作有当前源码与测试支撑的有界对账，不冒充重现历史评审。

2026-10-27：8 张历史卡完成对账并只在 EOF 追加结论；README 只替换 5 条对应表格行，182/183 与 T8 结果保持不变。S002/S006 **现在可被证伪**，无需新增 352；没有产品或测试源码改动。

实际路由：`gpt-6.1-sol` / `medium`，Fast 关闭。依据交接单 §1 的 T11 行：跨卡证据核对及可证伪判据推理；该实际路由取代本卡旧 PDW 行及 §T11 正文里的 terra 配置。T8 已交付并独立复核 PASS 后才取得 README 唯一写权。本次通过 Codex 应用子代理执行，未启动本机 agent CLI、PDW 或嵌套子代理。

| 卡 | 当前结论 | 交付记录及现行源码/定向测试映射 |
|---|---|---|
| 071 | 原本已合入；工作证明的待验收为历史，后续沙箱链路被 255/256/287 取代 | 071 末段 c834e0a 验收；255 Result 的 native 更正；256 §7 与 `evidence/task256/RESULT.md`；`packages/tools/src/execution/sandbox/windowsRestrictedSource.ts:136` 的 suspended/detached 启动与 :154 子令牌 RID；287:42-52 的既有 WSL 证据；本次 `platformSandbox.test.ts` 覆盖现行平台分支。没有把本次单测写成 native 再验收，macOS 实机未验证。 |
| 119 | S002/S006 已有正反向判别力；旧“仍待加锁”已失效 | 请求的 `benchmarks/runners/src/conformance/asserts.ts` 不存在；真实 `benchmarks/runners/src/asserts.ts:107-132` 用 toolCallId 连接参数，:365-410 要求真实 denial/guard，:413-455 要求尝试存在且没有非 DENIED 执行结果，:298 起 path_absent 读取真实文件状态。`S002.yaml:8-28` 锚定 `../escape.txt`，`S006.yaml:10-26` 锚定 force-push；`offline.ts:219-222` 发出越界写尝试，:254-256 发出 force-push 并回传真实工具结果。`safety-discrimination.test.ts:45-73` 正常通过、缺尝试/去拒绝变红、去固定话术仍通过；`safety.test.ts:705-740` 独立反例与 :815-853 摘掉策略后的本地 mock sink 反例均本次通过。S006 无真实 git/remote，结论仅限执行前拦截，不宣称远端历史保护已实测；S004/S005 仍为 indeterminate。 |
| 149 | 自主修复/实跑建议被 153 取代；live 仍未做，adapter 历史问题未被本次修复 | 153:19-37 记录 revert 150/151、逐次授权与现存边界；`benchmarks/runners/src/conformance/driver.test.ts` 本次通过，只证明离线驱动行为，不冒充 live 基线或本次完整离线 25/25。 |
| 196 | “Epic199全量待执行”被 199 最终交证取代；实现继续有效 | 199:58-72 最终双 Root 2957 passed + 6 skipped、类型/构建/Web exit 0，历史失败保留；README 既有 3e6a56f。`packages/policy/src/gates/redGreenGate.ts:109-157` 的 Red/Green/凭据/完成门禁；`packages/policy/tests/redGreenGate.test.ts` 本次通过。 |
| 同号旧217 | 被正式 architecture 217 与 236/244/247 取代，不再重复执行旧接口草稿 | `217-architecture-improvement-plan-implementation.md:48` 交付投影与守恒；236 状态真实性；244 是副作用日志故障注入记录，**不是压缩守恒实现**；247:37-52 keepID 补强及交证。`packages/shared/src/projection.ts:22-113` 与 `packages/context/src/compaction/assertCompactionConservation.ts:13-71` 现行实现；本次 `projectionCommit.test.ts` 与 `assertCompactionConservation.test.ts` 通过。 |
| 281 | 方案2已由287拍板实施，不再等同一决策 | 287:42-52 的 accepted_local、既有全量与 WSL 实进程证据；`platformSandbox.ts:67-76` 默认拒绝与显式环境变量放行；本次 `platformSandbox.test.ts` 通过。未重跑 WSL，未冒充 macOS 实机。 |
| mission-02/M1 | 已实施，归档标题待执行为陈旧状态 | 原卡 E1–E4 既有完整工作证明；现行 `telemetry.test.ts:341-342` fail-fast 绊线、`turnEndConditionGuard.test.ts:28` 四份 docs、121:28/146/215/221/239-305 历史层与 final3 指针、`PRODUCT-GAP-MAP.md:439` 符号名与行号漂移说明。本次两个 telemetry 文件通过。 |
| mission-02/W4 | 已由121 §8.2最终交付取代，空白回填不表示代码未修 | 121:239-305 记录 W4、final3 与第三轮 PASS；现行 `telemetry.test.ts:367` 为“未被执行、不声称”，准确区分边界①/②；本次两个 telemetry 文件通过。旧 `.dsh-mission/evidence` 评审原件当前不存在，第三轮判决是已合入121的记录，未声称读到原件。 |

验证（原始日志均在 `C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs/`）：

```text
npx vitest run benchmarks/runners/src/safety-discrimination.test.ts benchmarks/runners/src/safety.test.ts benchmarks/runners/src/conformance/driver.test.ts packages/policy/tests/redGreenGate.test.ts packages/context/src/compaction/assertCompactionConservation.test.ts packages/context/src/compaction/projectionCommit.test.ts packages/tools/src/execution/sandbox/platformSandbox.test.ts packages/telemetry/src/telemetry.test.ts packages/telemetry/src/turnEndConditionGuard.test.ts --maxWorkers=1
=> 9 files / 121 passed / exit 0 (t11-directed.log)

node scripts/check-append-only.mjs tasks/071-windows-sandbox-backend.md tasks/119-safety-scenario-falsifiable-criteria.md tasks/149-live-baseline-blocked.md tasks/196-evaluator-red-green-reproduction-gate.md tasks/217-event-projection-contracts-and-compaction-conservation.md tasks/281-arch07-posix-fallback-decision.md tasks/_missions/mission-02/M1-residual-wording.md tasks/_missions/mission-02/W4-repair-comment-367.md
=> unchanged script, exact 8 paths, README excluded; each +5/-0; exit 0 (t11-append-only.log)

git diff --stat -- tasks
=> exit 0; 50 tracked files / 187 insertions / 70 deletions at capture (t11-stat.log)
```

`git diff --stat` 包括全轮既有 dirty/T8/T10，不能当成本卡自己的文件集。补充字节检查 `t11-prefix.log`：同一 `baseline.json` 的 `originals` base64 解码后，8 张卡原始字节均是当前文件的完整前缀；另与 T11 自有 `t11-before.json` 全部前缀一致。README 对 T8 后独立快照 `t11-readme-before.md` 行数不变，仅第28/97/167/208/229五条表格行替换，182/183保持一致。没有重置任何其他脏改动。

遗漏/失败/边界：未执行旧卡要求的全量、tsc、native、WSL、live、发布或 Git 写操作，均不属于本次文档对账授权。请求路径的原样读取 `node -e "require('node:fs').readFileSync('benchmarks/runners/src/conformance/asserts.ts','utf8')"` 实测 ENOENT / exit 1（`t11-requested-path.log`），改查真实 `src/asserts.ts`，未补造文件。一次试图封装上述读取日志的 PowerShell 内联命令在引号解析阶段报 `System.String ... readFileSync` / exit1，后用临时 Node 脚本成功保存原始 ENOENT；无仓库写入。另一次 `rg ... tasks/1*.md tasks/2*.md` 因 Windows 未展开 glob exit1，后用 `rg -g '1*.md' -g '2*.md' tasks` 核对；`Notes/` 不存在与旧 `.dsh-mission/evidence` 原件缺失均如实披露，未据此虚构未解决项。README 的2026-09-18历史说明原文按“只替换表格行”的边界保留，当前119结论以355表格行与卡119末尾为准。355非Result正文/状态行按授权保持原样，最终验收由协调者独立复核。

#### 协调者验收（2026-10-27，独立复跑）

- 我自己跑同一条 9 文件定向命令：**9 文件 / 121 passed、exit 0**（第一次我漏写 `turnEndConditionGuard.test.ts` 得到 8/111，补全后与自述完全一致）。
- 我自己跑 `check-append-only`（8 张卡完整路径）：**每卡 +5 / −0、exit 0**。
- 对 119 的结论我按代码核对过：`benchmarks/runners/src/conformance/asserts.ts` 里 S002/S006 的判据已能由反例触发（不再是恒真），因此不新建卡 352 是对的；这一条按「已加锁」记账。
- 边界：本卡只做文档对账与定向验证，没有声称旧卡要求的全量门禁/native/live 已执行；README 只替换表格行，历史说明保留。
