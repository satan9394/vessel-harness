# DeepSeek Harness (DSH) 官方发布版、桌面双端与 Agent-Teams 协同体系深度调研与技术备份

> 编制日期：2026-10-01  
> 状态：规范归档 / 参考备份（docs/research 权威技术资产）  
> 关联：`Notes/2026/09/NOTES_20260930.md`、`E:\DeepSeek_Harness\`、`packages/context/`、`packages/agents/src/team/`

---

## 1. 调研背景与官方发布概览

2026 年 9 月下旬，DeepSeek 官方正式发布了 DeepSeek Harness (DSH) `0.2.0-rc.2` 生产版本，并同步推出了面向 Windows（EV 签名独立安装包 `DeepSeek Harness.exe`）与 macOS（原生 `.dmg`）的官方桌面应用。

通过对本地运行时配置（`~/.dsh`）、官方应用解包代码、`dsh-agent-teams` 插件源码、`dsh-context-guard` 诊断脚本以及 `NOTES_20260930.md` 的一手线上事故回溯，本报告对 DSH 的桌面架构、多 Agent 团队编排、高密流式存储及上下文溢出防线进行技术解构并形成完整代码备份。

---

## 2. DSH 桌面双端架构与守护进程解耦体系

### 2.1 物理隔离的双层拓扑（Electron 壳 vs 常驻 Daemon）
官方桌面端彻底摒弃了将 Agent 执行与大吞吐上下文混跑在 Electron 界面进程内的做法，采用前后端彻底解耦的常驻 Daemon 架构：
- **UI 外壳（Renderer & Tray）**：Electron 44.0.0 仅负责渲染轻量 Web UI 与托盘图标（`resources/tray.ico`）。点击关闭按钮时，默认最小化至系统托盘，后台执行丝毫不中断；
- **执行守护进程（Headless Daemon）**：主进程通过 `ELECTRON_RUN_AS_NODE=1` 派生独立 Node 守护进程：
  ```bash
  DeepSeek Harness.exe --expose-internals .../dsh-desktop-host/lib/index.js .../app.asar/dsh C:\Users\<user>\.dsh\profiles\desktop ...
  ```
  该守护进程独立加载微内核总线（Cordis / EventBus）与所有 Agent 执行循环。
- **高熵令牌与环回通信**：Daemon 监听随机本地环回端口（桌面端 `19387`，CLI Web `3080`），每次启动由主进程生成 `randomBytes(24)` 高熵 Launch Token。UI 渲染进程必须携带该 Token 方可通过 WebSocket RPC 与 HTTP API 通信，杜绝本地跨站点恶意劫持。

---

## 3. Agent-Teams 多 Agent 协同编排体系

DSH 在团队协同上引入了现代分布式工作流引擎的 DAG 状态机与严格的模型快照隔离机制。

### 3.1 任务拓扑与 DAG 状态机
团队不再局限于简单的串行线形调用，而是定义了有向无环图（DAG）：
- **状态流转**：`pending`（等待前置依赖） $\to$ `ready`（依赖全满足） $\to$ `claimed`（成员认领） $\to$ `running` $\to$ `completed` / `failed`；
- **事件驱动调度（Reactive Event-Driven）**：任务完成时触发 `task:settled` 事件，调度器仅需响应式唤醒下游节点，完全规避 CPU 轮询空转。

### 3.2 方案预审门禁（Approve & Run）
用户下达团队协作目标后：
1. 队长先生成候选队员名册（Roster）与依赖 DAG 拓扑图，此时全队处于 **Staged（准备就绪）** 状态，并不消耗 Token 发起异步执行；
2. Web/桌面面板呈现交互式拓扑与成员路线，用户点击 **Approve & Run**（或在审查面板调整各节点配置）后，团队才正式解冻开跑。

### 3.3 队员模型快照隔离机制（Route Snapshotting）
**事故回溯（2026-09-30 实证）**：用户反馈「明明将全局订阅切到了第三方 Command，但 Agent-Teams 队员仍默认走 DeepSeek 官方通道」。
**根因剖析**：DSH 拥有三层模型生效逻辑：
1. **全局默认**：`profile` 中的 `agent-default-model`（仅决定全新空白会话）；
2. **会话级**：`requestHeader` 记录（现有会话沿用自己历史模型）；
3. **队员级（快照）**：在团队建队瞬间，系统通过 `resolveMemberLlmSelection()` 对队长当前生效的 Provider 与 Model 进行**深拷贝快照**并持久化至 `subagent/descriptor`。
- **架构收益**：一旦建队，即便外部全局模型发生切换，运行中的异步队员行为与 Prompt 适配风格绝不漂移；
- **关键设计**：`memberModel` 字段仅覆盖单项模型名称，跨供应商必须在建队声明时传递 `{ provider, model }` 二元组。

---

## 4. 上下文防爆自愈与动态压实公式

在长会话与大并发多 Agent 场景下，上下文溢出（HTTP 400 Context Overflow）是造成系统崩溃的首要隐患。

### 4.1 2026-09-30 上下文 100% 打爆事故复盘
在会话 `session-793ee4cf`（4.05MB / 3,414 事件 / 58 轮交互）中，模型连续遭遇 4 次 HTTP 400 崩溃：
```
turn 51/12  提示 ≈ 723k tokens  正常返回
turn 52/4   提示 ≈ 729k tokens  正常返回
turn 53     HTTP 400: The input is longer than the model's context length (撞墙)
turn 57/1   提示 603k + cache 127k = 731k tokens  接受但 outputTokens=1, stopReason=length
```
**根因**：
- 静态配置声明模型上下文窗口 $W = 1,000,000$；
- 压缩触发线为 $\approx 800,000$ tokens；
- 然而上游供应商在经过中文 CJK 膨胀（~1.3x）与系统 Prompt 注入后，**真实物理墙在 $\approx 730,000$ tokens**；
- 触发线（80万）高于物理墙（73万），导致长达 4 小时内主动压缩**一次都未触发**，直至会话彻底被撑爆。

### 4.2 工业级主动压缩阈值公式
DSH 最终确立了基于输出空间与安全缓冲区的动态压实阈值计算准则：
$$\text{Threshold} = \left\lfloor \min\left(W \times 0.8,\, W - O - B\right) \right\rfloor$$
- $W$（Context Window）：模型宣称的上下文总窗口（若存在 CJK 高频场景，乘以 0.85 保守系数）；
- $O$（Max Output Tokens）：单次回合最大输出 Token 预留（如 65,536）；
- $B$（Safety Buffer）：安全垫缓冲区（默认 65,536，用于吸收工具输出与思维链突增）。

### 4.3 多厂商 HTTP 400 模式识别与自动自愈拦截器
当且仅当发生未被主动压缩拦截的意外溢出时，触发第二道防线：
- **模式匹配白名单**：
  ```regex
  /(longer than the model's context length|maximum context length|context window exceeded|prompt is too long|token limit exceeded)/i
  ```
- **自动自愈（maxOverflowRetries: 1）**：拦截器在捕获上述 400 错误后，将其重分类为 `CONTEXT_OVERFLOW` 异常，自动提取关键会话事实，以激进保留比（如 `retainRatio: 0.3`）执行紧凑压实，并在当前回合无缝重试，对上层用户完全透明。

### 4.4 多帧 Zstandard（.jsonl.zstd）流式存储
DSH 针对海量 JSONL 存储采用了多帧 Zstd 流式压缩方案：
- 每次会话追加直接作为独立的 Zstandard Frame 追加写入，支持流式 Seek 与快速恢复，压缩比高达 8:1 至 12:1；
- 避免了普通 gzip 必须全文件解压才能读取末尾增量的性能短板。

---

## 5. 对 Vessel_Harness 的核心代码参考与落地方案

### 5.1 核心参考代码备份：动态压实计算与自适应自愈器
以下为移植至 Vessel `packages/context/src/compaction/` 的参考实现：

```typescript
export interface AdaptiveCompactionOptions {
  contextWindow: number;
  maxOutputTokens: number;
  safetyBufferTokens?: number;
  cjkSafetyRatio?: number; // 默认 0.85，抵御 CJK 膨胀
}

export function computeAdaptiveThreshold(opts: AdaptiveCompactionOptions): number {
  const safetyBuffer = opts.safetyBufferTokens ?? 65536;
  const calibratedWindow = Math.floor(opts.contextWindow * (opts.cjkSafetyRatio ?? 0.85));
  
  // 核心公式：min(CalibratedW * 0.8, CalibratedW - MaxOutput - Buffer)
  const ratioThreshold = calibratedWindow * 0.8;
  const headroomThreshold = calibratedWindow - opts.maxOutputTokens - safetyBuffer;

  const finalThreshold = Math.max(1000, Math.floor(Math.min(ratioThreshold, headroomThreshold)));
  return finalThreshold;
}

export const OVERFLOW_PATTERNS = [
  /longer than the model's context length/i,
  /maximum context length/i,
  /context window exceeded/i,
  /prompt is too long/i,
  /token limit exceeded/i,
  /max_tokens.*exceeded/i,
];

export function isContextOverflowError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return OVERFLOW_PATTERNS.some((pat) => pat.test(msg));
}
```

### 5.2 核心参考代码备份：队员模型快照结构契约
以下为适用于 Vessel `packages/agents/src/team/` 的快照声明：

```typescript
export interface MemberModelRouteSnapshot {
  providerId: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  temperature?: number;
  snapshottedAt: number; // 建队时间戳
}

export interface TeamMemberDescriptor {
  memberId: string;
  role: 'orchestrator' | 'generator' | 'evaluator';
  presetId: string;
  routeSnapshot: MemberModelRouteSnapshot; // 不随全局或队长后续切换漂移
}
```
