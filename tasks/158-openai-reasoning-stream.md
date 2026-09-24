# 158 — OpenAI 协议 Reasoning 思考流解析标准化 (Stream Reasoning Ingestion)

- 编号：158
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/llm`, `packages/shared`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

为解决大语言模型（如 DeepSeek-R1、OpenAI o1/o3、Qwen-QwQ 等）在 OpenAI 兼容流式输出中，思考推演内容（Thinking / Reasoning）与正文内容混杂或丢失的问题。
标准化 OpenAI 流式解析管道，自动侦测 `delta.reasoning_content`（DeepSeek 规范）或 `delta.thinking`（社区代理规范），
将其统一解包为框架标准的思考流 Chunk，使后续前端 UI 与终端能够实时渲染推演过程手风琴卡片。

## 2. 权威开源参考基准与读取指引 (GitHub & Local Assets)

### 重点参考开源项目：
1. **DeepSeek-Harness**：`https://github.com/deepseek-ai/deepseek-harness`
   - 对标要点：`reasoning_content` 字段的流式提取与生命周期管理。
   - 读取方式：本地已有适配器参考 `benchmarks/runners/src/adapters/dsh.ts`，或在线查阅仓库规范。
2. **Claw-Code (UltraWorkers)**：`https://github.com/ultraworkers/claw-code`
   - 对标要点：Rust 流式解析器如何将推理块与普通正文分流。
   - 读取方式：使用 `gh api repos/ultraworkers/claw-code/contents/rust/crates/...` 针对性查阅。
3. **Cline**：`https://github.com/cline/cline`
   - 对标要点：前端如何实时接收 thinking chunk 并与普通文本分流更新。
   - 读取方式：在线查阅其 streaming 处理管道。

### 读取纪律：
- 严禁全量克隆大仓库至当前工作区。
- Clean-room 准则：仅参考协议字段结构（如 `delta.reasoning_content`），自主编写符合 Vessel 规范的解析与测试代码。

## 3. 接口与数据契约

在 `packages/llm/src/stream/types.ts` 中扩展流式 Chunk 联合类型：

```typescript
export interface StreamThinkingChunk {
  kind: 'thinking_delta';
  delta: string;
}

export type StreamChunk =
  | StreamTextChunk
  | StreamThinkingChunk
  | StreamToolCallChunk;
```

在 `packages/llm/src/stream/parseOpenAI.ts` 中增强流式解析逻辑：
- 探测每一行 SSE 的 JSON 数据：
  - 若包含 `choices[0].delta.reasoning_content` 或 `choices[0].delta.thinking`，发射 `kind: 'thinking_delta'`。
  - 若包含 `choices[0].delta.content`，发射既有的 `kind: 'text_delta'`。
  - 两者并存或交替时，严格按流式顺序先后发射，绝不合并吞并。

## 4. 确定性完成门禁 (DoD)

- [x] **单元测试**：新建/扩充 `packages/llm/src/stream/parseOpenAI.test.ts`：
  - 覆盖 DeepSeek-R1 纯 reasoning 流段落解析。
  - 覆盖包含 reasoning 然后过渡到 content 的完整多阶段流。
  - 覆盖容错 `delta.thinking` 替代字段的解析。
  - 覆盖普通模型（无 reasoning）时的零回归。
- [x] **构建检查**：
  - `npx tsc -b tsconfig.json` 退出码必须为 0。
  - `npm run typecheck:tests` 退出码必须为 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守薄核（Thin Core）**：流式格式的扩充只停留在 `packages/llm` 和事件流契约，不侵入 `packages/core`。
- **向前兼容**：既有只消费 `text_delta` 的下游消费者（如简易命令行输出）不得被 `thinking_delta` 抛出未处理分支异常，类型断言需平滑收窄。
- 严禁永久删除任何既有测试。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 有些流式中转服务会在首个 chunk 吐出空的 `reasoning_content: ""`，解析器应忽略纯空 delta 避免产生空事件噪音。
- 在流式收尾时，某些模型会在最后一个带 `finish_reason` 的 chunk 中只吐 usage，此时不应误解包出非预期的 thinking 内容。
