# 任务卡 212：Web 端模型与供应商可视化管理弹窗及一键连通性探测 (Provider Settings Modal & Connection Tester)

**状态**：已完成 (PASS)  
**负责人**：Codex  
**模式**：Bounded 自治  
**所属 Epic**：[Epic 214] `tasks/214-epic-v2-6-pure-i18n-and-visual-model-hub.md`  
**前置依赖**：`tasks/210-comprehensive-i18n-dictionary-and-component-decoupling.md`，`tasks/211-local-server-provider-store-and-models-api.md`  

---

## 1. 目标与背景

当前 Web 界面缺少任何添加模型或配置供应商的交互界面。用户无法直观输入 API Key、Base URL，也无法检验自己配置的端点是否通畅。

本卡目标：
1. 在 `apps/web/src/components/providers/` 实现 `ProviderSettingsModal.tsx`（模型与供应商管理面板）；
2. 顶部工具栏提供快捷打开按钮，并在 `CommandPalette.tsx`（`Ctrl+K`）中注册“模型设置 / 供应商配置”命令；
3. 展示已配置的供应商卡片列表，直观显示协议类型徽章、Base URL、脱敏后的密钥，以及删除操作；
4. 提供“添加供应商”表单：
   - 包含快捷模版预设：DeepSeek 官方、OpenAI 官方、Anthropic 官方、本地 Ollama（`http://localhost:11434/v1`）、自定义兼容端点；
   - 支持填写供应商名称、协议类型、Base URL、API Key 与可用模型列表（以逗号或标签输入）；
   - 提供“测试连接”按钮：即时发起测试并以绿色/红色徽章显示连通性与实测网络延迟（如 `连接成功 · 156ms` 或 `401 Unauthorized`）；
5. 界面文案 100% 接入 i18n 字典，支持中英文即时切换无违和感。

---

## 2. 接口契约与代码规范

### 2.1 API 客户端对接 (`apps/web/src/api.ts`)

```typescript
export interface ProviderInfo {
  name: string;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKeyMasked: string;
  models: string[];
}

export interface ApiClient {
  // ... 既有方法 ...
  listProviders(): Promise<{ providers: ProviderInfo[] }>;
  addProvider(input: {
    name: string;
    protocol: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    apiKey: string;
    models: string[];
  }): Promise<{ provider: ProviderInfo }>;
  deleteProvider(name: string): Promise<{ ok: boolean }>;
  testProvider(input: {
    protocol: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    apiKey: string;
    model?: string;
  }): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
  listModels(): Promise<{ models: Array<{ id: string; name: string; providerName: string }> }>;
}
```

### 2.2 组件设计 (`apps/web/src/components/providers/ProviderSettingsModal.tsx`)
- 模态弹窗使用标准可访问性结构（`role="dialog"`，`aria-label` 使用 `t('modelSettings')`）；
- 表单验证：Base URL 必须为合法 URL，名称不可为空，密钥添加时必填；
- 状态联动：测试连接期间按钮显示 loading 旋转状态，保存成功后自动刷新模型列表并关闭或保持面板；
- 错误提示：错误信息清晰可读，不出现未捕获异常。

---

## 3. 受影响文件清单

- `apps/web/src/api.ts`：增加供应商与模型相关 API 调用封装；
- `apps/web/src/components/providers/ProviderSettingsModal.tsx`：实现可视化配置弹窗；
- `apps/web/src/components/providers/ProviderSettingsModal.test.tsx`：编写组件交互与表单测试；
- `apps/web/src/App.tsx`：在 Topbar 添加模型设置触发入口，并集成至 CommandPalette；
- `apps/web/src/styles.css`：添加供应商卡片与测试连接徽章的高级极客样式。

---

## 4. 验证命令与验收门禁 (DoD)

1. **定向测试**：
   ```bash
   npx vitest run apps/web/src/components/providers/ProviderSettingsModal.test.tsx
   ```
   表单输入、模版预设填充、测试连接与增删流程单测 100% 通过；
2. **Web 生产构建**：
   ```bash
   npm run -w @vessel/web build -- --emptyOutDir false
   ```
   无打包警告或类型错误；
3. **全量 Web 测试**：
   ```bash
   npm run -w @vessel/web test
   ```
   无回归。


## 5. 工作证明（2026-10-11）

实现与验收记录：`evidence/sessions/2026-10-11-v2.6/card212-proof.md`。
供应商管理、模板、密钥安全输入、确认删除、连接延迟/错误反馈与中英文界面已接入；顶部按钮及命令面板可打开。
最终编辑后：定向 13/13、Web 269/269（31 文件）、Web 类型检查与测试类型检查均 exit 0，安全构建 exit 0。
