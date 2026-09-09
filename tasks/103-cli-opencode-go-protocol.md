# 103 — CLI/TUI 侧 opencode-go 协议适配（消除 400 MissingSessionID）

- 编号：103
- 状态：待执行
- 优先级：P1（用户日常用 CLI/TUI 走 Go 端点会 400）
- 创建日期：2026-09-09
- 关联：102（5af2dfc：lane 侧 opencodeGoChatProvider 已带 x-opencode-session）；docs/OPENCODE-KEY-VERIFY.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（102 记录）

opencode **Go 端点**（`https://opencode.ai/zen/go/v1`）**强制 `x-opencode-session` 头**（缺失 → 400
`MissingSessionID`）+ 具名 User-Agent。102 已在 benchmark lane 侧实现（`opencodeGoChatProvider.ts`），但
**CLI/TUI 侧仍走通用 openai-compatible 客户端**（`apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`），
对 Go 端点会 400——用户实际用 `vessel run`/`vessel chat` 配 opencode-go 时会失败。

## 验收标准（执行器逐条勾选）

- [ ] 选定并实施方案（记录理由）：
      A：把 Go 协议能力上提到 `packages/llm`（新 provider 或 OpenAICompatibleProvider 的 opencode-go 变体），
      CLI/TUI 与 lane 共用同一实现（推荐——单一事实源）；
      B：给 `ProviderConfig` 增 `extraHeaders`（或 `sessionHeader?: boolean`），OpenAICompatibleProvider 在请求时附加
      `x-opencode-session`（每会话稳定 UUID）+ 具名 UA。
      ——无论哪种，**不得**在 CLI 与 lane 各写一份协议逻辑。
- [ ] CLI/TUI 走 opencode-go（provider preset id `opencode-go`）时自动带 session 头 + UA；错误分类区分
      400 MissingSessionID / 401 CreditsError（沿用 102 的文案剥离）
- [ ] 与 102 的 lane 实现收敛：优先让 lane 复用同一 provider（若方案 A），消除重复
- [ ] 测试 ≥6 例：头注入/缺头 400 分类/CLI 端到端（mock HTTP 服务）/lane 复用/降级；`npx tsc -b tsconfig.json` exit 0 +
      全量 vitest（1082+ 无回归）+ web 74
- [ ] 文档同步（PROVIDER-MANAGEMENT/REAL-MODEL-LANE：Go 端点协议要求与配置方式）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 CLI/TUI 侧协议适配 + 与 lane 收敛。不改 pricing（101 已验收）；不做 UI；不加依赖。
- 密钥不落盘（env/CredentialStore）；不读用户本机应用数据。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`（客户端构造点）
- `packages/llm/src/provider/OpenAICompatibleProvider.ts`（若方案 B）
- `benchmarks/runners/src/lane/opencodeGoChatProvider.ts`（102；收敛目标）
- `packages/shared/src/provider.ts`（若加 extraHeaders 契约）
- `apps/cli/src/providers/presets.data.ts`（opencode-go preset：可声明协议特性）

## 方法

- 先读 102 的 lane 实现与 CLI 客户端构造路径 → 选方案（优先单一事实源）→ 实施 → mock HTTP 端到端测试 →
  全量验证

## 工作证明（执行器回填：方案选择与理由/改动 diff/头注入证据/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
