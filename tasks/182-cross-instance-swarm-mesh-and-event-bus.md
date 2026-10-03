# 182 — 跨实例异构 Swarm 网格与分布式事件总线 (Cross-Instance Swarm Mesh & Event Bus)

- 编号：182
- 优先级：P2
- 关联模块：`apps/local-server`, `packages/agents`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已合入（2026-10-03 本地验收）
- 创建日期：2026-10-02

---

## 1. 目标与意图

在任务 176 中，Vessel 落地了常驻 Daemon 与基于 24 字节高熵 Launch Token 的 Bearer 鉴权体系；在任务 172 与 175 中落地了 DAG 编排与团队工作台。然而，目前所有的子 Agent 与 DAG 节点依然运行在单一物理机的一个工作区中。

随着任务规模扩大与异构算力需求提升，单机模式面临两项局限：
1. **多机分布式协作缺失**：无法将部分长耗时、高算力子任务安全派发至局域网或远程另一台机器运行的 Vessel 实例；
2. **事件总线局限于单实例内存**：跨节点间无法同步任务生命周期状态与产物增量 Diff。

本任务旨在基于 Daemon 体系扩展分布式 Mesh 网关：
- **节点对等发现与双向鉴权（Peer Handshake & Mutual Auth）**：基于 Launch Token 与实例指纹（Node UUID）建立跨机 WebSocket / SSE 信任通信链路；
- **分布式 DAG 子图委托（Remote Sub-DAG Delegation）**：主控节点将 DAG 的独立分支作为子图打包，派发给远端 Vessel Daemon 异步执行，远端流式回传进度事件与结果包；
- **离线断网自愈与状态对账（Event Reconciliation）**：网络瞬断重连后，双方通过事件序列号（Seq）快速对账，自动补齐丢弃的事件，保证 DAG 全局一致性。

---

## 2. 接口与契约规范

### 2.1 分布式网格接口 (`packages/agents/src/team/mesh/types.ts`)

```typescript
export interface MeshNodeDescriptor {
  nodeId: string;
  endpoint: string;
  token: string;
  roleCapabilities: string[];
  status: 'online' | 'busy' | 'offline';
  latencyMs: number;
}

export interface RemoteSubDagTask {
  dagId: string;
  subGraphNodes: string[];
  contextSnapshotRef: string;
}

export interface MeshEventBus {
  registerPeer(node: MeshNodeDescriptor): Promise<void>;
  dispatchSubDag(targetNodeId: string, task: RemoteSubDagTask): Promise<void>;
  subscribePeerEvents(targetNodeId: string, onEvent: (event: any) => void): () => void;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：核心 Loop 仍只负责单个 Agent 的本地步进，分布式分发完全位于 `packages/agents/src/team/mesh` 与 `apps/local-server`，Core 零感知网络拓扑。
2. **离线与本地仿真**：单元测试严禁依赖真实公网环境或外部服务，所有测试一律通过虚拟本地网络端口与内存 EventEmitter 仿真。
3. **包管理器铁律**：严禁引入需编译或与现有依赖树冲突的重型 RPC 库，仅采用 Node.js 原生标准 HTTP/SSE/WebSocket 规范。

---

## 4. 确定性完成门禁 (DoD)

1. **定向单测覆盖与全绿**：
   - 编写并通过 `packages/agents/src/team/mesh/peerHandshake.test.ts`：验证节点双向 Token 校验、假冒节点拒绝与心跳探测；
   - 编写并通过 `packages/agents/src/team/mesh/subDagDispatch.test.ts`：验证子图切分、远端派发、流式聚合与断网重连对账；
2. **全量构建与回归**：
   - `npx tsc -b tsconfig.json` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run test:all` 双 Root 保持全绿。

## 5. 本轮执行与验证计划（2026-10-03）

1. 本地预配置信任节点，UUID + 24 字节 Launch Token 双向握手，心跳与连接生命周期；验证错误凭据、冒充、离线恢复。
2. 序列化独立子图和上下文，通过 Daemon 内部 HTTP/SSE 端点执行并回传状态与产物 Diff；验证真实本地 TeamRuntime 接线及失败传播。
3. Seq 增量重放、重连、重复派发与全局状态聚合；验证缺失事件补齐且不重复执行。
4. 独立审查后依次执行定向测试、类型双门禁、双 Root 全量回归；保存完整日志，更新待验收状态，交回维护者。

## 6. 交付工作证明（2026-10-03）

- 已实现：本地预配置信任与双向握手、心跳、原生 HTTP/SSE 子图派发、接收端 TeamRuntime 执行与产物 Diff、Seq 重连及分页对账、跨 Peer 所有权与全局任务聚合、显式父 DAG 结算、活动回合取消。
- 独立审查：修复权威结果被 UI 预览截断及明确拒绝后的所有权锁定；复审无剩余已证实阻塞项。
- 定向测试：2 文件 / **10 passed**；生产 HTTP 接线测试亦随全量通过。
- `npx tsc -b tsconfig.json` / `npm run typecheck:tests`：**exit 0 / exit 0**。
- `npm run test:all`：根 **221 文件 / 2535 passed + 6 skipped**；Web **16 文件 / 154 passed**；**exit 0**。门禁均在最终实现/测试编辑后执行。
- 变更清单、接口接线及完整日志：[DELIVERY.md](../evidence/sessions/2026-10-03-task182/DELIVERY.md)。
- 明确边界：对账日志为进程生命周期内存；不提供重启持久化。控制器显式订阅/对账，并在父任务已 claim/start 后调用 `settleParent`；不宣称自动父调度接线。
- 无 Core 改动、无新增依赖、无真实外部 Agent/公网测试；未 commit、未 push。
