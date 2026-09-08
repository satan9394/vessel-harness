# 034 — CredentialStore 抽象（OS 凭据存储 + 明文降级显式化）

- 状态：待执行
- 优先级：P1（Milestone A/F 前哨；路线 §十四 凭据系统、§十六 V0.10 任务 10）
- 创建日期：2026-09
- 关联：路线卡 034/069；goal（V1.0 产品化）；依赖 033（~/.vessel 迁移已合入）

## 目标

把 apiKey 从 providers.json 明文 JSON 拆到 CredentialStore 抽象（接口 + 后端），providers.json 只存 secretRef。首期做接口 + Windows Credential Manager 后端（本机 Windows）+ plaintext fallback（显式提示，不静默）。

## 验收标准

- [x] `packages/application/src/credential/CredentialStore.ts`：接口（async CredentialStore + 同步 SyncCredentialStore 供 ProviderStore 复用）+ SecretRef 助手
- [x] 后端：`WindowsDpapiCredentialStore`（node:child_process 调 PowerShell ProtectedData Protect/Unprotect，0034 实测本机 Windows 可用）+ `PlaintextCredentialStore`（写时显式 warn）
- [x] `PlaintextCredentialStore`（显式降级，写入时提示"明文存储，建议 OS store"）
- [x] 默认选择逻辑 `createCredentialStore()`：Windows + DPAPI 可用 → DPAPI；否则 plaintext + 显式警告（注入 isWindows/isDpapiAvailable 可测）
- [x] ProviderStore 集成：apiKey 保留向后兼容读取；写 secretRef（`credential:vessel/<id>`）；加载时自动迁移旧明文 apiKey → store + 改写 providers.json 为 secretRef（原子写，幂等）
- [x] 文档：SECURITY.md / PROVIDER-MANAGEMENT.md 已更新（默认 DPAPI 加密 / plaintext 显式降级 / secretRef 说明）
- [x] 测试：PlaintextCredentialStore set/get/delete、DPAPI store（本机 Windows DPAPI 实测）、工厂选择、ProviderStore 迁移旧明文→secretRef、secretRef 读取解析回 apiKey
- [x] 全量 vitest/tsc 绿（337+ 无回归）
- [ ] 卡置"待验收"（指挥回填）

## 涉及文件

- 新建 `packages/application/src/credential/`（接口 + 后端 + 测试）
- `apps/cli/src/providers/ProviderStore.ts`（apiKey→secretRef 集成 + 迁移）
- `apps/cli/src/cli.ts` / `apps/cli/src/tui/chat.ts`（挂载默认 CredentialStore，secretRef 运行时解析）
- 文档同步

## 依赖

- 033（~/.vessel 已存在）

## 方法

- 首选 Windows DPAPI（ProtectedData）加密 secrets.json；cmdkey 走系统 Credential Manager 若可行
- 零新 npm 依赖（用 node:child_process 调 powershell 或 node:crypto）
- 迁移：旧 providers.json 有 apiKey → 写入 store → providers.json 改 secretRef（旧 key 字段清除）

## 工作证明（执行器回填）

- [x] 接口/后端/迁移/测试（见下节回传摘要；DPAPI 本机 powershell 实测可用）

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：