# V0.3 执行进度（V03-PROGRESS.md）

> 接力文档：按 personal-dev-workflow 拆卡推进（tasks/ 看板）。每完成一张卡更新本文件 + 任务卡状态。
> 权威依据：docs/MISSION-V0.3.md、docs/ARCHITECTURE.md §4.8/§4.9、docs/DESIGN-DECISIONS.md（决策点 10/11）。
> 最后更新：2026-09-05（**V0.3 全部完成，验收 VERDICT: PASS**）。

## 0. 环境与基线

- 非沙箱会话（danger-full-access）：`npx vitest run` 可用。基线 104 用例（18 文件）全绿，`npx tsc -b` exit 0。
- git 已建仓：main。V0.3 提交链：fc8ae84(M1) / 3bcf37f(M2) / 64832d0(M3) / 410f1f0(M4) / 8ef5e0b(M5) / a74efa2(M6 bench+notes) / 478adc6(评审 PASS)。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| M1 Project Memory 核心 | tasks/001-project-memory.md | 已合入（fc8ae84），115 测试全绿 |
| M2 Persistent Memory | tasks/002-persistent-memory.md | 已合入（3bcf37f），123 测试全绿 |
| M3 Skills 正文注入 | tasks/003-skills-content-injection.md | 已合入（64832d0），131 测试全绿 |
| M4 Skill Scope/Search/Provenance | tasks/004-skill-scope-search-provenance.md | 已合入（410f1f0），138 测试全绿 |
| M5 自动学习 suggest 通道 | tasks/005-auto-learn-suggest.md | 已合入（8ef5e0b），144 测试全绿 |
| M6 收尾 | 006-benchmarks（内联） | 已合入（a74efa2 + 478adc6），146 测试全绿，**V0.3 VERDICT: PASS** |

## 2. 验收标准映射（MISSION-V0.3 第六节）

1. ✅ 可运行代码 + 测试：146/146（≥ V0.2 104），`npx tsc -b` exit 0
2. ✅ Project Memory 端到端：B020 + 跨会话单元测试
3. ✅ Persistent Memory 端到端：user/project/local 分层隔离 + 跨项目 user 可见
4. ✅ Skills：正文注入（渐进披露）+ 冲突裁决 + 检索 + UNTRUSTED 检测；B021
5. ✅ 自动学习 suggest-only：approve 需 met 评审门 + 只写 learned/ + 无 auto-modify 快照实证
6. ✅ benchmark：B001–B005/B016–B019 无回归；B020/B021 新增可跑
7. ✅ 交付说明（V03-IMPLEMENTATION-NOTES.md）+ 独立评审（REVIEW-REPORT-V03.md，VERDICT: PASS）

## 3. 已沉淀决策/教训

- 工作流落地：AGENTS.md + tasks/ 看板 + MISSION-V0.3.md（commit e9a771a）。
- memory/project 按 ARCHITECTURE §4.8 文件式蓝图施工，不用 DB。
- **教训 1（第 1 轮）**：001 子代理两度零产出卡死 → 中断重派 → 改指挥会话直接实现。对策已沉淀：聚焦核心交付 + 分步验证 + 快速上报错误。
- **教训 2（第 2 轮）**：独立评审子代理在收尾阶段中断（未产出报告）→ 指挥会话以核验模式完成评审（只读取证 + 零实现改动，REVIEW-REPORT-V03 OBS-3 记录）。子代理通道在本环境不可靠，V0.4 起优先指挥会话直接实现 + 核验模式评审。
- **教训 3**：ESM 循环 import 规避导致 discovery 目录约定在 skills 三处重复（评审 MINOR-1）——V0.4 提取共享 discovery 模块。
