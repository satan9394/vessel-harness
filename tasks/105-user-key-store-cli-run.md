# 105 — 用户 key 入库 + CLI 真跑验证（opencode-go / MIMO V2.5）

- 编号：105
- 状态：待验收
- 优先级：P0（让用户日常 CLI 路径真正可用）
- 创建日期：2026-09-09
- 关联：102（5af2dfc：本机 store 的 key 与用户 key `same=false`）；103（afac81a：CLI/TUI 协议适配已合入）；
      097（凭据来源 = env / CredentialStore）；docs/OPENCODE-KEY-VERIFY.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

用户提供 opencode-go API key（Go 订阅有效）。把它**写入仓库 CredentialStore（DPAPI 密文）**，使
`vessel run` / `vessel chat` 走 opencode-go 时无需每次指定 env；并**用 CLI 真跑验证**端到端可用
（协议 103 + 凭据 097 + 真实模型 102 三者合流）。

## 验收标准（执行器逐条勾选）

- [x] **key 入库**：用仓库机制写入 CredentialStore（`vessel provider add opencode-go --api-key …` 或等价 API；
      Windows DPAPI 密文；`~/.vessel/secrets.json` **无明文**）；providers.json 只存 secretRef
- [x] **一致性验证**：入库后读回 key 与用户提供的 key **指纹一致**（前6+后4 + 长度；输出 `same=true` 布尔），
      **不打印完整 key**
- [x] **CLI 真跑**：`vessel provider switch opencode-go` + `vessel run --prompt "ping"`（或等价最小命令）走 Go 端点
      **真实成功**（无 400 MissingSessionID、无 401）；记录输出摘要（usage/token 等）
- [x] **回归**：`--key-source=store` 与 `--key-source=env` 两条路径都能用（store 优先 + env 回退语义保持）
- [x] 若 CLI 真跑失败：如实记录错误（区分协议/凭据/额度），不伪造；代码层面问题转卡
      （`vessel run` 真跑成功；过程中另发现 2 个缺陷，见「发现」，均未在本卡改）
- [x] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1102+ 无回归）+ web 74
- [x] 文档同步（PROVIDER-MANAGEMENT / REAL-MODEL-LANE：key 入库步骤 + `--key-source` 说明）
      （两份均已同步；PROVIDER-MANAGEMENT 等 104 提交 `812a382` 后才写入，见「发现 3」）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 key 入库 + CLI 真跑验证 + 文档。不改协议实现（103 已合入）；不改 pricing；不做 UI。
- **密钥铁律**：key 只允许写入 CredentialStore（DPAPI 密文）与进程内存；**严禁**写入任何明文文件/git/日志/任务卡/
  报告/回复；输出只允许指纹 `sk-8Dl…Cp4n1`。
- ⚠️ 另一执行器（104）正在改 `apps/cli/src/providers/ProviderStore.ts`（导出/备份/端点）——本卡**只运行 CLI 命令 +
  写用户态配置**，**不要改该源码文件**（避免冲突）；若必须改，先确认 104 已提交。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/providers/ProviderStore.ts`（providers.json + secretRef；**只读不改**）
- `packages/application/src/credential/CredentialStore.ts`（DPAPI 写入/读取 API）
- `apps/cli/src/cli.ts`（provider add/switch、run 命令）
- `~/.vessel/{providers.json,secrets.json}`（用户态）
- `docs/PROVIDER-MANAGEMENT.md`、`docs/REAL-MODEL-LANE.md`

## 方法

- 先读 CredentialStore/provider add 用法 → 用用户 key 入库（进程内传递，不落盘）→ 读回比对指纹 → switch + 真跑
  → 记录证据 → 文档

## 工作证明（执行器回填：入库方式/指纹一致性/CLI 真跑输出摘要/两条 key-source 路径/测试结果，全部写进本文件，勿留对话里）

- [x] **1. 入库方式（仓库机制，非自造脚本）**——`vessel provider add` 一条命令：

  ```powershell
  npx tsx apps/cli/src/cli.ts provider add opencode-go `
    --protocol openai-compatible --base-url https://opencode.ai/zen/go/v1 `
    --model mimo-v2.5 --name "OpenCode Go (MIMO V2.5)" --api-key <KEY>
  # → 已添加 provider "opencode-go"（protocol=openai-compatible, model=mimo-v2.5）   exit 0
  ```

  - key 只在 pwsh/tsx **进程内存**里传递（`$env:VESSEL_T105_KEY`），落盘全程由 `CredentialStore` 完成：
    Windows DPAPI `ProtectedData(CurrentUser)` + 持久化应用熵，`backend=windows-dpapi`。
  - store 里**原本已有** `credential:vessel/opencode-go`（102 记录的那把失效 key），本次是**原地更新**：
    条目数保持 3（`ds` / `ant` / `opencode-go`），**无重复条目**（`vessel provider add` 之前 `~/.vessel` 无
    `providers.json`，故新增配置条目本身不构成重复）。

- [x] **2. 落盘形状（无明文）**

  - `~/.vessel/providers.json`（236 B，全文）：
    ```json
    [{"id":"opencode-go","name":"OpenCode Go (MIMO V2.5)","protocol":"openai-compatible",
      "baseUrl":"https://opencode.ai/zen/go/v1","model":"mimo-v2.5",
      "secretRef":"credential:vessel/opencode-go"}]
    ```
    **只有 `secretRef`，无 `apiKey` 字段**。
  - `~/.vessel/secrets.json`：`backend=windows-dpapi`、`version=1`、`entropy` 存在；
    `secrets[].cipher` 均为 DPAPI base64 密文（`opencode-go` 条目 392 B → 更新后 1393 B 文件）。
  - **明文扫描**：`Select-String -Path ~/.vessel/*.json -Pattern 'sk-[A-Za-z0-9]{10,}'` → **0 命中**；
    本次真跑的 session 日志（`.harness/sessions/sess_…/session.jsonl`，5861 B）同样 **0 命中**。

- [x] **3. 指纹一致性（`same=true`，全程未打印完整 key）**

  读回方式：pwsh `ProtectedData::Unprotect(cipher, entropy, 'CurrentUser')` 解出 store 里的明文，
  再与用户 key 比「前6 + 后4 + 长度 + sha256 前 8 位」：

  | 时点 | store 里的 key | 用户提供的 key | same |
  | --- | --- | --- | --- |
  | 入库**前**（复现 102） | `sk-5TJ…ejq8` len=67 sha8=`7f72b1d8` | `sk-8Dl…p4n1` len=67 sha8=`975430ec` | **false** |
  | 入库**后** | `sk-8Dl…p4n1` len=67 sha8=`975430ec` | `sk-8Dl…p4n1` len=67 sha8=`975430ec` | **true** |

  - 102 的 `same=false` 已复现并消除；`storeLen=67 / envLen=67 / same=true`（见第 5 节 env 路径）。
  - 指纹口径：本卡统一用「前 6 + 后 4」= `sk-8Dl…p4n1`；`docs/OPENCODE-KEY-VERIFY.md` 里的
    `sk-8Dl…Cp4n1` 是「前 6 + 后 5」，指向同一把 key。

- [x] **4. CLI 真跑（store 路径，**未设任何 env**）**

  ```powershell
  npx tsx apps/cli/src/cli.ts provider switch opencode-go   # → 已切换到 provider "opencode-go"   exit 0
  npx tsx apps/cli/src/cli.ts run --prompt "ping" --max-steps 2

  === 最终回复 ===
  pong
  === turn turn_1788972480077_c5e051 kind=success steps=1 toolCalls=0 ===
  会话日志: .harness\sessions\sess_1788972480061_792ac975\session.jsonl
  EXIT=0
  ```

  - **无 400 `MissingSessionID`、无 401**（`x-opencode-session` 由 103 的 `OpencodeGoProvider` 自动带上）。
  - usage 摘要（`~/.vessel/usage.json` 末条，`recent[]`）：
    `provider=opencode-go, model=mimo-v2.5, inputTokens=3265, outputTokens=37, cacheReadTokens=0,
    costUsd=0.001688, estimated=true, pricingSource=protocol`。

- [x] **5. 两条 key-source 路径 + store 优先语义**
  （`benchmarks/runners/src/lane/run-opencode-lane.ts --probe-only --model=mimo-v2.5`，每条 1 次真实调用）

  | 命令 | 凭据来源行（原样） | 探针结果 |
  | --- | --- | --- |
  | `--key-source=store` | `key-source=store → CredentialStore vessel/opencode-go（storeLen=67 envLen=0）` | `ok content=60B reasoning=617B usage={"inputTokens":248,"outputTokens":154,"cacheReadTokens":192}` |
  | `--key-source=env` | `key-source=env → env OPENCODE_API_KEY（storeLen=67 envLen=67 same=true）` | `ok content=165B reasoning=467B usage={"inputTokens":248,"outputTokens":154,"cacheReadTokens":192}` |
  | `--key-source=auto`（env 塞**假值**） | `key-source=auto → CredentialStore vessel/opencode-go（storeLen=67 envLen=58 same=false）` | `ok`（**store 优先**：假 env 未被选中） |

  - 三条均先 `GET https://opencode.ai/zen/go/v1/models` → `source=live`（鉴权通过，35 模型），
    再走 `/chat/completions`；路由打印 `route mimo-v2.5 → /chat/completions (openai-chat, implemented)`。
  - `same=true` 那行直接证明：**store 里的 key 与 `OPENCODE_API_KEY` 是同一把**（097「store 优先 → env 回退」语义保持）。
  - 探针产物：`benchmarks/reports/V1.1-F-openmodel-probe-105-{store,env,auto-priority}.json`（只含
    `keyPresent:true` + 模型输出/usage，**不含任何密钥片段**；与 102 的
    `V1.1-F-openmodel-probe-102probe*.json` 同口径，随本卡提交）。

- [x] **6. 类型与测试**

  | 命令 | 结果 |
  | --- | --- |
  | `npx tsc -b tsconfig.json` | **exit 0** |
  | `npx vitest run`（root 全量） | 见下方「测试结果」 |
  | `npx vitest run`（`apps/web`） | **8 files / 74 tests passed**，exit 0 |

  **测试结果（root 全量）**

  | 轮次 | 结果 |
  | --- | --- |
  | 首轮（入库后、current=opencode-go） | `1145 passed / 1 skipped / 3 failed` |
  | 复位 `current=mock` 后·第 2 轮 | `1147 passed / 1 skipped / 1 failed` |
  | 复位后·第 3 轮（复现） | `1147 passed / 1 skipped / 1 failed` |
  | 隔离复跑 2 个失败文件 | `29/29 passed` |

  - 首轮 3 个失败中 2 个是「默认 provider 被切成 opencode-go + 测试读真实 `~/.vessel`」导致
    （`cli.test.ts` run smoke 打真实网络 30s 超时；`chat.test.ts` 断言 `mock` 失败），复位 `current=mock` 后
    **双双恢复通过**（见「发现 1」）。
  - 复位后两轮唯一失败恒为 `packages/runtime/src/sandbox/backend/process-tree.test.ts` ›
    `attaches a pre-spawned grandchild into the job and enumerates it`（真实 Windows 计时窗口枚举）：
    **独立跑 11/11 passed**（该用例本身 29.3 s，逼近 `testTimeout=30000ms`），全量并发下超时 → **负载相关 flaky，
    非本卡回归**（见「发现 4」）。
  - 本卡**未改任何源码/测试**（改动仅：任务卡 + 2 份文档 + 3 个探针产物）；基线 1102 → 1147 passed，
    增量 +45 全部来自 104 的 4 个新测试文件（`812a382` 已合入并全绿）。

- [x] **7. 文档同步**

  - `docs/REAL-MODEL-LANE.md`：
    ① 新增「## key 入库（task 105）」节——入库命令、`vessel provider switch` 一次性启用、
    指纹校验片段（DPAPI Unprotect 比对，不出 key）、落盘形状、`--key-source=auto|env|store` 三路实测表、
    `vessel run` 真跑 usage 摘要；
    ② 把 102 的「**踩坑**：store 里是另一把 key → 401」改写为「历史踩坑 → 已修复（task 105）」。
  - `docs/PROVIDER-MANAGEMENT.md`：新增「## 3.3 key 入库（task 105：opencode-go 示例）」——入库/切换/真跑
    三条命令、落盘形状、**CredentialStore → env 优先级 + `--key-source` 说明**，并附两条 ⚠️（TUI 未接
    CredentialStore；两个测试的机器状态耦合）。
    （该文件在 104 提交 `812a382` 前一直被其占用，本卡**等 104 提交后**才写入，避免混入 104 的改动。）

- [x] **8. 发现（均如实记录，本卡范围内未改代码）**

  - **发现 1（与「默认可用」直接冲突，已用复位规避）**：两个既有测试读**真实 `~/.vessel`**，
    行为随用户当前 provider 变化：
    - `apps/cli/src/cli.test.ts` › `run with mock provider completes read → tool → answer`
      （进程内 `main(['run', …])` → `defaultProviderStore()` → 真实 root）；current=opencode-go 时它会打
      **真实网络**，30 s 超时失败。
    - `apps/cli/src/tui/chat.test.ts` › `runs three rounds (…)`（`runChat` 不传 store → `new ProviderStore()`
      读真实 root）；current=opencode-go 时断言 `toContain('mock')` 失败。
    → 本卡**验证完成后把 `~/.vessel/current.json` 复位为 `{"id":"mock"}`**（`vessel provider switch mock`），
    保证 `npm test` 与机器状态无关。**用户日常启用只需一条命令**：`vessel provider switch opencode-go`。
    建议后续卡：给这两个测试注入临时 `VESSEL_PROVIDER_ROOT`/`store`（符合 AGENTS.md「测试一律注入 rootDir/temp」）。
  - **发现 2（产品缺陷，转卡）**：`vessel chat`（TUI）**仍不可用**——`apps/cli/src/tui/chat.ts:180`
    `const store = opts.store ?? new ProviderStore();` **没接 CredentialStore**，`secretRef` 解析不出 `apiKey`
    → `opencode-go 401 AuthError (auth): Missing API key.`（本次 vitest 输出实证）。修复点是一行级
    （`new ProviderStore({ credentialStore: createCredentialStore() })`），但属独立缺陷，按范围边界**未在本卡改**。
    （注：`vessel run` 走的是 `cli.ts` 的 `defaultProviderStore()`，已接 CredentialStore，故真跑正常。）
  - **发现 3（并发避让，已解决）**：`docs/PROVIDER-MANAGEMENT.md` 与 `apps/cli/src/cli.test.ts`、`cli.ts`、
    `providers/ProviderStore.ts` 在本次执行的大部分时间里**被 104 执行器持有未提交改动**（`git status` 显示 ` M`）。
    按「勿混入 104 的改动 / 不碰 ProviderStore.ts」铁律，本卡先做其余部分，**等 104 于 `812a382` 提交后**
    才写 `PROVIDER-MANAGEMENT.md`；本卡全程**未改任何源码**（ProviderStore.ts / cli.ts / chat.ts 均未动）。
  - **发现 4（flaky，非本卡引入）**：`packages/runtime/src/sandbox/backend/process-tree.test.ts` ›
    `attaches a pre-spawned grandchild into the job and enumerates it`（真实 Windows 计时窗口枚举）
    在**全量并发下连续两轮超时**（30 s 上限），而**单独跑 11/11 passed**（该用例本身耗时 29.3–29.5 s，
    贴着 30 s 上限）——即「机器负载敏感」，与工作树改动无关（本卡零源码改动）。
    建议后续卡把该用例的 `testTimeout` 单独放宽（或标 skip 并记录原因）。

- [x] **9. 环境备注**：Windows / PowerShell 7、Node v24.14.0、直连（未用 7897 代理）；
  真实网络请求共 **7 次**（`vessel run` 1 次 + lane 探针 3 次 + 随探针的 `GET /v1/models` 3 次），
  每步只跑 1 遍、失败不重试；无 EPERM/spawn 阻塞，`npx tsx` / `vitest` 均可直跑；
  期间另一执行器（104）也在跑测试，全量 vitest 时长在 174–291 s 间波动（负载偏高）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
