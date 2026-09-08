# 035 — 公开文档：README / LICENSE / SECURITY / CHANGELOG

- 状态：待执行
- 优先级：P1（Milestone A；路线 §十六 V0.10 任务 5-8）
- 创建日期：2026-09
- 关联：路线文档；goal（V1.0 产品化）

## 目标

为 Vessel 写产品级公开文档：root README（产品定位、公式、快速开始、命令参考）、LICENSE、SECURITY.md（安全边界、凭据说明、报告渠道）、CHANGELOG（V0.1-V0.10 汇总）。

## 验收标准

- [ ] `README.md`（根）：Vessel 定位（A Composable Agent Harness，本地优先/模型无关/可组合/可观察/硬策略边界）、产品公式（Model+Behavior+Context+Tools+Policy+Memory+Evaluator+Orchestration+Runtime+Surfaces）、快速开始（npm install→build→vessel→setup→run，5 分钟上手）、命令参考（run/web/serve/setup/provider/models/usage/pricing/migrate）、UI 哲学（Capability is abundant. Interface is quiet.）、链接 docs/ 关键文档
- [ ] `LICENSE`：MIT（或注明选型）
- [ ] `SECURITY.md`：安全模型（Policy 四件套 / 权限三档 / 沙箱状态如实标注 partial / ~/.vessel 凭据说明与风险 / 上报渠道）
- [ ] `CHANGELOG.md`：V0.1-V0.10 里程碑汇总（可基于 docs/V0x-PROGRESS 摘要，不必逐 commit）
- [ ] 风格遵循 UI-THEME 的浅色/系统深色（文档不涉及，但 HTML 类若含保持）
- [ ] 不引入代码改动（纯文档）；全量测试不受影响（tsc/vitest 仍绿即可确认）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 README.md / LICENSE / SECURITY.md / CHANGELOG.md（根目录）
- 可顺带把 docs/ 里过时的"cah"引用在 README 层面不再出现（README 是门面必须 vessel）

## 依赖

- 无（纯文档，可与 039 并行）

## 方法

- 内容从 docs/VESSEL.md、V1.0 路线、PROVIDER-MANAGEMENT、UI-THEME 提炼；不编造功能
- CHANGELOG 依据 git log 里程碑（可 `git log --oneline` 扫一遍）

## 工作证明（执行器回填）

- [ ] 四个文件 / 内容要点 / 无代码改动确认

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：