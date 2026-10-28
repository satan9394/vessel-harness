# Task 250: Session Completion Integrity & Stored Credential Destination Binding (Fixes F1 & F2)

状态：已验收（2026-10-26 对账；原状态「待验收」，门禁数字见 [卡 340](340-board-backlog-closeout.md)）
负责人：Codex (`gpt-6.1-sol`, medium reasoning effort)
规划 / 架构监督：Antigravity
前序依赖：[任务卡 249](249-adversarial-audit.md) 对抗审计揭露的 F1 与 F2 高危漏洞

## 1. 目标 (Goal)
彻底根治 Task 249 独立对抗审查报告所揭示的两个 High 级别漏洞：
1. **F1 会话完成状态推断失真与错误标识脱节**：
   - 修复 `server.ts` 中检查 `lastTurnEnd?.kind` 时将底层运行时的 `'error'` / `'budget'` 漏判的问题；
   - 消除 `activityRoutes.ts` 中仅凭 `recordCount > 0` 就擅自将崩溃、未完成或中断的历史会话盲目推断为 `completed` 的假回执；无确凿 terminal 成功记录的统一回退为真实状态；
   - 修复错误详情传递，确保失败会话能够准确体现失败状态。
2. **F2 存储凭据免输直测目标强绑定**：
   - 修复 `providerRoutes.ts` 中客户端利用免输直测（`apiKey: ''`）时可任意篡改 `baseUrl` / `protocol` 导致存储密钥外发到非预期域名的安全漏洞；
   - 服务端在触发存储密钥直测或拉取模型时，必须严格强制绑定该 Provider 在本地存储的真实 `baseUrl` 和 `protocol`；
   - 顺带完成 F3 防御：若上游模型列表回显了包含密钥的恶意模型 ID，做脱敏过滤。

## 2. 禁做事项 (Not Doing)
- 严禁修改 `packages/core`（薄核纪律：0 改动）；
- 严禁永久删除任何文件（所有删除走回收站，除临时测试自建目录外）；
- 不引入外部新依赖，不改动无关 UI 组件。

## 3. 验收标准 (Acceptance Criteria)
1. **F1 验证**：
   - 运行 Task 249 产出的反例脚本（`evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs`）中关于 F1 的反例时，不再返回 `completed`，而是正确返回真实未完成/错误状态；
   - `apps/local-server/src/server.test.ts` 新增对 turn `error` / `budget` 的状态识别单测。
2. **F2 验证**：
   - 运行 F2 反例时，传入已存供应商名称 + 篡改的 `baseUrl` + 空 `apiKey` 时，请求必须被强行修正为存储的目标地址，绝不将凭据发往篡改地址；
   - `providerRoutes.test.ts` 或 `server.test.ts` 新增对恶意 host 劫持阻断/锁定的回归测试。
3. **门禁指标**：
   - `git diff HEAD --stat -- packages/core` 必须为 0；
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `apps/local-server` 相关测试 100% 通过；
   - `npm run test:web` 413 测试 100% 通过。

## 4. 影响面 (Blast Radius)
- `apps/local-server/src/routes/activityRoutes.ts`
- `apps/local-server/src/routes/providerRoutes.ts`
- `apps/local-server/src/server.ts`
- `apps/local-server/src/server.test.ts`

## 5. 预期证据 (Expected Evidence)
- `evidence/sessions/2026-10-20-codex-task-250.log`
- `evidence/sessions/2026-10-20-codex-task-250-test.log`
- 修复前后的可复现 probe 运行对比日志。

## 6. Result

本地实现与回归测试已交付；确定性验收与门禁输出见 [Task 250 验证记录](../evidence/sessions/2026-10-20-codex-task-250-proof.md)。Task 249 反例脚本新增 `--verify-250` 模式验证修复后的 F1/F2/F3，保留原始复现断言；F4/F5 不在本卡范围。

本卡未修改 `packages/core`，但用户指定的 `origin/main` 比较包含历史已提交差异，不能汇报为零。没有修改公共 API 形状或新增配置；本次行为修正与验证说明集中记录于上述证据，不重复改写版本文档。未调用外部 Agent，未提交、推送或发布。
