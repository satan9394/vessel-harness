# 任务卡 211：Local Server 供应商存储集成、/api/providers 端点与动态模型路由 (Provider Store & Models API)

**状态**：已完成（2026-10-11；23 API tests、136 local-server tests、tsc 与测试类型检查 exit 0；证据 evidence/sessions/2026-10-11-v2.6/card211-proof.md）  
**负责人**：Codex  
**模式**：Bounded 自治  
**所属 Epic**：[Epic 214] `tasks/214-epic-v2-6-pure-i18n-and-visual-model-hub.md`  
**前置依赖**：无  

---

## 1. 目标与背景

当前 `apps/local-server` 默认仅提供离线 MockProvider，未将 Vessel 既有的 `ProviderStore`（`~/.vessel/providers.json`）接入 HTTP API，导致前端界面无法列出真实模型、无法添加 API Key / Base URL、更无法让会话使用真实模型驱动。

本卡目标：
1. 在 `apps/local-server` 中集成 `ProviderStore`，构建一套标准的供应商管理 REST API；
2. 提供 `GET /api/providers`、`POST /api/providers`、`DELETE /api/providers/:name` 与 `POST /api/providers/test`（端点自省与连通性测试）；
3. 提供 `GET /api/models` 聚合返回系统内配置的所有可用真实模型清单；
4. 升级 `POST /api/sessions` 接收 `provider` 与 `model` 参数，允许在创建会话时指定真实供应商驱动；
5. 编写针对 `providerRoutes` 的单元测试，覆盖增删改查、密钥安全脱敏、探针连通性与会话控制器动态绑定。

---

## 2. 接口契约与代码规范

### 2.1 REST API 规范 (`apps/local-server/src/routes/providerRoutes.ts`)

```typescript
export interface ProviderDto {
  name: string;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKeyMasked: string; // 如 "sk-****1234"，严禁明文暴露完整密钥
  models: string[];
  isDefault?: boolean;
}

export interface AddProviderInput {
  name: string;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface TestProviderResult {
  ok: boolean;
  latencyMs?: number;
  availableModels?: string[];
  error?: string;
}

export interface ModelOptionDto {
  id: string;          // 如 "deepseek-chat"
  name: string;        // 如 "DeepSeek Chat"
  providerName: string;// 如 "deepseek"
  protocol: string;
}
```

### 2.2 核心端点行为
- `GET /api/providers`：返回 `{ providers: ProviderDto[] }`，密码已做脱敏处理；
- `POST /api/providers`：校验入参格式并安全写入 `ProviderStore`，返回 `201 { provider: ProviderDto }`；
- `DELETE /api/providers/:name`：安全移除指定的供应商；
- `POST /api/providers/test`：传入 `{ protocol, baseUrl, apiKey, model? }`，向该端点发起一次轻量探针请求（如 `/v1/models` 或生成 1 token 冒烟调用），返回 `{ ok: true, latencyMs: 120 }` 或 `{ ok: false, error: '401 Unauthorized' }`；
- `GET /api/models`：聚合所有供应商的 models 数组，并附带离线 mock 模型作为兜底备选；
- `POST /api/sessions`：请求体扩展 `{ workspaceRoot, permission?, provider?, model? }`。若指定了 `provider`，则从 `ProviderStore` 实例化真实 Provider 并注入 `SessionController`。

---

## 3. 受影响文件清单

- `apps/local-server/src/routes/providerRoutes.ts`：实现供应商与模型路由处理器；
- `apps/local-server/src/server.ts`：挂载 `/api/providers*` 与 `/api/models`，并在 SessionFactory 中支持真实 Provider 解析；
- `apps/local-server/src/routes/providerRoutes.test.ts`：编写针对新端点的完整自动化测试；
- `apps/local-server/src/server.test.ts`：补充端点集成与权限隔离测试。

---

## 4. 验证命令与验收门禁 (DoD)

1. **定向测试**：
   ```bash
   npx vitest run apps/local-server/src/routes/providerRoutes.test.ts
   ```
   端点增删改查、端点连通性探测、API Key 脱敏断言 100% 通过；
2. **Local Server 测试全绿**：
   ```bash
   npx vitest run apps/local-server
   ```
   历史路由与新增路由无冲突，全部通过；
3. **类型安全**：
   ```bash
   npx tsc -b tsconfig.json
   ```
   exit 0，零类型错误。
