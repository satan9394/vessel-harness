# 069 — OS Credential Store 完善（跨平台凭据后端）

- 状态：待验收
- 优先级：P0（Wave 4 / Milestone F 首发）
- 创建日期：2026-09-08
- 关联：034（已做 CredentialStore：Windows DPAPI 真实现 + plaintext 显式降级 + secretRef 迁移）——本卡在其上完善
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（Secret Store 目标：OS-level；V1.4 Security 起点；
  checkpoint 记录 034 已含 DPAPI + 降级）

## 目标

在 034 基础上完善 OS Credential Store：增强跨平台 OS 凭据后端覆盖（Windows DPAPI/Credential Manager 细化、
macOS Keychain、Linux secret-service/libsecret 或等价；无 OS 后端时安全降级路径清晰）；错误/边界完善
（不可用/权限/损坏/重试）；保证 secret 不落盘明文（除显式 plaintext 降级 + warn）。为 070-075 安全栈铺路。

## 验收标准（执行器逐条勾选）

- [x] 摸清 034 现状（packages/application/src/credential/CredentialStore.ts：后端抽象/DPAPI 实现/plaintext 降级/
      secretRef）——明确本卡补什么（平台覆盖/错误处理/可用性检测/测试缺口）
- [x] 完善项落地（按现状与可行性选，至少 2 项实质改进）：
      - OS 后端覆盖增强：Windows DPAPI 细化（运行时 probe 往返自检 + DPAPI 失败归一 CredentialError）；
        macOS Keychain / Linux libsecret 做探测+选择适配层（本机不可测，标注平台）
      - 可用性检测/后端选择：probeBackends() 探测 + selectBackend() 按优先级 fail-over + 逐条 warn 降级原因
      - 错误边界：损坏文件隔离恢复（recoverCorrupted：改名 .corrupted-<ts> 备份留档继续）/ IO·权限失败统一
        CredentialError（带 errno code）/ 覆盖写与删除幂等 + 测试
      - secret 泄露防护验证：明文不落盘不变量强化（DPAPI 后端写入后文件绝不含明文 + 结构断言）
- [x] 不破坏 034 既有 API/迁移（secretRef/plaintext 降级语义保持；现有测试零回归）
- [x] 测试 ≥6 例（新增 14 例：探测/选择/降级 warn/损坏隔离/IO 错误/probe 自检/幂等/明文不落盘）；
      全量 vitest/tsc 绿（650 全绿，基线 636 + 14，零回归）
- [x] 文档同步（docs/PROVIDER-MANAGEMENT.md：平台支持矩阵/降级路径/错误边界）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做凭据存储完善。Rust sidecar（070）、sandbox 后端（071-073）、安全测试包（075）各自成卡。
- 不引入重依赖（如 keytar 等原生绑定需谨慎评估；优先 OS 命令/API 免依赖方案或既有 DPAPI 模式扩展）。

## 涉及文件（指针，执行器自行精化）

- packages/application/src/credential/（CredentialStore.ts/index.ts）
- 测试（现有 credential 测试 + 新增）
- docs（平台矩阵）

## 方法

- 读 034 实现与测试；定完善范围（可行性优先）；后端选择/降级路径测试化
- Windows 平台本机可测 DPAPI 路径；macOS/Linux 做适配层 + 清晰文档（本机不可测则标注）

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 一、改动文件与 diff 摘要

1. **packages/application/src/credential/CredentialStore.ts**（核心）
   - 新增 `CredentialError`（带 errno `code` 的领域错误）；`readSecretsFile`/`writeSecretsFile` 的
     IO/权限失败统一抛 CredentialError（延续 034 损坏 fail loud 语义）。
   - 新增损坏隔离恢复：`recoverCorrupted` 选项（`CredentialStoreOptions`），损坏文件改名备份为
     `<file>.corrupted-<epochMs>`（改名留档，符合删除铁律）并以空结构继续 + console.warn；两个后端
     的 read 都走该语义；默认 false 保持 fail loud。
   - 新增可用性检测/后端选择：`BackendProbe`/`probeBackends()`（windows-dpapi/macos-keychain/
     linux-libsecret 探测，注入优先 + 真实平台/工具链探测）、`selectBackend()`（按优先级 fail-over，
     skipped 原因收集）、`createCredentialStore` 重构为 probe→select→实例化，全不可用才降级
     plaintext 且逐条 warn 原因（不静默）。macOS/Linux 后端留适配层占位（REGISTERED_BACKENDS
     undefined → 探测到可用但未注册时安全降级 + warn）。
   - 新增 `probe()` 运行时自检（CredentialBackend 可选成员）：DPAPI 做真实 Protect/Unprotect 往返，
     失败返回 available=false + reason（EPERM/EACCES → permission denied）；plaintext 恒可用。
   - DPAPI 失败归一：`dpapiCall()` 把 Protect/Unprotect/powershell 失败包成带 reason 的 CredentialError。
   - 既有 API 零破坏：CredentialStore/SyncCredentialStore/CredentialBackend/secretRef/两个后端类/
     createCredentialStore 签名与返回类型不变（probe 为新增可选成员）。
2. **packages/application/src/credential/index.ts**：导出新增符号（CredentialError/DpapiFailureInfo/
   BackendProbe/CandidateOsBackend/ProbeBackendsOptions/BackendCtor/BackendSelection/probeBackends/
   selectBackend）。
3. **packages/application/src/credential/CredentialStore.test.ts**：新增 5 个 describe / 14 例测试
   （probeBackends×3、selectBackend×2、损坏隔离×3、IO 错误×1、probe 自检×2、幂等与明文不落盘×3）。
4. **docs/PROVIDER-MANAGEMENT.md**：存储章节更新平台支持矩阵（Windows DPAPI ✅ 本机可测 / macOS
   keychain / Linux libsecret 适配层标注）、fail-over 降级路径、错误边界说明。

### 二、测试数量与命令输出

- credential 测试：18（034 基线）→ 32（+14 新例）；全绿。
- 全量：**73 test files / 650 tests passed**（基线 636 + 新增 14，零回归），`npx vitest run` exit 0。
- 类型：`npx tsc -b tsconfig.json` exit 0（TSC_EXIT=0）。
- 本机 Windows + PowerShell ProtectedData 可用 → DPAPI 真实现路径实测通过（round-trip / 跨实例 /
  probe 自检 / 明文不落盘断言均真跑）。

### 三、完善项与设计选择

- **后端选择显式化**：工厂不再"Windows?→DPAPI else plaintext"二选一，改为 probe 全部候选 → 按优先级
  取首个可用 OS 后端 → 全不可用才降级 plaintext；降级时逐条输出被跳过后端及原因，不静默。macOS/Linux
  因本机不可测仅做探测/选择适配层 + 文档标注（不伪造实现结论）。
- **错误边界**：损坏默认 fail loud（034 语义）；显式 recoverCorrupted 时改名隔离 + 空结构继续（留档不删）；
  IO/权限失败统一 CredentialError 带 code 供上层分级；覆盖写/删除幂等（文件单条目断言）。
- **明文不落盘强化**：非 plaintext 后端写入后文件绝不含明文（真实 DPAPI 路径断言）+ 结构不变量
  （backend 标签/entropy 字段）。
- **零新依赖**：延续 034 的 node:crypto + PowerShell spawn 模式，无 keytar 等原生绑定。

### 四、踩坑记录

- selectBackend 优先级 reduce 初版测试断言写反（windows 不可用时错误断言仍选 windows），已修正为
  验证降到 macos-keychain 且 skipped 收原因。
- createCredentialStore 初版未把 isDpapiAvailable 注入透传给 probeBackends，导致测试注入失效；已补透传。
- DPAPI 后端 getSync 的 Unprotect 失败语义保持 034 的"返回 null"（不 throw），与 setSync 的
  Protect 失败 throw 区分：写入失败显式抛错，读取解不出视作不存在——文档化在类注释。

### 五、验收标准勾选情况

见上方验收标准节（全部勾选）。

- [x] 待执行器回填（已完成，见上）

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
