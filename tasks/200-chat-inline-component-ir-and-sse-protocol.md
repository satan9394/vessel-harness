# 200 — Chat 流内嵌富交互组件 IR 与双向 SSE 协议 (Chat Inline Component IR & SSE Protocol)

- 编号：200
- 优先级：P1
- 关联模块：`packages/shared`, `apps/local-server`, `packages/runtime`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已完成（本地验证）
- 创建日期：2026-10-09

---

## 1. 目标与意图

当前大部分 Agent 对话系统仅输出纯文本或 Markdown 流，当遇到代码 Diff、门禁状态、审批确认与多维图谱时，信息只能混杂在字符滚屏中，体验极度碎片化。

本任务旨在建立 **Vessel 原生内嵌交互组件中间表示（Inline Component IR）与双向 SSE 事件协议**：
1. **定义结构化组件 Block 契约**：使 Agent 输出不仅包含 `text`，还能在流式交互中就地发射强类型的富交互微资产（Diff、Gate 状态卡、AST 影响面、人类审批控件）；
2. **双向交互 RPC 与 SSE 事件扩展**：
   - 扩展 `apps/local-server` 的流式通道，支持 `event: widget_block`、`event: action_request`、`event: action_response`；
   - 支持前端直接对组件执行点击交互（如“批准权限”、“回退补丁”、“展开调用堆栈”），并通过轻量 HTTP 端点回传给正在等待的 Agent 运行时；
3. **薄核（Thin Core）零侵入**：组件 IR 属于 `packages/shared` 与 `apps/local-server` 的表现层协议，`packages/core` 保持 0 修改。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 交互组件 IR 类型定义 (`packages/shared/src/widgets.ts`)

```typescript
export type WidgetKind = 'diff_inspector' | 'red_green_gate' | 'impact_radar' | 'permission_action';

export interface BaseWidgetBlock {
  id: string;                      // 唯一块 ID
  kind: WidgetKind;
  turnIndex: number;
  timestamp: string;
  status: 'pending' | 'resolved' | 'expired';
}

export interface DiffInspectorWidget extends BaseWidgetBlock {
  kind: 'diff_inspector';
  payload: {
    filePath: string;
    additions: number;
    deletions: number;
    patch: string;                 // Unified Diff 格式
    collapsedByDefault?: boolean;
  };
}

export interface RedGreenGateWidget extends BaseWidgetBlock {
  kind: 'red_green_gate';
  payload: {
    phase: 'red_verified' | 'green_verified' | 'rejected';
    command: string;
    exitCode: number;
    failureSummary?: string;
    proofSha256: string;
  };
}

export interface ImpactRadarWidget extends BaseWidgetBlock {
  kind: 'impact_radar';
  payload: {
    targetSymbol: string;
    blastRadius: {
      modifiedFiles: string[];
      affectedCallers: Array<{ filePath: string; symbolName: string }>;
    };
  };
}

export interface PermissionActionWidget extends BaseWidgetBlock {
  kind: 'permission_action';
  payload: {
    actionType: 'mod_execution' | 'policy_override' | 'filesystem_write';
    description: string;
    options: Array<{ id: string; label: string; tone: 'primary' | 'danger' | 'neutral' }>;
  };
  resolution?: {
    selectedOptionId: string;
    resolvedAt: string;
  };
}

export type WidgetBlock =
  | DiffInspectorWidget
  | RedGreenGateWidget
  | ImpactRadarWidget
  | PermissionActionWidget;
```

### 2.2 服务端双向协议 (`apps/local-server/src/routes/widgetRoutes.ts`)

- `GET /api/session/:id/events`：SSE 流中支持下发 `event: widget`，载荷为 `WidgetBlock`；
- `POST /api/session/:id/widget/:widgetId/respond`：客户端提交用户选择或交互行为，返回 `{ success: boolean }`，并通过 EventEmitter 唤醒正在等待决策的 Agent Loop。

---

## 3. 验收标准与测试用例 (DoD)

1. **类型与序列化测试 (`packages/shared/tests/widgets.test.ts`)**：
   - 验证所有 4 类 `WidgetBlock` 的结构化序列化与反序列化，防篡改校验正常；
2. **服务端端到端冒烟测试 (`apps/local-server/tests/widgetRoutes.test.ts`)**：
   - 验证通过 SSE 流订阅接收 `widget` 事件；
   - 验证向 `/respond` 发起响应后，挂起的 Promise 能正确收到交互结果；超时或无效 widgetId 能优雅返回 404/400；
3. **构建与类型门禁**：
   - `npm run test:all` 与 `npm run typecheck:tests` exit 0。


## 4. Delivery evidence
2026-10-09: shared/local-server 19 files / 183 tests passed; scoped composite build and full test typecheck exit 0. Independent review lifecycle findings repaired with mutation, observer failure and stale unsubscribe regressions. Evidence: evidence/sessions/2026-10-09-v2.4/card200-*-repair2.log. Core unchanged.

