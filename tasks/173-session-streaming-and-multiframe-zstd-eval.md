# 173 — 多帧增量会话持久化与极限长会话韧性评测套件 (Streaming Session Persistence & Soak Conformance)

- 编号：173
- 优先级：P1
- 关联模块：`packages/core`, `packages/application`, `benchmarks/runners`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地交付与全部门禁完成；待用户验收，Git 未提交
- 创建日期：2026-10-01

---

## 1. 目标与意图

在长达数小时的大型协作会话中，Session 事件日志（`session.jsonl`）往往膨胀至数万行、数百兆甚至上千兆：
1. **全量重放与内存压力**：既有会话在启动与恢复时，直接通过单文件流进行全量扫描与反序列化，面对超长会话时极易引发 Node.js V8 堆内存溢出（OOM）；
2. **缺乏多帧分片增量流式存储（Multi-frame Persistence）**：DSH 引入了多帧追加压缩机制（多帧 Zstd / 分块流式），支持按 Frame 快速追加与跳跃式按需解压，在海量事件下保障零碎持久化与极速断点续跑；
3. **缺乏极限长会话韧性度量（Soak & Chaos Conformance）**：系统在遭遇并发工具异常、强制断电（Process Kill）、上下文多次压实与重试交替发生时，缺少确定性的离线回归评测。

本任务旨在为 Vessel 构建流式高密持久化层，并建立跨 100 轮超长场景的离线双盲防抖评测套件：
- **分块流式持久化层（Chunked Streaming Persistence）**：在保持 `packages/core/src/session/Session.ts` 既有薄核契约不变的前提下，引入可插拔的流式分片存储，支持超大事件日志分块封存与快速索引；
- **极限长会话防抖与保全度评测套件**：离线模拟并发多 Agent 在面临 100 轮工具输出冲击、主动压缩触发、400 溢出拦截自愈及随机崩溃恢复时，验证整体能力保全度 $\ge 90\%$，工作区残留 `residueCount === 0`。

---

## 2. 接口与契约规范

### 2.1 分片流式会话存储契约 (`packages/core/src/session/streaming/types.ts`)

```typescript
export interface SessionChunkMeta {
  chunkIndex: number;
  startSeq: number;
  endSeq: number;
  recordCount: number;
  byteSize: number;
  compressed: boolean;
}

export interface StreamingSessionReader {
  /** 获取当前会话的分片元数据目录 */
  listChunks(): Promise<SessionChunkMeta[]>;
  /** 流式读取指定序列号范围的记录，无需全量加载进内存 */
  streamRecords(fromSeq?: number, toSeq?: number): AsyncIterable<SessionRecord>;
}
```

### 2.2 长会话离线评测套件 (`benchmarks/runners/src/conformance/resilience/`)

建立 `LongSessionResilienceScenario`：
- **压测参数**：连续模拟 100 轮深度工具调用与大文本注入（模拟 500,000+ Tokens）；
- **故障注入点**：
  1. 在第 30 轮注入 400 Context Overflow 报错，断言自愈拦截器自动触发压缩并恢复；
  2. 在第 60 轮模拟未响应 MCP 进程，断言 Windows Job Object 2000ms 强制回收且无悬挂；
  3. 在第 90 轮突发中断主进程并重新 `open()` 会话，断言分片日志能够 100% 完整 Replay 并保持事件单调递增；
- **机械度量指标**：
  - `dataIntegrityRate === 100%`（事件无丢失无错序）；
  - `overallPreservationScore >= 90%`；
  - `orphanProcessCount === 0`；
  - `workspaceResidueCount === 0`。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：`packages/core/src/session/Session.ts` 既有构造与对外契约严禁破坏性变更，分块流式持久化作为非侵入式的可选后端挂载。
2. **严禁引入强制编译的原生 C++ 依赖**：压缩与分片操作优先使用 Node.js 内置 `zlib` 或纯 TypeScript/WebAssembly 高性能实现，保证跨平台 `npm ci` 与 GitHub Actions 恒绿。
3. **严禁调用真机 Agent**：测试中所有长会话回合必须完全由确定性 Mock 驱动，杜绝产生网络配额开销。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/core/src/session/streaming/chunkedSession.test.ts`；
   - 编写并通过 `benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`：
     - 100 轮模拟场景离线秒级/十秒级全绿通过；
     - 机械指标输出且达到合格线（保全度 $\ge 90\%$，残留为 0）。
2. **回归门禁**：
   - `npm run test:all` 根与 web 保持全绿；
   - `npx tsc -b tsconfig.json` exit 0。

## 5. 交付证据（2026-10-01）

- 可选 ChunkedSession 使用 Node 内置 gzip/raw 分帧、校验和、序号索引与流式范围读取，既有 Session 契约不变。
- flush/close 是持久化屏障；interrupt 丢弃未 flush 尾部；恢复覆盖旧索引、损坏尾帧、writer 争用与失效持有者。 acquisition 崩溃保持 fail-closed，不宣称默认 JSONL 恢复已解决 OOM。
- 100 轮真实 AgentLoop 的离线 Mock 场景：保全度与数据完整度 100%，孤儿进程及工作区残留均 0；定向测试 5 passed。无真实 Agent/网络调用。
- 细节与限制见 docs/V1.5-IMPLEMENTATION-NOTES.md；最终回归见任务 174。

无法确认（2026-10-27 对账：`packages/core/src/session/streaming/ChunkedSession.ts:24` 与分帧测试仍在，chunkedSession 本次通过；但原始定向命令中 `longSessionResilience.test.ts:51` beforeAll 超过 30000ms，后续清理报 ENOTEMPTY，整批 exit 1 / 24 passed + 5 skipped，详见卡 354 Result / `t8-v15-b.log`。额外 `--hookTimeout 120000` 单文件探针 exit 0 / 5 passed 仅作诊断，不替代原失败、不据此验收；默认 JSONL OOM 保证与原生 MCP 时延仍无此证据。）
