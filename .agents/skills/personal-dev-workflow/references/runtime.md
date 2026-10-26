# PDW 1.3.3 本地运行工具

仅依赖 Node.js 18+ 与已经安装、登录的 CLI；代码使用 Node 标准库，沿用 PDW 的 JavaScript 脚本形式，不安装 TypeScript/Next.js 或新依赖。

目录：[命令](#命令) · [上下文接续与文档维护](#上下文接续与文档维护) · [最小契约](#最小契约) · [模型路由](#模型路由) · [模型交接配置](#模型交接配置) · [第三方 Agent 与宿主子 Agent](#第三方-agent-与宿主子-agent) · [证据与安全边界](#证据与安全边界) · [验证程序自身](#验证程序自身)

## 命令

在项目根目录用 `node <本Skill绝对路径>/scripts/pdw.mjs <命令>`；当前研究项目还提供 `pdw.ps1` 包装。

- `init`：创建 `.pdw/config.json`、任务目录，并给项目 `.gitignore` 追加 `.pdw/`；已有配置保持原样。
- `doctor`：核对原生可执行文件、版本与角色配置。model_explicit 只表示显式填写模型；Codex/AGY 的 host-default 不再被标成 explicit。ready 可接受这两个后端的宿主默认，OC 则必须显式指定模型；退出码 0 仅表示非 planner 角色 ready，**不等于登录、模型路由、调用或输出协议已通过**。
- `new --from <JSON文件>`：冻结一张任务卡、基线和任务限额，返回任务 ID。
- `plan <id>`：列出会用的角色、模型、检查与预算；不调用模型。
- `run <id>`：启动任务。默认两个独立的只读扫描/验收准备会话并行；实现、机器检查、独立复核串行。
- `status [id]`：列出任务或详细证据状态；`evidence_current=false` 表示源码已变化。
- `handoff <id>`：从任务事实刷新 HANDOFF.md 并返回结构化交接，不启动模型、不修改状态或重置预算；核对源码与冻结契约的新鲜度。
- `cancel <id>`：请求运行中的协调者停止其直接子进程树；记录仍在运行的进程时不释放锁。
- `resume <id>`：保留已完成阶段、调用次数、耗时和修复次数继续；代码基线漂移则拒绝旧证据。路由可由用户调整，任务限额不随配置提高而增加。
- `demo`：对安装了本 Skill 的项目进行真实模型只读审计，会消耗配置模型额度；它不执行产品代码修改。
- `view [--port <n>] [--open]`：起一个只读本地看板（默认 `http://127.0.0.1:8891/`），按项目列出任务、七步进度、每次派发的模型与思考档位、验收退出码和 Codex 剩余用量。数据只来自 `.pdw/tasks/` 与本机 Codex 会话日志，不写盘、不起模型；进程前台运行，Ctrl+C 结束。
- `install --project <已存在目录>`：将本 Skill 完整复制为该项目 `.agents/skills/personal-dev-workflow`。目标已有同名 Skill 时拒绝覆盖，先比较迁移。

所有命令支持 `--project <项目绝对路径>`。运行失败保留 REPORT.md、状态、完整 stdout/stderr 与验收命令输出，不删除证据。

Windows 的 init 按 PATH 查找原生 exe；Codex 的 npm 壳会解析到官方可选平台包或旧 vendor 布局中的 codex.exe，不执行 .cmd/.ps1 壳。原生 exe 优先，支持中文路径；找不到就由 doctor 明确报不可用。init 不覆盖已有配置，因此宿主升级后旧 hash 路径失效时，仍需重新核对并显式更新该项目 executable；不要复制其他机器路径。

已有同名 Skill 的升级仍需先比较与可回滚备份，再迁移完整目录、入口及必要的 Hook 引用；没有自动 upgrade 命令或旧 runstate 状态转换。保留进行中的 Mission、原始证据与已用预算，到安全边界切换，不能用重装重置额度。新配置初始化成功后先 doctor，再做隔离小任务确认实际登录/输出协议；不要仅凭 doctor 放行真实业务任务。

## 上下文接续与文档维护

任务创建、启动、阶段完成及正常退出（包括 blocked/cancelled）时，程序自动生成 `.pdw/tasks/<id>/HANDOFF.md`。它是 contract/state/日志的可重建视图，不是第二个状态源。保存目标、范围、验收、阶段、剩余预算、实际改动、检查输出与独立复核入口、失败及下一步。换对话时由协调者运行 status 和 handoff，用户无需搬运日志或提醒同步。

handoff 当下重新检查源码指纹和契约哈希；历史 accepted_local 在漂移后仍保留，但 accepted_current=false，不能据此宣布当前代码已通过。活动任务先核对进程，不同时启动第二个协调者。进程崩溃可能只留下前一阶段交接；state 与当前产物优先，命令不能保存尚未产生的结果。命令读取不启动模型，但仍会扫描源码指纹；大型仓库先配置合理 ignore。

ponytail: 程序不读取上下文百分比、不自动创建或归档宿主对话、不把所有项目文档自动改写。项目文档同步由 Skill 的实施/复核职责完成：有影响时纳入任务 scope 和 acceptance；检查命令按真实项目选择，不以文件存在或更新时间冒充语义正确。长期入口文档只留当前用法，详细运行记录留任务目录，架构取舍沿用项目既有决策记录。

宿主原生子 Agent 辅助模式沿用同样契约与证据要求，按项目既有交接文件记录；本运行器的 handoff 命令只读取本运行器管理的任务，不导入外部团队的聊天冒充验收。

## 最小契约

契约由协调 Agent 根据真实任务生成，用户不必学习 JSON。以下是字段示例：

```json
{
  "goal": "修复配置保存失败，保持既有接口兼容",
  "mode": "develop",
  "scope": ["src/settings", "tests/settings.test.mjs"],
  "planner": false,
  "acceptance": [
    {"id": "AC1", "description": "有效配置保存并能重新加载，非法输入被拒绝"}
  ],
  "checks": [
    {"id": "settings", "command": "node", "args": ["--test", "tests/settings.test.mjs"], "cwd": "."}
  ]
}
```

路径相对项目根目录，scope 使用 `.` 或规范的正斜杠相对路径；拒绝 `./`、内部 `.`、重复/末尾斜杠、`..`、盘符相对路径、绝对路径及保留排除目录，避免快照与范围检查使用不同的路径名称。检查必须是项目确实存在、有意义的命令；不能为了创建成功编造一个永远返回 0 的检查。Windows 的 cmd/bat/ps1 不是可直接 spawn 的原生程序：用 `powershell.exe -NoProfile -File ...` 等显式 executable/args 形式。项目用 pnpm 时，也须找到其原生入口或通过显式 PowerShell `-File` 调用，不拼接不受信文本。

audit 模式不启动实现或修复。审计报告可以包含被审对象的 high/blocker 发现；报告本身是否完成由验收覆盖、证据与独立复核决定，不能将 accepted_local 理解成被审软件无缺陷。develop 模式有 high/blocker 则不能验收。

## 模型路由

`.pdw/config.json` 中的 roles 为 `scan / test-plan / implement / review / planner`。每项有 backend、executable、model；可选 args 只用于受信 CLI 启动前缀。程序拒绝前缀中的改工作根/扩展可写目录（如 -C、--cd、--add-dir）、覆盖权限/沙箱/config/model 等保留参数；应使用结构化角色字段。配置与 executable 仍是受信输入，这些检查不是恶意配置隔离。

init 仅从现有 OpenCode 配置中的标识选择 DeepSeek V4.1 Flash，不复制配置或密钥：先看顶层 `model`，再按 `providers`（OpenCode 2.x）或 `provider`（1.x）里的 `models` 找匹配项，两者都读、都不写回。选中的只是提议值，不证明它最便宜；没有识别到就要求协调者从实际模型列表填写，不能静默使用昂贵默认模型。Codex/AGY 默认沿用宿主模型，可在项目配置显式指定。

OpenCode 2.0.x 的私有 standalone 模型查询曾报插件激活失败，因此默认用现有服务；可设置某项 `standalone: true` 在其他已验证环境使用私有进程。原有权限/风险插件不被禁用。

## 模型交接配置

角色可选 `prompt_guidance`（非空文本，须显式指定 model），用于协调者根据已核实的模型指导和本任务编写的简短执行提示。程序将其连同契约、角色职责和前序证据写入每次 `attempts/.../prompt.md`。模型指导不能覆盖范围、权限或验收；计划须结合当前源码验证。

Codex 角色还可设 `reasoning_effort`，通过 `--config model_reasoning_effort="..."` 传给 CLI，而非仅在提示词写“深入思考”。例如角色片段（executable 沿用本机已验证路径）：

```json
{
  "backend": "codex",
  "model": "gpt-6.1-sol",
  "reasoning_effort": "medium",
  "prompt_guidance": "保持现有接口，先核对保存与重启读取路径；在允许范围内自主选择最小实现，运行契约检查。"
}
```

OpenCode TUI 的 `/effort`（`/thinking`、`/variants`）选择模型 variant。已核对后台 `run` 使用 `--model provider/model#variant`（OpenCode 2.0.x 与 2.1.x 均如此，最后核对 2026-10-24）。PDW 支持以下角色配置，转换为 `--model <provider>/<model-id>#<variant>`，不发送 Codex 的 `--config`：

```json
{ "backend": "opencode", "model": "<provider>/<model-id>", "reasoning_effort": "high" }
```

也可直接写 `model: "<provider>/<model-id>#high"`，自定义 variant 使用此形式；不能同时再设置 reasoning_effort。不要给其他 OpenCode 版本猜测参数：先核对其 run --help，旧版可能使用不同入口。档位词表由该模型在宿主里声明的 `variants` 决定，不同提供方不同：DeepSeek V4.1 Flash 实测为 `low/high/max/off`（`off` 关闭思考），**没有** `medium`；GPT-6.1 Sol 实测为 `low/medium/high/xhigh/max/ultra`。写之前查声明，不能由 flash 后缀推断能力。

2026-10-17 核对官方 v2.0.32 源码：[TUI effort 别名](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/tui/src/app.tsx#L950)、[后台模型变体解析](https://github.com/anomalyco/opencode/blob/v2.0.32/packages/cli/src/run/run.ts#L176)。TUI 和 run 属于同一安装的不同入口；界面能切换不意味着已有 PDW 配置自动继承。

新建配置时，init 对识别到的模型读取 OpenCode TUI 状态目录 model.json 的 variant 映射，将该模型已保存的变体固定到项目配置。状态目录为 XDG_STATE_HOME/opencode，默认 ~/.local/state/opencode。已有配置、显式 #variant 和缺失状态均不会被覆盖；之后 TUI 改选不会自动改变已有 PDW 项目。升级旧项目时由协调者核对该项目是否有活动任务，备份配置后只调整相关角色，不重置任务或预算。

这不是默认模型切换。只有账户/宿主确实支持该模型与等级时才使用。程序检查字段格式，reasoning_effort 仅支持 Codex/OpenCode；认可等级名称不等于每个模型都支持。未配置时保留宿主默认，不自动提高等级或换模型。doctor、prompt 与 attempt 记录 effective_model、reasoning_effort 和 OpenCode variant，它们是请求设置，不是提供方采用证明；doctor 不执行认证或真实请求。原始前缀 args 不得覆盖显式 model/effort。

核对 TUI 与模型时只提取模型 ID、variants 与对应的 effort 字段。OpenCode 2.0 的 api model.list 原始返回包含认证设置，禁止直接打印或保存整个响应。

2026-10-16 核对来源：[OpenAI 模型选择](https://developers.openai.com/api/docs/guides/model-selection)、[模型与提示指导](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol)、[减少过度提示](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)、[Codex 单次运行配置](https://learn.chatgpt.com/docs/developer-settings)。运行器不自动检索这些页面，也不自动生成最佳提示；这些判断由使用 Skill 的协调者完成，效果仍须真实任务验证。

## 第三方 Agent 与宿主子 Agent

当前 `drivers.mjs` 只实现 `opencode / codex / agy`，未知 backend 会拒绝执行。DSH（DeepSeek Harness）、CC 或其他 Agent 尚无本运行器适配，不能仅改配置名就启用。TeamAI 分发 Skill 也不会自动增加执行适配器。

接入一个新工具前，先查其实际 CLI/API 与已有适配实现，再做最小适配。至少验证：在指定项目启动独立角色会话、传入契约与模型、遵守宿主权限、获取符合 resultSchema 的最终结果、保留原始日志、超时与取消行为。还须验证只读职责、真实检查失败不能被文字 pass 覆盖，以及一次隔离的小任务。取消客户端与服务端停止计费分别报告。无法取得的费用信息标 unknown，不降低验收协议以兼容工具。

宿主原生子 Agent 与跨 CLI 工作者都可以实现扫描、执行、评审等职责；数量取决于可独立完成的工作，不为凑三人或五人增加调用。实施前确认目标和验收，实施后独立复核；复杂规划按需提前。至少保留执行与复核的独立上下文，换模型并非独立复核的必要条件，也不保证正确。

ponytail: 当前程序保持固定阶段及禁止嵌套调度，不增加通用团队调度框架。使用宿主原生团队时，由一个宿主协调者负责同一契约下的调度、调用预算和证据汇总，标为辅助模式；不同时运行 CLI 调度器，不写入假的 accepted_local。宿主子 Agent 若不能路由至指定低成本模型，不宣称它替代了 OC/DeepSeek 的成本路线。

## 证据与安全边界

唯一任务运行态位于 `.pdw/tasks/<id>/state.json`；contract.json 为冻结契约，baseline.json 为起始文件哈希。不再把旧 run-state 计数当作这套新调度器的状态源。

角色 stdout/stderr、最终结构化结果与机器检查分别保存。检查退出码非零不能被 Agent 的 pass 覆盖；复核必须列出所有验收 ID、pass 状态和具体证据。修复后重跑检查和独立复核，最多一次。

源码指纹在普通 Git 项目使用 tracked/untracked 非 ignored 文件，并额外遍历显式任务 scope；scope 落在忽略规则下时，覆盖其最上层被忽略的祖先及同目录源文件，以便检测越界兄弟文件。项目根被 Git 忽略、Git 文件列表为空、scope 为整个项目或非 Git 项目时改用文件系统遍历，不能静默接受空的 Git 列表。status/handoff 的 snapshot_coverage 给出覆盖方式、文件数、强制覆盖根与保留排除目录。

始终排除 `.git/.pdw/node_modules/.next/.turbo/__pycache__`，这些目录不能声明为任务 scope；显式 scope 的链接路径被拒绝，遍历中的其他符号链接只记录链接指向、不跟随其目标。无法读取的范围会报错，不能当成已覆盖。普通 Git 模式下，未声明的其他 Git ignored 文件仍不在覆盖范围。范围检测不是沙箱、内容签名或抗恶意同用户进程的隔离；大型目录应缩小任务 scope，不能只靠 Git ignore 隐藏需要监测的代码。

运行中出现快照错误时停止并保留失败报告、交接和预算，活动进程退出后释放锁。交接明确显示 snapshot_coverage.source=unavailable、file_count=null、changes_known=false、accepted_current=false；差异记录为 null，不把“无法确定”写成“没有改动”。

同项目单协调者通过原子目录锁实现；释放时把锁记录移动到 lock-history，保留证据，不永久删除。崩溃后若记录中的子进程仍存活，resume 会拒绝清零；需核对进程后处理。没有跨机器分布式锁。

程序限制 CLI 启动次数、任务累计运行时间、单次进程超时和修复次数；不限制 CLI 内每次模型 API 请求。费用/Token 明细仍需宿主用量证据，当前统一记录 unknown。停止本地客户端也不能宣称已停止服务端所有计费或共享服务中的工作；这需要宿主提供可验证的会话取消接口。

Codex 使用原生 read-only/workspace-write 沙箱；OC 使用 plan/build agent；AGY 使用 plan/accept-edits。宿主权限可能要求交互，未授权动作不会通过添加 bypass 参数放行，非交互阻塞会在超时后报告。

## 验证程序自身

```powershell
node <本Skill>/scripts/pdw.test.mjs
node --test <本Skill>/scripts/drivers.test.mjs
```

它创建并保留隔离用例、启动真实本地子进程，用 fixture CLI 测试完成条件、检查失败、定向修复、越界、只读违规、输出解析、漂移、预算、进程超时、并发锁、取消与恢复，并覆盖被父仓库忽略的夹具根、项目 Git ignore 与 info/exclude 隐藏的显式范围。驱动测试另验证 Windows Codex npm 布局、中文路径与参数边界。**这些套件验证编排/发现逻辑，真实 OC/Codex/AGY 的登录和路由需要另外的 live task。** 夹具保存在项目 `.pdw/test-runs/`，没有自动清理。快照另有两道防线：Git 工作树必须是项目根，覆盖到文件却读不出内容时拒绝写入空基线，两者都有夹具用例。

## 分发与更新

本 Skill 的更新以公开仓库为准，不以任何本机目录为准。

- 源：本 Skill `SKILL.md` frontmatter `metadata` 里的 `repository`，分支 `main`（滚动），路径 `skills/personal-dev-workflow/`（11 个文件，行尾统一 LF）：`SKILL.md`、`agents/openai.yaml`、`assets/{audit-task.json,viewer.html}`、`references/runtime.md`、`scripts/{drivers,drivers.test,pdw,pdw.test,update,viewer}.mjs`。
- 一条命令自更新（推荐）：在项目根执行 `node .agents/skills/personal-dev-workflow/scripts/update.mjs --project <项目根>`；`--dry-run` 只看差异不写盘，`--json` 只输出摘要；`--mirror <目录>` 同时刷新第二份副本（见下）。
  1. 取远端到 `<项目>/.pdw/update-cache/<时间戳>/source`，`git clone --depth 1 --branch main` 并强制 `core.autocrlf=false`，保证比对与写盘不受操作者 Git 行尾设置影响；该缓存不自动清理。
  2. 逐字节比对整份技能目录（缺文件或散列不同都算差异）；本地多出的文件只报告、不删除。
  3. 无差异 → 报「已是最新（<版本>）」，不改任何文件，退出 0。
  4. 有差异 → 备份当前文件到 `<项目>/.pdw/skill-upgrade-<YYYYMMDD>/personal-dev-workflow-pre-<版本>/` → 逐个原子替换（临时名改到目标名，支持替换自身）→ **不动 `.pdw/config.json`** → 跑 `doctor` 并报告退出码。
- 脚本不可用时的手工兜底：`git clone --depth 1 --branch main <repository> <临时目录>` → 用远端 11 个文件与当前副本逐字节比对（sha256，缺文件算差异）→ 无差异只回「已是最新（<版本>）」→ 有差异就先备份再整份替换（保留四层目录）→ 跑 `doctor`。网络不可用时就地报告失败并说明用了哪份兜底，不静默沿用本机副本。
- 自更新**只动技能文件**：模型、思考档位（`reasoning_effort` / `model#variant`）、调用上限与 `prompt_guidance` 属**项目级配置**，改前必须先给出 diff 并等用户明确确认；本程序不会改它们。
- `--mirror <目录>`：把另一份技能副本（如多个 agent 共用的技能根）一并对齐到远端字节。镜像必须已存在，且不能与已安装的技能目录互相包含；镜像里多出的文件只报告、不删除；镜像落后时即使本副本已是最新也会被修好，覆盖前同样备份到 `.pdw/skill-upgrade-<日期>/personal-dev-workflow-pre-<版本>-mirror/`。写成 `--mirror` 一次，比"更新完再手工拷一遍"可靠——后者漏拷时没有任何报错。
- 不要改本机镜像当"真身"；镜像只是公开仓库的下游副本。
