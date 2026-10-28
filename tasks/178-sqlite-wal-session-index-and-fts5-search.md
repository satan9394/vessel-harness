# 178 — SQLite WAL 模式高性能会话元数据与全文检索 (SQLite WAL Session Index & FTS5 Search)

- 编号：178
- 优先级：P1
- 关联模块：`packages/memory`, `packages/application`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；待用户验收（2026-10-02）
- 创建日期：2026-10-01

---

## 1. 目标与意图

在经历了 V1.0 至 V1.5 的多轮演进后，Vessel 的会话数据积累了大量历史 JSONL 日志与分块归档文件。然而，现有会话列表、Topic 查询与历史代码定位存在显著性能瓶颈：
1. **全盘遍历延迟高**：获取会话列表需要对磁盘目录进行 `fs.readdir` 与逐个读取第一行元数据，当会话累积至成百上千时，列表加载延迟显著拉长；
2. **缺乏全文倒排索引**：用户若想搜寻数周前某次讨论中使用的特定 Prompt、架构设计或工具调用产物，只能通过命令行 grep 机械检索，不支持多维关键词加权搜索；
3. **不能破坏 JSONL 单一事实源原则**：依据决策点 10，`session.jsonl` 是绝对的单源事实。引入数据库绝不得取代文本日志，只能作为只读加速投影视图。

本任务旨在借鉴 OpenCode V2 的 SQLite 治理实践，在 `packages/memory` 构建高性能本地索引视图：
- **SQLite WAL 加速中枢**：引入本地 SQLite 数据库（位于 `~/.vessel/cache/session_index.db`，开启 `PRAGMA journal_mode = WAL` 与 `PRAGMA synchronous = NORMAL`），异步投影会话元数据、Topic 状态与四维 Token 统计；
- **FTS5 全文倒排索引**：对用户问题与模型最终结论建立全文本虚拟表（`messages_fts`），提供 sub-10ms 的跨会话毫秒级关键词模糊定位；
- **异步投影与自愈重建**：若 SQLite 数据库文件丢失或损坏，系统自动从磁盘上的 JSONL 事实源平滑重建，核心会话读写零感知。

---

## 2. 接口与契约规范

### 2.1 会话索引器契约 (`packages/memory/src/sqlite/SessionIndexStore.ts`)

```typescript
export interface IndexedSessionSummary {
  sessionId: string;
  topicId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  recordCount: number;
  totalTokens: number;
}

export interface SessionSearchParams {
  query: string;
  limit?: number;
  offset?: number;
}

export interface SessionSearchResult {
  sessionId: string;
  matchedContent: string;
  snippet: string;
  createdAt: number;
}

export class SessionIndexStore {
  constructor(dbPath: string);

  /** 增量投影单条记录或整批记录 */
  indexRecords(sessionId: string, records: SessionRecord[]): Promise<void>;

  /** 分页获取最新会话列表（微秒级） */
  listSessions(limit?: number, offset?: number): Promise<IndexedSessionSummary[]>;

  /** 基于 FTS5 引擎的高性能全文检索 */
  search(params: SessionSearchParams): Promise<SessionSearchResult[]>;

  /** 关闭数据库连接并释放 WAL 文件 */
  close(): Promise<void>;
}
```

### 2.2 数据库表结构规范

- `sessions_meta`：`session_id PRIMARY KEY, topic_id, title, created_at, updated_at, record_count, total_tokens`；
- `messages_fts`（FTS5 Virtual Table）：`session_id UNINDEXED, seq UNINDEXED, role, content`。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：`packages/core` 保持零侵入，SQLite 索引层完全位于 `packages/memory` 中，作为可插拔的 Projection 消费 EventBus 事件。
2. **清洁安装与零 C++ 编译失败风险**：SQLite 采用 Node.js 22+ 原生内置的 `node:sqlite`（或轻量 pure-JS/WASM 方案），严禁引入需要本地 Visual Studio C++ 工具链编译的重型原生包，确保跨平台与 GitHub Actions 恒绿。
3. **单源一致性保证**：JSONL 是系统最终持久化的唯一事实；当发生索引分歧时，恒以 JSONL 为准。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/memory/src/sqlite/sessionIndex.test.ts`：
     - 验证会话元数据增量投影与快速分页列表（1,000 条数据读取 < 5ms）；
     - 验证索引文件删除后的平滑离线全量重建。
   - 编写并通过 `packages/memory/src/sqlite/ftsSearch.test.ts`：
     - 验证 FTS5 关键词命中、高亮片段提取与多词模糊匹配。
2. **回归门禁**：
   - `npx vitest run packages/memory` 全部通过；
   - `npx tsc -b tsconfig.json` exit 0。

已验收（2026-10-27 对账，仅本地 SQLite/FTS 投影契约与原有 warm 延迟断言；本次 `sessionIndex.test.ts`、`ftsSearch.test.ts` 与工具三套共 5 文件 44 passed / exit 0，完整命令见卡 354 Result / `t8-v16-storage-tools.log`；源码 `packages/memory/src/sqlite/SessionIndexStore.ts:77`、`:90`；WAL/NORMAL、增量分页、JSONL 重建、FTS 前缀/高亮和本机延迟断言可复验，不扩展为任意硬件 SLA。）
