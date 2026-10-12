# [Epic 214] Vessel V2.6 全域纯正国际化与可视化多模型接入中枢 (Epic Pure i18n & Visual Model Hub)

**状态**：已完成（2026-10-11 本地 PASS；双 Root 3146 passed / 6 skipped；七项终态门禁 exit 0）  
**负责人**：Codex  
**模式**：Bounded 自治  
**子任务集**：210, 211, 212, 213, 214  
**前置基线 Commit**：`dd8e72c`（V2.4 / V2.5 本地已验收状态）  

---

## 1. 目标与范围 (Epic Scope)

解决当前 Vessel Web 界面中英文混杂、翻译质量不佳、以及用户无法在前端添加或切换真实模型的重大痛点。

### 核心交付目标
1. **全域纯正国际化 (Pure i18n)**：彻底清除所有组件中的硬编码英文字符串，重写地道的技术中文语言包，确保切换为中文时 100% 纯中文、切换为英文时 100% 纯英文，杜绝中英夹生饭；
2. **后端供应商与模型 REST API**：在 `apps/local-server` 集成 `ProviderStore`，打通 `/api/providers`（增删查改、API Key 脱敏）与 `/api/providers/test`（端点连通性测试与延迟探测），并升级 SessionFactory 支持真实模型初始化；
3. **可视化模型与供应商管理面板**：Web 端新增 `ProviderSettingsModal.tsx`，支持预设模板一键添加 DeepSeek、OpenAI、Claude、本地 Ollama 等端点，并支持即时连通性测试；
4. **会话级模型选择与动态切换**：重构 `NewSessionForm.tsx` 与 `ModelSelector.tsx`，彻底废弃虚假模式，实现真实模型的创建与会话内动态切换。

### 红线与边界纪律 (Hard Rules)
- **纯本地开发**：严禁执行 `git push`，绝对不向 npm 发布包；
- **薄核零侵入 (Thin Core)**：`packages/core` 变动行数严格为 0；
- **文件删除铁律**：严禁彻底删除任何文件，必须走回收站（测试自理的 tmpdir 除外）；
- **禁止驱动外部真实 Agent**：严禁在测试中调起真实 dsh/claude/codex 进程；
- **依赖锁定**：锁定 npm，严禁引入 pnpm/bun/yarn 锁文件；
- **Web 构建纪律**：运行 Web 构建必须添加 `-- --emptyOutDir false`。

---

## 2. 任务卡拓扑与推进顺序

```
Task 210 (全域 i18n 字典扩充与组件解耦) ──┐
                                          ├──> Task 212 (可视化供应商管理面板) ──┐
Task 211 (Local Server 供应商与模型 API) ──┘                                      ├──> Task 214 (全量集成门禁验收)
                                          └────> Task 213 (会话模型选择与动态切换) ─┘
```

1. **Card 210**：扩充字典，清洗中文包，重构既有组件，消除硬编码英文；
2. **Card 211**：实现后端 ProviderStore 集成与 `/api/providers*`、`/api/models` 端点；
3. **Card 212**：Web 端实现供应商管理弹窗与连通性测试；
4. **Card 213**：升级新建会话与模型选择器，实现真实模型切换；
5. **Card 214**：全量集成测试、双 Root 回归、全量门禁与工作证明交付。

---

## 3. 终态门禁 (Definition of Done)

在最后一次代码/测试编辑后，按顺序执行以下七项门禁，必须全部 exit 0：
1. `npm run test:all`：双 Root（根 + `apps/web`）测试全绿，总测试数 ≥ 3,100 passed；
2. `npx tsc -b tsconfig.json`：exit 0；
3. `npm run typecheck:tests`：exit 0；
4. `npm run -w @vessel/web typecheck`：exit 0；
5. `npm run -w @vessel/web build -- --emptyOutDir false`：exit 0；
6. `npx tsx apps/cli/src/cli.ts --help`：exit 0；
7. `packages/core` 变动行数严格为 0。

交付产物存入 `evidence/sessions/2026-10-11-v2.6/PROOF.md`，并更新 `HANDOFF.md`。

## 4. 最终交证（2026-10-11）

210–213 顺序闭环，独立评审 PASS；真实浏览器中英、800px、配置引导/发现/保存/创建/模型切换与历史保全通过。最终 root 268 文件 / 2869 passed + 6 skipped，Web 33 文件 / 277 passed；全部门禁均在最后源码/测试编辑后执行。core 0、125 保护哈希未变、根锁未变、无删除/外部 Agent/提交/推送/发布。

工作证明：evidence/sessions/2026-10-11-v2.6/PROOF.md；机器证据 accepted-gates.json、completion-audit.json；完整重跑 run-final-gates.ps1 + completion-audit.ps1。内部 hub 身份、未知端点限制与估算价目边界见 card213-proof.md；浏览器仅用隔离本地 fixture，无实时供应商计费声明。Mission completed、workers 0，不自动续新路线。
