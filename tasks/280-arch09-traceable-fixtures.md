# 任务卡 280: ARCH-09 的可追溯 fixture 矩阵与全量门禁收口

**状态**: 待执行（等全量门禁与 bench 复跑后填 Result）
**创建时间**: 2026-10-23
**执行者**: OpenCode（协调者自己验证）
**协调者**: OpenCode

---

## 1. 背景

评审矩阵把 ARCH-09 记为「部分实现」，缺的是**可追溯性**，不是功能：

> 未找到满足规范矩阵的回溯（启动成功、任务删除、adapter 不存在、未知写入不重放、协议），
> 统一 10–20 场景可追溯黄金 fixture 的当前达成；当前 Web 单测图 exit 1。

三件事现在都变了，需要重新取一次证据，而不是继续沿用旧结论：

1. 卡 274 已交付 `npm run bench:reliability`：**14 个 fixture / 7 个类别**
   （retry、crash、soft-delete、adapter-unavailable、unknown-tool、event-replay、capability-negotiation），
   每个 fixture 指向一个具体测试文件与标题——这正是规范要的「10–20 场景可追溯」。
2. 「Web 单测图 exit 1」是当时的现场；当前 `test:web` 全绿（57 文件 / 488 通过）。
3. 全量门禁由协调者执行（`npm run test:all` 两个 root），不再受「用户禁止 test:all」约束。

## 2. Goal

用当前代码重新生产这三类证据，并把 ARCH-09 的剩余缺口如实收敛或标注。

## 3. Acceptance Criteria

1. `npm run bench:reliability` 在当前 HEAD 上 exit 0，输出 14 fixture / 7 类别的实测结果（落盘日志）。
2. `npm run bench:conformance`（离线车道）exit 0，记录场景数与通过数。
3. `npm run test:all` 两个 root 的实测数字落盘，且在最后一次编辑之后。
4. 复核 14 个 fixture 指向的测试文件**真实存在且仍在跑**（不是陈旧指针）。
5. 在卡里给出「规范要求 → 当前证据」的逐项对照，明确哪些条目仍未闭环及其原因。

## 4. Not Doing

- 不新增 fixture 充数；缺什么就如实写缺。
- 不动 ARCH-04（需要用户授权调用本机其他 CLI）与 ARCH-07（安全口径取舍，需用户拍板）。
- 不重写 benchmark 规范文档。

## 5. Blast Radius

只读验证 + `tasks/README.md` 与评审报告的状态行；不改产品代码（除非证据显示 fixture 指针失效）。

## 6. Result

（待填：跑完 `bench:reliability`、`bench:conformance`、`test:all` 后写入实测数字与逐项对照。）
