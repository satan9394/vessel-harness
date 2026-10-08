# Epic 191 最终交付工作证明

日期：2026-10-08（America/Los_Angeles）。仓库：Vessel_Harness，本地 `main`，基线 `7f2f2b6`。最终结论：**Epic 191 功能与人类批准的新 DoD 验收 PASS**，188/189/190 完成，性能阻断已解除，五项最终机械门禁全部 exit 0；历史执行偏差明确保留，不声明历史红线全部遵守。

## 人类批准的验收契约

2026-10-08 人类明确批准：保留每次实时内容/mtime、精确 Git 补丁字节、staged/untracked、忽略规则与目录边界；50 文件 fixture warm ≤50ms；当前全仓 ≤2000 文件规模 cold ≤1500ms、warm p95 ≤1000ms。此批准替代原 <25ms，任务 190/191 DoD 已更新；旧失败记录不删改。

计时覆盖整次 `WorkspaceFingerprinter.compute()`，包含遍历、内容读取、哈希和 Git。首次调用作为 cold，之后 10 次作为 warm，nearest-rank p95；fixture 全部 warm 样本最大值 ≤50ms。性能与构建/测试串行，禁止陈旧跨调用结果缓存。

## 实现与逐项证据

| 要求 | 实现 / 证明 |
|---|---|
| canonicalJson、stableStringify 深排序与请求确定性 | `packages/llm/src/canonical/`；OpenAI/Anthropic/OpencodeGo 请求与工具参数边界接线；phase188 专项/架构修复日志、final-independent-review 的既有修复复核 |
| TripartitePrefixBuilder 与稳定前缀 SHA-256 | `packages/context/src/builder/`；stable/scoped/volatile，项目和反思快照；父/隔离 runtime 接线及相应回归 |
| 意图边界压缩守卫 | `packages/context/src/compaction/`；turnIndex=0、无 active microturn、无当前待响应调用；72 专项与生命周期独立最终复核 |
| Anthropic/OpenAI/DeepSeek 缓存计量 | `packages/shared/src/cacheMetrics.ts` 与 llm stream/discovery；实际 provider/model 身份、明确测量的分母，缺失缓存价保守估算 |
| CacheDriftDetector 与持久化投影 | llm detector、application UsageProjection 与 model/usage、audit/cache_drift 记录；投影专项与独立审查修复复核 |
| CLI / Web 缓存与费用展示 | CLI `usage --cache`、UsageStore/recompute；Web UsageBar/TalkingMetricsBar 与 server-priced 单次 SSE；根/Web 专项与最终双 Root 回归 |
| 实时指纹与安全边界 | `packages/tools/src/filesystem/workspaceFingerprint.ts`；同 mtime 内容改写、binary patch、staged/deleted/untracked、nested ignore 与 parent junction 回归 |
| 默认三轮停滞 / 同类错误熔断 | tools 状态机、engine 导出和停止结果、application/IsolatedRuntime；audit/stagnation_break 持久化后中断，无自动重试 |
| 中断生命周期 | 迟到工具 generation fence、DENIED 原安全熔断优先、同 attempt/turn 的 abandoned 调用核算；`lifecycle-independent-revalidation.md` 最终段无剩余阻断 |
| SQLite 既有 <5ms 回归 | 新鲜 JSON 页面传输，REAL/unsafe INTEGER 原生回退；10 / 22 专项、`sqlite-page-independent-review.md` 最终数值兼容发现已关闭 |
| core 不改、npm 锁文件不变体系、无新增第三方依赖 | `accepted-core-diff.txt` 为空；context/agents 内部 workspace 依赖及 package-lock 同步；此前保留旧 node_modules 后 npm ci exit 0 |

## 最终门禁

| 命令 | 原始记录 | 状态 |
|---|---|---|
| `npx tsx scripts/bench-workspace-fingerprint.ts .` | accepted-final-fingerprint-benchmark.log | exit 0；fixture warm max 42.5767ms；1739 文件 cold 905.8525ms、warm p95 673.4129ms |
| `npx tsc -b tsconfig.json` | accepted-tsc.log | exit 0 |
| `npm run typecheck:tests` | accepted-test-types.log | exit 0 |
| `npm run -w @vessel/web build -- --emptyOutDir false` | accepted-web-build.log | exit 0 |
| `npm run test:all` | accepted-test-all.log | exit 0；根 236 文件 / 2634 passed / 6 skipped；Web 20 文件 / 177 passed；合计 2811 passed / 6 skipped |
| Git Bash `scripts/identity-guard.sh` | accepted-identity.log | exit 0；历史提交身份无 denylisted 命中 |

本次接受标准使用真实本机工作负载，不能推导任意文件大小、任意硬件或无界仓库的通用时延保证。此前 <25ms 失败事实保留。

初次新契约性能通过记录为 `accepted-fingerprint-benchmark.log`：fixture warm max 42.9798ms；1726 文件 cold 644.2333ms / p95 651.2598ms。最终复核在交付文件收齐、机械门禁进程全部结束后串行执行，覆盖新增证据文件后的完整工作区，使用上表最终数值；两次真实记录均保留。

## 改动文件与独立评审

完整工作区清单：`accepted-worktree-inventory.txt`；tracked diff：`accepted-tracked-diff-summary.txt`。清单含起始人类既有 AGENTS.md、DEV_LOG.md、HANDOFF.md、tasks/README.md 变更及 V2.0 文档，不全部归因本 Epic。

实现覆盖 llm/context/shared/tools/engine/agents/application、CLI/server/Web 与对应测试；配套 event/pricing 文档、任务卡与交接记录。当前闭环新增的是人类批准的 DoD、benchmark 可失败退出的验收逻辑和交付记录；同步读取试验已完全撤回。

独立复核：`final-acceptance-independent-review.md` 确认新 benchmark 契约与通过值，既有具体代码发现均关闭；最终机械门禁以 root 完成日志为准。

终态进程 session 47315 已结束 exit 0；所有验证进程结束，没有待重启的 gate。最终 source 编辑后依次执行构建、测试类型、Web 构建、双 Root 回归和身份守卫，期间未修改运行时代码；之后仅同步交付文档。`git diff --check` exit 0。

## 历史偏差与本地状态

189 执行器三次默认 Vite 构建清空并重建生成 `apps/web/dist`，违反当时删除纪律。这是已披露的历史执行偏差，当前构建均使用 `--emptyOutDir false`，不声明历史红线全部遵守。旧失败、偏差和实验日志均保留；没有本 Epic 的 git commit、push、publish 或真实外部 agent 调用。现有改动留在本地工作树，交付不自动提交。

下一步：本 Mission 已结束，等待人类新任务或明确的本地提交指令；不自动续卡。
