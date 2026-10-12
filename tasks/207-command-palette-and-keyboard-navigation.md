# 207 — 全局命令面板 (Ctrl+K) 与全键盘无障碍导航 (Command Palette & Keymap Hub)

- 编号：207
- 优先级：P2
- 关联模块：`apps/web`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验证（Web 222；类型与安全构建 exit 0）
- 创建日期：2026-10-10

---

## 1. 目标与意图

极客与高级工程师最重视“全键盘流畅操作（Keyboard-First Experience）”。如果每一个操作（切换会话、折叠 Diff、审批权限、触发诊断）都需要伸手抓鼠标，使用效率会大打折扣。

本任务旨在建立 **Vessel Web 端全局命令面板与键盘中枢**：
1. **类 VS Code/Raycast 全局命令面板 (`CommandPalette.tsx`)**：
   - 快捷键 `Ctrl+K` / `Cmd+K` 唤出居中浮层；
   - 支持关键词模糊搜索与即时执行：
     - 会话切换与新建；
     - 系统命令（运行 `/doctor`、切换模型 Provider、导出当前会话）；
     - 视图控制（全部折叠/展开 Diff、切换黑暗/明亮主题）；
2. **全键盘无障碍导航与快捷操作**：
   - 支持 `J / K` 或上下键在消息列表中导航高亮当前卡片；
   - `Space` 切换当前卡片的折叠状态；`Enter` 激活当前审批项；
   - 按 `?` 呼出快捷键速查表（Cheatsheet）。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 命令定义与注册中心 (`apps/web/src/components/palette/types.ts`)

```typescript
export interface CommandItem {
  id: string;
  title: string;
  category: 'session' | 'action' | 'navigation' | 'view';
  shortcut?: string;
  keywords?: string[];
  execute: () => void | Promise<void>;
}

export interface ICommandRegistry {
  register(command: CommandItem): () => void; // 返回取消注销函数
  search(query: string): CommandItem[];
}
```

---

## 3. 验收标准与测试用例 (DoD)

1. **注册表与快捷键测试 (`apps/web/src/components/palette/CommandPalette.test.tsx`)**：
   - 验证 `Ctrl+K` 触发面板弹出与 `Escape` 关闭；
   - 验证输入关键词能准确匹配过滤命令，键盘回车成功触发 `execute`；
2. **构建与门禁**：
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0；
   - `npm run test:all` 全绿通过。

工作证明：`evidence/sessions/2026-10-10-v2.5/card207-proof.md`。沙箱命令为新会话权限预设；清屏仅影响本地视图。

