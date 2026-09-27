## 关联任务卡

<!-- 一张卡一个 PR。写卡号，例如 tasks/168-desensitize-and-public-hygiene.md -->

## 改了什么

<!-- 只写事实与范围，不要写"优化了代码质量"这类无法核对的话 -->

## 门禁证据

必须是在**最后一次编辑之后**跑出来的结果（贴关键输出，不要只写"已通过"）：

- [ ] `npm ci` — exit 0
- [ ] `npx tsc -b tsconfig.json` — exit 0
- [ ] `npm run typecheck:tests` — exit 0
- [ ] `npm run test:all` — 双 root 全绿（根 + `--root apps/web`）
- [ ] `npm run -w @vessel/web build` — exit 0
- [ ] 新增/修改行为有对应测试；无回归

## 纪律确认

- [ ] 未做任何永久删除（仓库内一律回收站；唯一例外是测试自建且位于 `os.tmpdir()` 下的临时目录）
- [ ] 未 force push、未改写已推送历史（脱敏例外需维护者显式授权并记录决策）
- [ ] 未引入 pnpm/bun/yarn 锁文件（本仓锁定 npm）
- [ ] 未复制其它 harness 的源码（clean-room），外部研究资料未直接进 System Prompt
- [ ] 未在自动化测试里调用本机 `dsh` / `opencode` / `codex` / `claude` / `pi`

## 文档同步

- [ ] `CHANGELOG.md` 记录用户可见的变化
- [ ] 会约束未来的决策已进 `docs/DESIGN-DECISIONS.md`（追加新编号，不改写旧条目）
- [ ] 规范变化已同步对应 `docs/*-SPEC.md`
