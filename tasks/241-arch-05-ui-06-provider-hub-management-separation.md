# 任务卡 241 [ARCH-05 + UI-06]: ProviderHub 管理与添加分离 + 凭据免输直测

> 状态：已完成 (DONE)  
> 归属：Phase 2 配置中心分层与单一事实源（ARCH-05 / UI-06 / P1）  
> 对应规划：`docs/plans/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` §3 UI-06 与 `VESSEL_Architecture_Review_and_Execution_2026-10-20.md` ARCH-05  

## 1. 目标 (Goal)
- 彻底解决模型设置页（Settings / ProviderHub）一进入就铺满 72+ 预设卡片墙导致的视觉冗余与认知过载问题：
  1. **管理与发现分离 (Management vs. Discovery Separation)**：
     - 已配置供应商为主视图：清晰呈现供应商名称、协议、端点、掩码凭据、模型数、健康状态与能力等级；
     - 添加新供应商通过明确的【+ 添加供应商】操作触发，收起时不占用主视区；
     - 零配置新用户或传入 `initialPreset` 时平滑聚焦添加视图；
  2. **解决用户核心痛点：已存供应商直连免输 Key 测试**：
     - 卡片上提供原生【测试连接】按钮，直接使用服务端安全存储的凭据发起测试（`apiKey: ''` 由服务端从已存凭据补齐），一步完成验证；
     - 保留【更换密钥测试】二级选项，支持用户换 key 试用而不覆盖原凭据；
     - 凭据安全：绝不把掩码 Key 发送到服务端，也不在屏幕上暴露明文；
  3. **预设目录 SSOT (ARCH-05)**：
     - 保持 `packages/application/src/providers/presets.data.ts` 与 `apps/web/src/components/providers/presetsData.ts` 强一致；
     - 规范化错误处理：测试或拉取模型失败时展示具体错误码，不出现笼统的“操作失败”。

## 2. 非目标 (Not Doing)
- 不破坏现有 ProviderStore 与凭据后端契约；
- 不修改 `packages/core`（修改行数恒为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. 视觉结构：
   - 已有供应商时，Settings 优先展示已配供应商列表，不强制平铺 PresetsGallery 预设墙；
   - 点击【+ 添加供应商】平滑展开/切换至预设展台与表单；
2. 测试免输：
   - 已配置供应商卡片上点击【测试连接】，无需重复输入 API Key 即可成功完成测试并刷新状态；
3. 安全与回退：
   - 绝不泄露明文 API Key，掩码仅作展示；
   - 支持通过【更换密钥测试】表单输入新密钥进行探测；
4. 自动化测试门禁：
   - `ProviderHub.test.tsx` 与 `ProviderSettingsModal.test.tsx` 涵盖免输直接测试、更换密钥测试与添加展开逻辑，全部通过；
   - Web 单元测试 `npm run test -- --root apps/web` 全绿；
   - 全量双 Root 测试 `npm run test:all` 全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/components/providers/ProviderSettingsModal.tsx`：重构视图分层、优化免输直测逻辑；
- `apps/web/src/components/providers/ProviderHub.test.tsx`：更新直测断言与展开交互测试；
- `apps/web/src/components/providers/ProviderSettingsModal.test.tsx`：覆盖各分支验证；
- `apps/web/src/styles.css`：补充操作栏与响应式排版样式。

## 5. 预期证据 (Expected Evidence)
- 定向测试与 Web 全量测试通过日志：
  - `src/components/providers/ProviderHub.test.tsx` 5 passed；
  - `src/components/providers/ProviderSettingsModal.test.tsx` 24 passed；
  - `npx vitest run --root apps/web` 50 passed (50 files / 408 passed)；
- 全量门禁验证：
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
- `packages/core` 修改行数：0。
