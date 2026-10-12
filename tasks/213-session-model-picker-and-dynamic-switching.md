# 任务卡 213：新建会话模型选择器升级与会话级多模型动态切换 (Session Model Picker & Dynamic Switching)

**状态**：单卡门禁通过 (PASS, 2026-10-11)  
**负责人**：Codex  
**模式**：Bounded 自治  
**所属 Epic**：[Epic 214] `tasks/214-epic-v2-6-pure-i18n-and-visual-model-hub.md`  
**前置依赖**：`tasks/211-local-server-provider-store-and-models-api.md`，`tasks/212-provider-settings-modal-and-connection-tester.md`  

---

## 1. 目标与背景

当前用户在新建会话时无法指定模型，在已有会话中也只能在 Auto/Fast/Pro 三个虚假模式间切换。

本卡目标：
1. 升级 `NewSessionForm.tsx`：增加“模型选择”下拉控件，自动拉取当前已配置的真实模型列表；若未配置任何供应商，则提供“配置新模型”跳转按钮与兜底提示；
2. 升级 `ModelSelector.tsx`：彻底废弃固化的 Auto/Fast/Pro 假模型，改造为真正的模型切换器。支持直接展示并切换当前会话所绑定的真实模型（如 `deepseek-chat` / `claude-3-5-sonnet`）；
3. 在会话顶部状态栏或对话流头部清晰展示当前会话使用的真实模型标签；
4. 确保在创建会话和切换模型时，与后端 `/api/sessions` 协议完整打通；
5. 全面接入 i18n 规范，杜绝任何中英混杂。

---

## 2. 接口契约与代码规范

### 2.1 新建会话交互扩展 (`apps/web/src/components/NewSessionForm.tsx`)

```typescript
export interface CreateSessionInput {
  workspaceRoot: string;
  permission?: 'read-only' | 'workspace-write' | 'danger-full-access';
  provider?: string;
  model?: string;
}
```

- 表单增加字段：
  - “运行模型”下拉框：展示 `{providerName} / {modelId}`（如 `DeepSeek / deepseek-chat`）；
  - 选项后方带有配置跳转链接（未配置模型时直接引导打开 `ProviderSettingsModal`）；
- 提交时将选择的 `provider` 与 `model` 随请求体发送给后端 `api.createSession`。

### 2.2 模型切换器重构 (`apps/web/src/components/ModelSelector.tsx`)
- 放弃写死的 `ROUTE_MODES` 单选按钮组；
- 改为真实模型下拉切换选择器，显示当前正在驱动会话的模型标识（附带供应商协议图标或标签）；
- 用户切换选择后，通过 API 实时更新会话模型并同步状态。

---

## 3. 受影响文件清单

- `apps/web/src/components/NewSessionForm.tsx`：重构表单，加入真实模型选择项；
- `apps/web/src/components/NewSessionForm.test.tsx`：增加模型选择逻辑与无模型引导测试；
- `apps/web/src/components/ModelSelector.tsx`：重构为真实模型切换器；
- `apps/web/src/components/ModelSelector.test.tsx`：更新模型切换与展示单测；
- `apps/web/src/components/ConversationView.tsx`：展示当前生效的模型标签；
- `apps/web/src/styles.css`：优化模型选择器与表单下拉框视觉风格。

---

## 4. 验证命令与验收门禁 (DoD)

1. **定向测试**：
   ```bash
   npx vitest run apps/web/src/components/NewSessionForm.test.tsx apps/web/src/components/ModelSelector.test.tsx
   ```
   单测 100% 通过；
2. **Web 生产构建**：
   ```bash
   npm run -w @vessel/web build -- --emptyOutDir false
   ```
   exit 0；
3. **全端集成测试**：
   ```bash
   npm run -w @vessel/web test
   ```
   所有组件测试全绿。

## 5. 工作证明（2026-10-11）

- 实现：新会话真实供应商/模型选择、无配置引导与设置返回保留表单；会话头部真实模型切换；移除 TeamModule 的旧 Auto/Fast/Pro 假选择器。
- 后端：本地 SessionModelHub 保留原控制器、历史、权限及 SSE，实际请求委派至所选供应商/模型；PATCH 模型切换覆盖输入校验、忙态拒绝、失败回滚及同源防护。真实委派审计不含密钥或提示词。
- 最后源码/测试编辑之后：定向后端 **37/37**、定向 Web **18/18**、Web **277/277（33 文件）**、local-server **150/150（18 文件）**；`tsc -b`、`typecheck:tests`、Web typecheck、安全构建均 exit 0。
- 证明：`evidence/sessions/2026-10-11-v2.6/card213-proof.md`；机器门禁：`card213-gates.json`；最终日志为 `card213-*-accepted-2.log`。
- 保留原默认上下文预算及 4096 输出预算；未知端点上限和价目不作推断。内部请求记录标识模型中枢，真实供应商/模型以委派审计为准。Epic 214 独立审查、浏览器集成和双 Root 最终回归由主会话继续验收。
