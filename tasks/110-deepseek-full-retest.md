# 110 — deepseek-flash 全场景集复测（线协议修复后终对比）

- 编号：110
- 状态：待执行
- 优先级：P0（兑现 108 未竟目标：线协议修复后 deepseek 全场景收敛对比）
- 创建日期：2026-09-10
- 关联：109（9ec20df：线协议修复，B001/S001 真实 passed）；108（087977c：线协议阻塞时的对比，恒 0/10）；
      102（mimo-v2.5 基线）；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

线协议修复（109）后，deepseek-flash 已能真实跑通（B001/S001 通过）。本卡做**全场景集 × 1-2 次复测**，
产出与 mimo-v2.5 的**终对比**（收敛稳定性/通过率/工具链行为/usage），并给出**是否把 lane 默认模型从
mimo-v2.5 换成 deepseek-flash 的建议**（建议由指挥/用户拍板，本卡不改默认）。

## 前置事实（勿重复摸索）

- key 在 CredentialStore（105，`same=true`）；`--key-source=store`；输出只许指纹 sk-8Dl…
- 端点 /zen/go/v1，DeepSeek 走 /chat/completions，需 x-opencode-session（103 SSOT 已就绪）
- 109 已修线协议：assistant tool_calls 投影 + reasoning_content 回传（chat+流式）
- 102 mimo 基线：`benchmarks/reports/real-model-lane-1788964714845.md`（9/1）等，mimo 长工具链偶发不收敛
- 108 报告：`benchmarks/reports/real-model-lane-1789037140071-deepseek-flash.md`（修复前 0/10）
- 109 报告：`benchmarks/reports/real-model-lane-1789040766242.md`（修复后 B001/S001 pass）

## 验收标准（执行器逐条勾选）

- [ ] 跑 082 lane 全场景集（同 108 的子集：B001,B002,S001-S008 等）用 deepseek-flash × 1-2 次（跨次稳定性，
      若有失败场景重跑 1 次判断是否偶发）
- [ ] 产出 `benchmarks/reports/real-model-lane-<ts>-deepseek-final.md` + gate 4（judgeRealModelLaneWithNonConvergence）
      pass/pending 如实标注（不伪造）
- [ ] **终对比表**：deepseek-flash(final) vs mimo-v2.5（通过率、失败模式、finalText、工具步数、usage、耗时、
      跨次稳定性）——mimo 数据取 102 报告，不重跑 mimo（省配额）
- [ ] **换默认建议**：对比结论 + 明确建议（换/不换 + 理由）；**不改 lane 默认**（拍板权在用户）
- [ ] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1166+ 无回归）+ web 82
- [ ] 文档同步（REAL-MODEL-LANE 终对比节）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做真实对比 + 报告 + 建议。不改默认模型/判据/协议；不做 UI；不加依赖。
- 配额最小化：全场景 ×1（失败场景补跑 1 次）；不重跑 mimo。
- 密钥不落盘；报告不含 key。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（082 lane + run-opencode-lane.ts，109 已可跑 deepseek）
- `benchmarks/runners/src/release-gates/`（084 gate 4）
- 报告：`benchmarks/reports/real-model-lane-*.md`
- 对比源：102/108/109 报告

## 方法

- 全场景集 ×1（失败补 1 次）→ 报告 + gate 4 → 终对比表 → 建议 → 文档

## 工作证明（执行器回填：全场景结果表/跨次稳定性/终对比/gate 4/建议/命令输出/测试结果，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：