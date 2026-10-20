# Task 231 — 基于 CC-Switch 理念的模型供应商中枢与快捷切换器全量重构 (Provider Hub & Quick Switcher)

## Status: COMPLETED
- **Owner**: 主会话 (Planner/Coordinator) 调度
- **Research & Design**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash`)
- **Implementer**: Codex (`gpt-6.1-sol`, reasoning_effort: medium)
- **Reviewer**: OpenCode (`commandcode/deepseek/deepseek-v4.1-flash#max`)
- **Reference**: CC-Switch / Claude Code Switcher / `@vessel/application` presets catalog (55+ entries)
- **Date**: 2026-10-19
- **Evidence**: `apps/web/.task231-evidence/PROOF.md`, `evidence/sessions/2026-10-19-agent-walkthrough-231/`

---

## 1. Goal & Background
解决当前 Web UI 中模型供应商配置体验差、严重割裂、“东一点西一点”、以及与市面上主流优秀 Agent 客户端（如 CC-Switch / Cherry Studio）差距巨大的核心痛点：

1. **P0: 55+ 权威预设卡片展台 (Presets Catalog & Grid)**：
   - 废除前端硬编码的 4 个选项，引入后端 `@vessel/application` 的完整 55+ 款精选预设；
   - 分类网格呈现：
     - **国内直连 (CN)**: DeepSeek、Kimi (Moonshot 编程专用)、豆包 Seed (火山 Coding Plan)、通义千问 Qwen、智谱 GLM、MiniMax、百川、零一万物；
     - **国际官方 (Official)**: Anthropic Claude、OpenAI GPT、Google Gemini、xAI Grok、Mistral、Cerebras 等；
     - **聚合中转 (Aggregator)**: SiliconFlow 硅基流动、OpenRouter、NewAPI / OneAPI、Together AI、Fireworks 等；
     - **本地模型 (Local)**: Ollama、vLLM、LM Studio；
   - 极简配置：点击卡片自动填好 Base URL、线协议与推荐模型，**用户仅需粘贴 API Key**。

2. **P0: 可视化模型标签（Pills / Chips）与端点探测**：
   - 彻底废除逗号分隔的纯文本输入框；
   - 一键探测 `/v1/models`，模型以流线型胶囊标签展示，用户点选即可添加/设为常用；
   - 实时连通性测试指示器（绿色脉冲灯 + 延迟毫秒数，如 `118ms`）。

3. **P0: 就地快捷切换器 (Quick Switcher Popover)**：
   - 终结主界面与设置弹窗的割裂；
   - 在 `TaskComposer` 和会话顶部提供统一的**当前激活模型胶囊**（显示供应商 Logo、名称、模型及延迟）；
   - 点击就地弹出微型切换菜单，一键在已配置的供应商与模型之间秒切，热生效，无页面跳转。

4. **P1: 新手开箱引导 (Zero-Config Guide)**：
   - 未配置模型时，展示直观的「30 秒快捷接入」向导卡片（推荐 DeepSeek、Claude、OpenAI 一键接入胶囊）。

---

## 2. Not Doing
1. **禁止修改核心**：`packages/core` 修改行数严格保持为 0。
2. **禁止破坏既有供应商数据**：兼容既有 `providers.json` / `current.json` 存储格式与 API 契约。
3. **纯本地开发**：不向 GitHub push，所有删除走 Windows 回收站。

---

## 3. Scope & Blast Radius
- `apps/web/src/components/providers/ProviderSettingsModal.tsx`: 重构为分类预设卡片展台 + 标签化模型选择器
- `apps/web/src/components/providers/ProviderPresetsCatalog.ts`: 引入分类预设元数据（或复用 Application 层契约）
- `apps/web/src/components/providers/ModelQuickSwitcher.tsx`: 新增就地快捷切换组件
- `apps/web/src/components/TaskComposer.tsx`: 接入就地快捷切换胶囊
- `apps/web/src/styles.css`: 预设卡片网格、模型胶囊标签、切换浮层样式
- `apps/web/src/i18n.ts`: 补齐各供应商名称与分类国际化词条

---

## 4. Acceptance Criteria
1. **预设卡片网格**：涵盖国内/国际/聚合/本地 4 大分类，点击即预填，单填 Key 即可启用；
2. **模型标签化**：探测到的模型呈现为标签胶囊，点击勾选，支持一键设为默认；
3. **就地切换**：在输入框与顶部无需进入设置页，直接点击胶囊即可在已配模型间秒切并实时生效；
4. **全量门禁**：
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run -w @vessel/web test` 100% 通过；
   - `npm run -w @vessel/web build` 0 警告成功构建；
   - `npm run test:all` 双 Root 全量通过；
   - `packages/core` 0 改动。

---

## 5. Verification & Acceptance Evidence
- **Web UI 单测**: `npx vitest run --root apps/web` 全量 **47 文件 / 389 passed (100%)**，耗时 18.46s；
- **Web 生产构建**: `npm run -w @vessel/web build` 0 警告成功（`dist/` 资源构建正常，bundle 480kB / gzip 143kB）；
- **TypeScript 静态检查**: `npm run typecheck:tests` exit 0，`npx tsc -b tsconfig.json` exit 0（全仓类型零错误）；
- **薄核零侵入**: `git diff --stat packages/core packages/runtime` 输出严格为空（0 修改）；
- **端到端 Chromium 走查**: `python scripts/run-browser-agent-walkthrough-231.py` **5/5 PASS (100%)**：
  1. `01_OpenHomePage` PASS (2906ms)
  2. `02_InspectModelControls` PASS (484ms)
  3. `03_OpenProviderModal` PASS (922ms)
  4. `04_InteractPresetsGallery` PASS (1094ms)
  5. `05_ValidateModelChips` PASS (531ms)
  - Console Errors: 0，Page Errors: 0；
  - 截取 6 张全真机高清渲染截图归档于 `evidence/sessions/2026-10-19-agent-walkthrough-231/`。
- **独立对抗性审查**: OpenCode (`deepseek/deepseek-v4.1-flash#max`) 审查报告已归档至 `evidence/sessions/2026-10-19-opencode-review-231.md`。
