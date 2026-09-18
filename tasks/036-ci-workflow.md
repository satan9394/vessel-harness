# 036 — CI（Windows + Linux GitHub Actions + package smoke）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：docs/V1.0-CHECKPOINT.md Milestone A（294c905）。
- 优先级：P1（Milestone A 收尾；路线 §十六 V0.10 任务 9）
- 创建日期：2026-09
- 关联：路线卡 036；goal（V1.0 产品化）

## 目标

GitHub Actions CI：Windows + Linux 双平台跑 build + test + package smoke，保证 clean clone 可复现（路线 §V0.10 验收链）。

## 验收标准

- [ ] `.github/workflows/ci.yml`：workflow
  - 触发：push / pull_request
  - 矩阵：windows-latest + ubuntu-latest（node 20 或 22）
  - 步骤：checkout → setup-node（cache npm）→ npm ci → npm run build（tsc -b）→ npm test（vitest run）→ package smoke（node apps/cli/dist/cli.js --version + run --prompt "你好" mock）
  - 条件性：Windows 全跑；Linux 若某些测试平台相关（如 DPAPI/powershell）可设 skip 或 continue-on-error（在 workflow 注释说明）
- [ ] 本机预验证 workflow 逻辑（无法真跑 Actions——用同一命令链在本机跑一遍留证：npm ci（或 npm install）→ build → test → smoke；注意不提交 node_modules）
- [ ] 全量 vitest/tsc 绿（337+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `.github/workflows/ci.yml`
- 若需根 package.json scripts 已有 build/test；无需改

## 依赖

- 无（独立）

## 方法

- actions/checkout@v4 + actions/setup-node@v4（node 22）
- npm ci（用 lockfile）；npm run build；npm test
- smoke：`node apps/cli/dist/cli.js --version` 断言含 Vessel CLI；`node apps/cli/dist/cli.js run --prompt "你好"` mock 冒烟
- 平台差异：Windows 沙箱相关测试可能 flaky——Linux 可跑全量，Windows 也全跑（本仓库 Windows 为主环境应过）；若某个包测试平台相关加 continue-on-error 注释说明

## 工作证明（执行器回填）

- [ ] workflow 文件 / 本机同命令链验证输出

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：