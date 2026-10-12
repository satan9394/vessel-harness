# 205 — 画布区代码块交互式审阅与单 Hunk 采纳/回退 (Canvas Patch Picker & Cherry-pick)

- 编号：205
- 优先级：P1
- 关联模块：`apps/web`, `apps/local-server`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验证（2026-10-10）
- 创建日期：2026-10-10

---

## 1. 目标与意图

当前大部分 Agent 在生成多文件修改时，用户往往只能面对“全盘接受”或“全盘放弃”的极端选项，缺乏对局部修改的细粒度掌控。

本任务旨在建立 **Vessel 画布级代码块交互式审阅与 Cherry-pick 体系**：
1. **多 Hunk 细粒度拆解**：解析 Unified Diff 为独立的变更块（Hunks），在画布中以卡片列表清晰呈现；
2. **就地逐块决策（Accept / Revert / Keep）**：
   - 用户可以针对特定改动块点击“✓ 采纳”或“✕ 丢弃”；
   - 客户端通过端点将丢弃指令发送至本地服务器，自动从暂存工作树中剔除对应 Hunk；
3. **视觉对齐与代码着色**：优雅展示变动前后上下文，支持并排（Side-by-side）与内联（Inline）自由切换。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 Hunk 数据模型与操作契约 (`packages/shared/src/patch.ts`)

```typescript
export interface DiffHunk {
  id: string;               // `${filePath}#hunk-${index}`
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];          // '+' | '-' | ' ' 前缀行
  status: 'pending' | 'accepted' | 'rejected';
}

export interface PatchCherryPickRequest {
  sessionId: string;
  filePath: string;
  hunkId: string;
  action: 'accept' | 'reject';
}
```

### 2.2 界面组件 (`apps/web/src/components/canvas/PatchPickerCanvas.tsx`)

```tsx
import type { DiffHunk } from '@vessel/shared';

export interface PatchPickerCanvasProps {
  hunks: DiffHunk[];
  onAction: (hunkId: string, action: 'accept' | 'reject') => Promise<void>;
}

export function PatchPickerCanvas({ hunks, onAction }: PatchPickerCanvasProps): React.JSX.Element;
```

---

## 3. 验收标准与测试用例 (DoD)

1. **Diff 解析器与状态测试 (`packages/shared/tests/patch.test.ts`)**：
   - 验证能够正确将多文件复杂 patch 拆分成独立的 `DiffHunk` 列表，行号计算精确；
2. **React 组件交互测试 (`apps/web/src/components/canvas/PatchPickerCanvas.test.tsx`)**：
   - 验证点击“拒绝”按钮后组件状态变为 rejected，并正确触发回调；
3. **构建与门禁**：
   - `npm run test:all` 与 `npx tsc -b` exit 0；
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0。

## 4. 交付证据（V2.5）

入口：evidence/sessions/2026-10-10-v2.5/。accepted focused root 25 / Web 69；tsc、测试类型、Web类型 exit 0。实际组件 InteractivePatchPicker.tsx；端点 POST /api/session/:id/patch/apply。支持未应用提案与已应用 Diff 的单 Hunk 采纳/丢弃/回退/重采纳；精确内容冲突时拒绝覆盖用户编辑。创建/删除/重命名、无法区分新旧侧的歧义补丁不支持。证明 card205-PROOF.md / card205-results.json。最终全量与浏览器门禁由 Epic 209 交证。




Epic 最终补充：双视图 SSE 决策同步回归与 UTF-8/换行字节保护已复验；混合换行/非法 UTF-8 fail closed。证据 `card205-sync-PROOF.md` 与 `independent-review.md` 位于 V2.5 evidence 目录。

