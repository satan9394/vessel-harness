# 任务卡 210：全域纯正国际化字典体系扩充与组件硬编码英文彻底解耦 (Comprehensive i18n & Pure Localization)

**状态**：已完成（2026-10-11；256 Web tests、16 i18n tests、Web typecheck exit 0；证据 evidence/sessions/2026-10-11-v2.6/card210-proof.md）  
**负责人**：Codex  
**模式**：Bounded 自治  
**所属 Epic**：[Epic 214] `tasks/214-epic-v2-6-pure-i18n-and-visual-model-hub.md`  
**前置依赖**：无  

---

## 1. 目标与背景

当前 Web 界面存在严重的中英文混杂现象：`apps/web/src/i18n.ts` 仅有 40 个基础词条，后续加入的双模态画布、补丁选择器、流式思考块、命令面板、注意力控制、新建会话表单等核心组件大量硬编码了英文字符串；原有的中文词典也充斥着生硬的英文字词（如 “从左侧 Recent Sessions 选择... 点击 + New Session”）。

本卡目标：
1. 全面扩充 `apps/web/src/i18n.ts`，建立强类型化、模块化的字典结构（common, session, model, canvas, patch, reasoning, palette, attention, status）；
2. 彻底清洗中文语言包为 100% 地道纯正的技术中文，杜绝任何生硬混杂；英文语言包同样提供 100% 地道母语级英文；
3. 系统性重构全仓所有 UI 组件，彻底消除硬编码英文字符串，统一消费 `useI18n().t(...)`；
4. 编写全面的 i18n 单元测试，确保中/英双语无缺失、无死键、切换即时响应。

---

## 2. 接口契约与代码规范

### 2.1 字典接口架构扩展 (`apps/web/src/i18n.ts`)

```typescript
export interface Messages {
  // common 通用操作
  confirm: MessageTemplate;
  cancel: MessageTemplate;
  save: MessageTemplate;
  delete: MessageTemplate;
  close: MessageTemplate;
  copy: MessageTemplate;
  loading: MessageTemplate;
  retry: MessageTemplate;

  // session 会话与项目
  newSession: MessageTemplate;
  newSessionTitle: MessageTemplate;
  workspacePath: MessageTemplate;
  workspacePlaceholder: MessageTemplate;
  permissionLabel: MessageTemplate;
  permissionReadOnly: MessageTemplate;
  permissionWorkspaceWrite: MessageTemplate;
  permissionDangerFull: MessageTemplate;
  recentSessions: MessageTemplate;
  searchTopics: MessageTemplate;
  noProjects: MessageTemplate;
  noSessions: MessageTemplate;
  emptyTitle: MessageTemplate;
  emptyBody: MessageTemplate;

  // canvas & inspector 画布检视器
  inspectorTitle: MessageTemplate;
  tabDiff: MessageTemplate;
  tabTree: MessageTemplate;
  tabImpact: MessageTemplate;
  tabRules: MessageTemplate;
  tabPatch: MessageTemplate;
  noDiffAvailable: MessageTemplate;
  noImpactReport: MessageTemplate;

  // patch 补丁微操
  hunkTitle: MessageTemplate;
  acceptHunk: MessageTemplate;
  discardHunk: MessageTemplate;
  revertHunk: MessageTemplate;
  reapplyHunk: MessageTemplate;
  patchAppliedSuccess: MessageTemplate;
  viewUnified: MessageTemplate;
  viewSplit: MessageTemplate;

  // reasoning 思考推演
  thinking: MessageTemplate;
  thinkingFor: MessageTemplate;
  expandReasoning: MessageTemplate;
  collapseReasoning: MessageTemplate;
  cognitiveRulesHit: MessageTemplate;

  // palette 全局命令面板
  palettePlaceholder: MessageTemplate;
  paletteCategorySession: MessageTemplate;
  paletteCategoryAction: MessageTemplate;
  paletteCategoryView: MessageTemplate;
  paletteClearScreen: MessageTemplate;
  paletteExportJson: MessageTemplate;

  // attention & audio 注意力与提示音
  attentionTitle: MessageTemplate;
  enableNotification: MessageTemplate;
  notificationEnabled: MessageTemplate;
  soundMute: MessageTemplate;
  soundUnmute: MessageTemplate;
  testSound: MessageTemplate;

  // model 供应商与模型
  modelSettings: MessageTemplate;
  selectModel: MessageTemplate;
  currentModel: MessageTemplate;
  noModelsConfigured: MessageTemplate;
}
```

### 2.2 地道中文清洗标准对照

| 历史生硬/混杂英文 | 规范地道中文 (zh) | 纯正英文 (en) |
|---|---|---|
| Recent Sessions | 历史会话 | Recent Sessions |
| + New Session | + 新建会话 | + New Session |
| Canvas Inspector | 画布检视器 | Canvas Inspector |
| Patch Picker | 代码补丁审阅 | Patch Inspector |
| Hunk | 变更代码块 | Code Hunk |
| Cherry-pick / Accept | 采纳此块 | Accept Hunk |
| Discard | 放弃修改 | Discard Changes |
| Workspace write | 工作区读写权限 | Workspace Write |
| Read-only | 只读探索权限 | Read-only Explore |
| Thinking... | 思考推演中… | Thinking… |
| Type a command or search sessions... | 输入命令或搜索历史会话… | Type a command or search sessions… |

---

## 3. 受影响文件清单

- `apps/web/src/i18n.ts`：扩展强类型字典并完善中英词典；
- `apps/web/src/components/NewSessionForm.tsx`：全面接入国际化，替换所有硬编码标签；
- `apps/web/src/components/layout/DualSurfaceLayout.tsx`：替换五大 Tab 与画布英文标签；
- `apps/web/src/components/canvas/InteractivePatchPicker.tsx`：替换补丁采纳、回退与视图模式英文；
- `apps/web/src/components/widgets/InlineDiffInspector.tsx`：替换行折叠与 Diff 统计标签；
- `apps/web/src/components/widgets/StreamingReasoningBlock.tsx`：替换思考计时与规则标签；
- `apps/web/src/components/palette/CommandPalette.tsx`：替换快捷命令标题与分类标签；
- `apps/web/src/components/AttentionControls.tsx`：替换通知与静音提示文案；
- `apps/web/src/components/ModelSelector.tsx`：替换模式标签与固定提示；
- `apps/web/src/components/Sidebar.tsx` 与 `ConversationView.tsx`：全面检查并替换残留英文字符串；
- `apps/web/src/i18n.test.ts`：新增全面的国际化测试文件。

---

## 4. 验证命令与验收门禁 (DoD)

1. **定向测试**：
   ```bash
   npx vitest run apps/web/src/i18n.test.ts
   ```
   中英文全部词条对齐，无未定义键，占位符替换正常；
2. **Web 全量测试**：
   ```bash
   npm run -w @vessel/web test
   ```
   所有 React 组件单测全绿；
3. **类型安全**：
   ```bash
   npm run -w @vessel/web typecheck
   ```
   exit 0，零类型错误。
