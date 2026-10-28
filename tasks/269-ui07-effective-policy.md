# 任务卡269：UI-07当前生效Policy只读汇总

**状态**：已验收（2026-10-26 对账；原「待协调者验收」，依据见 [卡 340](340-board-backlog-closeout.md)）

## Goal

将Agent Studio的当前生效安全策略与候选行为配置分区展示，提供会话绑定、来源、强制程度及未执法/读取失败原因。

## Existing Classification

部分实现：卡242已把Composer标为候选验证/未激活；BehaviorInspection展示行为层级和映射。SessionController.policyArtifacts已有实际生效策略副本，但尚无独立Policy DTO/API/UI；Policy来源在loadPolicyArtifacts编译后未保留。复用现有装载/编译与会话实例，不读取当前磁盘文件冒充已绑定快照。

## Not Doing

不提供策略修改或激活，不改安全执法，不改packages/core，不重编译候选作为有效配置，不commit/push、不跑test:all、不动用户会话。

## Acceptance

只读API从所选会话真实PolicyArtifacts投影并记录加载时来源；与候选配置验证互不影响。UI展示profile/approval、规则/工具拦截/文件守卫、soft guidance和未执法声明及原因，不把声明伪报为已执法。禁止写请求和跨源；切会话不显示旧结果。加载后改源文件不改变已绑定显示。有针对测试、六项指定门禁及IAB真实模型会话证据。

## Blast Radius

shared只读Policy快照契约、policy装载来源、application插件来源与SessionController副本、local-server只读投影、Web Studio汇总与关联测试。core零改动。

## Expected Evidence

确定性来源/候选隔离/权限测试，六项退出码与浏览器截图，统一修复报告。

## Result

当前会话Policy只读汇总、加载时来源与强弱执法边界已实现。六项指定门禁exit 0，真实模型历史会话IAB显示与API快照一致。详情及回滚边界见[修复报告](../evidence/sessions/2026-10-23-fix-wave-report.md)。
