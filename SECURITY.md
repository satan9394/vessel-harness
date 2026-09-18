# Security

Vessel 的安全策略遵循「软引导硬边界」哲学：重要规则不能只依赖模型自觉遵守，而是由 Policy Engine 硬执法。本文描述当前安全模型、已知边界（如实标注）与漏洞上报渠道。

## 安全模型

### Policy 四件套

安全规则在运行时通过四个通道强制，而不是只写进 Prompt：

| 通道 | 作用 |
|---|---|
| **Prompt Guidance** | 软引导：把安全意图以行为 IR 编译进每个 Agent 的 stable system |
| **Tool Interceptor** | 识别：每次工具调用先经策略评估 |
| **Runtime Deny** | 拦截：违反权限档 / protected 路径 / 白名单之外的写与执行被 fail-closed 拒绝，不允许绕行 |
| **Audit Event** | 记录：被拦截行为全部进 Audit（`audit/denial`），会话全量落盘可复现 |

### 权限三档

每次运行可用 `--permission <mode>` 或 TUI `/permission` 设定：

| 模式 | 行为 |
|---|---|
| `read-only` | 只读探索：Read/Grep/Glob 放行，写/执行拒绝 |
| `workspace-write`（默认） | 写工作区放行，高危操作 fail-closed 拒绝 |
| `danger-full-access` | 全权限；protected 路径与 `.env` 读取仍拒绝，保留电路熔断 |

### 沙箱边界（如实标注）

> **现状：策略层强；Windows 上已有 OS 级进程边界；非 Windows 仍为策略边界。**

- Vessel 的隔离主体是 **Policy Engine（进程内策略拦截）+ 权限档**，是行为级 / 工具级边界。
- **Windows 已交付 OS 级进程边界**（卡 071/072，见 `docs/SANDBOX-WINDOWS.md`）：命名 **Job Object** 包裹子进程，`TerminateJobObject` 连孙进程一并终止（补上 `child.kill` 只杀直接子进程的缺口）；**活动进程数上限**（anti fork-bomb，best-effort，OS 强制）；每条受限命令在 `os.tmpdir()` 下的独立目录执行。
- **仍未交付**：**受限令牌 / 低完整性级别（restricted token / low-integrity）降权**——从 TS/PowerShell 路径无法安全创建，需原生 helper（未装 Rust 工具链），后端如实上报已交付子集而不假装完整。**Linux/macOS 无 OS 级沙箱**，仍仅策略边界。
- `danger-full-access` 模式下工具在用户态执行，与宿主权限一致。
- 在线程与宿主系统验收时，请把 Vessel 视为"本地单机工具"对待，勿在承载敏感数据的受信环境之外授予过高权限。

## 凭据存储

- **task 034 起**：供应商 `apiKey` 经 `CredentialStore` 抽象管理（`packages/application/src/credential/`），providers.json 只存 `secretRef`（如 `credential:vessel/<id>`），**密钥不再明文写进 providers.json**。
- **Windows（本机）**：默认 `WindowsDpapiCredentialStore` —— 用 PowerShell `[System.Security.Cryptography.ProtectedData]`（DPAPI，绑定当前 Windows 用户）加密，密文 base64 存 `~/.vessel/secrets.json`。
- **其它/不可用平台**：显式降级 `PlaintextCredentialStore` —— `secrets.json` 明文 + 写入时 `console.warn` 显式提示"建议用 OS 凭据管理器"（不静默）。
- 选择逻辑在 `createCredentialStore()`：Windows 且 PowerShell/DPAPI 可用 → DPAPI；否则 → plaintext（带显式警告）。工厂支持注入 `isWindows/isDpapiAvailable` 便于测试隔离。
- 旧 providers.json 若仍含明文 `apiKey`：ProviderStore 加载时**自动迁入** CredentialStore 并把 providers.json 改写为 `secretRef`（原子写改写，非删除；幂等）。
- 因此仍不要同步/备份 `~/.vessel` 到不受信位置：非 Windows 降级为明文时泄露风险等同旧版。确认目录仅本机用户可读。
- 备用存储根：环境变量 `VESSEL_PROVIDER_ROOT` 可切换（CI/测试隔离；真实 ~/.vessel 凭据迁移只在 CLI 真跑时触发，测试全部注入 temp 目录）。

## 上报渠道

发现安全漏洞（策略绕过、权限越权、凭据泄漏、注入等）请优先非公开上报：

- **GitHub Issues**：仓库 Issues（如公开可见，敏感细节先邮件联系，勿在公开 issue 粘贴密钥/细节）。
- **Email**：安全上报用占位邮箱 `<security@example.invalid>`（项目维护方接盘后替换为真实地址）。

请勿将 API 密钥、`.env` 内容或完整凭据随上报提交。感谢你帮助 Vessel 更安全。