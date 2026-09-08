# 033 — ~/.dsh → ~/.vessel 迁移（用户/项目状态目录 + one-time migrator）

- 状态：待执行
- 优先级：P1（Milestone A；路线 §十六 V0.10 任务 3/4、§一问题 6、§十四）
- 创建日期：2026-09
- 关联：路线文档；goal（V1.0 产品化）

## 目标

把公开可见的用户/项目级状态目录从 `~/.dsh/*` 迁移到 `~/.vessel/*`，并提供 one-time 迁移，而不是让用户手改。项目级 `.harness/` 本期可保留读取兼容（路线建议：公开用 `.vessel/`，内部 session event 兼容读 `.harness/`，V1.x 迁移层）。

## 验收标准

- [ ] 用户级默认目录改为 `~/.vessel/`：providers.json / current.json / usage.json / memory / learned / skills（user scope）
- [ ] 项目级 skills 目录 `<ws>/.dsh/skills` → `<ws>/.vessel/skills`
- [ ] 所有硬编码 `.dsh` 的源码/测试改为 `.vessel`（grep 侦察已定位：packages/skills 的 SkillSearch/SkillLoader/index，packages/memory 的 LearnedStore/ScopedMemoryStore/userMemoryRoot，apps/cli ProviderStore 默认根）
- [ ] 新增 **one-time migrator**：若发现 `~/.dsh/*` 存在而 `~/.vessel/*` 不存在，首次运行时自动复制/移动（走文件复制 + 原路径进回收站；非静默回退，日志提示），或提供 `vessel migrate` 命令
- [ ] 环境变量 `VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` 等 keep 现名（已是 VESSEL_*），默认路径改 `.vessel`
- [ ] 全量 vitest/tsc 绿（297+ 无回归）；相关测试同步
- [ ] 卡置"待验收"

## 涉及文件（指挥 grep 侦察）

- `packages/skills/src/{search/SkillSearch.ts,index.ts,load/SkillLoader.ts}` + 相关测试
- `packages/memory/src/{learned/LearnedStore.ts,persistent/ScopedMemoryStore.ts}` + 测试
- `apps/cli/src/providers/ProviderStore.ts`（defaultProviderRoot 的 `.dsh`）
- `apps/cli/src/usage/UsageStore.ts`（defaultUsageRoot 的 `.dsh`）
- 新增 migrator（建议 apps/cli/src/migrate.ts 或 application）

## 依赖

- 无（独立于 application；可与 Milestone B 并行）

## 方法

- 全部 `.dsh` → `.vessel` 字符串替换（用户级 + 项目级 skills）
- migrator：启动/命令时检测，复制 `~/.dsh/` 数据到 `~/.vessel/`（用 fs.copyFile/复制树），原路径目录走回收站删除；**删除铁律**必须用 `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory` 走回收站
- 测试临时目录用 os.tmpdir 下的 mkdtemp，改 `.vessel` 后断言同步

## 工作证明（执行器回填）

- [ ] 改动文件 / 残留 .dsh grep / migrator 逻辑 / 测试

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：