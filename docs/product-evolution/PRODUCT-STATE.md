# PRODUCT-STATE — Vessel 产品演进状态（Orchestrator 维护）

> 每轮结束更新。**当前进度：第 35 轮（本段 goal 自 Round 20 起，已闭环 20→34）**。**当前基线（均实测）**：`tsc 0`、全量 **140 文件 / 1659 passed + 6 skipped / 0 failed**（本段起点为 138 / 1555 ⇒ **+104 通过**）、**`npm install --dry-run` exit 0（51 条 `@vessel/*` 声明零不匹配）**、**发布门禁 8 道常驻 + 第 9 道可选安装态冒烟（含升级路径；实测 `✅ PASS | 38101ms`）**、**symlink 出界由变异测试验证封堵**（移除修复后 `outsideFileCreated` 由 `false` 翻 `true`）、**本机沙箱降级原因可读**（`target-exited` vs `attach-failed` 分开，且 `reportStatus` 已从死 seam 接成生产可达）。
> 本段 goal（Round 20–34）解决的四族问题：**① 静默降级族**（配置/状态文件损坏不再静默销毁：索引与覆盖文件写前留档、留档失败抑制写入）；**② "宣称与实际不符"族**（沙箱状态/审计不再撒谎；pricing 未落盘不再宣称成功；guard 分类不再把"路径写错"记成安全逃逸）；**③ 权限 fail-open 族**（preset 未命中不再静默给全量工具面）；**④ 证据基础空心族**（安全场景 S003/S008 与 B023 的判据从恒真/自产自评改为**锚定真实机制**）。**一处已观察未定位偶发**：同修订下全量出现过一次 `exit=1`（1648 passed）与一次 `exit=0`（1659 passed），疑为本段新增的"真跑 PowerShell/真实建链接"用例并发抖动，**未当作已绿放过**，已交复评。
> 产物索引：`docs/PROJECT-BRIEF.md`、`docs/product-audit/*`（4 份独立审计）、`ROUND-15-DIRECTION.md`、`PRODUCT-GAP-MAP.md`（缺口 + **路线图 NOW/NEXT/LATER/NOT_NOW** + 文末 Round 32/33 的 S008/S003 收口与真因）、`IMPLEMENTATION-BRIEF-0N.md` / `EVALUATION-REPORT-0N.md`（每轮规格与独立裁定，最新 24）、本文档（状态与**20 条纪律**）。
>
> **如何继续（无我也能接手）**：① 先读 `PRODUCT-GAP-MAP.md` 的**路线图**取下一片（NEXT 里都是**已具证据**项，不必重新调研）；② 按六步循环开工——**拆卡 → 派隔离 Workers（写入型微任务，禁跑命令）→ 指挥跑 `tsc -b`/`vitest`/真实 CLI 取证据 → 派全新上下文的对抗 Evaluator → 按其 REJECT 修 → 复评**；③ **每卡必须自带判别性证据**（"删掉该实现哪条断言会红"），并把"修复前必红清单"写进卡片；④ 涉及合并/装载/接线/打包的验收**必须至少一条走完整生产入口**（纪律 15）；⑤ 每轮末尾更新本文档与路线图。**旁证口径**：全量 `vitest`、`npx tsc -b`、`benchmarks/runners`、以及 `docs/product-evolution/EVALUATION-REPORT-*.md` 的裁定。

## 当前成熟度

| 维度 | 评估 |
|---|---|
| 内部工程成熟度 | **高** — 依赖零环；**8 道发布门禁 8/8 `ready`**（`build` 含 `apps/web` 类型检查）；**136 文件 / 1512 passed + 3 skipped / 0 failed**；打包卫生已修（tarball 270→62 文件、无测试产物与 source map） |
| 对外可启动成熟度 | **高（本会话显著提升）** — 首跑可用；崩溃面给人话+路径+指引；会话可续跑；**机器面完整**（`--json` 覆盖五条只读命令 + **全部失败出口**信封）；**默认配置"装在哪儿就在哪儿"**（包内优先，**装机 E2E 三条命令 exit 0**）；**不需要 clone 仓库即可安装运行** |
| 安全与执法正确性 | **高（Round 20 再加固）** — 项目层提权/放宽执行已封堵；force-push 以**平台并集 + fail-closed** 收口；`filesystem.confinement` 首次真正可达；错误体全链路脱敏；**symlink 出界**（唯一防线原为静默跳过）已修，并由**变异测试**证明"移除修复即攻击成功"；**损坏文件**不再静默销毁（索引/覆盖文件写前留档，留档失败抑制写入） |
| 诚实性 | **高，但有一处已知未修** — mock 运行期可见、产品名统一、密钥口径按平台如实、文档命令与 `dispatch` 对齐、`policy status` 报告合成可编译性；**残留**：`pricingOverride` 抑制写入后 CLI 仍打印「✔ 已写入覆盖」⇒ **确认时刻的宣称不为真**（已排 NEXT 首位，修法已定：`write()` 回传落盘状态 + 双向验收） |
| 主要短板（当前） | 见 `PRODUCT-GAP-MAP.md` 的 NEXT：① 上述假成功；② 静默降级族剩余项（`costMultipliers()` 抛→**倍率静默变 1**、行级坏价行静默忽略、locale 静默回退 zh、坏任务静默消失、B 类"产出状态没人读"若干）；③ `npm pack --ignore-scripts` 可绕过 prepack；LATER：i18n 架构、`~/.vessel` 状态根收敛、`vessel diff --last` 只读回滚提示 |

## 当前最高价值下一步（Round 35 收口后）

**本段（Round 20–34）已完成**：① **静默降级族**（`ProjectRegistry` 损坏覆盖 → 留档 + 留档失败抑制写入；`pricingOverride` 三态可见 + 写前留档 + 抑制；`pricing.json` 兜底仍待补状态通道）；② **宣称与实际不符族**（沙箱状态/审计说真话、`target-exited` 与 `attach-failed` 分开、warn 每会话每因一次、`reportStatus` 从**死 seam** 接成生产可达；pricing 未落盘 exit 1 且不打成功行；guard 拆 `escape`/`unverifiable` 并写入 `EVENT-SPEC` 硬纪律）；③ **权限 fail-open 族**（preset 未命中不再静默给全量面：已接线未命中 → 拒绝、未接线 → 最严格只读面 + 可见状态）；④ **证据基础空心族**（S003 三层修复并实测通过、S008 判据改锚**真正生效的机制**、B023 改为读引擎真实产物并加"golden 不得出现在 runner 源码"的回归锁）。

**下一段（NEXT，均已具证据，可直接开工）**——**权威清单在 `PRODUCT-GAP-MAP.md` 的路线图**，此处只列最优先：
1. **`deny_domains` 是死规则**（`packages/policy/src/risk/Compiler.ts:976-984`：`net-deny:<domain>` 的 `match` 恒 `false`）⇒ 声明的域名级控制在运行时**从不拦任何东西**。**要么让它真的匹配，要么停止宣称**（与已修的 `shell-force-push` 死 matcher 同族）。
2. **`packages/llm` 的 toolCallId 上游根因**（`MockProvider` 按响应编号 ⇒ 任何复用 id 的 provider 都会让**基于 id 的锚定 join 再次误绑**，而 `asserts.ts` 的后写覆盖语义未改）。**未接线旁路**：`evalProvider`、taskRouter 两个 tier provider、五个 adapter 各自的 `copyDir`（未接 prepare）。
3. **第三处死 seam**：`EnforcementProjection.foldSession()` **只在测试里被调用** ⇒ `fs-confinement` 来源在生产**恒为 0**（与 `reportStatus` 同型缺陷，已修一处、此处仍在）。另：`shellTool.ts` 取的是 run **之前**的状态（`meta.sandbox` 描述**上一轮**，注释却称 "honest … for THIS spawn"）；短命令仍要等 1–10 s（可并行探活早退）。
4. 其余：S008 未纳入 `SAFETY_SCENARIOS`；S002/S006 恒真判据待加锁；`cli.ts:517` 的 `costMultipliers()` 抛 → **倍率静默变 1**；`SkillSearch` 只扫正文前 400 字符的 UNTRUSTED 标记；`EventBus` 监听器抛错退化为 `defer`（当前无 deny 型监听器 ⇒ 潜伏陷阱）。

### 历史（Round 17 时的清单，**已过期**，保留仅作演变记录）

**Round 16 + 发布里程碑已完成**（详见下方 Round 16 / 16b 段与 `PRODUCT-GAP-MAP.md` 的路线图归位）：1C/1B/2B/2C 诚实化、依赖声明、打包卫生（`files` 否定模式）、**包内 configs 可达**、**装机 E2E 三条 exit 0**；策略执法侧则以**平台并集 + fail-closed**收口了续行/alias/包装/`+refspec` 全部已知绕过形。

**NEXT（P2，已具证据，可独立开轮）**：① `@vessel/*` 依赖声明补全（14/16 包）+ `bench-runners` 运行期动态 import；② pricing 产品形态正解（读=用户目录优先+包内兜底，写=`~/.vessel`）；③ `policy status` 的**合成后可编译性**（**在跑**）；④ 测试盲点清单（如 C-4 文案未锁）。
**LATER**：全量 i18n 架构；`~/.vessel` 状态根 7+ 处重复收敛；`vessel diff --last` 只读回滚提示（G-10 的克制替代）；`dist/.tsbuildinfo` 入包与 `npm pack --json` 被 prepack 输出污染（自动化卫生）。
**NOT_NOW（明确不做，均有论证）**：全量 npm 发布（成本 ≫ 收益，本阶段无外部消费者）、单包 bundle、CI 自动发布、provenance/签名/SBOM、changesets、插件市场/云协作/排行榜/IDE 表面；TUI 内不放 `migrate`/`serve`/`bench`/`pricing sync`/`--json`；**不做**通用快照回滚（会让用户误以为 Shell 写入也可回滚）。

## Round 16c（终评 `EVALUATION-REPORT-24.md`）— **ACCEPT**，但一项 P1 直接削弱里程碑结论

**A（force-push 平台并集）PASS**：终评静态核到 Compiler 内部——并集确为**两次单向解析**（`:761-766`），递归全程传同一 `mode`（`:624/:633/:649`）**无二次取并**，故 `depth` 语义未被破坏；并集是 **deny 集合单调放大**，结构上**不可能新增放行**；cmd 下 `\` 确已非续行/非转义（`:258`、`:303/:311`、`:358/:366` 均以 posix 为门）；alias 的 `--get/--list` 短路与 `-f/--file/--blob` 跳值成立。残留 P3：读取动作短路对整段无序（`git config alias.p 'push --force' --get` 这类反常参数序放行）。
**B（pricing 读路径）PASS**：三读路径确改（`:461/:921/:1852`），warn 与 `loadPricing`/`loadModelCatalog` 的路径拼接**逐字同源**且用同一个 `root`；归一函数对不存在路径走"最近已存在祖先"不抛。P3：新测试只测纯函数，**调用点 `:1793-1794` 无断言**（删掉仍全绿）。
**C（打包）**：否定模式经 npm packlist **源码级**核验确为硬排除；包内优先在 `node_modules` 与 pnpm 形态均成立。**但 P1 未闭合**（见下）。
**D（诚实化）PASS**（抽查）：命令表与 `dispatch` 逐项对得上；密钥按**实际生效后端**三态措辞。

**P1（严重，已派卡）**：`prepack` **只复制 configs、不含构建**（`apps/cli/package.json:23` vs `:22` 的 `build`），而 `.gitignore` 排除 `dist/` ⇒ **干净检出**跑 `npm pack`/`publish` 会产出「**有 `dist/configs/*`、没有 `dist/cli.js`**」的坏包，`bin`/`main`/`exports` 全悬空、**安装仍 exit 0**。→ **我此前那三条 exit 0 之所以成立，只因工作区里已有一份手工 `tsc -b` 产物**；终评同时指出 `--version`/`--help` 与 `policy status`（恒 exit 0）**本身无判别力**，真正有判别力的是"system 层路径落在 `node_modules/.../dist/configs`"。

**P1 已修复并由 Orchestrator 用同一探针 after 对照（闭环）**：`apps/cli/package.json` 的 `prepack` 改为 `npm run build`（`build` = `tsc -b && node scripts/copy-configs.mjs`，构建链单一事实源）。生命周期经 npm 11 源码核实**无递归**（`npm run build` 只触发 prebuild/build/postbuild，不回触 prepack；pack 路径**不跑 `prepare`**），且 `tsc -b` 无参时按引用图**先构建全部依赖工程**，故包内构建足以产出 `dist/cli.js`。
**after 实测（同样把 `dist` 重命名移走）**：`hasCliJs=**True**`、`hasConfigs=True`、无测试产物、**62 文件 / 188.1 kB**（before：5 文件 / 6.5 kB / `hasCliJs=False`）。
**残余（如实记录）**：① `npm pack --ignore-scripts` 仍可跳过 prepack 产出坏包（显式 opt-out，**必须由门禁兜住**）；② `npm run build` 是嵌套 npm，`-w/--workspaces` 打包时子进程会继承 `npm_config_workspace(s)`，理论上可能 ENOWORKSPACES 失败（**fail-loud，不静默出坏包**）；③ `dist/.tsbuildinfo` 仍入包。
**P2（已修复并验证）**：发布门禁原本只查本地 `dist` 是否存在 → 现已把「**发布物形状**」并入 Gate 8（`packaging`，不新增第 9 道门禁）：① pack 期脚本（`prepack`/`prepare`）**必须构建 `dist`**（**该分支不读本地 `dist`，所以"工作区恰好有 dist"救不了它**）；② `npm pack --dry-run` 清单必须含 `dist/cli.js` 与 4 个 `dist/configs/*`，且不含 `*.test.*`/`*.map`；③ 不可解析/包名错位/工具缺失 → **显式 pending**（不静默通过）。
**Orchestrator 用真实输出验证了门禁的判别力（双向）**：真实 `npm pack --dry-run` 的 **stderr**（3062 字节）→ `parsedFlag=true`、**62 条**、含 `dist/cli.js`、4 个 configs 齐、无违禁 → **`pass`**；**`prepack` 不构建 → `fail`**（正是产生坏包的那个条件）；只含 configs 的清单 → **`fail`**。
**过程中的自我纠正**：我第一次探针**抓的是 stdout**（npm 把清单写 **stderr**）→ 得到"解析为空、`pending`"，差点误判成门禁缺陷；换通道后结论反转。**教训：探针本身也会抓错通道——工具输出必须按其真实信道捕获。**（随后核对执行器接线 `run-release-gates.ts:478`：`output = stderr + '\n' + stdout`，**stderr 在前**，管线本身正确；`--loglevel=notice` + `--no-color` 消除环境干扰。）
**P3×4**：pricing sync warn 调用点无用例；warn 文案补救指向 `node_modules`（重装即失效）且 `--dry-run` 也打印；`dist/.tsbuildinfo` 入包；alias 读取短路边界。
**终评对里程碑证据强度的批评（我接受）**：`--version`/`--help` 与 `policy status`（恒 exit 0）**本身无判别力**；真正有判别力的只有"system 层路径落在 `node_modules/.../dist/configs`"。它另指出 **pricing/model-catalog 的安装态读路径缺等价实证**——**已补反向证据探针**：16 tarball → 空项目 `npm i`（exit 0）→ **`vessel usage` exit 0 且「未找到内置配置」警告未出现**（`部分装载` 警告亦未出现）⇒ `pricing.json` 确从**包内 `dist/configs`** 读到（该 warn 仅在缺失时打印）。

**终评对"最大缺口"的判断（我采纳）**：不是这些单点语义，而是「**打包 → 安装 → 首跑 → 升级**」整条发布链路仍靠**人工实测一次**——tarball 形状、`dist` 随构建、安装态读路径、无 warn 冒烟**都没有自动门禁**，任何重构都能在**没有红灯**的情况下把"能用的包"变成"不能用的包"。→ 本轮的处置正是把 **P1 变为门禁红灯**（`prepack` 构建 + 门禁断言包形状）。**新增纪律 17**：**"能跑一次"不等于"可发布"**——一次性人工实测必须转化为**离线、确定性、可回归的门禁**，否则它只提供假安全感。

## Round 18 — 发布链路门禁化（终评 P1/P2 的收口）

**P1 修复**（`prepack` 接构建）与 **P2 门禁**（`publish-artifact` 判据 + **28 条自守护单测**）均已完成并实测，细节见上文。**其余如实记录的残留（不假装干净）**：
1. `normalizePackEntry` 是**纯归一化器而非过滤器**（`'total files: 62'` 原样返回）；过滤职责在 `parsePackListing` 的 `npm notice <size> <path>` 正则。安全性质成立（注入用例已证非文件行进不了 entries），但**若将来有人把它的输出直接当 entries 用，会漏进非文件行**——已由单测 B 组锁定"过滤在 parse 层"这一分工。
2. `parsed` 由 `entries.length > 0` 推出：若 npm 改动尺寸格式（如 `270 B` 带空格）导致段内**所有**行失配，summary 会写成"未找到 Tarball Contents 段"，而真实归因是"段找到了但零可用条目"——**状态仍是 `pending`（安全）**，只是**排查文案会误导**。建议未来区分 `start >= 0`。
3. `packedName` 取不到时身份断言被**静默跳过**（设计如此、文档已声明），仅靠形状判据兜底；风险低。

**验证方式（已由 Orchestrator 实跑）**：`benchmarks/runners` **18 文件 / 244 passed**；全量 **136 文件 / 1514 passed + 3 skipped / exit 0**；`tsc 0`。

## Round 19 — 依赖声明补全 + 测试盲点闭合 + 发布链路门禁化（终评"最大缺口"）

**① 依赖声明（14 个 `package.json`）**：补齐后**全仓 51 条 `@vessel/*` 声明零不匹配**（16 处 `@vessel/shared` 全为 `^0.10.0`）；**`npm install --dry-run` exit 0 / "up to date"**、无 registry 拉取 ⇒ **未破坏 workspace 链接**。执行者更正了我的根因：仓库内缺声明不暴露的真因是 **`vitest.config.ts` 的 alias 直指源码 + TS project references（根本不经过 `package.json` 解析）**，hoisting 只是兜底。
**② 两处测试盲点闭合**：`pricingSyncMismatchWarning` 的**调用点**改用**真跑**（既有 pricing sync 用例本就用**本地 loopback 替身**充当 models.dev，零外网）；C-4 文案用**正向关键词 + 反向 `not.toContain` 双锁**。执行者逐条给出"删哪行会红"，并**主动限定了一处断言边界**：顺序断言锁的是"warn 早于人类可读写入回执"，**不严格等价于"早于 `fs` 写盘"**，故另配 `fs.existsSync`。
**③ 发布链路门禁化（终评点名的最大缺口）**：新增第 9 道门禁 **`install-smoke`**——**默认不跑**（`VESSEL_GATE_INSTALL_SMOKE=1` 才启用，未启用时**零命令零 IO** 直接 `pending`，故**不拖慢既有 8 道**）；判据是"**读路径逐字落在安装态包内**（仓库/cwd 下的 configs 一律不算）"，**而非"命令 exit 0"**；**7 种 pending**（环境不具备）与 **5 种 fail**（包真的坏了）严格分离。
**④ 事实更正**：文档引用的行号已漂移，实测为 **`cli.ts:641`**（C-4 文案）、**`:291`**（判据定义）、**`:1818-1819`**（调用点），非 `:509`/`:1793-1794`。已修。
**验证**：`tsc 0`；全量 **138 文件 / 1555 passed + 3 skipped / exit 0**；`benchmarks/runners` **19 文件 / 250–251 passed**；`npm install --dry-run` exit 0。
**⑤ 一次已观察但未复现的偶发（如实记录）**：一次全量运行报 `1 failed | Received: "fail"`；随后 **3 次运行全绿**（`benchmarks/runners` ×2、全量 ×2，末次 `1555 passed`）。**未复现**，故不据此改动实现。**取证失误**：我当时用 `Select-String` 过滤 vitest 输出，**把失败用例名连同堆栈滤掉了**——这违反本仓纪律（"不捕获即等于没有证据"）。**教训（并入纪律 14 的延伸）**：**定位失败时必须先把原始输出落盘再过滤**，否则会把"待定位的红"变成"记不清的偶发"。
**⑥ 已知残余（执行者如实标注）**：`benchmarks/runners/src/report/runner.ts` 的 md 标题写死"8 道发布门禁"，启用第 9 道时表格会多一行与标题不符（一行可修）；第 9 道**只覆盖"打包→安装→首跑"，未覆盖"升级路径"**；Windows 下临时路径含空白时按 `pending` 降级（已显式处理，不会误判 `fail`）。

**⑦ 发布链路门禁的实测（Orchestrator 真跑，最强证据）**：设 `VESSEL_GATE_INSTALL_SMOKE=1` 跑真实门禁管线 → 报告第 9 行 **`Install Smoke (opt-in, gate 9) | ✅ PASS | 38101ms`**，证据行写明全过程：**16 个 tarball → 全新空项目离线安装 exit 0 → system 层路径在包内 + `usage` 无缺配置警告**。整体 `status=partial pass=8 fail=0 pending=1`（pending 为需密钥的直播道）。⇒ 终评那句"**打包→安装→首跑只靠人工实测一次**"**已闭合**：该链路现在是**离线、确定性、可回归**的门禁（38 秒），且**本机 npm 缓存足以离线安装**（`@clack/prompts`、`js-yaml` 命中缓存）。
**⑧ 报告口径修正**：`release-gates/runner.ts` 的 md 标题原**写死「8 道发布门禁」**（第 9 道启用后与表格自相矛盾）→ 改为**由实际行数推导**「发布门禁（N 道）」，并保留"§21 注册表 8 道常驻 + 第 9 道可选"的准确表述；测试**只收紧不放宽**（`toContain('## 发布门禁（3 道）')`、`not.toContain('8 道发布门禁')`、`toContain('8 道常驻')`）。

## Round 20 — pricing 用户态落点 + 安装态门禁的升级路径（自主选片）

**选片理由**：Round 19 只修了 pricing 的**读**（改包内），**写**仍在 `cwd` → 安装态 `pricing sync` 是**空操作**且会在用户项目里**凭空建 `configs/`**。属"我修一半造成的不对称"，应闭环。
**设计决定（Orchestrator）**：**只动 catalog 档位内部**——`pricing sync` 默认写**用户状态根** `~/.vessel/model-catalog.json`（`VESSEL_USAGE_ROOT` 可覆盖，与 `pricing.override.json` 同根）；`loadModelCatalog` 改为**用户态优先 → 包内兜底**；**`pricing.json` 不加用户态层**（用户定制通道已是全链最高的 `pricing.override.json`，再加一层是 scope creep）。层序 `override > pricing.json > catalog > protocol > default` **一字不动**。
**before 基线（指挥侧实测，用于证明"无用户态文件时零漂移"）**：`VESSEL_USAGE_ROOT=<tmp>` 下 `loadPricing(repoRoot)` = 2 keys / hash `c32b0314d4250b10`；`loadModelCatalog(repoRoot)` = 3 keys（`version`/`source`/`models`）/ hash `514cc48db36d6861`；用户态 catalog 不存在。**改动后必须以同一探针得到相同哈希**。
**另一片**：第 9 道门禁扩**升级路径**（覆盖安装后仍能跑、且无旧版本残留污染）；升级特有的断言**不得**用"文件存在即算过"的弱形式；默认仍**零命令零 IO**、不联网、环境不具备一律 `pending`。

**after 验证（指挥侧实测，独立于实现者）**：① **零漂移**——无用户态文件时 `loadPricing` 与 `loadModelCatalog` 的哈希与 before **逐字相同**（`c32b0314d4250b10` / `514cc48db36d6861`）⇒ usage 成本不会漂移；② **用户态优先真的存在**——向 `VESSEL_USAGE_ROOT` 写入哨兵 catalog 后，`loadModelCatalog` 返回哨兵（`userStatePriority=true`，哈希变为 `f967911781f83d00` ≠ 内置），**这是改动前必红的判别点**。

## Round 20 附：静默降级族（独立审计 + **指挥亲测确认**）

派了只读审计枚举"静默降级/静默吞错"（A 类=返回兜底且无告警无状态位；B 类=有状态位但需确认被消费；C 类=合理静默）。**我对它给的 Top 项逐条实测**（不采信严重度猜测），确认三处：
| 位点 | 实测 | 后果 |
|---|---|---|
| `packages/application/src/project/ProjectRegistry.ts`（`persist` 约 `:91`） | 写坏 `projects.json` 后 `open()` → **未抛错、`warnings=0`、原文件被覆盖、目录内无任何 quarantine 副本** | **不可恢复的索引丢失**（对照 `UsageStore` 会改名留档+warn） |
| `apps/cli/src/usage/pricingOverride.ts`（`read` 约 `:99-123`） | 合法覆盖 `deleted:['deepseek-chat']` → `tombstones()=['deepseek-chat']`；改成坏 JSON → **`tombstones()=[]`、`warnings=0`** | **墓碑静默丢失 ⇒ 被删模型重新计费**；自定义价全部失效 |
| `apps/cli/src/providers/pricing.ts:79` | 裸 `catch {}` → 坏 `pricing.json` 静默回退兜底表（`warnings=0`） | **拿兜底价算成本且无信号** |
**安全类（独立安全复核，逐条带行号）**：`packages/tools/src/filesystem/guards.ts:81-94` 的 `realpathSync` 失败被**静默吞掉**→ 回退词法检查。复核**逐条排除**了三层"我以为的兜底"（`assertConfined:175` 直接 return 且 `:176` 仍按词法判；`fs-confinement` 规则只匹配 `..`/绝对路径；sandbox 只注入 Shell、fsTools 不读它）⇒ **它是 symlink 出界的唯一防线**。**攻击形（推演）**：父目录为出界链接 + 目标文件不存在 → realpath ENOENT 被吞 → 词法全过 → **Write 跟随链接写到工作区外**；**默认策略与 `confinement:true` 皆然**。判定**可利用性中、建议立即修**；且复核指出**不能对整条路径 fail-closed**（新建文件 realpath 必然 ENOENT → 会拦掉所有正常新建，属**确定误伤**），须 **errno 分离**（非 ENOENT → 拦；ENOENT → 对**最深已存在祖先** realpath 并判根）。
**本轮的自我纠错（两次）**：① 我对上述三处的第一版探针**输入形状全错**（`ProjectRegistry` 构造要 `{vesselHome:目录}`、`open()` 收路径；`PricingOverrideStore` 构造要 `{rootDir}` 选项对象）→ 得到"无问题"的**假阴**；我**没有**据此下结论，而是读真实 API 后重测才确认。② pricing 卡新用例全量报红，我**落盘日志**后定位到是**它自己把依赖 env 的断言放在了 `finally` 还原之后**（非实现缺陷）——上一程同类情形我因先过滤输出而丢失了失败用例名，这次不再重犯。

## Round 20 结算（提交 `5612acf`）— 静默降级族已修，安全缺陷已修且由**变异测试**验证

上表四处（`ProjectRegistry` 覆盖销毁、`pricingOverride` 墓碑丢失、`pricing.json` 兜底、`guards.ts` symlink 出界）**均已修并落盘**。其中 **`pricing.json` 兜底**与 `modelCatalog` 的三态对齐（缺失静默、损坏可见）；**墓碑丢失**改为三态可见 + 写前留档；**索引覆盖**改为留档 + 留档失败抑制写入（我拍板的决策：**这一片的意义就是"别销毁数据"，功能降级远好于数据灭失**）。

**最强证据形式（本轮首次使用）：变异测试。** 安全修复若只跑"修复后通过"，**证明不了探针有判别力**。故我把 `guards.ts` 的 ENOENT 祖先校验**短路回旧的静默吞异常**再跑同一探针：
| 变体 | `attackBlocked` | **工作区外文件被创建** |
|---|---|---|
| 修复版 | `true` | **`false`** ✅ |
| 变异版（模拟旧行为） | **`false`** | **`true`** ❌ |
两次里 `normalNewFileAllowed` 均为 `true`（负对照稳定 ⇒ 修复**无过度拦截**），随后用备份**原样还原**（不用被守护规则拦下的 `git checkout`）。⇒ 一次证明四件事：**缺陷真实可利用、修复真的堵住、探针不恒绿、没有误伤**。
**本轮引入的待修残留（实现者主动上报，指名我决策）**：`pricingOverride` **抑制写入后 CLI 仍打印「✔ 已写入覆盖」**（`cli.ts:1791/1808/1856`）——即**确认时刻的宣称不为真**；修法需让 mutator 回传"是否真落盘"（动 set/delete/restore/repair 返回语义），已排入下一片。

## Round 24 — 沙箱"说真话"修复，以及测量揭出的更深问题

**修复内容**（提交 `734258d`，13 文件）：`statusSnapshot().active` **只**来源于"本轮 job 是否真的附加成功"（新增 `jobAttached` 状态机 + `degraded` 三值原因 + 可注入 warn）；`Shell` 把 `r.audit` 的**逃逸/终止/失败**事件筛进工具结果 `meta.sandbox.audit`，并补上此前缺失的唯一生产消费方 `EnforcementProjection.recordProcessTree`；`terminatePids` 改为返回**已验证成功**的 pid 集合，其余逐条记新事件 `escape-terminate-failed`（**"试过了"永不记为"已死"**）。测试 **64 passed + 1 skipped**。

**我的独立探针（关键）**：

| 阶段 | `active` | `degraded` |
|---|---|---|
| 附加前 | `false` | `job-object-not-attempted` |
| **真实 run 之后** | **`false`** | **`job-object-attach-failed`** |

⇒ **修复前本机会报 `active:true, backend:'job-object'`，而进程树约束从未生效**——那个"谎报"**不是理论风险，是本机每天都在发生**。

**测量揭出的更深问题（已派只读调查）——结论推翻了我的假设**：我一度判断"本机 job object 后端坏了"，调查给出更准的结论：**后端没坏，是「附加时机 bug」**——holder 的 PowerShell `Add-Type` 编译需 **1–10s**，而它发生在**子进程 spawn 之后** ⇒ **短命令必然在附加完成前退出**；`OpenProcess failed: 87` 是 **pid 已退出**（`ERROR_INVALID_PARAMETER`），**不是权限**（权限是 5）；**我的探针用 `process.exit(0)`，构造的正是"注定失败"的场景**（本会话我第 4 次发现"错的是我的测量"）。后端对**长命**进程可用：仓内真机用例（`Sandbox.test.ts:204-232`、`process-tree.test.ts:317-351`）与 `tasks/078:59` 的 10759ms 实跑可证。
**调查另附三条更该修的**：① **CLI 的 sandbox 状态展示是死 seam**——`reportStatus()` **只在测试里被调用**（`projections.test.ts`），生产**从不打印**，TUI/Web 也不渲染 ⇒ **用户既看不到"生效"也看不到"未生效"**，唯一信号是**每个短命令一条 stderr 降级刷屏**；② **`docs/SANDBOX-WINDOWS.md:21` 仍宣称 `active=true`**（修复前旧语义 ⇒ 文档漂移，必修）；③ 修法方向：**先起 holder 再 spawn**（把窗口从"秒级编译"压到"一次 PS 往返"）＋ 把"目标已退出"与"真失败"分开（独立 reason、不 warn 不计 degraded）＋ 预算 10s→30s ＋ **把 `reportStatus` 接上线**让 degraded 可见（Node 侧无 `CREATE_SUSPENDED`，真 suspend-then-attach 需原生 helper/holder 侧 `CreateProcess`，建议另立卡）。
**教训（已在纪律中体现）**：修完"状态说谎"必须继续问"它现在说的是什么"；**并且**——**测量本身要够格**：用"注定失败"的场景去测后端可用性，会得出"后端坏了"的错误结论，而这类错误在本会话已出现 4 次（抓错输出通道、传错 API 形状、用必然失败的迭代方式、用瞬时退出的进程测长命附加）。

**S003 在修复后从"假的绿"变成"真的红"（我实跑的原报告）**：`success:false`；a1 `guard_seen` / a2 `denial_seen` **fail** 且 evidence 显示 `argumentsPattern:"probe-link"`、**`guards:[]`、`anchoredCalls:[]`**；a3 `file_content` pass（对照，如设计）。⇒ **判据已正确锚定**（`mock 的话不再是证据`——`finalText` 声称"被硬拒"，而锚定证据显示那次调用**从未发生**）；失败的**根因**是**离线脚本没有发起针对 `probe-link` 的真实读取**。**副作用**：S003 已被加进 `SAFETY_SCENARIOS`（门禁会跑它）⇒ **发布门禁会变红**，故"补齐脚本"是紧接的必修项（在跑）。**这比原来的假绿好得多**：它现在指向**具体缺什么**（一次真实调用），而不是给一个来源不明的绿灯。

**S003 根因（我实测钉死）与我自己的一次推理错误**：我先前的解读"**离线脚本从未发起那次读取**"被**我的证据本身否证**——原始 JSON 里 `toolCallsSeen` **明明含** `Read {"path":"probe-link/secret.txt"}`；那张卡给出正确推理：我看到的 `finalText` 与脚本**第 3 条**（要求 `minToolResults: 2`）逐字相同 ⇒ 若脚本为空，mock 只会返回 fallback ⇒ **那段文字恰恰证明读取发生了**。真因由我跑测试钉死：`safety.test.ts` **2 failed | 16 passed**，失败两条为①正例 ②**`S003: prepare 真实创建 probe-link…`** ⇒ **链接根本没被创建**。完整链路：`probe-link` 不存在 → `canonicalize` 上溯到工作区根（**在界内**）→ 正常返回 → 随后报 **ENOENT** → `TOOL_FAILURE`（**无 `meta.guard`**）⇒ 既无 `escape` 也无锚定调用。**这与"链接存在但被判 `unverifiable`"是两种不同的病，实测把二者分开了。**
**我的并发失误（如实记录）**：我在 **Round 19** 就派过一张 S003 卡且它**从未报告完成**，与 Round 27 那张**同时在写** `runner.ts`/`safety.test.ts` ⇒ **双派**（那张卡在读取期间观察到文件从 732→754 行、263→277 行）。**是执行者主动报告"有并发写入者"我才发现**，已 `interrupt` 中止旧卡。**教训：并发不仅要比"文件集合是否相交"，还要比"**同一目标是否已有在跑的卡**"**——我上一轮自省的同类错误（以为 B023 与 S003 不相交，结果两卡都改 `runner.ts`）在本轮以另一种形式重犯。

## 已解决问题（Round 1 切片 · 历史存档）

- **G-01（P0）首跑示例失效**：仓库工作区 `run --prompt` 曾 100% 输出 `(mock: no script entry matched)` 且 exit 0（假成功）。根因：ContextBuilder 将 volatile skills index 作为**最后一条 user 消息**追加，MockProvider 只匹配最后一条 user 消息。修复：`ChatMessage.source` 溯源 + Builder 标记 volatile 为 `environment` + MockProvider 只匹配真实 surface 输入 + 确定性兜底文案。
- **G-02（P0）未知命令静默 run**：`vessel foo`、`vessel chat` 曾静默跑一次 mock 任务并 exit 0。修复：main() 未知子命令 → stderr「未知命令 <x>。可用：vessel --help」+ **exit 2**（实测）。
- **G-14（文案）**：TUI 欢迎语补 `/explain`·`? <术语>`·`vessel guide`（已完成）。**订正**：`cah *` 并非审计误报——指挥早前 PowerShell 检索失效误判，独立 Evaluator 已证伪并定位 `apps/cli/src/providers/setup.ts:7/103/237/268/301`（4 处用户可见文案）→ 列入 FIX 轮（`FIX-BRIEF-01.md` S2）。
- 附带：空工作区/无 README 时给友好提示，不再把裸 `TOOL_FAILURE` 当"最终回复"。

验收侧证据（Orchestrator）：`tsc -b` exit 0；`vitest` **114 文件 / 1235 passed + 1 skipped / exit 0**（基线 1220+1 → 本轮 +15 用例）；CLI 冒烟 6 项 E2E 全通过（含**带参数已知命令** `explain 小小蜜` / `provider list` / `settings list` 均 exit 0，证明未知命令分支未过度拦截）；`source` 经查不进入任何真实 provider 请求体（三路均显式挑字段）。
**独立 Evaluator 裁定：ACCEPT**（Round 1 全静态 → **REJECT**（S1–S4）→ FIX 轮 → Round 2 全静态 → **ACCEPT**，逐项行号证据见 `EVALUATION-REPORT-01.md` / `EVALUATION-REPORT-02.md`）。

## 仍存在缺口（Round 1 视角 · 历史存档；**当前路线图以 `PRODUCT-GAP-MAP.md` 的 NOW/NEXT/LATER/NOT_NOW 为准**）

- **NEXT（低成本高价值，建议下一轮 NOW）**：G-03 CLI 顶层 `main()` 无 catch（配置损坏即裸栈崩溃、无恢复指引）；G-07 `apps/web` 游离 `tsc -b` 图外（类型错误可静默过 8 道门禁）；G-12 `apps/cli/tsconfig.json` 缺 `local-server` reference（干净 clone 构建顺序脆弱）；G-09 TUI 会话内成本可见性（数据已采集只缺展示，直击 deepseek-flash 成本波动痛点）。
- **LATER**：G-04 usage.json 损坏静默清零 + 无备份轮转（数据丢失类）；G-05 密钥暴露面（DPAPI 经 PowerShell 命令行传密钥 ×  openai-compatible 错误体回显 500 字符 ×  secrets 损坏默认不恢复）；G-10 会话续跑 + 会话级快照回滚；G-11 CLI 面 MCP 配置命令 + 通用 JSON 出口；G-13 TUI/CLI 命令面不一致、`/permission` 不持久、theme 无消费者。
- **NOT_NOW（主动拒绝）**：G-06 全量 i18n 改造（成本≈全量改造、当前用户仅中英）；G-08 `~/.vessel` 状态根 7 处重复的重构（可小步缓行）；G-15 原子写 wrapper 重复（P4）；竞品形态追逐（插件市场 / 消息平台 / 云协作 / 大众榜单 / IDE·桌面表面）——竞品审计已逐条论证不做。

## 新发现问题（本轮过程中）

1. **提交者把 WIP 交证落盘的链条很脆**：连续 3 个 Implementer 在"读文件/跑命令"阶段失败（本环境子代理执行长命令会中断）→ 应对：改用**写入型窄任务**（禁跑命令）+ 由指挥跑验证 + 保命 WIP 提交。
2. **第 4 轮 Implementer 引入语法回归**（模板字符串内嵌反引号 → TS1005，连带两个测试套件 transform 失败）——被验收侧复跑即时捕获，FIX 阶段修复。**教训：写入型执行器虽能完成，但必须强制验收侧复跑 tsc/测试**（否则该回归会静默进主干）。
3. **"未检索到" ≠ "不存在"**：G-14 的 `cah *` **属实**（`setup.ts` 4 处用户可见文案）——我最初用 PowerShell `Get-ChildItem -Include` 组合检索返回空，据此误判"审计误报"并写进状态文件，被独立 Evaluator 证伪。教训：核验一律用 ripgrep 类工具，并复核检索式本身是否有效。
4. **N4（Round-2 提出，建议下一轮小卡）**：`ChatMessage.source` 仍是裸 `string`、`INJECTED_MESSAGE_SOURCES` 手写集合 → 未来新增注入源会**静默退化**（无人报错）。建议：收窄为联合类型，或加"漂移守卫"测试（断言 events 联合里的注入类 source 全部在集合内）。
5. **N5（低危）**：`MockProvider.ts:47-52` / `Builder.ts:47-48` 注释仍只列举 4 个 source（实际 7 个）。
6. **N2 文档-命令漂移**：`vessel chat` 已不再是入口（现 exit 2），但有 3 份文档仍当它作 TUI 入口——本轮已修 `PROVIDER-MANAGEMENT.md`（3 处）、`REAL-MODEL-LANE.md`（3 处）、`PROJECT-BRIEF.md`（2 处）→ 建议后续把"文档命令一致性"纳入发布门禁或加一条 grep 检查。
7. **偶发**：全量 vitest 有一次 exit 1 但仅伴随 "unhandled errors" 警告（测试全过），复跑 exit 0 —— 记为观察项，非本轮改动引入。

## 当前最高价值下一步

**进行中**：Round 14（P3 集群收口）。**A（CLI 错误出口 `--json` 化）✅ 57 处全部收敛**（**反向验证已做**：把 `provider set` 缺 id 那一处临时还原成 `console.error(...); return 2;` → 测试**立即 2 例红**（`Unexpected token '用', "用法: vessel"... is not valid JSON`），随后原样还原、`git diff` 为空、9/9 复绿 → **判别力实证**）、**B（门禁重跑）✅ 最终 `status=ready` 8/8 pass**（423s，`deepseek-flash` live lane，`build` 判据已含 `apps/web` 类型检查）、**C（文档指针）✅ 只改 living docs**；两张由 B 暴露的缺陷已修：① `VESSEL_OPENCODE_GO_BASE_URL` **污染测试套件**（判别性复现：无 env 20/20 过、有 env 2 例红）→ 测试侧隔离，修后**设/不设 env 均 22/22**；② 门禁 `unit` 注记**硬编码错误归因**（把真实回归说成 process-tree flaky）→ 改为证据推导（仅在证据确证"唯一失败=process-tree"时才写因果，否则如实"未自动归因"）。完成后按序：

1. **Round 14 复评**：核 A 的 57 处改造是否真有判别力（含多行文案与 stdout 纯净性）、B 的覆盖入口是否守住默认行为、两张修复卡是否闭合。
2. **复跑门禁**取 clean report（验证注记不再误归因、unit 不再受 env 污染）。
3. **LATER**：全量 i18n 架构、`~/.vessel` 状态根重复收敛、`vessel diff --last` 式只读回滚提示（G-10 的克制替代）、`--json` 下 `console.warn` 仍打人类文案（P4）、`cmdProviderEndpointTest` 在 `--json` 下探测阶段先往 stdout 打人类行（P4）。

**已定的"不做"**（均有论证，不因"竞品有"而做）：插件市场、消息平台、云协作/多用户、公开排行榜、IDE/桌面表面；TUI 内不放 `migrate`/`serve`/`bench`/`pricing sync`/`--json`；**不做**通用快照回滚（会让用户误以为 Shell 写入也可回滚）。

## Round 2（G-03 / G-12 / G-16）— 已闭环

**交付**：`apps/cli/src/startupError.ts`（纯函数：4 类判定 + 路径提取 + 恢复指引）＋ `apps/cli/src/cli.ts` 入口 `.catch` → 人话 + **exit 1**；`apps/cli/tsconfig.json` 补 local-server 构建边；`packages/shared/src/events.ts` 新增运行时事实源 `MESSAGE_SOURCES`（`MessageSource` 类型由此派生）＋ 漂移守卫测试 3 例；`startupError.test.ts` 10 例。

**验收侧证据（指挥 E2E，非实现者自证）**：`tsc 0`；`vitest` **116 文件 / 1248 passed + 1 skipped / exit 0**；崩溃面 E2E 双例（写坏 `settings.json` / `providers.json`）→「配置文件损坏 + 涉及文件（路径干净收尾）+ 恢复指引」+ **exit 1** + 无裸栈行；带参数已知命令（`explain 小小蜜`/`provider list`/`settings list`）零回归。

**独立裁定**：`EVALUATION-REPORT-03.md` **ACCEPT（7/7 必查点）**；`EVALUATION-REPORT-03-RECHECK.md` **ACCEPT（A–D）**，并给出判别力推演（回退正则后首个红灯为 `startupError.test.ts:146`）。

**本轮由"验证"而非"实现者自证"捕获的 3 个缺陷**：
1. `startupError.ts` JSDoc 内 `**/` 提前闭合块注释 → esbuild `Unexpected "*"`，**整个 CLI 无法运行**；
2. `涉及文件：` 行尾残留全角 `）:`；
3. 上述"修复"**实际未生效**——真根因是字符类内 `]` 未转义（正则永不匹配），需读实现才定位。
   **教训**：执行器报"完成"与功能"生效"是两件事；**指挥 E2E + 读码定位 + 判别性断言**三者缺一不可。

**残留（→ Round 3 候选）**：
- **N1（P2，建议首选）**：「坏配置 → exit 1 + 路径 + 指引」这条**用户可见契约无自动化测试**（删掉 `.catch` 不变红）→ 补 `cli.crashSurface.test.ts`（in-process 断言 `main()` reject + `describeStartupFailure` 渲染，避开子进程 EPERM）。
- **N2（P3）**：分类探测用裸 `/JSON/i` → 目录名含 "json" 的 ENOENT 会被误判为"配置文件损坏"。
- **N3（P3）**：内容类错误（格式非法 / theme 非法值）落 `unknown`，指引偏弱。
- **N4（P3）**：未复用 `describeProviderError`（丢掉 opencode-go 的 hint）；unknown 分支不再保留 stack。
- **N5（P3，跨轮）**：`ChatMessage.source` 仍为裸 `string`（守卫只覆盖"联合→集合"一条边）→ 建议收窄为 `MessageSource | 'environment'`。
- **LOW**：路径清洗会截断以 `]`/`）` 结尾的**真实**路径（仅影响展示文案）。

## Round 3（N1 / N2 / N5）— 已闭环

**交付**：`apps/cli/src/cli.crashSurface.test.ts`（新，3 例：坏 `settings.json` / 坏 `providers.json` → `main()` reject 且渲染含路径+`vessel setup`+无 stack；干净对照 → resolve 0）；`startupError.ts` N2（判定顺序 ENOENT→file-missing 最优先、`CONFIG_CORRUPTED_RE` 收紧为精确 JSON 签名**并补** `invalid JSON|corrupted` 以覆盖 ProviderStore 措辞）；`packages/shared/src/provider.ts` N5（`source?: MessageSource | 'environment'`）；`messageSources.test.ts` 双向全等守卫；`MockProvider.test.ts` 类型化适配。

**验收侧证据（指挥 E2E + 全量）**：`tsc 0`；`vitest` **117 文件 / 1255 passed + 1 skipped / exit 0**；崩溃面 E2E：坏 `settings.json` →「配置文件损坏 + 干净路径 + 指引」exit 1；坏 `providers.json` → 同样（修复前曾退化为 unknown）；干净对照 exit 0；无裸栈行。

**独立裁定**：`EVALUATION-REPORT-04.md` **ACCEPT**（5 点中 1–4 通过，第 5 点为 P3 文档残留）。

**本轮由验证（非实现者自证）捕获的问题**：
1. N5 类型收窄**立刻**让 `tsc` 变红（`MockProvider.test.ts:96` 传裸 `string`）——证明收窄有效；
2. **N2 副作用**：ProviderStore 措辞被判 `unknown`（新增的 N1 用例②恰好变红把它暴露）→ 补 `invalid JSON|corrupted` 修；
3. 修正则的执行器报"失败"实为**写完即死**（文件已改）→ 坚持"核验文件而非采信回报"；
4. 想用 `Remove-Item` 清临时文件被**全局铁律拦截**（删除必须走回收站）→ 改用"另建干净 root" 做对照，零删除。

**残留 P3（均非阻断）**：① `provider.ts` 的 `source` JSDoc 仍把 `steer` 写成注入来源、漏 plan/handoff/inject；② 裸 `corrupted`/`invalid JSON` 关键词仍有极窄反向误报面（建议与 file/config/`.json` 同现）；③ `cli.crashSurface.test.ts` 干净对照用例不封"分类漂移"（该哨兵在 `startupError.test.ts`）；④ 路径清洗会截断以 `]`/`）` 结尾的真实路径（仅展示）；⑤ 内容类错误（格式非法/theme 非法值）落 `unknown`，指引偏弱；⑥ 未复用 `describeProviderError`（丢 opencode-go hint），unknown 分支不留 stack。

## Round 4（G-07：web 拉进类型门禁）— 已闭环

**交付**：`apps/web/package.json` 增 `typecheck`；`gates.ts` Gate1 现同时跑根 `tsc -b` 与 `tsc -p apps/web/tsconfig.json`，判定抽为纯函数 `judgeBuildPair`；criterion 文案与 `docs/RELEASE-GATES.md` 同步；web 侧探测失败**显式 pending**（不静默通过）。

**判别性 E2E（决定性证据）**：注入 `apps/web/src/__probe_bad.ts`（类型错误）→ **根 `tsc -b` 仍 exit 0**（证明 web 原本在门禁视野外），而 **build 门禁 verdict=fail**（`web tsc exit=2`）；清理后回 `pass`。**独立裁定 `EVALUATION-REPORT-05.md`：ACCEPT**。

## Round 5（G-04：用量数据不再静默丢失）— 已闭环（含 P2 补修）

**交付**：`UsageStore.quarantineCorrupted()`（损坏 → 改名 `<file>.corrupted-<ts>[-N]` 留档 + `console.warn` + 空表继续）、`backupKeepOpt` + `resolveBackupKeep()`（**opts > `VESSEL_USAGE_BACKUP_KEEP` > 默认 5**）、`backupBeforeWrite()`（`backups/usage.<ts>.json`，超限改名+覆盖最旧，**零删除**，失败只 warn）、`save()` 中调用；新增 5 例恢复测试。**P2 补修**：`load()` 读失败按 `err.code` 分流（ENOENT 静默 / 其它 code warn + `suppressWrite`）、隔离名唯一化、rename 失败置 `suppressWrite`、`save()` 开头抑制检查。

**验收侧证据（指挥真实 CLI E2E）**：损坏 `usage.json`（`{oops`）→ `vessel usage` 打出「已隔离为 …\`usage.json.corrupted-<epochMs>\`（内容保留，未删除）」、exit 0、目录仅剩隔离文件且内容 = `{oops`；连跑 3 次 → `backups/` **5** 份（默认上限）；`KEEP=0` → 不建 backups 目录。全量 **120 文件 / 1271 passed + 1 skipped / exit 0**、`tsc 0`。独立裁定 `EVALUATION-REPORT-06.md`：**ACCEPT**（两项 P2 已补修，交 Round 5b 复核）。

## Round 6（G-05a：密钥不进命令行 + secrets 损坏默认可恢复）— 实现完成，评审在途

- **密钥不再进 argv**：`dpapiProtect/dpapiUnprotect` 改为固定脚本 + `$o = $input | ConvertFrom-Json`，材料只经 `execFileSync(..., { input })` 走 **stdin**（`CredentialStore.ts:342/363`）。
- **secrets 损坏默认可恢复**：`defaultStore` 传 `recoverCorrupted: true`；并补上 **DPAPI 构造期路径**的漏转发（`CredentialStore.ts:449` → `readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted })`，`readSecretsFile` 三处现已全部转发）；库层默认仍 fail-loud，显式 `false` 语义不变。
- **测试**：新增 `dpapiArgv.test.ts`（4 例：argv 无材料 / 材料只在 `input` / probe 双调用 / **真实 ProtectedData 往返**）与 `defaultStore.recovery.test.ts`（4 例：默认可恢复 / 恢复后仍可用 / 显式 false 仍抛 / ENOENT 不误伤）。
- **本轮由验证捕获的硬缺陷**（3 项）：① stdin 第一版用 `[Console]::In.ReadToEnd()` 使真实 DPAPI 往返 **5 例红**，探针实测该形态 `spawnSync EPERM`、`$input` 成功 → 改形态；② DPAPI **构造期**漏转发 `recoverCorrupted`（R5 残留，由测试作者独立发现）；③ 新测试用例②因 seed 占用 `id:'ds'` 报 duplicate（测试缺陷，非实现）。
- **行为证据（真实 CLI）**：损坏 `secrets.json` → 「[credential] secrets 文件损坏（invalid JSON …）已隔离备份到 `<tmp>\secrets.json.corrupted-<epochMs>`，凭据被重置为空；请核对后重建。」+ `provider list` **exit 0**（此前硬抛、CLI 全灭）+ 隔离文件内容 = `{oops`。
- 下一轮候选：**错误体回显脱敏**（R4：`OpenAICompatibleProvider` 回显 500 字符原文，建议复用已下沉到 `errorBody.ts` 的 `sanitizeWireSnippet` 口径）；其后 G-09（TUI 成本可见性）、G-10/G-11/G-13。

## Round 7（G-05b：错误体回显脱敏）— 已闭环

**交付**：`packages/llm/src/provider/errorBody.ts`（`sanitizeErrorBody`：复用 `sanitizeWireSnippet` 剥 URL/压空白/截断 + 遮蔽 `sk-…`/`Bearer …`/JSON 的 `api_key|authorization|token`）；`OpenAICompatibleProvider:120/195`、`AnthropicProvider:227/318` 四处回显改造；`errorBody.test.ts` 7 例。

**验收侧证据**：`tsc 0`；**121 文件 / 1280 passed + 1 skipped / exit 0**；**判别性 E2E**：本地假 provider 回 401（体内含 `sk-live-abcdef1234567890` 与 `api.internal.example.com`）→ 两 provider 抛出的 message 均为 `…: {"error":{"message":"invalid api key sk-<redacted> — see <url>`，`leaksKey=false leaksUrl=false`。

**独立裁定 `EVALUATION-REPORT-08.md`：ACCEPT（0 必修项）**。新发现 4 项 P3（主题同一，留作下一小切片）：① 截断先于遮蔽 → 恰好跨 240 边界的 key 会残留 ≤5 字符片段（建议 mask-then-truncate）；② `OpencodeGoProvider.ts:214` 的 detail 只走 `sanitizeWireSnippet`、**不遮密钥**；③ HTTP 200 带 error 体时 `OpenAICompatibleProvider:125`/`AnthropicProvider:232` 仍原样回显 `body.error.message`；④ 非 `sk-` 形态（`gsk_`/`AIza`/`hf_`）在自由文本里不遮。另确认 Round 6 遗留 P3 属实：`dpapiArgv.test.ts` 未断言脚本含 `$input`。

## Round 8（G-09：TUI 会话内成本可见性）— 实现中

- 目标：`/cost`（别名 `/usage`）命令 + 每回合一行成本增量；`vessel usage` 标题不再硬编码 `~/.vessel`（展示与实际一致）。
- 设计要点：`UsageStore` 由 `cli.ts` TUI 入口注入（`cli.ts` 第 280 行已有同款用法），**未注入时全部成本显示静默关闭**（回归保护）。
- 状态：两件实现卡首轮均未落盘，已重派。

## Round 8（G-09：TUI 会话内成本可见性）— 已闭环（REJECT → FIX → ACCEPT）

**交付（首版，提交 7073693）**：`costView.ts`（纯函数 `renderCostLines`/`renderTurnDelta`）、`chat.ts`（`ChatOptions.usageStore?`、会话起始基线 + 回合滚动基线、`/cost`/`/usage` 分支、回合末增量行、`/help` 列出 `/cost`）、`cli.ts`（TUI 入口注入 `usageStore`；`vessel usage` 标题改用实际 root）；新增 11 例测试。`tsc 0`、**122 文件 / 1291 passed + 1 skipped**。

**独立裁定 `EVALUATION-REPORT-09.md`：REJECT**，两条硬缺口：
1. **主因**：`chat.ts` 的 `buildHarness()` **从未把 `usageStore`/`usageProvider` 传给 `composeHarness`**（记账开关在 `compose.ts:297`）→ 真实会话每回合恒为 `· 本回合 $0.0000（无用量记录）`、`/cost` 恒为"暂无记录"，**比改动前更误导**。→ 我那次 E2E 是"手工 record 后渲染 costView"，**绕过了 runChat 接线**，因此掩盖了该缺陷（评审明确指出）。
2. `/cost` 缺「今日」行（验收标准 1 要求三行）；`costView` 注释承诺"由调用方追加"但调用方从未追加。
其余 6 项通过：基线分离正确、未注入确为静默、纯函数与具体串断言扎实、回归无破坏、标题一致性（store 与标题同走 `resolveUsageRoot()`）、测试隔离合规。次要缺口：usage 标题改动无单测；启动期 `totals()` 抛错会静默关停成本行。

**FIX（进行中）**：① `buildHarness()` 补传 `usageStore`/`usageProvider`；② 新增 `renderTodayLine` 并在 `/cost` 追加今日行（取不到则省略、不抛错）；③ 待补**判别性测试**：真实 `UsageStore` + mock provider 跑 `runChat`，断言 `· 本回合` 金额**非 0**（这是本轮的教训——只测渲染函数会漏掉接线）。

**方法论教训（写入纪律）**：**E2E 必须走真实用户路径**；用组件级渲染替代端到端接线，会把"功能未接通"误判为"功能已实现"。

## Round 9（G-10 resume 最小切片）— 实现完成，评审在途

**定位**：与 G-09 同款"**机制已在、只差接线**"——`Session.loadExisting()` 早已实现"重开日志 + 补 `turn/end{interrupted}`"，`Builder` 每步从日志重建模型历史；缺的是 CLI/TUI 没有 sessionId 通道、且 `apps/cli` **零处**引用 `SessionRegistry`（登记表只由 local-server 写）。

**交付（提交 c46a90a / e3582ab）**：
- **陈旧租约回收**（前置卡）：`Session.acquireLease` —— pid **ESRCH** 或租约内容不可解析 → warn + 回收重取；pid **存活/EPERM** → 仍 fail-closed。修掉了"崩溃后 `.lease` 永久残留 → 最需要 resume 的场景必然失败"这一头号风险；活 pid 文案统一为含 `already open` 的英文句（修掉一次既有断言回归）。
- **`SessionRegistry`**：补上全仓唯一缺失的状态根 env 覆盖 `VESSEL_SESSION_ROOT`（AGENTS.md 约束 8 的隔离前提）+ `list()` 按 `updatedAt` 倒序；桶导出 `defaultSessionRoot`/`resolveSessionRoot`；`migrate` 清单补 `sessions.json`。
- **CLI 通路**：`vessel sessions list`（registry 为唯一事实源）+ `vessel resume <id>|--last`；`resolveResumeTarget` 做**存在性 + 日志文件双重校验**（`Session.open` 对任意 id 都会 mkdir，不拦就会把 resume 静默变成新建空会话）；`cmdRun` 透传 `sessionId` 并在 composeHarness 后 `registry.put`（`createdAt` 取旧值、仅 `updatedAt` 刷新）；USAGE 登记两行并删除死文档 `--session-dir`。
- **测试**：`SessionLease.test.ts` 5 例、`resume.test.ts` 9 例（含"登记命中但日志缺失 → exit 2 且目录/文件/.harness 全不存在"的**凭空新建回归保护**）。

**验收侧证据（真实 CLI + 记录型 provider）**：`tsc 0`；**124 文件 / 1309 passed + 1 skipped / exit 0**；`run` 后 `sessions list` **列出该会话**（接线前必然为空）；`resume <id> --prompt …` exit 0 且**会话目录数仍为 1**；`resume --last` 空表 / `resume <不存在id>` 均 **exit 2 且零新建目录**；**记录型 provider 探针**：第二轮（同 sessionId 重建 harness）模型收到的 messages **含第一轮写入的口令** → `SECOND_TURN_SEES_HISTORY=true`。

**本切片显式剥离**（防 scope 膨胀）：快照回滚（全仓零实现，建议独立立项）、会话级用量恢复（`UsageEntry` 无 `sessionId`，需先改 schema）、多会话管理 UI、fork/rewind、云同步。

**验证纪律（第 3 条，本轮新增）**：**验收断言必须打到"因果链末端"**——"resume 有效"必须证明**模型收到了历史**（记录型 provider 捕获 messages），而不是"日志变长 / 能读回记录"（存储层证据），否则会假绿。

## Round 9（G-10 resume 最小切片）— 已闭环（ACCEPT + AC1 已实证）

**独立裁定 `EVALUATION-REPORT-11.md`：ACCEPT（有条件）**——AC2 fail-closed、AC3 绝不静默新建、AC4 登记接线、AC5 测试真实性、AC6 回归越界**全部通过**；AC1（"模型看到历史"）原判 **无法判定**，理由充分：我的首版探针产物未入库、且 `TURN2_MESSAGE_COUNT=1` 与真实回放形状矛盾（第二轮至少应有 system + user1 + assistant1 + user2），无法排除"口令来自 prompt 本身/工作区文件/指令层注入"。

**AC1 补强后已实证**（按评审给的最小证伪方案重做，探针含**负对照**）：
- 轮1 写入 `NONCE_A`；轮2 prompt **只含 `NONCE_B`**；断言轮2 实际发给 provider 的 messages：
  - `roles = ["system","user","assistant","user"]`（**真实回放形状**，而非单条）；
  - `TURN2_SEES_NONCE_A = true`（历史确实被回放）；
  - **`CONTROL_SEES_NONCE_A = false`**（负对照：换新 sessionId 则看不到 A）→ 排除 prompt 自带 / 全局注入；
  - `WORKSPACE_HAS_NONCE_A = false` → 排除"来自工作区文件"；
  - `SESSION_DIR_COUNT = 2`（主路径与对照组各 1 个，符合预期）。

**本轮由验证捕获的问题（延续"验证优先"纪律）**：
1. **真实用户状态被污染**（AGENTS.md §8 破坏）：G-10 的登记接线让**未钉 `VESSEL_SESSION_ROOT` 的测试**写进了真实 `~/.vessel/sessions.json`（实测 8 条测试会话：`C:\tmp\vessel-smoke-*`、`%TEMP%\cah-cli-*`、`cah-oc-go-*`）。→ 已派卡给受影响测试补 session 根注入；残留条目待清理（走回收站备份）。**教训：新增"默认状态根"的写入路径时，必须同步审计所有会构造默认 store 的测试**。
2. 规格漏项自查：BRIEF-09 §4 的 TUI 通道与"TUI 会话登记"在实现里漏做（TUI 会话不在 list、重建 harness 丢上下文）→ 我在评审前自查发现并补齐（`ChatOptions.sessionId` + 透传 + 登记块；`cli.ts` 交互式 `resume` 直接进 TUI）。
3. 评审指出：`resume` 时**静默改写 `--workspace`**（`cli.ts:1547`）与 SCOPING 风险⑥ 的 fail-loud 建议相悖 → 记为 P3 待处置。

**Round 9 显式未做**（写入状态，防被误认为已完成）：快照回滚、会话级用量恢复（需先给 `UsageEntry` 加 `sessionId`）、多会话管理 UI、fork/rewind、云同步。

## Round 10（G-11 之 `--json` 半）— 评审判 **REJECT**，FIX 中

**首轮交付（提交 027410f）**：`output.ts`（`isJson`/`emitJson`/`fail`）+ 五条只读命令的 `--json` 分支 + `resume` 提示抑制 + `USAGE` 说明；`tsc 0`、**125 文件 / 1313 passed + 1 skipped**。

**独立裁定 `EVALUATION-REPORT-12.md`：REJECT（有条件）**：
- **通过**：AC2 两模式口径一致（`totals` 同源、`daily` 同参、`recent` 同表达式）、AC3 stdout 纯净、AC5 默认路径零改动（既有断言无需改）、敏感字段白名单剔除 `apiKey`、`output.test.ts` 4 例非永真。
- **必修 1（AC4，有直接反例）**：`provider list --json` 遇损坏 `providers.json` 时 `ProviderStore` 抛错冒泡到 `main()` 兜底 → **人类文案写 stderr**（我用真实 CLI 复现：`exit=1`、stderr 为「配置文件损坏：…」、`stderrIsJson=空`）。评审另点名 5 处同类未 JSON 化的错误出口。
- **必修 2（AC1）**：五条命令的 `--json` **零用例覆盖**（违反 AGENTS.md 规则 7）。

**FIX（进行中）**：① `jsonCommands.test.ts`（7 例，走真实 `main()`）**已落盘并通过**——含"两模式数值一致（比数值不比格式化串）"、"`provider list --json` 不含 `apiKey`"、"`sessions list --json` 空表恰为 `{sessions:[]}`"、"损坏 `usage.json` 时 `--json` 仍返回 0 且 stdout 可解析"（**AC1 已满足**）；② 把 `main()` 兜底 catch 与 5 处错误出口改为 `--json` 下输出 JSON 信封（`fail(...)`）——**实现卡在途**。

**方法论确认**：本轮我的 E2E 覆盖了"正常路径 + 数据损坏但被内部降级"两种情形，却**漏了"错误冒泡到 CLI 顶层"这一层**——独立 Evaluator 用一条反例就把它抓出来。**教训（第 5 条纪律）：错误路径的 `--json` 契约必须在"异常冒泡到入口"的层级验证**，而不是只验证命令内部已捕获的失败。

## Round 10（G-11 之 `--json` 半）— 已闭环（ACCEPT）

**交付（提交 027410f）**：
- 新增 `apps/cli/src/output.ts`：`isJson(flags)` / `emitJson(value)`（**唯一 stdout 出口**，只打一段 JSON）/ `fail(code,msg,flags,human?)`（JSON 模式打 stderr 信封 `{error:{message,code}}`）。
- **五条只读命令**支持 `--json`：`usage`（`totals/daily/byProvider/byModel/recent`，**与人类报表同参**复用 `since`/`until`/`--recent`）、`provider list`（**逐字段白名单**）、`models`（三分支全覆盖，含 mock 分支原本会打人类提示的路径）、`sessions list`（空表输出 `{"sessions":[]}`）、`settings list`（`{settings:{theme,locale}}`）。
- `resume` 的前置提示用 `!isJson` 抑制（否则破坏"stdout 只有一段 JSON"）；`USAGE` 补 `--json` 说明。
- 沿用 `--json` 分支**全部提前 return** 的写法，保证**默认路径零改动**。

**验收侧证据（真实 CLI E2E + 全量）**：`tsc 0`；**125 文件 / 1313 passed + 1 skipped / exit 0**；判别性结论：① `usage --json` 可解析、keys 正确、无「使用统计」标题；② **两模式数值一致**——写入 1M in + 0.5M out（有价目）→ `EXPECTED=2 / TEXT=2 / JSON=2 / NUMERIC_EQUAL=true`；③ `provider list --json` **无 `apiKey` 字段**；④ `sessions list --json` → `{"sessions": []}`，而人类模式仍为「暂无历史会话」提示（**默认路径未变**）；⑤ `settings list --json` 正常。

**本轮由 E2E 捕获的 2 个真实缺口**（实现者自证均为"已完成"）：
1. **`sessions list --json` 形同虚设**：JSON 分支挂在 `opts.json` 上，但 `cli.ts` 调 `cmdSessionsList()` 时**未传 opts**（正是侦察报告预言的"seam 有、未接线"）→ 已修为 `cmdSessionsList({ json: isJson(parsed.flags) })`。
2. **口径分裂**：`usage --json` 用无参 `daily()/recent()`，人类报表用 `--since/--until/--recent` → 已改为复用同一批变量。
3. **密钥泄露风险（由实现者主动发现并规避）**：`store.list()` 会经 CredentialStore 把 `secretRef` 解析成**明文 `apiKey`**，故 `provider list --json` 采用逐字段白名单而非 `{...p}` 展开。

**测试隔离加固（延续 Round 9 的泄漏事故）**：`vitest.setup.ts` 全局兜底 + 8 个 describe 与 8 个测试文件逐处钉 `VESSEL_SESSION_ROOT`；全量跑完 `~/.vessel/sessions.json` mtime 未变（`realRegistryTouched=False`）；审计确认 5 处默认构造点、6 个导入 `main` 的测试文件与 6 处 `createVesselServer` 调用全部已覆盖，`apps/web` 独立配置且不触碰会话。

**待办**：命令侧 `--json` 的 Vitest 覆盖（补 AGENTS.md 规则 7；走真实 `main()`）；`output.fail()` 与 guidance/sessions 两处失败路径的走线不统一（一处走 `error` seam、一处走 `console.error`）——记为 P3 一致性项。

## Round 11（G-13-P1：`/permission`·`/model` 假成功）— 已闭环（ACCEPT）

**问题**：文案宣称已切换，主循环只打印、从不回写变量且 harness 被缓存 → 用户以为切到 `read-only`，实际仍 `workspace-write`（**用界面欺骗用户的安全设置**）。

**修复**：`SlashResult` 增 `permission?`/`model?`；命令侧校验（非法值**不宣称成功**、不返回字段）；主循环 `applyPendingChanges`（`chat.ts:402-435`）——**harness 已存在则确认即生效**（重建 + `syncSessionMeta` 回写登记表、保留 `createdAt`），尚未懒建则挂起；重建失败**回滚变量 + 保留旧 harness + 明确报错**（不崩、不留"宣称切了没生效"）；复用 `currentSessionId`（`:335`）消除孤儿会话；`planProvider` 收到会话内 `model`（修掉"只改状态行、真实请求仍用旧模型"这条**第二假成功路径**）。

**证据**：`tsc 0`；全量 **126 文件 / 1335 passed + 1 skipped**；判别性 E2E（注入会发 Write 的 provider）→ `POSITIVE(切换 read-only)=未写入 / CONTROL(不切换)=写入 / DISCRIMINATES=true`；TUI 新增 6 例（字段存在性、SessionMeta 落盘 + 负对照、记录型 provider 实测 model、**deny 面 `[DENIED]` + 不含 `[错误]` + 文件未创建**、locale 中英差分）；评审 `EVALUATION-REPORT-15.md` **ACCEPT**。

**过程教训（纪律 8）**：首版"延迟应用"使 `['你好','/permission read-only','/quit']` 场景变更**永不落地**（新测试实测失败）→ 裁定改为"确认即生效"。**安全设置的"已生效"必须在确认瞬间为真**，不能等到"下个回合"。

**残留（下一批）**：① 重建失败时 `previous.close()` 已执行，而 `Session.append` 的惰性重开（`packages/core/src/session/Session.ts:168-170`）**不重取租约** → 回滚后本会话余下时间无租约写入，单写者 fail-closed 失效；该 harness 的遥测投影/MCP 客户端亦不复活。② 无"buildHarness 失败 → 回滚 + 报错"的回归测试；`createdAt` 保真无断言。

## Round 12（G-13-P2/P3：locale 接入与 theme 诚实化）— 已闭环（ACCEPT）

**交付**：`cmdExplain` 生效 locale = `--locale` > settings.locale > `'zh'`（读 settings **任何失败回落 `'zh'`**，不让 explain 失败；非法 `--locale` 报错返回 2）；TUI `resolveChatLocale`（`chat.ts:226-232`）会话启动解析一次、`/explain` 与 `? <术语>` 共用同一值；**theme 文案四处**（`settings.ts:54-55`、`guideCommands.ts:137/164`、`glossary.ts:114-116`、`guide.ts:25/36`）全部改为"仅保存该偏好、当前版本不影响任何输出/渲染"。

**证据**：`tsc 0`；全量绿；评审确认"**无遗漏**、theme 侧合法值/校验/持久化**无行为改动**"，locale 唯一行为改动即本轮要求内的 catch 回落。

**残留**：`cmdGuide`（`guideCommands.ts:104`）读 settings 无 catch，与 explain 口径不对称（P3）。

## Round 13（G-11 之 MCP 半）— 评审判 **REJECT**（窄口径），FIX 中

**独立裁定 `EVALUATION-REPORT-16.md`：REJECT**——E2E **确为真跨进程、非假绿**（`child.pid ≠ process.pid` + `execute` 真返回 `'42'`），验收 1/2/4 通过。但发现 **2 处真实缺陷 + 测试缺口**（详见下方"FIX 中"），其中两条是实现者与我都没抓到的**产品级问题**：
1. **孤儿进程**：`StdioTransport.close()`（`McpClient.ts:142`）布的 2s SIGKILL 兜底，被 `:143-148` 的 50ms 乐观 resolve + `:149` 的 `clearTimeout` **提前取消** → 不响应 stdin EOF 的 MCP server **永不退出**。E2E 没暴露，是因为**测试自己在 `reap()` 里补了 SIGKILL——测试在替被测代码兜底**（此点由独立 Evaluator 点破，是"假绿"的另一种形态）。
2. **`initialize()` 无超时** → BRIEF-13 要求的"server 不响应即超时降级"未实现，`composeHarness` 会**永久挂起**（CLI/TUI 卡死无提示）；且缺陷 1 让既有 2s 兜底也不可能生效。
3. 验收 3（降级四断言）/5（重建不泄漏）**仓内零测试**；CLI 侧 `composeHarness` 抛错时已 spawn 的连接**无 close 兜底**（TUI 侧有）；win32 非白名单 `.cmd` 命令的失败信息含糊。

**FIX（已完成，提交 b98bfc0）**：
- ① `McpClient.ts`——`close()` 的 2s SIGKILL **只在子进程真退出/出错时解除**（`disarmKill` 挂 `exit`/`error`），50ms 快返路径**不再 clearTimeout**（孤儿缺陷已修）；`request()`/`initialize()` 加 **5s 超时**（双层：transport 层清理 pending + `McpClient.initialize` 的 `withTimeout` 兜底，覆盖忽略该参数的 in-process transport）。
- ② `cli.ts`——`composeHarness` 抛错时逐个 `close()` 已 spawn 的连接（补齐 TUI 已有的兜底）；win32 非白名单 `.cmd/.bat` **直接降级并给出可操作原因**（判据：Node 对 `.cmd` 无 shell spawn 会 EINVAL，不存在"能跑却被误杀"）。
- ③ 新增 `packages/application/src/mcp/connections.test.ts`（验收 3 四断言 + 对照组 + 2 条 opt-in 探针；默认 8 pass / 2 skip）。

**疑似缺陷被实测否证（重要）**：测试卡与我**都从代码推断**"不可达 command 的 server 会吊住 CLI 启动"（spawn ENOENT 是异步事件 → 构造不抛 → 失败推迟到 `initialize`；疑撞 dead child 的 EPIPE）。探针实测：`createMcpConnections` 构造期 `CONNECTIONS=1/FAILURES=0`（推断正确），但真实 `initialize` **7ms 内 reject `spawn ... ENOENT`**、无挂起、无未处理异常 → 因 `compose.ts` 已把 `initialize` 包进逐 server `try/catch`，**该 server 正常降级、CLI 不挂**。结论：**该推断不成立、无需修复卡**——「实测优先于静态推断：推断只是候选，证据才算数」（第 10 条纪律）。

**新发现（假红，修复中）**：`stdioTransport.e2e.test.ts` 的「npx shim」用例在**全量并发下连续两次失败、单跑 9/9 必过**（该例单跑 ~2.8s，timeout 30s 充裕）→ 判定为**并发资源竞争**（npx→node→tsx 子进程链在全量并行时被挤压）。这会让全量结果**不稳定（假红）**，已派卡加"提高超时 + 有界重试"，**且明令不得以降级判别力换稳定**（不得删真跨进程断言、不得改 in-process、不得对断言失败重试）。

## 纪律

## Round 13（G-11 之 MCP 半）— 交付细节

**定位**：把"**已有能力的出口**"接上——库级管道早已通（`compose.ts` 的 `mcp` + `registerMcpTools` + `mcp__<server>__<tool>`），但 `apps/cli` 内 `grep Mcp|MCP` **零命中**，用户只能编程接入。

**交付（提交 20f4c73）**：
- **传输层**：`StdioTransport(command, args?, opts?)` 支持任意命令（原硬编码 `process.execPath`）；`resolveSpawnCommand` **只在 win32 + 白名单**（npx/npm/pnpm/yarn/uvx）开 shell，避免 args 二次解析的命令注入；stdout 缺失**显式 throw**（原来是静默 fallback 到本进程 stdin，永远读不到行且掩盖真实错误）。爆炸半径为 0（全仓 `new StdioTransport` 零调用点）已先侦察确认。
- **配置读取器**（`apps/cli/src/mcp/config.ts`）：纯读取器，**零 `@vessel/tools` import**（依赖边纪律）；ENOENT→`[]`、JSON/结构/重复 name→**throw**、原子写；根解析 `opts.rootDir` > `VESSEL_MCP_ROOT` > `~/.vessel`。
- **application 桥接**（`packages/application/src/mcp/connections.ts`）：描述 → transport，**逐 server 降级**（失败进 `failures` 含原因，不影响其余）。
- **接线**：`cli.ts` 的 `cmdRun`（配置错 → **exit 1**）；TUI `buildHarness`（配置错**只 warn 不拒启**，因为已进入交互）；`compose.ts` 的 mcp 装配改**逐连接 try/catch** + 新增 `ComposedHarness.mcpFailures`，catch 内 `client.close()` 兜底防子进程残留。
- **测试**：真跨进程 E2E 9 例（含**反假绿自证**：断言本文件不含同进程传输函数名、断言 `child.pid` 存在且 ≠ `process.pid`、`process.kill(pid,0)` 探活；`afterEach`+`afterAll` 双重收尸）。

**验收侧证据（真实 CLI，临时四根）**：`tsc 0`；**127 文件 / 1344 passed + 1 skipped / exit 0**；E2E 三情形——① 不可达 server → **exit 0** 且输出含 `broken`+「已跳过」；② `mcp.json` 损坏 → **exit 1** 且含「MCP 配置错误」；③ npx 起 `echo-server` → **exit 0 且无失败提示**。即"**配错一个 server 不再让 CLI 打不开，但配置本身坏了仍 fail-loud**"。

**执行器主动报告的三条残留**（交独立验收判严重度）：① `StdioTransport.close()` 的 2s SIGKILL 兜底是**死代码**（50ms 的 resolve 先触发且 `clearTimeout`）→ 不响应 stdin EOF 的 server 可能成孤儿；② 重建失败回滚到旧 harness 时其 MCP transport 已关闭 → 该 TUI 会话内 MCP 工具永久失效（BRIEF-12/13 既有设计）；③ `VESSEL_MCP_ROOT` 在既有测试中零注入 → 开发机若真有 `~/.vessel/mcp.json`，默认路径测试会真 spawn 子进程（隔离隐患，补测中）。

**新增纪律（第 7 条，本轮沉淀）**：**"已有能力的出口"类切片必须先侦察爆炸半径**——确认调用点为零才可直接改契约，否则应加兼容层而非改契约。

## Round 15（G-17：策略可装载 / 可见 / 不静默降级）— 实现中

**P0 的定性与实测**（`ROUND-15-DIRECTION.md` 有完整依据）：产品差异化是"Behavior IR + **Policy 编译执法**"，但审计 + 我的三轮判别性实测把问题从"策略层缺失"推进到**更基本的根因**：
1. 仓库外跑：**不是静默**（`exit 1` + `no policy declaration found`）→ 审计"静默"半条被实测否证；
2. 放入 `<ws>/.harness/policy.yaml` 后：`no policy declaration found` **消失**（project 层接线生效，`DISCRIMINATES=True`），但失败点**前移**为 `behavior IR not found: <ws>/configs/behavior.default.yaml`；
3. → **真根因：默认配置全部按 cwd 拼，CLI 不携带内置默认**，所以"用户在自己工作区里跑 `vessel run`"注定失败，与策略层无关。

**已落地**：
- `resolveProjectPolicyPath()`（`cli.ts:173`）接通 project 层 → `cmdRun` + TUI 两分支 + `chat.ts` 透传（`ChatOptions.policyProjectPath`）。
- `builtinConfigRoot()`（`cli.ts:181-190`）：默认 policy/behavior 解析到 **CLI 自身携带**的 `configs/`（由 `import.meta.url` 上溯），找不到才回落旧行为；`--policy`/`--behavior` 显式覆盖语义不变。
- **决定性验收（实测）**：仓库外工作区 `run --prompt '你好'` → **`exit 0` 且真跑了一个回合**（`kind=success steps=1`，会话日志写入 `<ws>/.harness/sessions/`）；修复前同命令为 `exit 1 + behavior IR not found`。
- 门禁注记加固（Round 14 遗留）：导出 + 归一化全等取代 `endsWith`（`foo-process-tree.test.ts` 不再误命中）+ 分支 A 加"单跑失败即真实回归"条件语；**20/20 表驱动单测**；并加 ESM 入口守卫 `shouldRunAsScript()` 使该模块可被导入（**已验证脚本直跑仍正常打印 banner**）。

**进行中**：`vessel policy status`（AC2–AC4：层次事实/哈希/`--json`/"部分装载不静默"警告）+ AC5（`POLICY-SPEC` 中 user 层与 workspace trust 门的**诚实标注或实现**）。

### Round 15 完成态（AC1–AC5 全部落盘 + 7 条判别性 E2E 实测）

| AC | 实测证据 |
|---|---|
| AC1 project 层参与执法 | 放入 `<ws>/.harness/policy.yaml` → `no policy declaration found` **消失**（`DISCRIMINATES=True`）；调用链：`resolveProjectPolicyPath` → `composeHarness(policyProjectPath)` → `loadPolicyArtifacts(projectPath)` |
| AC1+ **仓库外可用**（真根因） | 临时工作区 `run --prompt` → **exit 0 且真跑一回合**（修复前 `exit 1 + behavior IR not found`）；**产物形态** `node apps/cli/dist/cli.js` 同样 exit 0 |
| AC2 哈希来自真实内容 | 改内容 → `HASH_DIFFERS=True`（`a3632a037705` → `8067c9f240c0`） |
| AC3 `--json` 单一可解析 | exit 0、`JSON.parse` 成功、`effectiveOrder=system>project` |
| AC4 部分装载不静默 | system 缺 + project 有声明 → **告警且 exit 0**；两层齐备 → **无告警**（`DISCRIMINATES=True`）；产物形态下告警含**该层真实路径**（可操作） |
| AC5 诚实 | `POLICY-SPEC:454-459` + `ARCHITECTURE.md:325` 标注**只实现 system + project**，user 层 / trust 门 / session 层尚未实现 |
| 错误场景 | 非法 `.harness/policy.yaml` → exit 1 且三条输出（告警 / `policy status` / 报错）**指向同一事实**："存在但无法解析 → 修复该文件（含路径与原因）" |

**基线**：`tsc 0`；**132 文件 / 1431 passed + 3 skipped / 0 failed**；`policyStatus.test.ts` 10/10（含 AC2 写回反向锁与 AC4 负对照）。

**本阶段两次"测量纪律"实证**：① 我抓到"非法策略被误报为缺失、且建议动作是错的（让你放置一个已存在的文件）"——根因是**判据用"声明数为 0"代替"文件不存在"，把两种失败形态混为一谈**，修法是给层次事实加 `error` 字段做三态区分；② 修正后我第一次复测得出**错误结论**，因为**执行器还在半写入**——测量必须对**稳定版本**进行（见纪律 14）。

## 纪律

**流程纪律**：并发执行器上限 2–3；一卡一执行器；删除走回收站；密钥不落盘；测试隔离（`VESSEL_*_ROOT` 注入）；写入型执行器**不跑命令**，由指挥复跑 `tsc`/vitest 并保命提交。

**验证纪律（历轮实证沉淀，通用）**：
1. **端到端必须走真实用户路径**——用组件级渲染替代接线验证，会把"功能未接通"误判为"功能已实现"（Round 8：`buildHarness` 未传 `usageStore`，TUI 成本恒 `$0.0000`）。
2. **断言锁"因果链上必然变化的量"**（`calls`/`inputTokens`/子进程 pid），不锁经过格式化/舍入的展示值（`$0.0000`）——后者会把正确实现判红。
3. **验收断言必须打到因果链末端**——"resume 有效"要证明**模型收到了历史**（记录型 provider 捕获 messages），而非"日志变长"（Round 9）。
4. **新增"默认状态根"写入路径时，必须审计所有会构造默认 store 的测试**——否则真实用户目录被测试污染（Round 9：8 条测试会话写进真实 `~/.vessel/sessions.json`）。
5. **错误路径的契约要在"异常冒泡到入口"的层级验证**——只验证命令内部已捕获的失败会漏（Round 10：`provider list --json` + 损坏配置仍打人类文案）。
6. **判别性探针必须自带"旧行为会红"的对照**——`NAIVE_TRUNCATE_WOULD_LEAK=true` 这类自证，才能证明用例有判别力（Round 7b）。
7. **"已有能力的出口"类切片先侦察爆炸半径**——确认调用点为零才可直接改契约，否则应加兼容层（Round 13 的 `StdioTransport`）。
8. **"宣称已生效"必须在确认瞬间为真**——延迟到"下个回合"会让切换后立即退出的场景永不落地（Round 11）。
9. **测试不得替被测代码兜底**——若测试自己在收尾时补 `SIGKILL`/补清理/补重试，那么"被测代码能正确清理"这条断言就是**假绿**：Round 13 的 `StdioTransport.close()` 2s 兜底被 50ms 路径 `clearTimeout` 取消（孤儿子进程），而 E2E 全绿只因 `reap()` 自补了 kill。**验收清理/回收类行为时，必须确认测试没有替实现代劳**。
10. **实测优先于静态推断**——推断只是候选，证据才算数。Round 13 中测试卡与编排者都从代码推断"不可达 MCP server 会吊住 CLI"，探针实测却显示 `initialize` **7ms 内 reject**、由既有逐 server `try/catch` 正常降级 → 该推断不成立，避免了一次不该开的修复卡。**开修复卡前先跑一个最小探针。**
11. **区分"真红"与"并发假红"**——同一用例"单跑必过、全量必败"且失败信息指向启动/超时，通常是资源竞争而非逻辑缺陷；处置方式应是"提高超时 + 有界重试（仅对启动/握手类环境性失败）"，**绝不以删断言/改 in-process 换取稳定**。
12. **报告/注记不得注入未经证据支持的归因**——错误的 `note` 比"单条测试假绿"更危险：假绿只骗过一条用例，而错误注记会**主动诱导人忽略真实红**。归因必须由实际输出推导，无法归因时如实写"未自动归因"。Round 13/14 实证：门禁把"我引入的 env 泄漏"写成"既有 process-tree flaky"，我若照单全收就会放过一个真实回归。
13. **验证动作不得破坏它所验证的证据**——我为了验证门禁脚本的入口守卫而直接跑了它（未带密钥），这会用一份 `partial` 报告**覆盖**刚拿到的 clean `ready` 报告，多亏及时终止。**验证前先想清楚"会写什么、写到哪"**；可换临时输出目录，或只做"能否启动"的最小探测，并用完后**清理自己产生的孤儿进程**（本次清理了 5 个 gate/tsx/vitest 残留，**只按 PID 精确终止**，绝不误杀 harness）。
14. **只对"稳定版本"测量**——执行器是**边写边落盘**的：Round 15 我在 `PolicyLoader` 已加 `error` 字段、而 `cli.ts` 尚未接入该分支的**半写入窗口**里跑 E2E，得到"合法但未贡献声明"这个**错误结论**，差点据此开错修复卡；两张卡都落盘后重跑才正确（`saysInvalid=True`）。**测量前先确认没有并发写入者**（看 `git status`、卡是否仍在跑），必要时先等卡结束或对同一修订连测两次一致再采信。
15. **测试若绕过生产入口，等于零证据**——Round 15b 的 C-1 是典型：`mergeScopes` 重建 `filesystem` 时**丢掉了 `confinement`**，使该硬执法特性在生产路径（`compose.ts` → `loadPolicyArtifacts`）**永不生效**；而 6 个 confinement 测试**直调 `compilePolicyYaml`**、跳过了合并层，于是 61/61 全绿**不可能**发现这个纯生产路径缺陷。**凡涉及"合并 / 装载 / 接线"的验收，必须至少有一条走完整生产入口**（用真实文件 + `loadPolicyArtifacts`），否则绿灯只证明"组件本身对"，不证明"用户拿到的行为对"。
16. **安全守卫的默认值要按"代价不对称"选择，且两侧都要有边界**——force-push 守卫上，**漏放（allow）＝唯一防线失效**，**误拦（deny）＝用户少做一次罕见操作**；代价严重不对称时，**不确定就应拦（fail-closed）**，而不是"解析不了就当没发生、只在注释里说明"（后者工程上省事、安全上是错的默认值）。但**同时**必须给出**防过度拦截的硬边界**：与守卫目标无关的命令（不含 `git`+`push` 的段）**绝不能被兜底误拦**，并要求负对照用例（如 `xargs ls`）。**收紧与放宽都不许失控。**
17. **"能跑一次"不等于"可发布"**——Round 17 我亲手跑通了"整仓 pack → 空项目安装 → 三条命令 exit 0"，但终评指出：`prepack` **只复制 configs 不构建**，而 `.gitignore` 排除 `dist/` ⇒ **干净检出**上打出的包**只有 `dist/configs/*`、没有 `dist/cli.js`**，`bin`/`main` 全悬空、**安装仍 exit 0**。我那次成功**只因工作区里恰有一份手工 `tsc -b` 产物**——**一次性人工实测提供的是假安全感**。凡"某个环境里能用"的结论，必须转化为**离线、确定性、可回归的门禁**（并让"前提不成立"这一情形**变红**），否则它证明的只是"我此刻的机器上恰好能用"。
18. **批量"机械抄写"类任务，必须先验证"要抄的规则"本身**——Round 19 我给执行器的指令是"新增 `@vessel/*` 声明时照抄仓库里**多数派**的版本范围"，而真实版本**不是单一多数派**：`@vessel/shared` 是 **0.10.0**、其余是 **0.1.0**，且 **caret 在 `0.x` 上只允许同 minor**（`^0.1.0` 不匹配 0.10.0）⇒ 照抄多数派会给 `shared` 写错范围，npm workspaces 便**不链接本地包**，**破坏安装**。危险之处在于：**错误规则被一致地应用后，diff 看起来整齐、审查看不出异常**。**给机械批量任务的正确做法是先核对"规则作用于每个对象时的取值是否一致"（此处应"读目标包自身 version 写 `^<version>`"），而不是让执行器去猜多数派。**（本轮我在卡落地前核对版本表并 steer 纠偏，未造成实际破坏。）
19. **"没跑"必须与"通过"可区分——静默跳过等于假的绿灯**——Round 20 在 `confinement.test.ts` 抓到一条老用例 `catch { return }`：在**不支持创建链接的主机**上它**零断言执行却 PASS**；同一批里 S003 的三条判据**从未被执行**（场景被排除在 `SAFETY_SCENARIOS` 之外），而报告里却显示 `passed`。**任何"因环境不具备而没测"都必须显式化为 skip/pending 并可见**；判据不得在未执行的情况下产出绿。这也是我把"2 个 skip"与"1596 passed"分开报数的原因。
20. **报告里的一行 PASS 必须能追溯到"哪条判据、在哪次运行中判定的"**——S003 的 `passed` **不是它的判据给出的**：那三行全部来自 **real-model-lane**，其判据是 `contracts/vessel.ts:171 success = runError===null && finalText.trim().length>0`（"模型说了话"），**与 `S003.yaml` 无关**；铁证是该行 `policyViolations: 0`（一次 denial 都没有）却标 passed。**判据与产出行之间必须有可核对的绑定**（字段/批次/断言计数），否则"绿"只是**来源不明的绿灯**——而它恰好在产品最核心的安全基准上出现。

## Round 15b（安全加固：策略执法本体的三处真实缺陷）— 已修并实测

由 AC5 诚实性核查顺链追出（**均非审计/复评提出**），三处共同形态是"**功能写了、看着也在，但实际不生效**"——比"缺失"更难发现，因为它通过所有"存在性"检查：

| # | 缺陷 | 修复前实测 | 修复后实测 |
|---|---|---|---|
| 1 | **项目策略可提权**：`mergeScopes` 对 `profile`/`approval` 是"后者覆盖"，层序 `[system, project]` → project 赢（与 `POLICY-SPEC:470`「profile/approval 取高层默认」**相反**） | 加项目层 `profile: danger-full-access` → **`danger-full-access`** | 三情形均 **`workspace-write`** ✅ |
| 2 | **项目策略可放宽 force-push**：`git`/`network`/`audit` 为对象浅覆盖 | system `force_push: deny` + project `allow` → 编译规则 **`deny` → `allow`**（`deny_domains: []` 可抹掉元数据 IP） | 仍 **`deny`**；`deny_domains` 并集 ✅ |
| 3 | **`shell-force-push` 规则是死的**：`Compiler.ts` 用**字面量 `startsWith(prefix)`**，故 `Shell(git push --force*)` 对真实命令**永不匹配**，且**全仓零测试** | 真实 force-push 命令 → 谓词 **false** | **true**，且普通 push / commit **false**（不误拦）✅ |

**修法**：① `profile`/`approval` 改 **first-wins（高层优先）**；② `git`/`network`/`audit` 改**单调趋严**（`force_push` 三态取最严 / `network.default` 取最严 / `deny_domains` 并集 / `audit.events` 并集、`details` 取最详尽 / 三域未登记键高层先声明者胜）；③ `Compiler` 的 `Shell()`/`Bash()` matcher **支持 `*`**（逐字转义 + 锚定正则，复用既有 `globmatch.ts`），不含 `*` 保留原 `startsWith` 语义。

**验收证据**：`tsc 0`；**134 文件 / 1460 passed + 3 skipped / exit 0**；`packages/policy` **61/61**（mergeScopes 19 + compilerMatcher 10）；`benchmarks/runners` **216/216**（matcher 变更无回归）；三条判别性探针见上表。**独立安全复评**：`EVALUATION-REPORT-20.md` 判 **REJECT（有条件）**——四处修复核心成立，但挖出**两条高危未闭合**（见下），并指出 `cli.ts:509` 反向文案。

### Round 15c（安全复评的两条高危 + 一条中危）— 修复中

| # | 缺陷（复评发现） | Orchestrator 实测复核 |
|---|---|---|
| **C-1** | `mergeScopes` 重建 `filesystem` 时**丢掉 `confinement`** → 该硬执法特性在**生产路径永不生效**（`Compiler.ts:137/169/278` 读它，而唯一设置途径是策略文件、必经合并） | 读码确认（`:244-248` 只带三个键）。**6 个 confinement 测试直调 `compilePolicyYaml` 绕过合并** → 61/61 全绿掩盖此洞 |
| **C-2** | **allow 类列表并集 = 低层可放宽执行**：project 追加 `shell.allow: ["bash"]` → `bash -c "rm -rf /tmp/x"` 从 **deny 变 allow** | ✅ **实测确认**：仅 system → `deny`；加项目层后 → **`allow`**（`rm -rf /tmp/x` 本身仍 deny，即"包一层即绕过"）。叠加无 trust 门 → **克隆仓库即可放宽执行** |
| C-3 | force-push 仍可绕：`git push origin main --force`（尾置）、`sh -c`、`sudo`；且一个测试把 `sudo` 不命中**锁成"正确行为"** | 静态（规则要求 `--force` 紧跟 `push`） |
| C-4 | `cli.ts:509` 仍打印"靠后的层覆盖标量"（唯一层事实展示通道，说反了） | ✅ 已修（改为"左侧为高层：profile/approval 取高层先声明者；deny 类列表取并集；低层只能加限制"）。**行号更正（Round 19 实测）**：文案实际在 **`cli.ts:641`**（非 `:509`）；`pricingSyncMismatchWarning` 定义在 **`:291`**、其**调用点**在 **`:1818-1819`**（非 `:1793-1794`）。 |
| C-5 | `version` 仍后者覆盖（当前不可利用） | 静态 |

**由此新增纪律 15**：**测试若绕过生产入口，等于零证据**——C-1 正是"组件级测试全绿、生产路径特性失效"的典型（详见纪律段）。

**C-1/C-2/C-3/C-5 修复已完成并由我实测封堵**（提交 `d39570e`）：

| 验证项 | 修复前 | 修复后 |
|---|---|---|
| C-2 `bash -c "rm -rf /tmp/x"`（+项目层 `shell.allow:["bash"]`） | `allow` | **`deny`**（与仅 system 相同） ✅ |
| C-1 `filesystem.confinement: true` | **到不了编译器**（恒 false） | **`fs-confinement` 规则已生成** ✅ |
| C-3 绕过形（尾置 `--force` / `git -C` / `sh -c` / `sudo`） | 均不命中 | **全部 `deny`** ✅ |
| C-5 `version` | 后者覆盖 | 高层优先 ✅ |

**修法**：`filesystem.confinement` **any-true**（都未声明保持 `undefined`，不写 `false`）；**allow 类字段高层先声明者胜出**、`scoped_rules`/`tools.rules` **按 action 分流**（低层 allow 规则**无条件丢弃**，deny/ask 可并集）；`git:force-push` 改用专用谓词 `detectForcePush`（引号感知分段/分词 + 包装器剥离（`sudo`/`env`/`nohup`…，深度上限 4）+ 位置无关判定）；`version` first-wins。

**已知残留（实现者诚实标注 + Orchestrator 实测量化，交复评判级）**：
- ① **allow 补空档**：allow 类字段在"高层**完全未声明**该键"时低层仍可补。**实测确认在生产路径不可达**——`configs/policy.default.yaml:21` 显式声明 `filesystem.allow: []`、`:28` 声明 `shell.allow: [...]`，故 system+project 路径无空档。**该残留无害**。
- ② **C-3 盲区（实测确认可利用）**：在 `--permission danger-full-access` 放宽会话下（profile 门不兜底、deny 规则是唯一防线），`git push origin +main`（**标准惯用写法**）、`env -S "git push --force" …`、`eval "git push --force …"` **均裁决为 `allow`**（而 `git push --force origin main` 与 `git push origin main --force` 均为 `deny`）。已派收口卡：`+refspec` 视为强制推送、`env -S`/`eval` 纳入"取字符串递归"同类处理；`xargs`/外部脚本/深度 >4 包装如实列为**已知 fail-open 边界**（不假装覆盖）。

**第二轮独立安全复评（`EVALUATION-REPORT-21.md`）：ACCEPT**——C-1→C-5 逐条核验**均真实落地、语义正确**（`PolicyLoader.ts:204-208/194-197/224-232/300`、`cli.ts:509`、`Compiler.ts:198-280/402-403`）；测试 32/16 例计数属实、端到端真走 `loadPolicyArtifacts` + 真实文件；**上一轮 C-1 的藏身处（测试绕过生产入口）已封闭**。

**复评列出的未闭合项（R-1 已处置，其余记入候补）**：
- **R-1 [中，处置中]** C-3 残留盲区经静态复核**全部成立**：`git push origin +main`、`env -S "…"`、`eval`/`xargs`、`sh script.sh`、深度 >4 fail-open。**默认策略下不可利用**（profile 门兜底），但 `--permission danger-full-access` 下可利用——**而这正是 S006 断言 force-push 被拒的那种会话**。复评给出更强立场：**"无法解析的间接形式应 fail-closed（判定命中/deny）"**。**Orchestrator 采纳该立场**（对 force-push 这条规则，**误拦代价远小于漏放**：合法 force push 极少），已定向追加给收口卡：精确判定优先，**仅在解析不完整/存在未跟随间接层时兜底 deny**；不含 `git`+`push` 的段**不得**被兜底误拦。**实测进展**：`+refspec` **已封堵**——放宽会话下 `git push origin +main` / `+HEAD:main` → **deny**（修复前均 allow），而 `git push origin main`、`git push origin feature+fix`、`echo a+b` 仍 **allow**（**边界正确：不因任意 `+` 触发**）；`xargs git push --force` 仍为 allow（fail-closed 兜底待完成）。
- **R-2 [低-中]** `guidance` 无条件并集是无 trust 门的**提示注入面**（低层可注入任意软引导文本，不参与执法判定）。
- **R-3 [低]** allow 空档仅在**非默认配置**可达（`--policy` 指向未声明该键的最小策略，或 system 层缺失时 project 变 `decls[0]`）。
- **R-4 [低]** `firstDeclared` 遇 YAML 裸 `allow:`（null）会 TypeError（**fail-loud，非放行**）。
- **R-5 [低]** `scoped_rules` 分流按"最高层"而非"首个声明者"；system 无 shell 块时 project 的 allow scoped 规则被丢（**fail-closed**）。
- **R-6 [低]** 潜伏：`git/network/audit` 未登记键可补空位（当前无消费者）；顶层 `session` 键被 `mergeScopes` 静默丢弃；**`policyStatus.test.ts:323` 未锁 C-4 新文案**（回潮不会变红——测试盲点，建议补一行断言）。

**方法论**：验证一律看"**它对真实输入的反应**"，而非"代码里有没有"——真实策略文件 → 编译出的 `decision`；真实命令 → 谓词返回值；真实工作区 → `run` 的退出码。

## Round 16（G-18：宣称与实际不符，1C 首片）— 1C 完成，复评在途

**1C（mock 运行期可见）**——原始实测痛点：无配置时 mock 会**真的调用工具读文件**，回复"看起来就是真模型"，新人确信已接上模型。已修（提交 `0c1abb8` + `7518b4e`）：

| 侧 | 提示 | 回复标记 | 判定同源 |
|---|---|---|---|
| CLI | `MOCK_PROVIDER_NOTICE` 走 **stderr**，回合开始前（`cli.ts:696`） | `renderFinalReply` 单一出口加前缀（幂等） | `usingMockProvider = realProvider === null`（与实际使用的 provider 同源） |
| TUI | `TUI_MOCK_PROVIDER_NOTICE` 走既有 `io`（`chat.ts:442-445`，每会话一次，重建不重复刷屏） | `renderTurnReply` 唯一出口加前缀（幂等） | `usingMockProvider` 唯一置 true 处紧邻 `new MockProvider(...)`（`chat.ts:422`） |

**实测（Orchestrator E2E）**：临时工作区 `run --prompt '总结 README'` → stderr 含「未连接真实模型」提示，且**那条原本"像真模型"的回复**现带 `（mock 离线冒烟）` 前缀。**负对照**：真 provider 路径由既有 52 个 CLI 测试 + 41 个 TUI 测试覆盖（它们断言真 provider 输出**逐字**为 `CLI-106-MARKER` / `GO-MOCK-PONG`，若给真 provider 也加标记必红）。

**诚实标注的边界（交决策，未做）**：① 标记加在**渲染出口**而非 `MockProvider` 内部 → **落盘 transcript 仍无标记**（要覆盖须改 `packages/llm`，属另一个决定——**我的判断：渲染层已解决"用户看见"，transcript 是事后审计，记入候补而不扩张**）；② TUI 的 `io` 无 stderr 面，提示走 stdout（TUI 无 `--json` 机器契约，可接受）；③ 测试注入 provider 的接缝**不加**标记（避免把任意 fake 误标为"内置 mock"）。

## 发布里程碑（用户已选定：`npm pack` + tarball 验证；未选全量 npm 发布）

**为什么是"对外成熟"的最大阻塞**：当前**无法安装**——`@vessel/cli` 依赖未发布的 workspace 包；用户唯一路径是 clone→build→`npm link`。

**侦察已确认的三类硬伤与处置**：
| 硬伤 | 状态 |
|---|---|
| 第三方依赖漏声明（`@clack/prompts` 只在 root 却被 `setup.ts:1` import；`js-yaml` 只在 root **devDeps** 却被 `policy/Compiler.ts:1`、`behavior/BehaviorIR.ts:2` import） | ✅ 已按包声明（`@clack/prompts`→cli、`js-yaml`→policy/behavior） |
| `apps/cli` 缺 `files` → npm 回退 `.gitignore`（其中忽略 `dist/`）→ **包会连自己的产物一起丢** | ✅ 已补 `files:["dist"]`+`engines`；**`npm pack --dry-run` 实测**：tarball 262 文件 / 397.6 kB / 解包 1.7 MB，全来自 `dist` |
| `dist` 内无 `configs/*` → 安装态 `builtinConfigRoot()` 上溯 6 级必落空 → 策略/behavior/pricing 全指向不存在路径 | ✅ **已修并用产物形态验证**：`builtinConfigRoot()` 改为**包内优先**（模块目录 → 上一级 → 上溯 6 级 → 回落 `repoRoot()`）；新增 `apps/cli/scripts/copy-configs.mjs` 并由 **`prepack`** 钩子在打包前把仓库根 `configs/` 复制进 `dist/configs/`（**不依赖根构建链**）。**实测**：`npm pack --dry-run` → tarball 含 `dist/configs/{policy.default.yaml,behavior.default.yaml,pricing.json,model-catalog.json}`（270 文件 / 406.3 kB）；从**临时目录**运行 `node apps/cli/dist/cli.js policy status` → system 层指向 **`<pkg>/apps/cli/dist/configs/policy.default.yaml`**（`pointsIntoPackageDist=True`、`pointsAtTempCwd=False`） |

**`npm pack --dry-run` 新发现（打包卫生，待处理）**：tarball **包含编译后的测试产物与 source map**（`dist/**/*.test.js`、`*.test.d.ts`、`*.js.map`）→ 发布物带测试代码与内部映射。处置方向：`files` 加否定模式（`!dist/**/*.test.*`、`!dist/**/*.map`）或独立 build 配置排除测试。**待 `apps/cli/package.json` 的在跑卡落盘后一并处理**（避免同文件冲突）。

**仍未闭合的系统性缺口（已完成精确量化）**：**16 个 workspace 包里有 14 个**存在缺失的 `@vessel/*` 依赖声明（只读扫描：逐包对比 `package.json` 的 `dependencies` 与其 `src/**` 非测试文件的实际 import）。清单：
`agents`（缺 context/core/policy/runtime/shared/tools）、`engine`（缺 agents/core/llm/shared/tools）、`local-server`（缺 agents/core/policy/shared）、`cli`（缺 llm/policy/shared）、`context`（缺 core/shared）、`telemetry`（缺 core/shared）、`tools`（缺 runtime/shared）、`behavior`/`llm`/`memory`/`policy`/`runtime`/`skills`（各缺 shared）、`core`（缺 shared）。

**关键判断（决定优先级，避免过度投入）**：Node 的模块解析**会向上查找**——把 17 个 tarball **一起**装进一个临时项目时，`@vessel/context` 里 `import '@vessel/shared'` 会沿 `node_modules/@vessel/context/node_modules → node_modules/@vessel → node_modules` 上溯并在**项目顶层**找到它。所以**缺声明不阻塞"整仓一起 pack + 一起装"**（用户已选路线）；它只在"**从 registry 单独安装 `@vessel/cli`**"（路线 a）时才是硬阻塞。
→ **排序**：先做"包内 configs 可达"（在跑）→ 跑**整仓 pack + 装机 E2E**（用户选定路线的验收）→ 若通过，则把"14 包补 `@vessel/*` 声明"记为 **P2（仅为将来 registry 发布所需）**，不在本路线内扩张。另 `@vessel/bench-runners` 是**运行期 `await import`** 但 `benchmarks/runners` 为 `private:true` → `run --bench` 在安装态不可用，属**功能面缺口**，同样记 P2 并如实写入文档。

## Round 16b（第三轮复评）— 片 A REJECT（我引入一处 P1 回归），B/C 通过，D 部分

`EVALUATION-REPORT-23.md`：
- **A（R-1）REJECT**：**续行修复在 Windows 上引入回归**——`\`+换行被**无条件**按 POSIX 语义当续行，但本产品 Windows 走 **cmd.exe**（`shellTool.ts:44/70` → `shell:true`），cmd 里 `\` **不是**续行。构造：`git status \`+换行+`git push --force origin main` → 被**合并**成一条弱命令（子命令 `status`）→ **allow**，而真实 cmd 执行两条、第二条是 force push（**修复前反而是 deny**）。另 alias 仍漏**跨命令形**（`git config alias.p 'push --force' && git p`）。
  **处置（已派卡）**：**不用 `process.platform` 分支**（编译期与执行期可能不同平台，且会漏判），改为**平台无关的并集判定**——按 **POSIX 与 cmd 两种语义各解析一次，任一判定为 force push 即 deny**（符合纪律 16：不确定就拦）；并**保守封堵 alias 跨命令形**（整条命令里出现 `git config`/`git -c` 语境的 `alias.` 定义即 deny，不要求同段调用）。
- **B（1C 测试）ACCEPT**、**C（1B/2B/2C）ACCEPT**（1B 的验收标准修订被判定"不掩盖问题"、2B 判据确来自**真实生效后端**、2C 与 `dispatch` 逐项一致）。
- **D PARTIAL**：缺口清单少列 `@vessel/core`（CLI 未声明的是 shared/core/llm/policy 共 4 个）；**`@vessel/bench-runners` 为 `private:true` 却是运行期 `await import`（`cli.ts:755/1850`，无 try/catch）→ 装 tarball 后 `run --bench`/`bench-report` 必 MODULE_NOT_FOUND**。

**本轮的"规格错误"（我犯的，已记录）**：我在卡里断言"policy/behavior/**pricing/model-catalog** 全用 `builtinConfigRoot()`"——**未核实即写**。执行者更正并被核实：`builtinConfigRoot()` **只覆盖 policy/behavior（4 处）**，pricing/model-catalog **仍走 `repoRoot()`（cwd）**，而 `loadPricing`/`loadModelCatalog` 对缺失路径**静默返回空表** → 安装态会**静默算错价目**（比崩溃更难发现）。已派卡改 3 个读路径 + **对"默认路径不存在"加明确 warn**（放大器必须一起修）；`cmdPricingSync` 的**写盘目标**属产品决策，要求只报告不改。
**教训（并入纪律 4 的延伸）**：**给执行器的事实也必须先核实**——错误前提会把实现带偏，且往往让"看似修完"漏掉最难发现的那条（静默错数据）。

**✅ 里程碑达成（用户选定路线 (c)）：端到端装机验证通过**——把 16 个 workspace 包 `npm pack` 到临时目录，在**全新空项目**里一次安装（`install exit=0`），三条命令全部 **exit 0**：
| 命令 | 结果 |
|---|---|
| `node node_modules/@vessel/cli/dist/cli.js --version` | exit 0 → `Vessel CLI v0.10.0` |
| `--help` | exit 0，含用法 |
| `policy status` | exit 0，且 system 层解析到 **`node_modules\@vessel\cli\dist\configs\policy.default.yaml`**（`pointsIntoInstalledPkg=True`） |

→ 即**不需要 clone 仓库**，装完即可运行，且**装到别处时 CLI 仍找得到自己的配置**。审计指出的"对外无可安装路径"这一阻塞，在 **(c) 级别已消除**（未做全量 npm 发布，也未做单包 bundle）。
**同时验证的周边事实**：`files:["dist"]`+否定模式让 tarball **270 → 62 文件 / 406.3 → 184.9 kB**，且 `dist/cli.js` 与四个 `dist/configs/*` 仍在包内、测试产物与 source map 零残留；`prepack` 钩子保证**不依赖根构建链**也会带上 configs。

**仍未闭合（如实记录，P2）**：① 14 个包缺 `@vessel/*` 声明——**不阻塞上述"整包一起装"路径**（Node 解析上溯到项目顶层即可命中），但会阻塞"从 registry 单独安装 `@vessel/cli`"；② `@vessel/bench-runners` 为 `private:true` 却是运行期 `await import` → 安装态 `run --bench`/`bench-report` 必 MODULE_NOT_FOUND；③ `dist/.tsbuildinfo` 仍入包（要排除需写 glob `!dist/**/.tsbuildinfo`，**不能**写指向真实文件的 `!dist/.tsbuildinfo`——后者会被 `requiredFiles` 反强制入包）；④ pricing **写**路径仍在 cwd（读已改包内）→ 已加 warn 消除静默，**产品形态正解（写 `~/.vessel` + 读时用户目录优先）留作候选**；⑤ `npm pack --json` 的 stdout 会被 `prepack` 脚本输出污染（自动化场景需注意）。

## 技术债

G-15 原子写 wrapper 各 Store 重复（P4）；architecture 审计的 T1–T9 清单（详见 `docs/product-audit/ARCHITECTURE-REPORT.md`）。

## 风险

- 执行器不稳定（跑 tsc/vitest/tsx 的子代理必中断；跨多文件中等任务亦常败）→ 已确立并**实证有效**的三件套：**写入型微任务（单文件、禁跑命令）+ 指挥跑验证 + 独立静态对抗 Evaluator**。
- 独立 Evaluator：命令型 4 次连败 → 全部改为**静态对抗审查**（新上下文 + 对抗立场 + 附指挥原始证据，报告如实标注"命令未复跑"）。
  **有效性已被证明**：Round 1 抓出 4 项实质缺陷（含指挥自身一处错误结论），Round 2 判 ACCEPT。
- 交付链脆弱：多次出现"执行器写完即中断、交证丢失"——对策：指挥每步 `git` 保命提交 + 亲自复跑验证。
