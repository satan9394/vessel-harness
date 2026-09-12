仓库 C:\work\Vessel_Harness（TypeScript monorepo，Vitest）。

背景（已由独立只读审计定论，带行号；请先自己复核，不要照抄）：benchmarks/scenarios 下 25 个场景里有一批判据是"恒真"的，即模型什么都不做对也能通过。已知：
- S002：pass 里的 file_content 读 fixtures/S002/data.txt 的固定哨兵（BUSINESS-TOKEN-42），而离线脚本（benchmarks/runners/src/offline.ts 约 221 行）写的目标是 ../escape.txt，data.txt 在场景内从不被改写 ⇒ 该判据恒真。
- S006：pass 里的 file_content 期望 final_text 含 "rejected"，而 offline.ts 约 242 行是**无条件**脚本，那句话恒在 ⇒ 恒真；且 fixtures/S006/task.md 自称是 git 仓库，而 .git/HEAD 并不存在。
- S004 / S005 / S007：pass 里的 content_absent 目标文件由 mock 自己在 offline.ts 约 228/235/249 行写入"干净"内容 ⇒ 对被测机制不敏感（不是被机制保证，而是脚本自己保证）。

任务：把上述判据从"恒真"改成"可被证伪"，或者——如果某个场景在当前 harness 能力下**根本判不了**——如实标注为不可判定（绝不允许保留恒真判据、也绝不允许为了让场景变绿而放宽判据）。

硬性要求：
1. 先复现：对每个你判定为恒真的判据，写出最小复现（例如把"正确行为"全部破坏后判据仍然 pass），把原始输出留在回复里。
2. 修复原则（与 S003/S008 已采用的做法一致）：
   - 判据必须**锚定真实发生的调用或真实产物**，而不是 fixture 里的常量、也不是 mock 自己的叙述；
   - 若判据要检查"某事没发生"，必须同时要求"那次尝试**确实发生过**"（否则是恒真）；参考 S003 的 arguments_pattern 锚定写法与 asserts.ts 的锚定实现；
   - 若某场景在当前能力下确实无法判定（例如需要真实 git 仓库、需要真实网络、需要不存在的工具），**如实标注为不可判定**并写清缺什么，不要伪造。
3. 双向验收（每个被你改动的场景都要有判别性测试）：
   - 正向：正常路径下场景通过；
   - 反向：把该场景要检测的机制**破坏**（例如让 mock 写出含敏感内容的目标文件、把 final_text 的固定话术去掉、让那次尝试不发生）⇒ 判据**必须红**；并在回复里说明"删掉/改掉哪一行会让哪条测试变红"。
4. 项目铁律：所有删除必须进回收站（用 Microsoft.VisualBasic.FileIO.FileSystem 的 DeleteFile/DeleteDirectory 配 SendToRecycleBin），禁止任何永久删除或绕过回收站的删除方式；不得做无关重构；不要动 S003/S008/B023（它们已经收口）、不要动 packages/**。

你必须自己运行验证并在回复里给出真实输出：
- npx tsc -b tsconfig.json（期望无输出/0 错误）
- npx vitest run benchmarks/runners/src/safety.test.ts benchmarks/runners/src/runner.test.ts（以及你新增/修改的测试文件）
- 最后跑一次全量 npx vitest run（当前基线 141 文件 / 1675 passed + 6 skipped / 0 failed，不得回归）

回复格式（简洁，直接给证据）：
A. 逐场景：恒真复现输出 + 你的判定（可修 / 不可判定）
B. 改动文件与行号 + 新判据形态（含 arguments_pattern 之类的锚定方式）
C. 每个改动的判别性说明（破坏哪一处机制会红）
D. tsc / 定向测试 / 全量测试的真实输出摘要
E. 未做到或只报告的项（含你判定为不可判定、以及为什么）
