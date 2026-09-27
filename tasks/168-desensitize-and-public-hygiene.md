# 168 — 公开仓库脱敏与规范化对标（Desensitize & Public Hygiene）

- 编号：168
- 状态：进行中（工作树脱敏与规范化文件已落盘，历史改写待执行）
- 优先级：P0
- 创建日期：2026-09-27
- 关联模块：仓库级（无源码逻辑改动）
- 执行模型：OpenCode (deepseek-v4.1-flash)
- 验收人：用户

## 1. 目标与意图

仓库于 2026-09-27 由 Private 转为 Public。公开前必须解决两类问题：

1. **个人信息泄漏**：工作树与 700+ 条提交里散布真实邮箱、姓名、本机用户名与本机工作区绝对路径。
2. **公开仓库规范化缺口**：缺少贡献指南、行为准则、issue/PR 模板、编辑器与行尾约定。

用户明确的边界是 **身份 + 本机路径 + 账号痕迹**；报告与证据目录（`benchmarks/reports/`、`evidence/`）**不**整体移出公开范围，但要清掉其中的本机路径。

## 2. 范围

**做**：

- 工作树脱敏：对全部受控文件做同源替换（身份、本机用户名、本机工作区路径、旧仓名自链接）。
- 历史改写：`git-filter-repo` 改写作者/提交者身份 + 全历史 blob 替换（与工作树同表）。
- 一次性 force push（授权来源：决策点 20）。
- 补齐规范化文件：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`.editorconfig`、`.gitattributes`、`.github/ISSUE_TEMPLATE/*`、`.github/pull_request_template.md`；`README.md` 增加「贡献」导航；`SECURITY.md` 上报渠道改为 GitHub 私密上报。

**不做**（明确排除）：

- 不把 `benchmarks/reports/`、`evidence/`、`.dsh-mission/` 移出仓库或整体删除（它们是可核查的演进证据）。
- 不改写 `tasks/` 中既有卡片的历史叙述（卡是已交付记录）。
- 不改 GitHub 账号句柄（它是公开仓库身份，URL 与 CODEOWNERS 依赖它；见决策点 20 的固有边界）。
- 不动 4 条 dependabot 开放 PR 与 19 条 `refs/pull/*`（服务端引用，客户端不可删）。
- 不抄 OpenCode 或任何其它 harness 的文字与代码，只参考其**仓库卫生的标准构成**。

## 3. 验收判据（可机械验证）

1. 工作树内以下 token 家族出现次数均为 **0**：真实邮箱、真实姓名（提交元数据外）、本机用户名（含 8.3 短名）、本机工作区盘符路径、其它本机工作树路径。
2. `git log --format='%an <%ae>' | sort -u` 中只剩中性身份与 `dependabot[bot]`，无真实邮箱/姓名。
3. 替换后的工作树与改写后的 HEAD **逐字节一致**（`git status` 干净）。
4. 门禁：`npm ci` / `npx tsc -b tsconfig.json` / `npm run typecheck:tests` / `npm run test:all`（双 root）/ `npm run -w @vessel/web build` 全绿。
5. 远端 CI 双腿（Windows + Linux）success。

## 4. 证据

- 备份：仓库外镜像 + bundle（`git bundle verify` = complete history，707 提交）。
- 替换表：与工作树脚本同源，保存在仓库外备份目录（含被移除的原始值，故不入库）。
- 决策记录：`docs/DESIGN-DECISIONS.md` 决策点 20；`DEV_LOG.md` 2026-09-27 条。

## 5. 已知残留

- `refs/pull/*` 服务端引用可能继续保留旧对象，彻底回收需联系 GitHub Support。
- `secret_scanning_non_provider_patterns` / `validity_checks` 经 API 未能开启（已开启 secret scanning + push protection + dependabot 安全更新）。
