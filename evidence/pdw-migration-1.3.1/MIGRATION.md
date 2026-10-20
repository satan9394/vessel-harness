# PDW 迁移交接：personal-dev-workflow 1.0.0 → 1.3.1-local

> 迁移时间：2026-10-16。范围：**本仓库的工作流适配**，非业务功能开发。
> 纯本地、未提交、未推送、未发布、未改全局配置、未永久删除任何文件。
> 旧状态存档与续接台账见 [`LEGACY-STATE.md`](LEGACY-STATE.md)；原始证据见 `validation/`、`backup/`。

## 1. 结论

- 适配**完成**；当前生效版本 **1.3.1-local**（`SKILL.md` 正文标注 `版本：1.3.1-local`）。
- 生效路径：`.agents/skills/personal-dev-workflow/`（完整 Skill 目录，实目录非 junction）；
  零安装入口 `pdw.ps1`（仓库根）；项目级配置 `.pdw/config.json`。
- `doctor` exit 0：5 个角色全部 `available` 且 `model_explicit`。
- 未绕过新版的「拒绝覆盖同名 Skill」保护：迁移先备份 + 移出旧 Skill，再让 `install` 在**目标不存在**的前提下复制。

## 2. 改了什么

| # | 文件 | 改动 | 备注 |
|---|---|---|---|
| 1 | `.agents/skills/personal-dev-workflow/` | **替换** 1.0.0 → 1.3.1-local（7 个文件，逐文件哈希与包清单一致） | 旧目录已移出到 `backup/`，未删除 |
| 2 | `pdw.ps1` | **新增**：`node .agents\skills\personal-dev-workflow\scripts\pdw.mjs @args` | 由 `install` 写入 |
| 3 | `AGENTS.md` | 在「开发工作流（六步循环）」内新增 `<!-- pdw-entry -->` 块（1.3.1 入口/运行器/后端边界 + 指向本文件）；另把「记录纪律」里一处对旧版 `references/memory-policy.md` 的引用标注为**旧版文档**（1.3.1 包已不含该文件） | 迁移前快照（= `HEAD`）**不含任何 pdw 文本**，故本块是**纯新增**。过程是：`install` 先把英文块追加到文件尾，我随即删除该尾部块、改在「六步循环」节内写入中文块；`<!-- pdw-entry -->` 标记只保留一处，将来再跑 `install` 仍幂等。其余规则一字未改 |
| 4 | `.gitignore` | 追加一行 `.pdw/`（第 61 行） | 旧规则全部保留；`.agent-state/`、`RUN_STATE.md`、`.dsh-mission/*`、`!evidence/**/*.log` 等经 `git check-ignore -v` 复核未受影响 |
| 5 | `.pdw/config.json`（运行时，被 gitignore） | 角色后端/可执行文件/模型；内容留档在 [`validation/pdw-config.json`](validation/pdw-config.json) | 见下「配置决策」 |
| 6 | `evidence/pdw-migration-1.3.1/` | **新增**：本文件、`LEGACY-STATE.md`、`backup/`、`validation/` | 迁移证据与回滚材料 |
| 7 | `tasks/224-pdw-1.3.1-local-adoption.md` + `tasks/README.md` 一行 | 按仓库记录纪律建卡收口 | 卡面 = 目标/验收；证据 = 本目录 |

**未改动**：`apps/`、`packages/`、`benchmarks/`、`configs/`、`apps/web`（含任务卡 223 的在飞未提交改动）、
`.agent-state/`、`RUN_STATE.md`、`tasks/` 内的既有卡、`.dsh-mission/`、任何依赖锁文件。

### Skill 文件集变化（诚实披露）

新包**只含 7 个文件**（`SKILL.md`、`agents/openai.yaml`、`assets/audit-task.json`、`references/runtime.md`、
`scripts/{drivers,pdw,pdw.test}.mjs`）。旧版随包带有的 `LICENSE`、`CHANGELOG.md`、`README.md`、`evals/*`、
`assets/{handoff,spec,task-card}.md`、`references/*`（除 `runtime.md`）在**活动目录**中不再存在 —— 这是**上游包本身的形态**，
不是本迁移的删减（旧版原件 27 个全在 `backup/personal-dev-workflow-v1.0.0/` 完整保留，`MANIFEST.sha256` 26/26 校验通过）。
因此工作树对该路径表现为旧文件 ` D`×26 + `SKILL.md` ` M` + 新文件 `??`×6；本迁移**不提交**，故这只是工作树视图。
副作用已在本次修正：`AGENTS.md` 曾引用旧版 `references/memory-policy.md`，现已标注为旧版文档。

### 配置决策（`.pdw/config.json`）

| 角色 | backend | executable（本机实测存在） | model |
|---|---|---|---|
| scan | opencode | `D:\Technology_application\NVM_Windows\nodejs\node_modules\@opencode\cli\bin\opencode.exe` | `workbuddy/deepseek-v4.1-flash` |
| test-plan | opencode | 同上 | 同上 |
| implement | codex | `C:\Users\Satanchen\AppData\Local\OpenAI\Codex\bin\e78bad9887fa50cf\codex.exe` | `null`（沿用宿主默认） |
| review | opencode | 同 scan | `workbuddy/deepseek-v4.1-flash` |
| planner | agy | `C:\Users\Satanchen\AppData\Local\agy\bin\agy.exe` | `null`（沿用宿主默认） |

- 这两个机器路径是**本机实测**（`doctor` 报出真实 `--version`：`opencode v2.0.30`、`codex-cli 0.163.0-alpha.10.2`、`agy 1.3.5`），
  **不是**照搬研究项目的配置。
- `implement.model = null` = 运行器「沿用宿主模型」，即 `~/.codex/config.toml` 的 `model = "gpt-6.1-sol"`（已读取核对）。
  这既落实了 `AGENTS.md` §模型选型与执行规约锁定的 **GPT-6.1 Sol**，又**没有**强改任何模型/等级。
- ⚠️ **口径冲突（需用户拍板，不影响本次适配验收）**：`AGENTS.md` 锁定 `gpt-6.1-sol` + `reasoning.effort: medium`；
  而 `HANDOFF.md`（2026-10-14 用户明确指令）把实现移交给 **OpenCode + DeepSeek-v4.1-Flash（high）**。
  本配置取「宿主默认」以求零假设。要按 HANDOFF 走：把 `implement` 改成
  `{"backend":"opencode","executable":"<上面的 opencode.exe>","model":"workbuddy/deepseek-v4.1-flash"}`（一行）。
  要按 AGENTS 收紧思考等级：给 `implement` 加 `"model":"gpt-6.1-sol"` + `"reasoning_effort":"medium"`（驱动程序只允许 Codex 设该字段）。
- ⚠️ codex 可执行文件位于**版本哈希目录**（`bin\<hash>\codex.exe`），Codex 升级后会失效 —— 届时重跑 `doctor` 看 `available:false`，
  更新该路径即可。这是本机现状，非本次引入。

## 3. 旧任务如何接续

- 旧状态**原样保留**：`.agent-state/run-state.json`（revision 253）、`RUN_STATE.md`、`tasks/*.md`、`evidence/missions/`、`.dsh-mission/`。
- **没有**任何旧状态被写入 `.pdw/tasks/`；**没有**伪造 `accepted_local`；**没有**重置或绕过预算。
- 旧 Goal / DoD / 已完成证据 / 未完成事项 / 已用与剩余预算 / 「不支持自动转换」的说明，全部整理在
  [`LEGACY-STATE.md`](LEGACY-STATE.md)。**继续旧工作 = 用 `new` 建新卡**（见该文件 §6），不是续写旧 run-state。
- 迁移时**无活动协调者、无 Worker、无 `run.lock`**，因此不存在「两套运行器争抢同一任务」的情形，也无需切换动作。

## 4. 以后怎样启动和继续

```powershell
# 在仓库根
.\pdw.ps1 help                 # 命令一览
.\pdw.ps1 doctor               # 环境自检（角色/可执行文件/版本）
node .agents\skills\personal-dev-workflow\scripts\pdw.mjs new --from <contract.json> --project <repo>
.\pdw.ps1 plan <id>            # 只看会调用哪些角色/模型/检查与预算，不调模型
.\pdw.ps1 run <id>             # 真正启动：扫描/验收准备并行 → 实现 → 机器检查 → 独立复核
.\pdw.ps1 status [id]          # 证据新鲜度（evidence_current=false 表示源码已漂移）
.\pdw.ps1 handoff <id>         # 刷新 HANDOFF.md 并返回结构化交接，不耗预算、不重置
.\pdw.ps1 resume <id> / cancel <id>
```

用户侧只需一句：「用 PDW 在 `<项目>` 完成 `<目标>`」；契约 JSON 由协调 Agent 生成，**不要推给用户手写**。
后端边界：自动接力只支持 **OC / Codex / AGY**；CC、DSH 只能作协调者或「宿主子 Agent 辅助模式」，不得汇报成 CLI 自动接力已通过。

## 5. 怎样回滚

无活动运行器（确认无 `.pdw/run.lock`）时，按序执行；**删除一律走回收站**：

```powershell
# 0. 确认没有在跑的任务
node .agents\skills\personal-dev-workflow\scripts\pdw.mjs status --project .

# 1. 还原入口文件（回到迁移前字节）
Copy-Item evidence\pdw-migration-1.3.1\backup\AGENTS.md.pre-migration   AGENTS.md   -Force
Copy-Item evidence\pdw-migration-1.3.1\backup\gitignore.pre-migration  .gitignore  -Force

# 2. 移出新 Skill（走回收站，勿用永久删除）→ 还原旧 Skill
#    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
#      (Resolve-Path .agents\skills\personal-dev-workflow).Path,'OnlyErrorDialogs','SendToRecycleBin')
Move-Item evidence\pdw-migration-1.3.1\backup\personal-dev-workflow-v1.0.0 .agents\skills\personal-dev-workflow

# 3. 清理新增入口（可选，走回收站）
#    pdw.ps1 与 .pdw\ 目录
```

回滚校验：`.agents/skills/personal-dev-workflow/MANIFEST.sha256` 逐行核对通过；
`AGENTS.md` / `.gitignore` 的 SHA-256 等于 `backup/` 清单（见 `LEGACY-STATE.md` §1）。
`.agent-state/` 与 `RUN_STATE.md` 全程未被修改，回滚无需处理。

## 6. 验证证据（本轮实际执行）

每条命令的**退出码逐条留档**在 [`validation/summary.json`](validation/summary.json)（含「为何非 0 仍可判 PASS」的说明）；下表是结论摘要。

| 检查 | 结果 | 证据 |
|---|---|---|
| 包 SHA-256 vs 清单 | ZIP = `042423fbb60a70ce437861ae2c4b81e76e21e5867dcd99cc5abeeacefdf443c5`（与清单一致，certutil 实测）；7 个文件哈希**逐个一致** | `validation/package-hash.json` |
| 安装后字节一致性 | 安装目录 7 个文件 SHA-256 = 包清单 SHA-256 | `validation/skill-integrity.json` |
| Skill 格式/引用/版本 | frontmatter 恰为 `name`+`description`；正文 `1.3.1-local`；本地链接全部可解析；预期文件齐全 → **PASS** | `validation/skill-integrity.json` |
| `help` | exit 0 | `validation/help.txt` |
| `doctor` | exit 0；5 角色 available + model_explicit | `validation/doctor.json` |
| 隔离目录安装 + 原规则保留 | 首次 exit 0；哨兵行 `KEEP-ME-PROJECT-RULE` 保留；`pdw-entry` 追加；`.gitignore` 追加 `.pdw/`；安装后 `help` exit 0 → **PASS** | `validation/install-isolated.json`、`iso-install-*.txt` |
| **防覆盖保护** | 第二次 `install` **exit 1**：`Target skill already exists...`（保护未被修改/绕过） | `validation/install-isolated.json` |
| 夹具套件（隔离非 Git 位置） | **20 passed / 0 failed**（exit 0）。另一轮 19/1，唯一失败是 Windows `EPERM: rename state.json.tmp` 瞬时文件锁，重跑即过 → 判为环境抖动，非逻辑缺陷 | `validation/pdw-selftest-isolated.txt`（=run2） |
| 夹具套件（本仓库内，Git 项目） | 15 passed / **5 failed** —— 全为依赖源码指纹的断言（out-of-scope / 只读变更 / 漂移失效）。**根因已实测**：`.pdw/` 被 gitignore，夹具把模拟源码写在 `.pdw/test-runs/` 下，`git ls-files -c -o --exclude-standard` 返回空 → 指纹恒为空。对照实验见 `validation/gitignore-check.txt` | `validation/pdw-selftest-inproject.txt` |
| `.gitignore` 语义 | 仅新增 `.pdw/`；其余规则 `git check-ignore -v` 逐条复核未变；`pdw.ps1`/`.agents/**`/`evidence/**` 不被忽略 | `validation/gitignore-check.txt` |
| 项目内产品检查 | **未跑**（改动的文件均不在 `tsc -b` / 测试图内；已 grep 确认无测试断言 `AGENTS.md`/`.gitignore`/`.agents` 内容）。按「不机械重跑无关测试」执行 | 见 §7 |

### 关于那 5 项失败的准确表述

- 这是**夹具套件在 Git 项目内的环境限制**，不是本次迁移文件的缺陷：把同一套件放到非 Git 位置即 20/20。
- 对**真实任务无影响**：真实任务的 `scope` 指向仓库源码（非 ignored 路径），Git 项目的指纹照常工作（对照实验已证明它会列出非忽略文件）。
- 该限制来自上游包本身（`pdw.mjs` 的 `snapshot()` 语义 + `install` 默认把 `.pdw/` 写入 `.gitignore`），本次**未改运行器**（不擅自维护上游代码）。

## 7. 未执行 / 未验证（不谎报）

1. **未做真实模型调用**：`demo`、`run <id>` 等会消耗配置模型额度的动作**未执行**。因此「认证、模型路由、输出协议」
   按运行器自身口径仍属未验证（`doctor` 明写「不等于登录、调用或输出协议已通过」）。需要时请显式授权再跑一次隔离小任务。
2. **未跑本仓全量门禁**（`npx tsc -b` / `npm run test:all`）：本次改动不触碰 `*.ts`、`package.json`、锁文件，
   且无测试断言被改文件；按项目纪律不做无关重跑。若要求「改动后全绿」，需显式要求。
3. **AGY planner 未做真实调用**（`agy --print --mode plan` 的协议一致性只做了 `--help` 字段核对，未实跑）。
4. **模型口径冲突未定**（见 §2 决策）：未替你选择 OC-DeepSeek 还是 Codex-GPT-6.1-Sol。
5. **任务卡 223 在飞**：其 `apps/web` 未提交改动未纳入 PDW 管理，也未提交/冻结；转为 PDW 卡前必须先冻结基线。
6. **复核处置后未跑第二轮独立复核**（第一轮复核的 5 项缺陷已全部处置，记录见 `REVIEW.md`）。
7. **本仓的 PDW `checks` 命令未实跑**（见 §8 的构造说明：入口存在性已核实，命令本身属真实任务范围）。

## 8. 附：本仓 `checks` 命令怎么构造（避免第一次 `run` 就踩坑）

PDW 的 `checks[].command` 必须是**可直接 spawn 的原生程序**（`pdw.mjs` 明确拒绝 `.cmd/.bat/.ps1`，且不做 shell 拼接）。
本机 `npm` / `npx` 都是 `.cmd`，**不能直接写进 `command`**。绕法：用 `node` 直接跑包内的原生入口。

**入口存在性已核实**（`Test-Path` 通过，命令本身本次未实跑）：

```json
"checks": [
  {"id": "tsc",             "command": "node", "args": ["node_modules/typescript/bin/tsc", "-b", "tsconfig.json"], "cwd": "."},
  {"id": "typecheck-tests", "command": "node", "args": ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json", "--pretty", "false"], "cwd": "."},
  {"id": "tests-root",      "command": "node", "args": ["node_modules/vitest/vitest.mjs", "run"], "cwd": "."},
  {"id": "tests-web",       "command": "node", "args": ["node_modules/vitest/vitest.mjs", "run", "--root", "apps/web"], "cwd": "."}
]
```

等价于本仓 `npm run test:all` 的两个 root（根 289 文件 + web 40 文件，双 root 才能算「全量」）。
Web 生产构建同理（`cwd: "apps/web"`，`args: ["node_modules/vite/bin/vite.js", "build", "--emptyOutDir false"]`）——
**必须带 `--emptyOutDir false`**（项目铁律，见 `HANDOFF.md` §0 执行偏差记录）；此条按模式写出，本次未实跑。

三个注意点：

1. **耗时**：双 root 全量在本机是分钟级；`call_timeout_seconds` 默认 600s，必要时在契约对应的 `.pdw/config.json.limits` 里显式放宽（限额在 `new` 时冻结进卡，事后改配置不会放宽既有卡）。
2. **检查会改工作树**：构建/测试可能产生 ignored 产物，运行器允许；但**不得改动源码**（`assertCurrent()` 会在检查后复核指纹）。
3. **绝不放跳过权限参数**：`drivers.mjs` 会拒绝 `--dangerously*` / `--auto` / `--yolo` / `--approve-for-me` 之类前缀。
