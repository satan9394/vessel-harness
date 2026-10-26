# 批次：provider 重构（magpie 对照 → 三面统一 → token 可见）

> 这是**一个批次的总入口**，不是单张卡。执行者按下面的顺序一次做完 5 张卡；每张卡是自包含执行书，先读卡、再动手、再跑它自己的验收。
> 项目根：`E:\Code_file\Projects\Vessel_Harness`（Windows）。HEAD 见 `git log -1`，工作树应为干净。

## 顺序（严格，不要跳卡）

| 顺序 | 卡 | 一句话 | 产出 |
|---|---|---|---|
| 1 | `tasks/315-magpie-absorption.md` | 读 magpie 源码三块 + cc-switch 研究 + VESSEL 现状，产出吸收清单 | `docs/MAGPIE-ABSORPTION.md` |
| 2 | `tasks/316-web-presets-generated.md` | Web 预设改为生成物，application 为唯一真源 | `scripts/sync-web-presets.mjs` + 生成文件 |
| 3 | `tasks/317-usage-by-provider.md` | CLI 按供应商看 token 与成本 | `vessel usage --by-provider` |
| 4 | `tasks/318-web-provider-usage.md` | 同一份聚合搬到 Web 与 API | `/api/providers/usage` + 卡片摘要 |
| 5 | `tasks/319-provider-docs.md` | 文档收口 | `docs/PROVIDER-MANAGEMENT.md` |

## 素材与边界（全批次通用）

- **只读素材**：`.harness/reference/magpie-main/`（magpie 源码，Go 项目；该目录已 gitignore、不入库）。只读它，不要改、不要复制 Go 代码进仓库。
- **不改**：`packages/core`、`package-lock.json`、`.pdw/`、`HANDOFF.md`、任何用户凭据或环境变量。
- **不跑**：`--live`、`vessel doctor`（沙箱里 `secretRef` 取不到会误报）。真实 CLI 冒烟用 `node apps/cli/dist/cli.js <cmd>`，先在宿主环境 `npx tsc -b` 出 dist。
- **不 commit / 不 push**；不加依赖；不永久删除（删除只能进回收站）。
- **数据不许编**：所有 token/成本数字必须来自既有 `UsageStore` 记录；没有记录就显示空/`—`，不许用 0 冒充。

## 每张卡的完成定义

1. 该卡「验收」一节的每条命令**真跑**，贴退出码与关键输出。
2. 该卡「允许修改」之外的路径**没有改动**（用 `git status --porcelain` 自证）。
3. 该卡的「不许做」逐条遵守。

## 失败处理

- 任何一条验收失败 → **停下**，原样贴命令、退出码、报错，说明卡住的位置；不要跳到下一张，也不要为了让检查通过去放宽断言。
- 发现卡内指引与真实代码不符（路径不存在、接口形状不同）→ 停下说明，按真实代码调整的最小改法给出建议，等确认。

## 全部做完后的汇总（必须）

```
批次结论：<5 张各自的 pass/fail>
改动文件：<git status 清单>
验收：<每张的关键命令退出码>
数据来源：<token 视图用的哪份记录>
未做/风险：<如实写>
```
