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

> **现状：策略层强，但 OS 级沙箱仍为部分实现（partial / seam）。** 请勿将 Vessel 当前的安全保证夸大为"进程已硬隔离"。

- Vessel 的隔离来自 **Policy Engine（进程内策略拦截）+ 权限档**，是行为级 / 工具级边界。
- **尚未提供独立的 OS 级进程沙箱**（如专用容器 / VM / OS 级权限分离）。`danger-full-access` 模式下工具在用户态执行，与宿主权限一致。
- 操作系统级隔离属于 V1.0 路线 **Milestone F（Security）**，尚在规划，未交付。
- 在线程与宿主系统验收时，请把 Vessel 视为"本地单机工具"对待，勿在承载敏感数据的受信环境之外授予过高权限。

## 凭据存储

- 供应商配置（含 `apiKey`）保存在 `~/.vessel/providers.json`，**当前为明文存储，不上锁**——这是为追求本地简单而做的取舍（与主流同类工具一致）。
- 因此：
  - **不要**把 `~/.vessel` 目录同步 / 备份到不受信的位置（网盘、远端仓库、共享主机）。
  - 确认该目录仅本机用户可读（勿用 `chmod`/ACL 放宽）。
  - 常见公共端点本身不作为安全边界；`apiKey` 属于敏感凭据。
- 备用存储根：可用环境变量 `VESSEL_PROVIDER_ROOT` 切换（CI/测试隔离，也便于在更安全的位置落盘）。
- 凭据加密属于后续安全里程碑（YAGNI：当前不做，避免过度设计）。

## 上报渠道

发现安全漏洞（策略绕过、权限越权、凭据泄漏、注入等）请优先非公开上报：

- **GitHub Issues**：仓库 Issues（如公开可见，敏感细节先邮件联系，勿在公开 issue 粘贴密钥/细节）。
- **Email**：安全上报用占位邮箱 `<security@example.invalid>`（项目维护方接盘后替换为真实地址）。

请勿将 API 密钥、`.env` 内容或完整凭据随上报提交。感谢你帮助 Vessel 更安全。