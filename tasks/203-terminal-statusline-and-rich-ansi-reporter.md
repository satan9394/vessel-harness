# 203 — CLI 终端 StatusLine 与富 ANSI 组件同步适配 (Terminal StatusLine & Rich ANSI Adapter)

- 编号：203
- 优先级：P2
- 关联模块：`apps/cli`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已完成（本地验证）
- 创建日期：2026-10-09

---

## 1. 目标与意图

虽然 Web 界面能够提供丰富的图形化体验，但终端键盘流开发者同样需要结构化的高信噪比反馈。传统纯控制台打印容易在大量长输出下冲垮可读性。

本任务旨在建立 **Vessel CLI 终端富交互适配体系（Terminal StatusLine & Rich ANSI Adapter）**：
1. **动态底部 StatusLine (`TerminalStatusLine.ts`)**：
   - 在交互式 TUI 会话底部渲染单行或双行平滑状态栏：
     - 展示：当前模型与思考等级、原生沙箱安全级别（`LowIntegrity` / `JobRestricted` / `Fallback`）、工作区状态指纹前缀、当前 Turn 耗时与 KV 缓存命中率；
   - 随交互动态重绘，在输出大文本时不发生闪烁断行；
2. **富 ANSI 就地格式化报告器 (`AnsiWidgetRenderer.ts`)**：
   - 为任务 200 的组件提供终端 ANSI 格式化对等物：
     - **Diff 摘要**：彩色 Unified 差异高亮，>15 行自动折叠为单行摘要卡片；
     - **Red→Green 门禁徽章**：`[RED: exit 1 verified]` → `[GREEN: verified]` 彩色状态条与哈希截断显示；
     - **交互式审批提示**：优雅的键盘方向键选择提示，支持快速回车决策。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 状态栏与渲染器契约 (`apps/cli/src/ui/statusLine.ts`)

```typescript
export interface StatusLineState {
  modelName: string;
  reasoningEffort?: string;
  sandboxTier: string;
  cachedTokensRate?: number; // 0.0 - 1.0
  workspaceFingerprint: string;
  activeTurns: number;
}

export interface ITerminalStatusLine {
  update(state: Partial<StatusLineState>): void;
  render(): void;
  clear(): void;
  dispose(): void;
}
```

---

## 3. 验收标准与测试用例 (DoD)

1. **终端状态栏与 ANSI 单元测试 (`apps/cli/src/ui/statusLine.test.ts`)**：
   - 验证无 TTY 环境下优雅降级（不输出乱码转义字符）；
   - 验证 Diff 折叠逻辑正确计算增删行数并在终端输出合规颜色代码；
2. **冒烟测试**：
   - `npx tsx apps/cli/src/cli.ts --help` 正常退出且无语法破损；
3. **全仓门禁**：
   - `npm run test:all` 与 `npm run typecheck:tests` exit 0。

## 本地交证（2026-10-10）

CLI 54文件 / 631测试通过；状态栏/ANSI/实际stdio集成10项通过；tsc、测试类型与help exit0。真实离线TTY方向键+Enter返回deny，hello显示模型与指纹并输出回答，/quit exit0。serve与daemon注入现有WorkspaceFingerprinter。证据：evidence/sessions/2026-10-09-v2.4/card203-*.log。

