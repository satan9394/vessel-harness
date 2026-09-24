# 162 — [Epic] 开放生态深度兼容与极度透明可观察性体系

- 编号：162 (Epic: 融合 157–161 联合交付)
- 状态：已合入（用户验收通过 2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/llm`, `packages/skills`, `packages/policy`, `packages/engine`, `apps/web`, `apps/cli`
- 执行模型：Codex (GPT-6 Luna - Max Thinking - 超长周期自主开发)
- 验收人：用户

## 1. 总体目标与愿景

融合 OpenCode、Claude Code (claw-code)、Dify、Cline 与 DSH 的工业级实践，一次性为 Vessel 交付全套现代 Agent 基础设施：
1. **第三方模型动态探测与自带供应**：输入 URL 与 Key 自动探测 `/v1/models`，智能标记大模型推理能力。
2. **OpenAI 协议 Reasoning 深度思考流**：流式解包 `reasoning_content` / `thinking`，实现思考与正文分离。
3. **Claude Code 社区插件与 Hook 兼容层**：识别 `plugin.json`、多 Skill 组合与生命周期 Hook，安全桥接至 Policy 拦截器。
4. **会话 Topic 一等公民与自动命名**：升级 Session 为 Topic 实体，提供启发式标题提炼，向前兼容本地持久化。
5. **Web 现代化交互与 APM 级可观察性**：侧边栏 Topic 分组展示、推演思考手风琴卡片、单轮四维 Token 拆解与时延详情。

## 2. 权威开源参考与本地免下直读路径

Codex 在执行超长开发时可按需针对性查阅以下权威基准：
- **OpenCode** (`https://github.com/anomalyco/opencode`)：对标动态模型加载与提供商管理。
- **Claw-Code** (`https://github.com/ultraworkers/claw-code`)：对标本地模型路由与 Parity 架构。
- **Claude Plugins Official** (本地直读：`D:\workspaces\2026_08_25\stars-scan\repos\anthropics__claude-plugins-official\`)：对标 `plugin.json` 与插件结构。
- **Everything Claude Code** (本地直读：`D:\workspaces\2026_08_25\stars-scan\repos\affaan-m__ECC\`)：对标生产级复合插件与 Hook 声明。
- **Dify** (`https://github.com/langgenius/dify`)：对标 Conversation Topic 模型与自动命名、APM 详情卡片。
- **Cline** (`https://github.com/cline/cline`)：对标 Thinking 块折叠展开与 Token Breakdown 四维细分。

**纪律**：严禁在当前工作区内直接 `git clone`；仅参考接口 Schema 与协议流转；严禁复制代码侵权。

## 3. 分阶段实施架构与核心契约

### 阶段一：模型探测与推理思考流 (`packages/llm`)
- 在 `packages/llm/src/discovery/probeOpenAIModels.ts` 实现 `probeOpenAIModels(opts: ModelProbeOptions): Promise<ModelProbeResult>`。
- 应用层 `fetchOpenAIModels` 复用该探针，保留 `/v1/models` 与 `/models` 回退，并覆盖凭据错误脱敏。
- 在 `packages/llm/src/stream/` 中扩展 `StreamThinkingChunk ({ kind: 'thinking_delta', delta: string })`，在 `parseOpenAI.ts` 中解析 `reasoning_content` 与 `thinking`。

### 阶段二：Claude 插件生态全兼容 (`packages/skills`, `packages/policy`)
- 在 `packages/skills/src/plugin/` 中实现 `discoverClaudePlugins(workspaceRoot: string): DiscoveredPlugin[]`，识别 `plugin.json`、`.claude/`、`.claw/` 与 `plugins/` 目录。
- 将外部 Hook 映射为 Vessel 声明式 `PolicyRule`，严禁外部脚本脱离 Policy 沙箱执行。

### 阶段三：Session Topic 架构与持久化 (`packages/engine`, `apps/cli`)
- 扩展 `SessionHeader` 引入 `SessionTopic ({ topicId, title, summary, createdAt, updatedAt, tags, isArchived })`。
- 实现启发式主题提炼纯函数 `deriveTopicTitle(firstPrompt: string): string`。
- `SessionRegistry` 增加按 Topic 检索与重命名接口，保证既有历史 Session 兼容读取。

### 阶段四：Web 界面现代化重构 (`apps/web`)
- `Sidebar.tsx`：重构为 Topic 树状/分组列表，支持搜索过滤、重命名与归档。
- `ThinkingBlock.tsx`：实现带推演耗时的思考过程手风琴折叠卡片。
- `TalkingMetricsBar.tsx`：实现单轮对话 APM 状态栏，展示提示/输出/思考/缓存四维 Token 与时延成本。

## 4. 确定性完成门禁 (DoD Checklist)

- [x] **单元与组件测试矩阵**：
  - `packages/llm/src/discovery/probeOpenAIModels.test.ts` 全部 PASS（标准列表、非标裸数组、推理模型识别、401/超时安全）。
  - `packages/application/src/providers/modelFetcher.test.ts` 覆盖探针接入、端点回退与 API Key 错误脱敏。
  - `packages/llm/src/stream/parseOpenAI.test.ts` 全部 PASS（推理流解包、混合流、普通文本流）。
  - `packages/skills/src/plugin/pluginLoader.test.ts` 全部 PASS（识别 `plugin.json` 与 `.claw/skills`）。
  - `packages/application/src/pluginIntegration.test.ts` 全部 PASS（组合根装配 Hook PolicyRule、加载/搜索插件技能、验证不执行外部命令）。
  - `packages/engine/src/session/topic.test.ts` 全部 PASS（`deriveTopicTitle` 截断清洗、Topic 读写序列化、向前兼容）。
  - `apps/web/src/` 组件测试全部 PASS（ThinkingBlock 折叠开合、TalkingMetricsBar 四维渲染、Sidebar 分组）。
- [x] **类型检查与构建全绿**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
  - `npm run -w @vessel/web build` exit 0。
- [x] **全量回归无破坏**：
  - `npm run test:all` 双 root 全部通过（根 182 文件 / 2,276 passed / 6 skipped；Web 12 文件 / 129 passed）。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守薄核（Thin Core）**：所有新机制严格落在对应包内，绝不修改 `packages/core` 中的核心 Agent 状态机。
- **脱敏铁律**：探针与所有日志报错中，严禁泄露或回显用户的 API Key。
- **删除铁律**：所有文件操作必须走回收站机制，除测试自建且位于 `os.tmpdir()` 下的临时目录外，严禁使用任何永久删除命令。
- **零外部运行时强依赖**：所有会话持久化与 Topic 索引坚持纯 JSON + 原子写，严禁引入复杂原生数据库驱动。
