仓库 C:\work\Vessel_Harness（TypeScript monorepo，Vitest）。

任务：修掉一个"看起来在执法、实际从不拦"的死规则。

已实测的事实（先自己复现确认，不要照抄）：packages/policy/src/risk/Compiler.ts 约 976-984 行把 policy 的 network.deny_domains 编译成 id 形如 "net-deny:<domain>" 的规则，但它的 match 恒为 false（match: () => false）。我用 compilePolicyYaml 编译一份含 network.deny_domains: [169.254.169.254] 的声明复现过：ruleCount=1、id="net-deny:169.254.169.254"、reason="denied domain: 169.254.169.254"，而 match() 对以下调用全部返回 false：Shell{command:'curl http://169.254.169.254/latest/meta-data/'}、WebFetch{url:'http://169.254.169.254/x'}、以及不含该地址的调用。也就是说：声明存在、规则存在、理由存在，而拦截从不发生。

硬性要求（这是本次任务的核心）：
1. 先复现：写一个最小脚本或测试，把上述事实跑出来（把 match 全 false 的证据留在回复里）。
2. 修复方向必须"诚实"，禁止伪造执法：不允许把 match 改成基于调用参数文本的启发式匹配（本 harness 根本没有任何网络工具，凭 command 里是否出现域名去拦会误拦正常内容，并制造"已经在拦"的假象）。正确做法是让"声明"与"执法"在数据结构上可区分：例如给编译产出的规则加一个显式标记（如 enforced: false / declarationOnly: true，或让 match 成为显式的 never-match 并带说明），使任何消费方能分辨"已声明但 v0.1 不执法"与"已执法但不匹配"。具体形态由你设计，但必须满足：消费方不可能把它误当成有效执法。
3. 同步"说的与做的"：规范与文档里凡是暗示域名级 deny_domains 会被运行期执行的地方，改成如实表述（v0.1 是声明式，真正生效的是 profile/approval 门禁；proxy 级执法是 v0.2）；请查 docs/ 下的权威文件（至少 docs/POLICY-SPEC.md、docs/EVENT-SPEC.md、docs/ARCHITECTURE.md）。
4. 双向验收（缺一不可，必须有判别性测试）：
   - 反向：一个真正生效的拒绝机制仍然生效（例如 profile/approval 门禁：workspace-write 下的 Shell 需要 danger-full-access 而 approval=never 时被拒，铸出 audit/denial；或既有的 force-push deny 规则）——你的改动不得削弱它；
   - 正向：域名级声明规则被明确标为"未执法"，且有测试锁住这个标记（删掉标记/改回旧的恒定不匹配形态 → 该测试必须红）；
   - 不得过度拦截：不得出现"因为命令里出现某域名就被拒"的行为。
5. 项目铁律：所有删除必须进回收站（用 Microsoft.VisualBasic.FileIO.FileSystem 的 DeleteFile/DeleteDirectory 配 SendToRecycleBin），禁止任何永久删除或绕过回收站的删除方式；不得做无关重构。

你必须自己运行验证并在回复里给出真实输出：
- npx tsc -b tsconfig.json（期望无输出/0 错误）
- 你新增或修改的测试文件（npx vitest run <该文件>）
- 最后跑一次全量 npx vitest run（当前基线是 140 文件 / 1670 passed + 6 skipped / 0 failed，不得回归）

回复格式（简洁，直接给证据）：
A. 复现结果（match 全 false 的原始输出）
B. 改动文件与行号 + 你选择的"可区分"设计形态与理由
C. 双向验收的测试名 + 判别性说明（删掉哪一行会让哪条测试变红）
D. tsc / 定向测试 / 全量测试的真实输出摘要
E. 未做到或只报告的项
