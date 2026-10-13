# 任务卡 217：Vessel 架构整改与实施规范落地 (Architecture Improvement Plan Implementation)

**状态**：已验证（2026-10-12，本地交证，待维护者验收）
**负责人**：Codex (GPT-6.1 Sol / Medium 思考深度)  
**模式**：standard（一卡一闭环，交证即停）  
**第一事实源**：`docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md` (VESSEL-ARCH-2026-01)  
**前置基线**：HEAD `520492d`（V2.6、Card 215、Card 216 之后）  
**交付证据**：`evidence/sessions/2026-10-12-card217/PROOF.md`；core 实现零 diff，获准测试 fixture 单列 diff stat

---

## 1. 任务目标

全面依据 `docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md`，优先落地第 0 节与第 3–5 节所定义的 **P0 级核心整改规范**：

1. **ARC-01（日志与投影解耦）**：在 `packages/shared/src/` 与 `packages/context/src/` 建立 `SessionProjection` 与 `RequestEnvelopeV1` 契约，明确物理追加事件（Event Log）与可见视图（Projection）的分离，并在压缩时保留历史回溯链；
2. **ARC-02（Policy 强制项编译阻断）**：在 `packages/behavior/src/compiler/` 落地 Fail-to-compile 机制，当 Behavior 配置声明了强制项但缺少对应的 `policy_ref` 时直接抛出编译错误，禁止静默降级为 warning；
3. **ARC-03（Run/Turn 状态机与预算熔断）**：在 `packages/application/src/` 或 `packages/engine/src/` 强化 Run 与 Turn 的显式状态机契约，严格限定执行步骤与 Token 硬预算熔断，确保 Cancel/Stop 具有确定性终态；
4. **ARC-04（Durable Execution 与工具副作用核对）**：确保工具调用生命周期具备幂等性与重试审计记录；
5. **ARC-05（规范化 Tool ID 与参数绑定执行许可）**：在 `packages/policy/` 与 `packages/runtime/` 落地参数绑定型 `ExecutionPermit` 凭证，防止仅凭裸工具名放行被篡改的工具调用。

---

## 2. 纪律红线（硬门禁）

- **薄核零侵入**：`packages/core` 实现行修改严格为 0；2026-10-12 用户显式批准仅在 core 测试 fixture 注入最小策略 stub，以适配 ARC-05 fail-closed；交证须单列测试 diff stat。所有实现契约与增强在外围模块；
- **纯本地开发**：遵循 2026-10-06 规约，绝对不执行 git push，不向 npm 发布包；
- **删除铁律**：全仓严禁彻底删除，必须走回收站（测试自建且在 `os.tmpdir()` 下的临时目录除外）；
- **依赖锁定**：严格使用 npm，严禁引入 pnpm/bun 锁文件；
- **全量测试**：必须通过 `npm run test:all` 双 Root（根 + `--root apps/web`）与 `npx tsc -b`、`npm run typecheck:tests`。

---

## 3. 验收标准 (Acceptance Criteria)

- [x] 完全遵照 `docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md` 落地 ARC-01 至 ARC-05 核心契约与逻辑；
- [x] 对应模块补充完善的 Vitest 单元测试，测试覆盖正面场景与负向违规阻断场景；
- [x] 定向测试与全量双 Root 测试全绿；
- [x] `packages/core` 实现变动严格为 0 行；仅经用户批准的测试策略 fixture 可变，单列 diff stat；
- [x] 回填本卡状态与交付证据。

## 4. 执行信封

- **Not Doing**：不推进 Card 218/P1/P2；不提交、推送、发布，不调用本机外部 harness；不改 core 实现或依赖锁。
- **Blast Radius**：shared 契约、context 投影/压缩、behavior 编译、engine/application 生命周期、policy/runtime 执行安全，以及必要调用方测试。
- **Expected Evidence**：定向正反向测试 → `npx tsc -b` → `npm run typecheck:tests` → `npm run test:all`；零 core 实现 diff、单列获准测试 diff；证据保存于 `evidence/sessions/2026-10-12-card217/`。
- **执行计划**：ARC-01 append-only 投影及回放/故障测试；ARC-02 强制编译错误及负向测试；ARC-03 累积预算/确定终态及取消测试；ARC-04/05 参数绑定许可/副作用恢复及攻击测试；最后按序全门禁与独立评审。
- **Result**：ARC-01 追加投影/回放及压缩守恒；ARC-02 强制编译阻断/先编译后激活；ARC-03 累积硬预算、取消、唯一终态与恢复；ARC-04/05 durable effect journal、参数/主体/作用域/版本绑定的单次许可已落地。最终顺序门禁全部 exit 0：定向 330 + CLI 6 passed；根 2937 passed / 6 skipped；Web 282 passed。core 实现零 diff；3 个测试 fixture 合计 +3/-3。独立评审 PASS，详细机器证据与边界见 PROOF。standard 交证即停。
