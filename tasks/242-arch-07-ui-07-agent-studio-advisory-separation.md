# 任务卡 242 [ARCH-07 + UI-07]: Agent Studio 行为配置与有效安全策略分层

> 状态：已完成 (DONE)  
> 归属：Phase 2 配置中心分层与单一事实源（ARCH-07 / UI-07 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-07 与 `VESSEL_Architecture_Review_and_Execution_2026-10-20.md` ARCH-07  

## 1. 目标 (Goal)
- 明确 Agent Studio 的职责边界与状态透明度，杜绝把“离线校验”误导为“已经作用于正在运行的 Agent”：
  1. **状态透明度（Advisory Verification）**：
     - 固定验证按钮文案为【验证候选配置】（英文：`Verify candidate configuration`），杜绝误导性词汇；
     - 增加明显的声明横幅（`composer-advisory-banner`），明确提示“候选配置编译评估（仅供离线验证，未作用于正在运行的 Agent 实例）”；
     - 结论展示区（`composer-report`）增加【候选草稿状态】徽章：
       - 若编译失败（`rejected`），明确显示【编译未通过，禁止启用】；
       - 若编译通过，明确显示【未激活至运行态】；
  2. **系统安全策略分层（Policy vs. Behavior Layering）**：
     - Agent 行为规则仅作为偏好与提示词草稿，不能弱化、修改或移除底层的系统安全策略（System Policy）；
     - 明确展示 Policy 映射关系与安全基线不可覆盖性。

## 2. 非目标 (Not Doing)
- 不开发未经验证的在线动态热替换机制（避免在缺乏版本化契约的前提下引入破坏性安全漏洞）；
- 不修改 `packages/core`（修改行数恒为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. 界面呈现：
   - 验证按钮统一为“验证候选配置”；
   - 顶部有清晰的离线候选评估提示；
   - 验证结果卡片上显式标明草稿状态（未激活至运行态，或编译未通过禁止启用）；
2. 语言本地化：
   - 中英双语完整覆盖；
3. 自动化测试门禁：
   - `card222.test.tsx` 扩充候选状态与文案断言，全部通过；
   - Web 单元测试 `npm run test -- --root apps/web` 50 文件 / 409 passed 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过；
   - `npm run -w @vessel/web build` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/components/studio/AgentStudioComposer.tsx`：增加横幅与状态指示；
- `apps/web/src/components/card222.css`：增加样式；
- `apps/web/src/components/card222.test.tsx`：补充断言；
- `apps/web/src/i18n.ts`：补充中英文词条。

## 5. 预期证据 (Expected Evidence)
- 定向测试与 Web 全量测试通过日志：
  - `apps/web/src/components/card222.test.tsx` 10 passed；
  - `npx vitest run --root apps/web` 50 passed (50 files / 409 passed)；
- 全量门禁验证：
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
- `packages/core` 修改行数：0。
