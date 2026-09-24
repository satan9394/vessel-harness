# 160 — Session 架构升级 Topic 实体支持与持久化索引 (Topic Entities & Registry)

- 编号：160
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/engine`, `apps/cli`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

升级 Vessel 的会话存储模型，从单一的基于“UUID + 时间戳”的冷冰冰扁平列表，升级为面向用户任务的 **Topic（会话主题）一等公民实体**。
支持按 Topic 组织对话快照、提供首轮输入自动提炼简短主题名（Topic Auto-naming）的启发式算法，
并在本地 `~/.vessel/sessions/` 元数据中保证向前兼容性，为后续 Web UI 与 CLI 提供主题分组检索能力。

## 2. 权威开源参考基准与读取指引 (GitHub & Local Assets)

### 重点参考开源项目：
1. **Dify (开源核心版)**：`https://github.com/langgenius/dify`
   - 对标要点：Conversation Topic 的数据模型设计、自动生成简短主题的提炼规则。
   - 读取方式：使用 `gh api repos/langgenius/dify/contents/...` 或在线查阅其会话元数据设计。
2. **OpenHands (原 OpenDevin)**：`https://github.com/All-Hands-AI/OpenHands`
   - 对标要点：工作区项目维度的会话树、会话重命名与归档生命周期。
   - 读取方式：在线检索其 session 存储接口定义。

### 读取纪律：
- 严禁全量克隆大仓库至本工作区。
- 纯净实现：自主实现基于纯函数与原子写入文件的 Topic 索引层，杜绝引入外部重量级数据库依赖。

## 3. 接口与数据契约

在 `packages/engine/src/session/` 中扩展 Session 元数据定义：

```typescript
export interface SessionTopic {
  topicId: string;
  title: string;           // 6-20 字精炼标题
  summary?: string;         // 一句话摘要
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  isArchived?: boolean;
}

export interface SessionHeaderWithTopic {
  sessionId: string;
  topic?: SessionTopic;
  createdAt: number;
  updatedAt: number;
  // 其余既有字段完全兼容
}

/** 启发式简短主题生成器（纯本地/规则优先，免调模型零消耗；或接收简短摘要） */
export function deriveTopicTitle(firstPrompt: string): string;

/** SessionRegistry 增加按 Topic 检索与更新标题接口 */
```

## 4. 确定性完成门禁 (DoD)

- [x] **单元测试**：新建/修改测试覆盖 Topic 元数据：
  - 测试 `deriveTopicTitle` 针对长文本、代码块、问候语等不同场景，均能提取出干净精炼的标题，无换行和特殊字符。
  - 测试 Session 保存与读取时，Topic 字段完整双向序列化且向前兼容旧版 Session 文件。
  - 测试按 Topic 列表检索与重命名（Rename）接口。
- [x] **构建检查**：
  - `npx tsc -b tsconfig.json` 退出码必须为 0。
  - `npm run typecheck:tests` 退出码必须为 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **向前兼容是死命令**：没有 Topic 字段的历史 Session 文件在读取时必须优雅回退，绝不得抛出 undefined 属性错误。
- **本地文件唯一真源**：严禁引入 SQLite、LevelDB 等复杂原生依赖，坚持纯 JSON + 原子写（atomicWrite）。
- **薄核红线**：Topic 仅属于管理面元数据，`packages/core` 执行循环无需感知 Topic 概念。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 当用户首轮输入是一段长代码或包含多行换行时，`deriveTopicTitle` 必须在第一个标点或换行处截断，并去除 markdown 符号（如 `#`, ```），防止标题破坏单行展示排版。
