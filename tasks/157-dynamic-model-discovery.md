# 157 — 第三方模型供应商动态自省与探测引擎 (Dynamic Model Discovery)

- 编号：157
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/llm`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

为 Vessel 交付独立的第三方模型供应商动态自省与探测子系统。
解决用户接入自定义 OpenAI 兼容端点（如 DeepSeek、SiliconFlow、OpenRouter、本地 Ollama / vLLM / llama.cpp）时，
必须手动敲模型 ID 的高摩擦痛点。用户仅需提供 Base URL 与可选 API Key，系统即可通过轻量探针安全获取可用模型清单，
智能识别推理（Thinking）大模型，并将结果标准化返回。

## 2. 权威开源参考基准与读取指引 (GitHub & Local Assets)

在实现此任务时，Codex GPT-6 Luna 可参考以下开源项目的成熟实现。
**读取纪律**：
- **严禁全量 git clone 外部大仓库到本工作区内**，避免工作区被污染或触发未跟踪文件。
- **本地免下直读**：用户机器已缓存部分参考仓库（路径：`E:\DeepSeek_Harness\workspace\2026_08_25\stars-scan\repos\`），可直接用文件读取工具秒读。
- **在线按需只读**：针对未本地缓存的仓库，使用 `gh api repos/<owner>/<repo>/contents/<path>` 获取目标文件内容，或者用 `gh repo view <owner>/<repo>` 查看说明。
- **Clean-room 铁律**：仅参考其数据结构（Schema）、字段命名规则与探测流程，**严禁复制代码文本**（遵守本仓 AGENTS.md clean-room 纪律）。

### 重点参考开源项目：
1. **OpenCode**：`https://github.com/anomalyco/opencode`
   - 对标要点：动态模型配置加载与 `/v1/models` 端点解析机制，如何自动提取模型 ID 并智能归类。
   - 读取方式：使用 `gh api repos/anomalyco/opencode/contents/...` 或 Web API 进行针对性查阅。
2. **Claw-Code (UltraWorkers)**：`https://github.com/ultraworkers/claw-code`
   - 对标要点：`docs/local-openai-compatible-providers.md` 中对于 Ollama / vLLM / llama.cpp 端点路径规范化与前缀路由策略。
   - 读取方式：使用 `gh api repos/ultraworkers/claw-code/contents/docs/local-openai-compatible-providers.md` 在线查阅。
3. **Cline**：`https://github.com/cline/cline`
   - 对标要点：多供应商（OpenRouter/Ollama/OpenAI-compatible）模型列表动态拉取与刷新逻辑。
   - 读取方式：在线按需检索其模型拉取服务模块。

## 3. 接口与数据契约

在 `packages/llm/src/discovery/` 模块下导出纯函数与强类型定义：

```typescript
export interface DiscoveredModel {
  /** 模型原生唯一标识，如 "deepseek-ai/DeepSeek-R1"、"qwen3:latest" */
  id: string;
  /** 上下文窗口大小（若服务端未返回则为 undefined） */
  contextWindow?: number;
  /** 是否支持/具备深度推理思考链（基于 ID 模式启发式匹配：r1, o1, o3, thinking, qwq 等） */
  supportsReasoning: boolean;
  /** 所属厂商或所有者（若有） */
  ownedBy?: string;
}

export interface ModelProbeOptions {
  /** 目标 API 根路径或 /v1 路径，探针内部需自适应处理末尾斜杠与 /models 拼接 */
  baseUrl: string;
  /** 可选 API Key（本地端点如 Ollama/llama.cpp 可空） */
  apiKey?: string;
  /** 超时毫秒数，默认 8000ms，必须带 AbortSignal 防挂死 */
  timeoutMs?: number;
  /** 自定义 fetch 实现，便于测试注入 Mock，默认全局 fetch */
  fetchFn?: typeof fetch;
}

export interface ModelProbeResult {
  ok: boolean;
  models: DiscoveredModel[];
  error?: {
    code: 'NETWORK_ERROR' | 'AUTH_FAILED' | 'INVALID_RESPONSE' | 'TIMEOUT';
    message: string;
    status?: number;
  };
}

/**
 * 安全探测 OpenAI 兼容端点的 /models 接口并解析模型元数据。
 * fail-safe：绝不抛出未捕获异常，所有失败均以 ok=false 的 ModelProbeResult 返回。
 */
export function probeOpenAIModels(opts: ModelProbeOptions): Promise<ModelProbeResult>;
```

在 `packages/llm/src/index.ts` 中导出上述接口与函数。

## 4. 确定性完成门禁 (DoD)

- [x] **单元测试**：新建 `packages/llm/src/discovery/probeOpenAIModels.test.ts`，Vitest 必须全部通过：
  - 测试标准返回：Mock 典型的 OpenAI `{ object: 'list', data: [{ id: 'gpt-4o' }, { id: 'deepseek-reasoner' }] }`，验证模型列表解析与 `supportsReasoning` 正确置位。
  - 测试推理识别：验证包含 `r1`, `o1`, `o3`, `thinking`, `qwq` 等特征的模型其 `supportsReasoning` 为 `true`，普通模型为 `false`。
  - 测试非标容错：Mock 某些本地服务直接返回裸数组 `[{ id: 'qwen3:latest' }]` 的情况，依然能容错解析。
  - 测试异常安全：Mock 401 Unauthorized、网络超时 Timeout、畸形 JSON 响应，断言 `ok: false`，返回对应的标准错误码，且**绝无未脱敏的 API Key 泄露到错误消息中**。
- [x] **构建检查**：
  - `npx tsc -b tsconfig.json` 退出码必须为 0。
  - `npm run typecheck:tests` 退出码必须为 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部绿灯（根工作区与 `apps/web` 既有测试无回归）。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守薄核（Thin Core）**：探针只属于 `packages/llm`，绝不修改 `packages/core` 中的任何核心状态机。
- **脱敏铁律**：严守本仓 G-05b 密钥安全规范，错误信息 `message` 中严禁拼接或反射用户的 `apiKey`。
- **回收站与删除纪律**：本任务为纯新增逻辑，如需清理测试临时资源，必须遵循回收站规则（唯一例外是测试自建且位于 `os.tmpdir()` 下的临时目录）。
- **零外部破坏**：本任务不修改 `apps/web` UI 渲染（UI 对接由后续工单承担），不修改既有已通过测试的断言。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- URL 规范化：部分用户传入的 `baseUrl` 已经带有 `/v1`（如 `https://api.example.com/v1`），有些未带（如 `http://localhost:11434`）。探针应智能处理，避免拼出 `/v1/v1/models` 或漏掉 `/models`。
- 全局 fetch 超时：推荐使用 `AbortController` 与 `setTimeout` 配合，并在请求完成后清理定时器，避免在 Node 事件循环中残留活跃句柄。
