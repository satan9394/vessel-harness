# 034 — CredentialStore 抽象（OS 凭据存储 + 明文降级显式化）

- 状态：待执行
- 优先级：P1（Milestone A/F 前哨；路线 §十四 凭据系统、§十六 V0.10 任务 10）
- 创建日期：2026-09
- 关联：路线卡 034/069；goal（V1.0 产品化）；依赖 033（~/.vessel 迁移已合入）

## 目标

把 apiKey 从 providers.json 明文 JSON 拆到 CredentialStore 抽象（接口 + 后端），providers.json 只存 secretRef。首期做接口 + Windows Credential Manager 后端（本机 Windows）+ plaintext fallback（显式提示，不静默）。

## 验收标准

- [ ] `packages/application/src/credential/CredentialStore.ts`：接口
  ```ts
  interface CredentialStore {
    set(service: string, account: string, secret: string): Promise<void>;
    get(service: string, account: string): Promise<string | null>;
    delete(service: string, account: string): Promise<void>;
  }
  ```
- [ ] 后端：`WindowsCredentialStore`（用 `cmdkey` 或 PowerShell `CredentialManager` 或 node 原生？——**零新依赖**：Windows 用 PowerShell `[System.Security.Cryptography.ProtectedData]` 或 cmdkey；本卡可行做法：Windows 上用 `powershell -Command` 调 Windows Credential Manager 经 `cmdkey /generic:... /pass:...` 存、`cmdkey /list` 查——若复杂，首期可做**加密文件 store**（ProtectedData DPAPI，Windows only）+ 跨平台 plaintext 带显式提示）——**由执行器选实现，保证接口 + 测试 + 显式降级**
- [ ] `PlaintextCredentialStore`（显式降级，写入时提示"明文存储，建议 OS store"）
- [ ] 默认选择逻辑：Windows → ProtectedData/DPAPI 加密文件 `~/.vessel/secrets.json`（加密）；非 Windows → plaintext + 显式警告
- [ ] ProviderStore 集成：`apiKey` 字段从 providers.json 移除（或可选），改存 `secretRef`（如 `credential:vessel/<providerId>`）；读取时经 CredentialStore 取 key；向后兼容：旧 providers.json 含明文 apiKey 时自动迁入 credential store 并清明文（迁移逻辑，删除走回收站/改写文件）
- [ ] 文档：SECURITY.md/PROVIDER-MANAGEMENT 更新（key 不再明文/默认加密/降级显式）
- [ ] 测试：WindowsCredentialStore（若可用）/PlaintextCredentialStore/加密 store 的 set/get/delete、ProviderStore 迁移旧明文到 secretRef
- [ ] 全量 vitest/tsc 绿（337+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `packages/application/src/credential/`（接口 + 后端 + 测试）或放 apps/cli（若 providers 在 cli 层）——执行器定，倾向 application 便于 web 复用
- `apps/cli/src/providers/ProviderStore.ts`（apiKey→secretRef 集成）
- `apps/cli/src/providers/setup.ts`（向导写 key 改走 store）
- 文档同步

## 依赖

- 033（~/.vessel 已存在）

## 方法

- 首选 Windows DPAPI（ProtectedData）加密 secrets.json；cmdkey 走系统 Credential Manager 若可行
- 零新 npm 依赖（用 node:child_process 调 powershell 或 node:crypto）
- 迁移：旧 providers.json 有 apiKey → 写入 store → providers.json 改 secretRef（旧 key 字段清除）

## 工作证明（执行器回填）

- [ ] 接口/后端/迁移/测试

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：