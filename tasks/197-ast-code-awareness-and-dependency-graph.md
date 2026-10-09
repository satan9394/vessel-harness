# 197 — 轻量 AST 符号索引与依赖图谱 (Lightweight AST Symbol Index & Dependency Graph)

- 编号：197
- 优先级：P1
- 关联模块：`packages/tools`, `packages/context`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：completed（用户批准完整语义指标 mean ≤15ms / peak ≤25ms；scoped16/16、12次真实更新及最终双Root门禁通过）
- 创建日期：2026-10-08

---

## 1. 目标与意图

当前 Agent 在浏览大型 Monorepo 代码库时，主要依赖低阶的文本检索（`grep_search` / `file_search`）：
1. **歧义与假阳性高**：同名方法（如 `execute`, `render`, `dispose`）产生数千行无关联结果，淹没关键调用栈；
2. **缺乏结构化依赖感知**：修改某个导出的接口或函数签名时，Agent 无法直观知道“有哪些模块间接依赖了它”，容易引发深层类型漂移；
3. **重型 LSP 难以常驻**：传统语言服务器（LSP）初始化内存高、启动慢、跨平台进程脆弱，不适合瞬态无状态的 CLI Agent 执行。

本任务旨在建立 **Vessel 原生轻量 AST 符号索引与依赖图谱（Lightweight AST Symbol Index & Graph）**：
- 利用轻量解析引擎（TypeScript AST Parser / SourceFile 遍历）建立工作区关键符号索引；
- 维护内存与增量缓存的符号依赖有向图（Directed Dependency Graph）：
  - 节点：`Module` (文件), `Function`, `Class`, `Interface`, `TypeAlias`；
  - 边：`imports`, `exports`, `references`, `implements`；
- 向 Agent 提供低延迟只读探索工具 `code_symbol_graph`。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 符号与依赖图谱契约 (`packages/context/src/ast/types.ts`)

```typescript
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'variable' | 'module';

export interface SymbolNode {
  id: string;              // 唯一 ID: `${filePath}#${symbolName}`
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  character: number;
  exported: boolean;
}

export type DependencyRelation = 'imports' | 'exports' | 'references' | 'implements';

export interface SymbolEdge {
  fromId: string;
  toId: string;
  relation: DependencyRelation;
}

export interface SymbolGraphQuery {
  filePath?: string;
  symbolName?: string;
  kind?: SymbolKind;
  relation?: DependencyRelation;
  direction?: 'incoming' | 'outgoing' | 'both';
  maxDepth?: number; // 默认 1
}

export interface ISymbolGraphService {
  /** 初始化或增量刷新指定文件的 AST 符号索引 */
  indexFiles(filePaths: string[]): Promise<void>;

  /** 查询匹配的符号节点 */
  findSymbols(query: Pick<SymbolGraphQuery, 'symbolName' | 'kind' | 'filePath'>): Promise<SymbolNode[]>;

  /** 获取符号或文件的直接与间接依赖图谱 */
  getDependencySubtree(symbolId: string, depth?: number): Promise<{ nodes: SymbolNode[]; edges: SymbolEdge[] }>;

  /** 获取反向依赖（谁依赖/引用了我） */
  getIncomingReferences(symbolId: string): Promise<SymbolNode[]>;
}
```

### 2.2 暴露给 Agent 的工具契约 (`packages/tools/src/ast/symbolGraphTool.ts`)

```typescript
export const SymbolGraphToolDefinition = {
  name: 'code_symbol_graph',
  description: '查询工作区内 TypeScript/JavaScript 文件的结构化 AST 符号与跨文件依赖拓扑',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['find_symbol', 'get_references', 'get_dependents', 'get_module_graph'],
        description: '查询操作类型',
      },
      filePath: { type: 'string', description: '文件相对路径' },
      symbolName: { type: 'string', description: '待查找的符号名称' },
      maxDepth: { type: 'number', description: '依赖探索深度 (默认 1，最大 3)' },
    },
    required: ['action'],
  },
};
```

---

## 3. 验收标准与测试用例 (DoD)

1. **单元测试 (`packages/context/tests/ast/symbolGraph.test.ts`)**：
   - 用例 1：解析包含多文件 import/export 的 fixture 工作区，验证所有导出函数与接口均被正确建立节点与边；
   - 用例 2：测试重构签名场景，调用 `getIncomingReferences`，能够 100% 准确列出调用方，无文本泛匹配噪音；
   - 用例 3：增量索引更新性能测试：含完整递归引用与类型驱动刷新的单文件真实增量修改（含 UTF-8 读取、解析与依赖更新），meanMs ≤15ms、峰值 ≤25ms；所有样本保留，不强制 GC、不丢弃峰值（2026-10-08 用户再次明确批准，替代 mean ≤10ms / peak ≤25ms）。
2. **工具集成测试 (`packages/tools/tests/symbolGraphTool.test.ts`)**：
   - 验证 `code_symbol_graph` 工具调用返回结构化 Markdown/JSON，支持对不存在符号的友好提示。
3. **机械门禁**：
   - `npm run test:all` 与 `npm run typecheck:tests` 全部通过。

## 4. 恢复指针（2026-10-08）

`evidence/sessions/2026-10-08-v2.3/card197-proof.md` 记录实现、精确率及边界。
授权专项修复曾通过 16/16 scoped 测试和 12 次真实更新（max 6.404ms），见 `authorized197-isolated-*.log`。独立评审发现递归引用遗漏及工具实现关系不一致，修复后语义断言通过；最新 scoped suite 为 14 passed / 1 latency failed，max 21.365ms，见 `card197-review-repair-tests.log`。当前不能宣称满足 ≤15ms 或 max <10ms，禁止用早期通过样本覆盖最新失败。198 已开展独立实现与验收；199 依赖性能门禁恢复。独立评审及恢复记录保留于该证据目录。

## 5. 人类批准的性能 DoD 变更（2026-10-08）

首次批准标准为 meanMs ≤10ms 且 maximumMs ≤25ms（历史）。原始 12 次更新重新计算 mean 7.137ms、max 21.365ms，见 `approved-dod-evaluation.json`；历史失败与 blocked 记录不删改。

再次批准标准为 **meanMs ≤15ms 且 maximumMs ≤25ms**，保留完整递归引用与类型驱动刷新。用户提供实测 mean14.24ms/peak19.39ms作为批准依据；本轮仍独立运行可执行检查和最终全量门禁，不以用户提供数字替代当前测试证据。

## 6. 最终集成恢复点（2026-10-08）

最终已验收：12项图测试及4项工具测试全绿；独立12次真实修改 mean10.767ms、peak21.405ms、精确率100%。全量root2780passed/6skipped、Web177passed，构建、测试类型、Web测试与带emptyOutDir=false的生产构建均exit0。blocked已解除。当前源码和历史失败分别见 `PROOF.md` 与 `PROOF-before15.md`；原始日志不删改。

首次指标的初始 scoped18/18 和孤立 mean2.554/peak4.675 曾通过；全仓 root 后续 mean11.543/peak21.083，旧均值门禁失败。一次编译器 host/cache 候选修复语义18项通过，但 mean59.570/peak106.043 失败，已仅撤回候选实现；新增文件集语义回归保留。再次用户批准15/25后重新运行门禁；完整证据见 `evidence/sessions/2026-10-08-v2.3/PROOF.md`。
