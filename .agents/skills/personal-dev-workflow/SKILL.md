---
name: personal-dev-workflow
description: "Run cost-aware multi-agent project work with OpenCode/DeepSeek, Codex, and optional AGY: create an executable task contract, dispatch isolated role sessions, run checks, review independently, and resume from recorded evidence. Use for substantial implementation, investigation, or explicit PDW workflow requests."
metadata:
  version: "1.3.3-local"
  repository: "https://github.com/satan9394/personal-dev-workflow"
  skill-path: "skills/personal-dev-workflow"
  branch: "main"
  updated: "2026-10-17"
---

# Personal Dev Workflow — 可执行的项目协作

版本：1.3.3-local；说明语言：zh-CN。

这是既有 PDW 的项目级升级版：保留契约、验证、交接、有限修复；增加真实 CLI 接力。程序为本 Skill 的 `scripts/pdw.mjs`，以 Skill 的绝对位置调用，不假定当前目录含 scripts。

若你已经收到程序分派的 scan/test-plan/implement/repair/review/planner 角色及契约路径，只执行该角色，不再初始化或启动下级工作流；避免 Skill 自动加载造成递归调度。

## 用户怎样使用

用户可以直接说：“用 PDW 在 <项目> 完成 <目标>”。你负责把目标编译成任务，不把 JSON 配置工作推给用户。

先选择执行方式：小到明显且低影响的修改可直接完成并检查；实质开发保留独立复核。宿主原生子 Agent 已满足角色隔离、证据及目标模型成本要求时，可在唯一协调者下使用辅助模式；需要 OC/DeepSeek 等跨工具路线时用以下 CLI 接力。不固定三人或五人，不为了使用插件而安装插件，也不因主模型强就取消必要验收。当前 CLI 管线仍是固定阶段，不宣称程序已自动选择团队拓扑。

1. 读目标项目约定、已有实现和已关闭记录。运行 `node <skill>/scripts/pdw.mjs init --project <项目>`，然后 `doctor`。初始化不覆盖现有配置，不改登录或全局设置。
2. 根据任务写一个 JSON 契约，字段见 [references/runtime.md](references/runtime.md)。必须有明确验收、允许修改路径和真实检查命令。检查本次变更对使用说明、配置、接口和维护文档的影响；有影响的文档更新从开始就纳入范围与验收，实施者同步修改，复核者对照实现核验。无影响就记录理由，不批量重写 MD，不另等用户提醒。命令用 executable + args，不拼 shell。调查任务用 audit；实现任务用 develop。
3. `new --from <契约> --project <项目>` 创建任务；先 `plan <id>` 检查角色、模型、检查项、调用上限。用户已要求完成任务时，在其授权范围内直接 `run <id>`，不另问是否允许普通本地实施。
4. 默认 OC + DeepSeek 扫描与验收准备，Codex 实现，独立 OC + DeepSeek 复核。常规实现可在项目配置把 implement 路由到 OC。需要架构规划时在契约中启用 planner，使用 AGY。不同角色是新会话，不共享长聊天。
5. 程序实际执行验收命令；失败最多定向修复一次，再失败即停止。遇到范围变化、环境阻塞或不支持的输出协议，保留原始结果并交接，不能凭文字宣布通过。
6. 查看 `status <id>` 和任务目录的 REPORT.md。每个阶段程序自动生成 HANDOFF.md，命令与换对话流程见 [上下文接续](references/runtime.md#上下文接续与文档维护)。中断后用 `resume <id>`；停止用 `cancel <id>`。切会话不重置额度，不通过另建任务规避原任务限额。

## 按目标模型交接

分派前先把用户需求整理为目标、可观察的验收行为、范围和关键假设。计划是实现建议，不覆盖用户目标；会改变验收的歧义才询问用户，其余由协调者决定。不能只把规划聊天或一句“按计划开发”转发给执行者。

确认执行角色的实际模型标识、宿主支持与思考等级，保留用户指定模型。首次使用或切换模型时查其官方选择/提示指导及宿主接口；记录来源与核对日期到任务准备材料。有效且仍适用的记录可复用，不每次重复联网。无法识别宿主默认模型时不猜测其特性。

协调者将简短、适用于该模型和当前任务的提示指导写入角色配置 `prompt_guidance`；Codex 与 OpenCode 可另设 `reasoning_effort`。OpenCode TUI 的 `/effort` 选择模型变体，协调者应核对实际模型的 variants，不能凭 Flash 名称断言不支持思考。用法与限制见 [模型交接配置](references/runtime.md#模型交接配置)。强模型以目标、约束、证据和自主空间为主；清晰小任务缩小交接范围。不要机械增加提示长度、角色数或最高思考等级，不要求公开内部思维链。

运行器只传递已配置的模型指导和参数，不自动联网选模型，也不证明提供方最终采用了请求设置。模型改变后重新核对指导与参数；未知模型沿用通用契约，不套用其他模型结论。独立复核按原始需求与验收检验结果，不能只确认是否遵循计划。

## 必须保持的边界

- 同一路径一个实现者；扫描/复核只读；对照当前产物检查，旧证据不能批准新修改。
- UI 任务的契约必须包含真实浏览器操作证据；build/curl 不替代业务验收。运行工具不能凭空提供浏览器能力。
- 不自行 commit/push/merge/send/deploy/publish/delete；用户确认点保留。已有授权按其实际范围执行。
- CLI 权限继续由宿主控制，程序不传跳过权限参数。源码范围检查是执行后检测，不是文件系统沙箱。
- 核对 status/handoff 的 snapshot_coverage；项目根被 Git 忽略或 Git 列表为空时使用文件系统快照，显式任务 scope 不受 Git ignore 隐藏。不能观察的保留目录和链接路径须先调整范围，不能把空覆盖当成通过。
- 时间与 CLI 启动次数有程序上限；金额/Token 总上限没有提供方证据时标 unknown，不能宣称硬限制。
- 不启动嵌套 Agent、不自动接 backlog、不升级全局工具、不永久清理任务记录。

## 完成与失败

`accepted_local` 要求实际检查全部通过、独立复核逐项覆盖验收、复核期间产物未变化、全程未越出允许路径。develop 还要求独立复核无 high/blocker；audit 验收的是调查覆盖、证据与独立复核质量，报告可以包含被审对象的 high/blocker 发现，不表示被审对象无缺陷。它不等于已提交或已发布。

若 OC/AGY 不可用，先明确环境失败。可在已经授权的宿主子代理能力下手工按相同角色与契约执行，但必须标为辅助模式，不把它汇报成 CLI 自动接力已通过。

## 自主决策与用户反馈

默认采用结果简报：协调者阅读各角色结果、检查证据并处理分歧，用户不承担阅读 OC 或其他角色日志的工作。常规的方案选择、工具路由与授权范围内修复自行决定；预算及修复上限仍然有效。不因用户不想看过程而跳过检查或隐瞒失败。

按宿主要求保留必要的简短进度，只报告有意义的变化，不转述角色聊天、扫描清单或已自行解决的报错。仅在缺少会改变验收的关键信息、需要用户授权的动作或耗尽恢复预算时请求介入；先完成不依赖该回答的工作。

最终默认四行：

- 结论：已解决 / 部分解决 / 未解决，注明任务与验收范围；不能承诺永无缺陷。
- 改动：一句话说明用户可感知的结果。
- 验证：一句话概括实际检查，详细证据放一个链接。
- 下一步：无需操作，或只列影响使用的剩余问题、明确需要用户做的事。影响结果可信度的未验证项必须披露。

用户追问时再展开细节。完整角色响应、低优先级发现与工具日志留在 `.pdw/tasks/<id>/`，不要求用户逐一阅读。审计任务的“已解决”仅指调查目标完成，不表示发现的缺陷已修复。

## 新 Agent 与宿主子 Agent

角色是职责，CLI 是执行工具，模型是能力与成本选择；三者不绑定。当前程序仅适配 OC、Codex、AGY；DSH、CC 等接入条件见 [运行说明的扩展边界](references/runtime.md#第三方-agent-与宿主子-agent)。不把读取 Skill、支持子 Agent 或修改 backend 名称汇报成自动接力已兼容。

宿主子 Agent 可以承接独立职责，但必须由唯一协调者管理范围、证据与预算。当前 CLI 运行器仍禁止角色自行嵌套调度；需要宿主原生团队时以辅助模式另行执行同一契约，不与 CLI 运行器争抢任务或伪造其验收状态。

新会话先用 `status` 定位用户正在继续的任务，再用 `handoff <id>` 核对新鲜度、活动进程和剩余预算。从契约、HANDOFF.md 及其引用的原始证据恢复；有多个候选且无法判断时才询问。源码或契约漂移不能沿用旧通过结论，running 任务不能重复启动。交接在阶段边界落盘，不依赖上下文达到固定百分比。没有宿主读数时不猜测百分比；归档旧对话不由本程序自动执行。

## 分发与更新

- 出处、版本与分支以本文件 frontmatter 的 `metadata` 为准（repository / version / skill-path / branch）。唯一更新源是该 repository 的 `main` 分支，技能位于 `skills/personal-dev-workflow/`（9 个文件，行尾 LF）。
- 本技能不绑定任何本机路径：项目内副本位于 `.agents/skills/personal-dev-workflow/`，各 agent 从自己的技能根读取；更新一律来自上面的 repository，不以任何本机目录为准。
- 项目内一条命令自更新：`node .agents/skills/personal-dev-workflow/scripts/update.mjs --project <项目根>`。它先逐字节比对整份技能目录，有差异才备份到 `.pdw/skill-upgrade-<YYYYMMDD>/` 再原子替换，最后跑 `doctor`；幂等、不动 `.pdw/config.json`、不 commit/push、不删除任何文件。它只改技能文件——模型与思考档位等属项目级配置，改动前须给用户 diff 并等确认。细节见 [运行说明的分发与更新](references/runtime.md#分发与更新)。
- 脚本不可用时按同一原则手工兜底（`git clone --depth 1 --branch main` → 逐字节比对 → 有差异才备份后整份替换 → 跑 `doctor`）；网络不可用时就地报告失败，不静默沿用本机副本。
