# 014 — 供应商配置 SSOT 存储（~/.dsh/providers.json）

- 状态：待验收（执行器 2026-09-05 完成核心+测试，全绿）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：015-018 都依赖本卡；目标 goal-575e1e4b

## 目标

实现供应商配置的单一事实源（SSOT）存储：`~/.dsh/providers.json`（沿用项目 ~/.dsh 用户目录约定），支持多组供应商的增删改查 + 当前默认供应商持久化（current.json）。原子读写、校验 fail-loud。

## 验收标准

- [ ] `ProviderConfig` 类型：{ id, name, protocol: 'openai-compatible'|'anthropic'|'mock', baseUrl?, apiKey?, model, models?: string[], note? }（apiKey 存本地文件，注明风险）
- [ ] `ProviderStore`（新模块，放 apps/cli/src/providers/ 或独立）：load/save/add/remove/get/list/setCurrent/getCurrent；默认 `~/.dsh/providers.json`，测试可注入 rootDir
- [ ] 原子写：temp 文件 + rename，防半写状态；校验重复 id/非法 protocol fail loud
- [ ] 首次运行无文件 → 返回空列表不报错；mock 作为内置默认供应商
- [ ] Vitest：增删改查/current 持久化/原子写/重复 id 拒绝/非法 protocol 拒绝/rootDir 注入
- [ ] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（按需扩展）

- 新模块：ProviderStore（放 packages 或 apps/cli——倾向新小包 `packages/provider-config` 或 apps/cli/src/providers/，实现者判断，倾向 apps/cli 侧先做，后续要复用再提包）
- 测试 + `docs/V06-PROGRESS.md`（新建进度文档）

## 依赖

- 依赖任务卡：无（首发）
- 阻塞于：—

## 设计锚点

- 沿用 ~/.dsh 用户目录约定（memory/skills 已用），不另造 ~/.cah
- apiKey 本地明文存储（与 cc-switch 同）——文档注明风险，不做加密（YAGNI）
- mock 是内置默认供应商（id='mock'），不可删除
- 原子写：写 temp + rename（cc-switch 同款防半写）

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0
- 改动文件：
  - 新增 `apps/cli/src/providers/ProviderStore.ts`（ProviderConfig/ProviderStore/内置 mock/原子写/校验 fail-loud）
  - 新增 `apps/cli/src/providers/ProviderStore.test.ts`（21 用例）
- 证据：`npx tsc -b` exit 0；`npx vitest run` 238 passed（含 ProviderStore 21 新用例，无回归）；定向跑 ProviderStore.test.ts 21/21 绿。
- 未完成：无（卡验收标准逐条 PASS，见回传 message）。

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
