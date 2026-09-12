# EVALUATION-REPORT-24 — Round 16 增量 + 发布里程碑（独立终评）

**审查方式**：静态审查，未复跑命令（未跑 tsc / vitest / npm pack / 安装）。立场：先假设修复表面、测试为假、装机结论不可复现。
**证据口径**：所有 `文件:行` 均指本仓库当前工作区内容。`packages/policy` 相关断言另静态核对了 npm 11 自带 packlist 源码。

## A. force-push 平台并集（`packages/policy/src/risk/Compiler.ts`）— 判定：PASS

① **并集确为「两种语义各解析一次」**：入口 `:761-766` 两次调用 `detectsForcePushUnder(command, mode)`；递归内部全部原样传 `mode`（`:624`、`:633`、`:649`），无二次并集 ⇒ `depth`/`stripped` 语义未被放大，深度上限仍为 4（`:70`、`:638`、`:731`）。并集是单调放大（deny 集合取并），结构上只能多拦、不可能新增放行 ⇒ 不会引入新 fail-open。
② **cmd 下 `\` 确已不再当续行/转义**：`normalizeLineContinuations` 只在 `mode==='posix'` 处理 `\`（`:258`），`^` 仅在 cmd 且**后随** `\r?\n` 时吞（`:272-278`）；`splitShellSegments`（`:303`、`:311`）与 `tokenizeShellSegment`（`:358`、`:366`）的转义分支同样以 `mode==='posix'` 为门。故 cmd 语义下 `git status \`+NL+`git push --force …` 保持两段、第二段命中；上一轮 P1 复现路径被堵死。反向的过度拦截（posix 合并）已由并集一侧命中，符合 `:754-759` 的自述代价。
③ **alias `--get`/`--list` 区分可靠**：`gitArgsDefineAlias`（`:175-204`）先短路读取动作（`:193`），再跳过独立取值选项 `-f/--file/--blob/--type/--default`（`:162`、`:194`），最后要求「键 **且** 值」齐备（`:203`）。逐条推演：`git config --file /tmp/cfg alias.p 'push --force'` → 跳 `--file` 的值后 `key=alias.p,value=…` ⇒ deny；`git config --global --get alias.p` → `:193` 短路 ⇒ allow；`git config alias.p`（无值）⇒ allow，与 `:153-155` 声明一致。大小写不敏感（`:144`、`:203`）。
④ **测试两侧齐备、未见永真断言**：`compilerMatcher.test.ts:517-528`（必拦：posix 合并/多段）、`:530-542`（既有命中面不得回归）、`:544-557`（跨段 alias 定义必拦）、`:559-575`（非别名配置 / `--get` / `--list` / 单参数读取必放）、`:577-590`（两种语义都不误拦 + 已知边界 `"git push \<NL>--force"` 如实 allow）、`:592-626`（端到端 deny/allow 双向）。断言全是具体布尔/对象比较，无 `toBe(true)` 式的恒真结构。
⑤ **JSDoc 如实**：`:742-759` 明写并集代价与「更保守误拦」，`:703-718` 逐条列出仍 fail-open 的边界（变量/命令替换/管道喂解释器/ANSI-C 引号/未闭合引号）。
**残余 P3（如实记录，非本轮引入）**：`:193` 的读取动作短路是**整段无序**的——同一段里同时出现定义与 `--get/--list` 时按「读取」放行（`git config alias.p 'push --force' --get` 这类反常参数序）。需非常规写法命中，且 git 自身对该形态的解析存疑；列观察项，不阻断。

## B. pricing 读路径与静默（`apps/cli/src/cli.ts`）— 判定：PASS（2 项 P3）

① **三条读路径确已改**：`createUsageStore:461`、`cmdModels:921`、`cmdPricing:1852` 均取 `builtinConfigRoot()`；写路径按声明**未改**（`cmdPricingSync:1768-1769` 仍 `repoRoot()`）。开发态 `builtinConfigRoot()` 经 `:206-212` 上溯 2 级命中仓库根，与该处 `repoRoot():162-172` **同值**——但仅在 cwd 位于仓库内时成立（cwd 在仓外时二者按设计分离，这正是本轮目的，非回归）。测试 3（`cli.builtinConfigRoot.test.ts:79-88`）在 vitest cwd=仓库根下断言同值，成立。
② **warn 与真实读取路径逐字同源**：`warnMissingBuiltinConfig:238` 用 `path.join(root,'configs',name)`；`loadPricing` 为 `pricing.ts:59` `path.join(configRoot,'configs','pricing.json')`，`loadModelCatalog` 为 `modelCatalog.ts:79` `path.join(configRoot,'configs','model-catalog.json')`。三处拼接逐字一致，且 `:467-468`、`:923`、`:1857` 传给 loader 的正是 `warn` 用的同一个 `root` ⇒ 既不漏报也不误报。
③ **归一不抛**：`normalizePathForCompare:257-275` 对不存在路径自底向上找最近已存在祖先（`:262-272` 捕获 ENOENT），win32 小写归一（`:274`）；测试 `cli.builtinConfigRoot.test.ts:121-131` 用「目标目录尚不存在」+ 大小写变体双向覆盖。**未发现短路径/大小写缺口**（`realpathSync` 在本机返回长名，且两侧同归一）。
④ 其它读写不一致：`cmdBench:883` 仍用 `repoRoot()` 取 policy/behavior——属仓库内基准命令，非产品读路径，不构成缺陷。
⑤ **测试取舍确有盲区（P3，真实）**：新增用例只测纯函数 `pricingSyncMismatchWarning`（`:115-132`），**未覆盖调用点** `:1793-1794`。把这两行删掉或改条件，`cli.builtinConfigRoot.test.ts` 全绿；`cli.test.ts:978-1025` 虽以 `--catalog <tmp>` 真跑 sync（必然触发 warn）但**未断言 warn 文案/条数** ⇒ 「warn 永不触发」当前不可被任何测试发现。最小修法：在 `cli.test.ts` 的 sync 用例上捕获 `console.warn`，断言 `--catalog <tmp>` 恰 1 条、默认目标 0 条。
**P3-2（文案半真）**：`:298-299` 建议的补救是 `--catalog <包>/dist/configs/model-catalog.json`——该落点在 `node_modules` 内，`npm ci`/重装即失效，全局安装下还可能只读；文案未提示更稳的 `~/.vessel/pricing.override.json`（该文件优先级最高，且 `:1844` 已提及）。另：`--dry-run` 也会打印该 warn（`:1793` 在 dry-run 判定之前），属噪音。

## C. 打包与安装 — 判定：声称的 tarball 形态成立，但发布链路未闭合（1 项 P1）

① **`files` 否定模式在本仓 npm 下确实生效，且不是「看着排除、实际仍在」**：`npm-packlist/lib/index.js:313` 把每个 `files` 条目取反（`!${file}`）后注入忽略集；`ignore-walk/lib/index.js:107` 用 `flipNegate: true`，minimatch 的 `parseNegate`（`index.js:589-601`）对 `!!dist/**/*.test.js` 数掉两个 `!` ⇒ `negate=false`、pattern=`dist/**/*.test.js`，匹配即 `included=false`（`index.js:999-1010` + `ignore-walk` 的 `:257-259`）⇒ 与「`*` 全排除后按 `!dist` 重纳入」组合出的正是**硬排除**语义。该否定是**载荷**而非装饰：`apps/cli/dist/` 里确有 50+ 个 `*.test.js|.js.map|.d.ts|.d.ts.map`（`glob` 实测）。**但**此语义依赖 packlist 内部实现而非 npm 文档承诺，跨 npm 大版本需重验。
② **`prepack` 一定执行，但它只复制 configs、不构建（P1）**：`apps/cli/package.json:23` = `node scripts/copy-configs.mjs`，唯一动作是 `cpSync`（`scripts/copy-configs.mjs:49-50`）；`build` 才含 `tsc -b`（`:22`）。而 `.gitignore:2-3` 排除 `dist/` 与 `*.tsbuildinfo` ⇒ **干净检出跑 `npm pack`/`npm publish` 会产出「有 `dist/configs/*`、没有 `dist/cli.js`」的包，`bin/main/exports`（`package.json:6-9`）全部指向不存在的文件，安装仍 exit 0**。本轮实测之所以正常，是因为工作区里已有一份手工 `tsc -b` 产物。最小修法：`"prepack": "npm run build"`（或加 `prepare`），并在发布门禁断言 tarball 含 `dist/cli.js`。
③ **包内优先在安装形态确实命中**：`builtinConfigRoot:199-204` ①分支返回 `moduleDir`（= `node_modules/@vessel/cli/dist`），调用方再拼 `configs/...`（`:319`、`:463-464`、`:1669`…）⇒ 与实测路径自洽。pnpm 下 ESM 默认 realpath 解析，symlink 指向的 store 目录内同样带 `dist/configs`（前提是 ② 的 tarball 正确），仅 `--preserve-symlinks` 例外。
④ **三条 exit 0 的证据强度不均**：`--version`/`--help` 根本不读 configs（`:2197-2202`），exit 0 无判别力；`policy status` 按设计恒 exit 0（`:2116`）亦无判别力。**有判别力的是 system 层路径落在 `node_modules\...\dist\configs\`**——它只能由 `builtinConfigRoot` ①命中产生，cwd/`VESSEL_*` 环境变量都改不了这一点。故「陌生人装完就能用」在该探针范围内成立，但**仅覆盖 policy 解析**；`pricing`/`model-catalog` 的读路径在安装态是否真命中包内文件，本轮未见等价实证（warn 只在缺失时出现，属反向证据，需要一条「安装态 `vessel usage` 无 warn」的探针才算闭合）。
⑤ **`dist/.tsbuildinfo` 仍入包（P3）**：文件真实存在（`apps/cli/dist/.tsbuildinfo`），`files: ["dist"]` 收录，四条否定模式（`package.json:12-16`）无一覆盖（`!dist/**/*.map` 不匹配 `.tsbuildinfo`）。影响限于产物噪音与构建机状态（含文件哈希清单/增量元数据）；建议 `!dist/.tsbuildinfo`。

## D. 诚实化（1B/2B/2C）— 判定：PASS（抽查，非穷尽）

`guide.ts` 无 `Claude Code`/`Codex` 等外部产品名；命中仅出现在 `guide/glossary.ts:10,23,42-43`，即"昵称/别名"术语条目本身，属应保留的正当解释。`README.md:61-79` 的命令清单与 `dispatch` 分支（`cli.ts:2098-2128`、`:2200-2208`）逐项对得上（provider/models/setup/usage/pricing/migrate/review/explain(term)/list-terms/guide/settings/policy/sessions/resume/bench-report/serve/web/run）。密钥口径按**实际生效后端**而非写死平台：`providers/setup.ts:46-65` 分 DPAPI / 显式降级明文 / 无凭据后端三态，`docs/PROJECT-BRIEF.md:22,43-46` 与之一致。抽查范围内**未见新引入的不实表述**。

## 总判

**ACCEPT** —— A/B/D 的声称修复逐条成立（含测试判别性与 JSDoc 如实）；C 的 tarball 形态与包内优先路径经静态核验成立。
**未闭合清单（按严重度）**：**P1** `prepack` 不构建 ⇒ 干净检出发布产出缺 `dist/cli.js` 的坏包（C-②，最小修法已在原处给出）；**P2** 发布门禁未断言 tarball 形状（`release-gates/gates.ts:648-654` 只查本地 `dist` 存在，不查"包内零 `*.test.*` + 含 `dist/cli.js`"）⇒ 「270→62」是一次性实测而非可回归门禁；**P3** pricing sync warn 调用点无用例（B-⑤）、warn 文案补救指向 `node_modules` 且 `--dry-run` 也打印（B-P3-2）、`dist/.tsbuildinfo` 入包（C-⑤）、alias 读取短路的反常参数序边界（A-P3）。
若里程碑口径包含"任意干净检出可发布"，则 P1 单独即构成 REJECT 理由；就本批声称的四项修复本身而言，不构成 REJECT。

**这批之后，距离成熟产品的最大缺口**：不是这些单点语义，而是「打包 → 安装 → 首跑 → 升级」整条发布链路仍靠人工实测一次（tarball 形状、dist 随构建、安装态读路径、无 warn 冒烟均无自动门禁），任何一次重构都能在无红灯的情况下把可用包装成不可用。
