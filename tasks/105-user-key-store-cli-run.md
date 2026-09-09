# 105 — 用户 key 入库 + CLI 真跑验证（opencode-go / MIMO V2.5）

- 编号：105
- 状态：待执行
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

- [ ] **key 入库**：用仓库机制写入 CredentialStore（`vessel provider add opencode-go --api-key …` 或等价 API；
      Windows DPAPI 密文；`~/.vessel/secrets.json` **无明文**）；providers.json 只存 secretRef
- [ ] **一致性验证**：入库后读回 key 与用户提供的 key **指纹一致**（前6+后4 + 长度；输出 `same=true` 布尔），
      **不打印完整 key**
- [ ] **CLI 真跑**：`vessel provider switch opencode-go` + `vessel run --prompt "ping"`（或等价最小命令）走 Go 端点
      **真实成功**（无 400 MissingSessionID、无 401）；记录输出摘要（usage/token 等）
- [ ] **回归**：`--key-source=store` 与 `--key-source=env` 两条路径都能用（store 优先 + env 回退语义保持）
- [ ] 若 CLI 真跑失败：如实记录错误（区分协议/凭据/额度），不伪造；代码层面问题转卡
- [ ] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1102+ 无回归）+ web 74
- [ ] 文档同步（PROVIDER-MANAGEMENT / REAL-MODEL-LANE：key 入库步骤 + `--key-source` 说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
