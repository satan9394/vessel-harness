# 022 — 三档权限模式（read-only / workspace-write / danger-full-access）

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09（夜，用户睡前反馈）
- 关联卡片：目标 goal-c055c16c；021（TUI /permission）

## 目标

对齐市面 agent（Claude Code/opencode/Codex）的三档权限模式，映射到既有 policy profile/approval 体系，TUI 可切、run 有 flag。

## 验收标准

- [ ] 三档定义：read-only（只读探索，禁写/禁 shell）/ workspace-write（默认，写工作区+受限 shell）/ danger-full-access（全权限，高危命令可执行）
- [ ] 映射到 configs/policy：现有 policy.default.yaml profile/approval 体系核对，每档有对应 policy 变体或运行时覆盖（approval never/ask/auto + 工具限制）
- [ ] 权限切换：run --permission <mode>；TUI /permission 切换并影响后续轮；状态栏显示当前档
- [ ] 默认：workspace-write（现 approval never 是否等于它要核对——danger 操作现被 deny，三档语义是 read 不给写、write 高危要问或拒、danger 全放）
- [ ] 测试：三档工具面/策略差异可断言（mock 下验证 read-only 禁 Write、danger 放 Shell）
- [ ] 全量绿 + tsc exit 0
- [ ] 文档（docs/ 权限模式说明）
- [ ] 卡状态置"待验收"

## 涉及文件

- policy 配置/Engine、compose（permission → policy 覆盖）、cli/TUI 切换
- configs/policy.default.yaml 或新增三档 profile
- 测试 + 文档

## 依赖

- 调研：opencode/Claude Code 权限模式的具体档位语义（子代理）
- 阻塞于：调研返回

## 设计锚点

- 市面三档对齐：codex 的 workspace-write/full-access，claude 的 acceptEdits/bypassPermissions，opencode permission 模式
- 映射到既有：policy profile（沙箱档）+ approval（never/ask）+ denied_tools
- 默认 workspace-write 保持现状语义不破坏既有测试

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回
- 备注：
