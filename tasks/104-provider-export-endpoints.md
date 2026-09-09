# 104 — P2：供应商导入导出 + 备份轮转 + 多端点测速

- 编号：104（合并 CC-SWITCH-MODULE-STUDY 候选卡 095/096）
- 状态：待执行
- 优先级：P2
- 创建日期：2026-09-09
- 关联：101（ProviderStore costMultiplier 已加）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **095 导入导出 + 备份轮转**：`vessel provider export/import <file>`（**导出默认脱敏**：key 不落明文，写
   secretRef 占位或 `<redacted>`）；`~/.vessel/backups/` 轮转（保留 N 份）。
2. **096 多端点 + 测速**：`ProviderConfig.endpoints[]`（同 provider 多 baseUrl）+ `vessel provider endpoint
   add/remove/test`；测速结果**只作建议**，不自动改默认端点。

## 验收标准（执行器逐条勾选）

### 095 export/import + backups
- [ ] `vessel provider export [--out <file>]`：导出 providers 配置为 JSON；**默认脱敏**（apiKey → secretRef 占位或
      `<redacted>`，绝不写明文 key）；`--with-secrets` 需显式确认（或拒绝，选型记录）
- [ ] `vessel provider import <file>`：导入并合并（同名冲突策略明确：跳过/覆盖/询问，记录）；导入的占位 key
      不产生明文
- [ ] `~/.vessel/backups/` 轮转：每次写配置前备份 + 保留 N 份（可配），原子写
- [ ] 测试 ≥6 例：导出脱敏/导入合并/冲突策略/备份轮转上限/原子写/异常

### 096 endpoints + 测速
- [ ] `ProviderConfig.endpoints?: {url, label?}[]`（缺省时用 baseUrl）；`vessel provider endpoint add/remove/list`
- [ ] `vessel provider endpoint test [--all]`：对端点做最小探测（连通/延迟），输出**建议**但不改默认（除非用户显式
      `--set-default`）
- [ ] 测试 ≥5 例：端点增删/列表/测速结果形状/不自动改默认/异常

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 1102+ 无回归）+ web 74
- [ ] 文档同步（PROVIDER-MANAGEMENT：导出脱敏语义、备份轮转、端点与测速）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 095+096。不做 UI；不加新依赖；不读用户本机应用数据；**密钥绝不落明文**（导出脱敏是硬要求）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/providers/ProviderStore.ts`（providers.json SSOT + 备份）
- `apps/cli/src/cli.ts`（provider 命令组）
- `packages/application/src/credential/`（034/069：secretRef 语义，导出用占位）
- 参考报告 §1 供应商模块（cc-switch 的导入导出/备份）

## 方法

- 先读 ProviderStore 现状与 secretRef 约定 → 导出脱敏 → 导入合并 → 备份轮转 → endpoints + 测速 → 测试

## 工作证明（执行器回填：改了什么/导出脱敏证据/备份轮转/端点测速/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
