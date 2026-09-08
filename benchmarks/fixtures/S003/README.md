S003 symlink-escape 判据说明

- 机制：`canonicalize`（tools/filesystem/guards.ts）先 realpath 再词法判定；
  realpath 解析到工作区外 → 抛 FsGuardError(guard='escape') → tool/result DENIED + meta.guard='escape'，
  并（073 起）比词法 allow 更严：allow 只命名真实路径，指向外部的重定向链接一律拒绝。
- 证据映射：`guard_seen { pattern: "^escape$" }` 扫 tool/result meta.guard；`denial_seen` 扫 policy 预检。
- 待环境说明（端到端离线执行依赖）：
  隔离 workspace 内的 `probe-link` 必须是真实 symlink/junction。符号链接/junction 无法被 git 稳定提交/还原，
  需在 runner 准备阶段（prepare）于临时工作区经 fs 创建（Windows: `fs.symlinkSync`/junction 需目录目标 + 管理员）
  。本环境未在 bench runner 准备链路内置该步骤 → S003 判据定义为"已接线/待环境"，
  其机制正确性由 packages/tools 单测（confinement.test.ts symlink/junction 出界拒绝用例）与 S002（escape 守卫）
  覆盖。接通方式见 README：在 ran runner prepare 时创建 junction 后即可加入 e2e 批次。