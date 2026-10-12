# 任务卡 215：模型端点自动拉取、灵活配置 Schema 兼容与供应商管理自愈 (Provider Hub Model Pull & Schema Repair)

**状态**：本地已验证（2026-10-11，待维护者验收）  
**负责人**：OpenCode (搭载 DeepSeek-v4.1-Flash · 最高思考度)  
**模式**：Bounded 自治  
**前置基线**：Epic 214 (commit `dd8e72c` / V2.6 本地验收基线)  
**交付证据**：`evidence/sessions/2026-10-11-card215/PROOF.md`  
**门禁实测**：双 Root 3155 passed / 6 skipped；定向 27（后端）+ 35（前端含 i18n）；`tsc -b`、`typecheck:tests`、web typecheck、web build（`-- --emptyOutDir false`）全 exit 0；`packages/core` 0 变动。

---

## 1. 目标与背景

用户在使用 Vessel Web 模型设置模块时遇到严重的可用性阻断与架构硬伤：
1. **缺少模型自动拉取**：配置 Base URL 与 API Key 后，无法一键调用 `/v1/models` 自动拉取端点支持的模型列表，仍需手动打字输入；
2. **术语与文案不贴合开发者直觉**：界面将协议称为“OpenAI协议 / Anthropic协议”，密钥称为“密钥”，应规范为“OpenAI 兼容 (OpenAI Compatible) / Anthropic (Claude)”以及“API Key”；
3. **已存供应商（如 OpenCode Go）无法顺利删除**：删除逻辑与后端错误被前端完全吃掉（统一回显“操作失败，请检查本地服务后重试”），无法删除或缺乏明确原因；
4. **硬编码 Schema 拒绝标准生态 JSON**：用户粘贴主流生态配置（以模型为键的对象字典、嵌套在 `options.baseURL` / `options.apiKey` 下的字段、`"npm": "@ai-sdk/openai-compatible"` 协议声明）时，后端因强行断言 `models` 为字符串数组而直接抛出 `invalid_models` 400 失败。

### 本卡核心改造目标
1. **后端 Schema 灵活兼容器 (`ProviderRoutes.save`)**：
   - 自动适配两种格式：
     - 格式 A（扁平式）：`{ name, protocol, baseUrl, apiKey, models: ["model-1"] }`；
     - 格式 B（AI-SDK / OpenCode 规范式）：`{ name, npm, options: { baseURL, apiKey }, models: { "m-1": { ... } } }`；
   - 提取规则：
     - 若 `models` 为对象，提取所有键名 `Object.keys(models)` 并去重；
     - 若存在 `options.baseURL`，优先作为 `baseUrl`；
     - 若存在 `options.apiKey`，优先作为 `apiKey`；
     - 若 `npm` 或 `protocol` 包含 `openai`，识别为 `openai-compatible`；包含 `anthropic`，识别为 `anthropic`；
2. **后端与前端增加显式「拉取模型」端点与交互**：
   - `POST /api/providers/pull-models`（或复用优化 `/api/providers/test`）：输入端点与 Key，真实请求该端点的 `/v1/models`，返回可用的模型字符串列表；
   - 前端增加「一键拉取模型列表」按钮：点击后自动将获取到的模型填充进输入框或作为多选标签；
3. **删除逻辑健壮性自愈与具体错误透传**：
   - 修复供应商删除时若关联 secretRef 或当前默认配置时的边缘异常；
   - 前后端杜绝吞掉错误：后端返回具体错误码及 message（如 `invalid_models`、`provider_not_found`），前端将具体原因呈现在界面上，绝不只显示一句话；
4. **文案专业化升级**：
   - 协议下拉项更名为“OpenAI 兼容 (OpenAI Compatible)”与“Anthropic (Claude)”；
   - 密钥字段更名为“API Key / 访问令牌”。

---

## 2. 接口契约与输入格式兼容示例

### 2.1 需 100% 兼容的输入 Payload (用户真实用例)

```json
{
  "name": "workbuddy",
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "http://127.0.0.1:7863/v1",
    "apiKey": "y8nqgu5ojwpsebrma4c2ld6zkxv9f7i01th3",
    "setCacheKey": false
  },
  "models": {
    "deepseek-v4.1-flash": {
      "name": "deepseek-v4.1-flash",
      "limit": {
        "context": 1000000,
        "input": 800000,
        "output": 32000
      }
    },
    "hy4-preview": {
      "name": "hy4-preview"
    },
    "hy4-preview-f": {
      "name": "hy4-preview-f"
    },
    "kimi-k3-1": {
      "name": "kimi-k3-1"
    }
  }
}
```

### 2.2 归一化提取函数规范 (`apps/local-server/src/routes/providerRoutes.ts`)

```typescript
export function normalizeProviderInput(input: unknown): AddProviderInput {
  const b = record(input);
  const name = text(b.name, 80) ? b.name : (b.id && text(b.id, 80) ? b.id : '');
  
  // 提取 options 嵌套或根字段
  const opts = (b.options && typeof b.options === 'object' && !Array.isArray(b.options))
    ? (b.options as Record<string, unknown>)
    : {};
  const rawUrl = b.baseUrl ?? b.baseURL ?? opts.baseUrl ?? opts.baseURL;
  const rawKey = b.apiKey ?? opts.apiKey ?? '';
  
  // 协议识别
  let protocol: 'openai-compatible' | 'anthropic' = 'openai-compatible';
  const rawProto = String(b.protocol ?? b.npm ?? opts.protocol ?? '');
  if (rawProto.includes('anthropic')) protocol = 'anthropic';
  
  // 模型提取：支持 string[]、Record<string, unknown>、逗号分隔字符串
  let models: string[] = [];
  if (Array.isArray(b.models)) {
    models = b.models.filter(m => typeof m === 'string' && m.trim());
  } else if (b.models && typeof b.models === 'object') {
    models = Object.keys(b.models).filter(k => k.trim());
  } else if (typeof b.models === 'string') {
    models = b.models.split(/[,，]/).map(m => m.trim()).filter(Boolean);
  }

  return {
    name,
    protocol,
    baseUrl: String(rawUrl ?? ''),
    apiKey: String(rawKey ?? ''),
    models,
  };
}
```

---

## 3. 受影响文件清单

- `apps/local-server/src/routes/providerRoutes.ts`：实现 `normalizeProviderInput`，支持对象字典型 models 与 options 嵌套；完善具体错误回传；
- `apps/local-server/src/routes/providerRoutes.test.ts`：编写针对 workbuddy 等嵌套格式及字典型 models 的保存与解析测试；
- `apps/web/src/components/providers/ProviderSettingsModal.tsx`：
  - 增加「拉取模型」按钮；
  - 协议选择项改为“OpenAI 兼容 / Anthropic”；
  - 字段改为“API Key”；
  - 错误展示具体 message 而非千篇一律“操作失败”；
- `apps/web/src/i18n.ts`：同步更新相关文案与国际化词条；
- `apps/local-server/src/server.ts`：确保端点异常暴露具体原因，避免被无脑 400 兜底。

---

## 4. 验证命令与验收门禁 (DoD)

1. **定向测试**：
   ```bash
   npx vitest run apps/local-server/src/routes/providerRoutes.test.ts apps/web/src/components/providers/ProviderSettingsModal.test.tsx
   ```
   测试包含：
   - 传入用户给出的真实 `workbuddy` JSON，能 100% 正确解析并存入，提取出 4 个模型；
   - 模拟 `/v1/models` 响应，测试一键拉取模型并填充表单；
   - 删除既有供应商（如包含 secretRef 的 `opencode-go`）成功并从列表中移除；
2. **全量双 Root 回归**：
   ```bash
   npm run test:all
   ```
   3,146+ 项用例全绿；
3. **类型与构建安全**：
   ```bash
   npx tsc -b tsconfig.json
   npm run -w @vessel/web typecheck
   npm run -w @vessel/web build -- --emptyOutDir false
   ```
   所有门禁 exit 0，薄核 packages/core 保持 0 变动。
