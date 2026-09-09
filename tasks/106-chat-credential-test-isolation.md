# 106 — 修复 105 暴露的三个问题（chat 凭据 + 测试隔离 + process-tree 超时）

- 编号：106
- 状态：待执行
- 优先级：P0（chat 产品缺陷）+ P1（测试基础设施）
- 创建日期：2026-09-09
- 关联：105（e064209 发现）；103（afac81a CLI 协议）；097（凭据来源约定）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（105 实测发现，均非 105 引入）

1. **`vessel chat`(TUI) 仍不可用（产品缺陷）**：`apps/cli/src/tui/chat.ts:180` 用
   `opts.store ?? new ProviderStore()` 构造，**没接 CredentialStore** → provider 的 `secretRef` 解析不出 apiKey
   → `401 Missing API key`（105 用 vitest 实证）。`vessel run` 不受影响（它走了 providerFactory）。
2. **测试读真实 `~/.vessel`（隔离缺陷）**：`apps/cli/src/cli.test.ts` 的 run smoke 与 `apps/cli/src/tui/chat.test.ts`
   读真实 `~/.vessel/current.json`——105 把默认切到 opencode-go 后这两用例会打真网络/断言失败（105 已把
   current.json 复位 `mock` 以保测试稳定）。根因是未注入临时 `VESSEL_PROVIDER_ROOT`。
3. **process-tree 时序 flaky**：`packages/runtime/src/sandbox/backend/process-tree.test.ts` Windows 计时用例
   本身 ~29-39s，默认 30s 超时 → 全量并发下偶发失败（隔离跑 11/11 通过）。

## 验收标准（执行器逐条勾选）

- [ ] **① chat 接 CredentialStore**：`apps/cli/src/tui/chat.ts` 构造 provider 时接 CredentialStore（复用
      providerFactory 或显式注入 store），使 `vessel chat` 能解析 secretRef → apiKey；**不改协议实现**（103 已合入）
- [ ] ① 测试：注入 mock CredentialStore 的 chat 用例能解析 secretRef（不真调网络）；或本地 mock HTTP 端到端
- [ ] **② 测试隔离**：`cli.test.ts` / `chat.test.ts` 显式注入临时 `VESSEL_PROVIDER_ROOT`（mkdtemp），
      断言测试**不读真实 `~/.vessel`**；跑完清理（回收站纪律）；验证方式：把真实 current.json 改成任意值，测试仍绿
- [ ] **③ process-tree 超时**：该用例加长 `testTimeout`（如 120s）或放宽断言窗口（选型记录理由，**不得**跳过用例）
- [ ] 全量验证：`npx tsc -b tsconfig.json` exit 0；`npx vitest run`（root）**0 failed**（这是本卡目标：消除唯一 flaky）；
      web 74；连续跑 2 次全量确认稳定
- [ ] 文档同步（若涉及测试约定，写进 AGENTS 或 docs）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只修这三项。不改协议（103）、不改 pricing、不做 UI、不加依赖。
- 密钥不落盘；不读用户本机应用数据（097 守卫测试）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/tui/chat.ts`（①）+ `apps/cli/src/tui/chat.test.ts`（②）
- `apps/cli/src/cli.test.ts`（②）
- `apps/cli/src/providers/providerFactory.ts`（103：唯一构造路径，优先复用）
- `packages/runtime/src/sandbox/backend/process-tree.test.ts`（③）

## 方法

- 先读 105 卡 §发现 + 103 的 providerFactory → ①接 store → ②注入临时 root → ③加长超时 → 连续两次全量验证

## 工作证明（执行器回填：三处改动 diff/隔离验证方法/全量两次结果/踩坑，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
