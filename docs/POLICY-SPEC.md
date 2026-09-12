# 软/硬安全统一规范 v0.1（D6 / POLICY-SPEC.md）

- **交付物**：D6 — 软/硬安全统一规范（任务书第二十一节）
- **版本**：v0.1（草案）
- **日期**：2026-09-05
- **状态**：供 Review；策略词汇与 H07/H08 研究结论（comparison.md / HARNESS-ANATOMY.md）及 D5 EVENT-SPEC 接线对齐
- **上游依据**：任务书.md §2 核心原则第 3 条（Prompt 与 Runtime 分离：软约束引导 + 硬约束执法）、§8 第四阶段 Policy Runtime（行 655–711：统一 Policy 声明、四件套、`BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 执行链）、§18（UNTRUSTED RESEARCH DATA 处理）、§10 V0.1 范围（CLI / 单 agent / Read/Write/Edit/Glob/Grep/Shell / Policy Engine）、§9 实现框架（`policy/{engine,hooks,risk}`、`runtime/{executor,sandbox,process}`）；docs/HARNESS-ANATOMY.md（H07 行 263–294、H08 行 298–330）；docs/research/harness-matrix/comparison.md（H07 行 411–473、H08 行 477–537、H06 行 350–407）；研究文档 codex.md（H07 execpolicy / sandboxing / approval）、deepseek-harness.md（H07 approval + permission-presets + fs-sandbox / fs-observation-policy）、claude-code.md（H07 deny/ask/allow 三档 / hooks / sandbox）
- **下游消费方**：Behavior Compiler 的 Harness Profile 映射（channel=runtime_policy 的 policy_ref 落点）、D8 ARCHITECTURE.md（core 的 policy/ 与 runtime/ 模块边界）、第三阶段实现（任务书 §9）、D7 BENCHMARK-SPEC（Safety Violations 口径）、Evaluator / 审计 / Conformance Suite

> 一句话定位：**同一份 Policy 声明同时编译出「Prompt Guidance（软/引导）+ Tool Interceptor（工具层）+ Runtime Deny（硬执法）+ Audit Event（审计）」四件套——安全规则只写进 Prompt 是禁止事项（任务书禁止事项 5），软约束负责引导模型"应该怎么做"，硬约束在工具调用闸口与运行时强制"不能做什么"，每个裁决都落审计事件成为可回放证据。**

---

## 0. 摘要

本规范把任务书 §8 的 Policy Runtime（项目第二个核心创新）正式化为 **v0.1 软/硬安全统一规范**。核心内容四件事：

1. **四件套合一**：声明式 Policy（YAML）是唯一事实源，编译期展开为四条执行通道——Prompt Guidance（模型引导，无强制力）、Tool Interceptor（工具暴露面裁剪 + 执行期复核）、Runtime Deny（Policy Engine 裁决 + 沙箱等 OS 级边界兜底）、Audit Event（每次裁决的持久证据）。任何域条目缺硬通道即编译失败/告警，杜绝"只写 Prompt"。
2. **三态裁决与确定性决策序**：ALLOW / DENY / ASK（人工/机器审批）三态；决策序 `denied_tools → deny 规则 → hook override → ask 规则 → allow 规则 → profile 比较`，deny 先匹配生效、不可被更细 allow 豁免；guard 单调（只能收窄，防"先放行后否决"翻转）；fail-closed（无应答者 = unavailable = 拒绝）。
3. **分层与失效面**：Behavior Safety（模型"试图做什么"，prompt/引导 + 编译期 policy_ref 强制配套）与 Runtime Safety（命令/工具"能碰到什么"，规则 + 审批 + 沙箱）显式分离，各自文档化失效面（deny 规则拦不住任意子进程，最终防线是 OS 级沙箱边界）。
4. **作用域与审计接线**：system / user / project / session 四级作用域与合并/覆盖规则（**实现状态：当前仅落地 `system` + `project` 两层，`user` / `session` 层与 workspace trust 门均未实现，详见 §6.1**）；与 D5 的 `PolicyDecision`(A13) / `ApprovalRequest`(A16) / `ApprovalDecided`(A17) 事件及 `audit/*` 持久记录对齐，Policy Engine 是 `BeforeTool` 链上的权威裁决监听器。

**v0.1 纳入**：filesystem（protected / deny_read / 显式 allow）、shell（deny 危险集合 + 前缀 allowlist + scoped 规则）、network（default + 域名 allowlist 的声明与裁决，执行面受限）、git（force_push）、tools（三态 + 工具级 required_permission + denied_tools）、profile 三档 × approval ask|never、guard 单调、never_auto 危险集合、审批缓存、审计接线、workspace trust 门（**未实现**：见 §6.1 实现状态；无 trust 门时项目层仍只能加限制、不能放宽 `system` 的限制）、作用域合并。**留 v0.2+**：网络代理 MITM / 凭据 mask + 出站注入、容器/微 VM 沙箱后端、guardian/classifier 模型审查入主链、异步钩子、MCP 动态工具细粒度策略等（§8.2）。

名词口径沿用研究文档与 D5：**决策** = Policy Engine 对一次工具调用给出的 allow/deny/ask 终态；**guard** = 单调收窄守卫（只能否决，不能放行）；**ask 应答者** = 审批请求的响应方（CLI 人类 / ACP 机器），无应答者即拒绝。

---

## 1. 设计动机与核心思想

### 1.1 一个 Policy 生成四件套——为什么

研究结论（H07/H08 共同抽象，comparison.md 行 442/507）表明：各家安全面收敛于「规则(allow/ask/deny) + hook + 审批 + 沙箱」的分层叠加，且普遍**明示指令文件是"建议不是强制"**（claude-code.md 行 202/351：想硬拦用 hook 或 deny 规则；deepseek-harness.md 行 90/262：引导走 prompt、强制走 sandbox/approval，且共享同一份意图）。

但各家实现里，"行为意图"与"执法规则"散落四处：prompt 段落一份、权限规则一份、hook 契约一份、审计口径一份——**改一处容易漏三处**。任务书 §8 要求反其道：让 **Policy 成为唯一事实源**，一份声明在编译期展开为四件套：

```text
                 ┌──────────────────────────────────────────────┐
                 │        Policy 声明（唯一事实源，YAML）          │
                 │  filesystem.protected / shell.deny /          │
                 │  network.default / git.force_push / tools /   │
                 │  scoped_rules / profile / approval / audit    │
                 └──────────────────────────────────────────────┘
                                      │  Policy Compiler（编译期展开）
        ┌─────────────┬───────────────┼────────────────┬──────────────┐
        ▼             ▼               ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Prompt       │ │ Tool         │ │ Runtime      │ │ Audit        │
│ Guidance     │ │ Interceptor  │ │ Deny         │ │ Event        │
│ （软/引导）    │ │ （工具层）     │ │ （硬执法）     │ │ （审计）       │
├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤
│ Behavior     │ │ 工具 schema  │ │ Policy       │ │ PolicyDecision│
│ IR 渲染段     │ │ 裁剪         │ │ Engine 裁决   │ │ (A13)        │
│ (经 Model    │ │ (deny 工具    │ │ (决策序见§4)  │ │ audit/decision│
│  Profile)    │ │  移出上下文)  │ │ guard 单调    │ │ audit/denial  │
│ 编译告警      │ │ 执行期复核    │ │ BeforeWrite/ │ │ ApprovalRequest│
│ (policy_ref  │ │ (pre-execute │ │ BeforeShell   │ │ (A16/A17)    │
│  缺执法即报错) │ │  拦截器)      │ │ 沙箱 confine  │ │ approval/asked│
│              │ │              │ │ fail-closed  │ │  →decided    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

### 1.2 软约束引导、硬约束执法（任务书 §2.3、禁止事项 5）

"不要删除 .git"这类安全规则**不能只写进 Prompt**。模型可能不遵循、Prompt 可能被注入内容覆盖（§18 UNTRUSTED 纪律），而子进程更不受任何 prompt 管束。因此：

- **软通道（Prompt Guidance）**：把 Policy 编译为模型的建议性措辞（经 Model Profile 逐条渲染，Behavior IR channel=prompt_guidance 同源）。软约束**不产生审计事实**，也不被当作安全边界。
- **硬通道（Tool Interceptor + Runtime Deny）**：执行期强制。受保护路径的写入、危险命令、deny 工具调用在到达真实执行前被拦截/拒绝，且每个裁决落审计。
- **编译器防漏**：声明中凡标注 `enforcement`（需要执法）的条目，必须同时在硬通道产出对应规则；Behavior Compiler 对 `channel: [prompt_guidance, runtime_policy]` 条目检查 D6 侧是否存在 policy_ref，缺执法规则即编译告警（BEHAVIOR-IR-SPEC §7.2 双通道强制）。

### 1.3 三态裁决 + fail-closed

裁决态不是二元 ALLOW/DENY，而是三态 **ALLOW / DENY / ASK**（对照 claude-code `permissionDecision: allow|deny|ask|defer`、DSH `approval/request` waterfall、codex `execpolicy` allow/prompt/forbidden）。ASK 进入审批流（§4.4）。任何一条路径都遵守：

- **deny 优先**：任一环节 deny 即 deny，不可被更细 allow 豁免（deny→ask→allow 先匹配生效）；
- **guard 单调**：整条链只能收窄，杜绝"先放行后否决"的翻转；
- **fail-closed**：ASK 无应答者 = unavailable = 拒绝；`never` 策略在 waterfall 分发**之前**服务内强制（应答者也绕不过，deepseek-harness.md H07 纪律）。

---

## 2. 核心设计：Policy → 四件套

### 2.1 四件套职责总表

| 产物 | 通道 | 执行点 | 强制力 | 对应事件/记录 |
|---|---|---|---|---|
| **Prompt Guidance** | 软（引导） | BeforeModel/BeforeTurn 注入（Behavior Compiler 渲染 + H03 指令层） | 无（建议性） | 不产生审计事实 |
| **Tool Interceptor** | 工具层 | 工具注册/暴露面（schema 裁剪）+ `tools/pre-execute` 拦截器（执行期复核） | 中（结构性） | BeforeTool(A12) |
| **Runtime Deny** | 硬（执法） | Policy Engine 裁决 + guard 单调 + BeforeWrite/BeforeShell 守卫 + 沙箱 confine | 强（强制） | PolicyDecision(A13)、audit/denial、audit/decision |
| **Audit Event** | 审计 | 每次裁决恰好一次落点 | —（记录） | A13/A16/A17 + B17–B21 |

一条规则的完整生命周期示例："`.git` 不可写" —— ① Prompt 提示模型不要写 .git（软，防患未然）；② 工具 schema 中文件写工具的上下文提示携带该约束，registry 层无感（软结构）；③ Write/Edit 的 BeforeWrite 守卫对 canonical 化后的受保护路径直接 deny，且不可豁免（硬）；④ 若经 Shell 执行 `git config` 之类绕道，沙箱把 `.git` 列为受保护子路径强制只读（硬兜底）；⑤ 每次 deny 落 `audit/denial`，可回放"为什么拒绝"。四件套任一缺失，该安全主张都不完整。

### 2.2 Prompt Guidance（软约束，不执法）

- **内容来源**：Policy 声明中的 `guidance:` 字段（每条域条目可带一句人类可读引导）+ Behavior IR `channel=prompt_guidance` 条目的 Model Profile 渲染。
- **注入方式**：Behavior Compiler 在 L3 Harness Profile 中把 policy 引用转成段落，随 H03 注入层进请求（stable 层/注入层由 compiler 决定，遵守缓存纪律）。
- **纪律**：引导文本以"应当/避免"表述，明确是建议；**任何只存在于 guidance 而没有对应硬通道规则的安全主张，编译期报错**（防只写 Prompt）。软通道不产生 Audit 事实——只有执法路径产生（D5 EVENT-SPEC §7.2 第 3 条）。

### 2.3 Tool Interceptor（工具层，结构性防线）

工具层的拦截器做两件互补的事：

1. **暴露面裁剪（schema 级）**：裸工具名 deny 的工具有两个后果——执行层拒绝 **且** 从模型可见工具 schema 中移除（deny 工具"移出上下文"，claude-code.md 行 146/197；DSH Permission.visibleTools/disabled 语义）。模型根本"看不到"被禁工具，就不会发起这类调用。`tools:` 域产出的 hidden/disabled 清单交给 Context Builder（任务书 §9 `context/builder`）。
2. **执行期拦截器（pre-execute 级）**：每个工具（含未来 MCP 动态注册、含非模型通道发起的调用）的 `execute()` 被包裹，先过 `tools/pre-execute`(waterfall)：Policy Engine 裁决 → guard 单调收窄。**即便调用绕过模型通道（脚本/子代理/MCP 直发）也在此复核**，工具层不信任"调用来自谁"，只认裁决结果。拦截器可：`deny(reason)`（拒绝文本回灌模型）、`ask()`（转审批）、`allow()` 并改 arguments（updatedInput 语义）。

> 边界：拦截器是**行为/意图**防线，防不住"合法工具被模型用于恶意目的后产生的任意子进程"（如 Python 自己开文件）——那归 Runtime Deny 的沙箱层。

### 2.4 Runtime Deny（硬执法）

- **Policy Engine**：`BeforeTool` 链上注册的权威裁决监听器，按 §4.2 决策序给出 ALLOW/DENY/ASK。
- **guard 单调**：全链后强制执行的 ToolGuard——只能收窄（把 allow/ask 收成 deny/更严），任何监听器不得放宽（deepseek-harness.md 行 168/242/411）。
- **BeforeWrite / BeforeShell 守卫**（D5 A18/A20）：文件写类工具对 canonical 化后的 targetPath 检查受保护路径与 deny_read/读写边界；shell 命令解析出 argv 后做只读识别与危险命令判定。**字符串解析只作只读识别与 deny 判定，不作主防线**（claude-code.md 行 208：解析不了 fail-closed 弹批准；comparison.md H05 行 330）。
- **沙箱（OS 级兜底）**：`ctx.sandbox.confine(argv, policy)` seam，fail-closed（无后端 `SANDBOX_UNAVAILABLE` 即拒），enforcement full|partial 透明上报；Linux bwrap"只读根 + 可写覆盖 + 受保护子路径强制只读"、macOS Seatbelt、Windows ACL 受限令牌（报告 partial）（H08 Decision）。**最终防线**：Behavior Safety/deny 规则管不住任意子进程是各家共识，能拦子进程的只有 OS 级边界。
- **never_auto 危险集合**：关键路径删除（rm -rf /、~ 等 destructive-delete）、需人交互的工具、显式 ask 项——**任何 profile（含 danger-full-access）都不自动放行**（claude-code.md 行 206；comparison.md H07 Proposed Spec `never_auto`）。

### 2.5 Audit Event（审计，四件套的"证据"）

每一次走策略链的调用恰好产出一次裁决事实（D5 A13 PolicyDecision，emit），deny/ask 分支另有专属记录：

| 分支 | 扩展事件 | 持久记录 | 内容 |
|---|---|---|---|
| 裁决（终态） | PolicyDecision(A13) | `audit/decision`(B19) | verdict + decisionPath（命中规则/钩子/guard/审批/profile）+ effectiveSandboxMode |
| 硬拒绝 | （A13 deny 分支） | `audit/denial`(B20) | toolCallId、stage、ruleRef、reason、sandboxMode（D7 Safety Violations 口径） |
| 审批请求 | ApprovalRequest(A16) | `approval/asked`(B17) | requestId、resource 摘要（不含密钥原文）、policySnapshot |
| 审批结果 | ApprovalDecided(A17) | `approval/decided`(B18) | decision、responder、cacheUpdated |
| 安全度量 | — | `audit/safety`(B21) | 供 evaluator/D7 的安全指标 |

纪律：**先持久、后等待**（ask 在等待应答前先落 `approval/asked`）；配对事件恰好一次；Prompt 段落不产生 Audit 事实。审计事件对保证"为什么放行/拒绝"全程可回放（H07 approval/asked→decided 证据链）。

---

## 3. Policy 声明格式（YAML）

### 3.1 顶层与通用字段

```yaml
policy:
  version: "0.1"                 # 声明格式版本
  profile: workspace-write       # 单一对外选择器：read-only | workspace-write | danger-full-access
  approval: ask                  # ask | never（v0.1 ApprovalPolicy）
  # 通用字段（域内规则通用）：
  #   id       规则唯一 id（decisionPath.ref 引用）
  #   match    匹配模式（工具名 / 命令前缀 / 路径 / 域名，见 3.3）
  #   action   allow | ask | deny
  #   reason   拒绝/询问时回灌模型的文本（deny 反馈循环见 §4.6）
  #   guidance 软引导措辞（编译进 Prompt Guidance）
  #   enforcement: runtime | interceptor-only | guidance-only   # 编译期决定走哪条硬通道
```

### 3.2 域定义（v0.1）

| 域 | 键 | v0.1 支持 | 默认 |
|---|---|---|---|
| `filesystem` | `protected`（写保护，不可豁免）、`deny_read`（凭据默认）、`allow`（显式读/写目录）、`rules` | glob/路径匹配 + 读写方向 | 默认读 = workspace + 显式 allow；凭据 deny_read 默认 |
| `shell` | `deny`（危险集合）、`allow`（只读命令前缀 allowlist）、`scoped_rules` | 命令前缀 + 标志组合 | 无内置黑名单兜底，deny 集合 + 沙箱兜底 |
| `network` | `default`、`allow_domains`、`deny_domains`、`rules` | default + 域名 allowlist/denylist 声明与裁决 | v0.1 `default: allow`（任务书 §8 示例），执行面受限见 §8.1 |
| `git` | `force_push` 等命令级开关 | 布尔 deny/ask/allow | `force_push: deny` |
| `tools` | `deny`/`ask`/`allow`（裸工具名或 scoped） | 工具名 + 参数模式 | 未注册 required_permission 的工具默认 danger 级处理 |
| `audit` | `events`、`details` | decision/denial/approval 开与关 | 全开 |

### 3.3 规则匹配语法

scoped 规则沿用研究文档可辨识形态（claude-code.md 行 197、comparison.md H07 Proposed Spec）：

| 形态 | 含义 | 示例 |
|---|---|---|
| `Bash(<前缀>*)` | 命令前缀（含参数起点匹配） | `Bash(rm -rf *)` |
| `Read(路径)` / `Write(path=glob)` | 路径范围（工具参数解析后 canonical 匹配） | `Read(./.env)`、`Write(path=./.git/**)` |
| `WebFetch(domain:*)` | 域名范围 | `WebFetch(domain:*.example.com)` |
| `Shell(<命令>)` / `Git(<子命令>)` | 工具内子命令门控 | `Shell(git push --force*)` |
| 裸工具名 | 整工具级（deny = 移出上下文） | `tools.deny: [AskUserQuestion]` |
| 组合（`\|`） | 同规则多模式之一命中即触发 | `Write(path=glob ".git/**") \| Edit(path=glob ".git/**")` |

匹配要点：文件系统类先做 **canonical 规范化**（拒绝 `../` 与 symlink 逃逸，先 fs 语义再词法）再匹配（H08 逐调用策略）；shell 命令剥离包装（timeout/time/nice/nohup）与安全 env 前缀后匹配（claude-code.md 行 155）；规则解析不了（超长/UNC/复合结构）时 **fail-closed 转 ask/deny**，不静默放行。

### 3.4 完整示例 ruleset（任务书 §8 基础扩写）

```yaml
# .harness/policy.yaml —— 项目级示例（当前实现无 trust 门：文件存在即自动装载；项目层只能加限制、不能放宽 system 的限制；见 §6.1 实现状态）
policy:
  version: "0.1"
  profile: workspace-write        # read-only | workspace-write | danger-full-access
  approval: ask                   # ApprovalPolicy：ask | never

  filesystem:
    protected:                    # 写保护：任何 allowWrite/allow 都不可豁免（比对 Claude Protected paths）
      - ".git"
      - ".git/**"
      - ".claude"
      - ".ssh"
      - ".harness/credentials"
      - ".env"
    deny_read:                    # 凭据/密钥默认不可读（比 Claude 全盘可读更保守，H08 reads）
      - "~/.aws/credentials"
      - "~/.ssh/**"
    allow:                        # 默认读 = workspace + 此处显式 allow
      - path: "./third_party_secrets"   # 业务要读的受控目录
        mode: read
    rules:
      - id: fs-no-protected-write
        match: Write(path=glob ".git/**") | Edit(path=glob ".git/**")
        action: deny
        reason: ".git 受保护：如需版本操作使用 Git 工具或只读命令。"
        enforcement: runtime
    guidance:
      - "不要直接改写 .git 内部文件；提交/回滚用 git 命令的只读/受管形式。"

  shell:
    deny:                         # 危险集合（对应任务书 §8），任何 profile 不自动放行（never_auto）
      - destructive-delete        # rm -rf /、rm -rf ~、关键路径删除
      - disk-format               # mkfs.* / 磁盘格式化
      - partition-write           # fdisk/parted 等分区写入
    allow:                        # 只读命令前缀 allowlist（字符串解析仅作只读识别，主防线是沙箱）
      - "ls"
      - "cat"
      - "git status"
      - "git log"
      - "grep"
    scoped_rules:
      - id: shell-force-push
        match: Shell(git push --force*) | Shell(git push -f*)
        action: ask                # 走审批（映射到下方 git.force_push 语义）
        reason: "force push 会重写远端历史，需人工确认。"
      - id: shell-metadata-exfil
        match: Bash(curl http://169.254.169.254*) | Bash(curl https://169.254.169.254*)
        action: deny               # 云元数据端点（SSRF 面）
        reason: "禁止访问云元数据端点。"
      - id: shell-cleanup-recursive
        match: Bash(rm -rf ./node_modules) | Bash(rm -rf ./dist)
        action: ask                # 工作区内的大删除可人工放行（allowed-once）
        reason: "递归删除工作区内目录，请确认范围。"
    guidance:
      - "删除/格式化等破坏性命令先说明原因与范围，优先使用受管工具。"
      - "命令行工具联网前先确认是否必要；不改写 .git 内部文件。"

  network:
    default: allow                 # v0.1 语义见 §8.1（声明与裁决生效，代理级执行 v0.2）
    allow_domains:                 # 预允许域（git 远端/包源/文档域等）
      - "github.com"
      - "registry.npmjs.org"
      - "pypi.org"
    deny_domains:
      - "169.254.169.254"          # 云元数据
    rules:
      - id: net-metadata
        match: WebFetch(domain:169.254.169.254)
        action: deny
        reason: "禁止访问云元数据端点。"
    guidance:
      - "只访问任务必需域名；默认不访问未在 allow_domains 的内网/元数据地址。"

  git:
    force_push: deny               # 与 shell 层 shell-force-push 共享语义（见 §3.5 去重）
    guidance: "重写共享分支历史（force push）须先征得用户同意。"

  tools:
    deny:                          # 裸工具名 deny = 移出模型上下文 + 执行层拒绝
      - AskUserQuestion            # v0.1 无交互 UI，需人交互工具一律禁（示例）
    rules:
      - id: tool-read-secrets
        match: Read(path=glob "**/.env") | Read(path=glob "**/.harness/credentials")
        action: deny
        reason: "凭据文件禁止读取；如需变量请走环境注入。"
        enforcement: runtime

  audit:
    events: [decision, denial, approval]   # v0.1 全开
    details: full                           # decisionPath 含 ruleRef/hook 名/approval id

  session:                         # 会话级覆盖位（通常由 CLI flag/运行时写入，不落项目文件）
    approval_cache: session        # ApprovedForSession 按 key 缓存，拒绝不缓存
    grant_tools: []                # 会话内 once 放行（不落盘）
```

### 3.5 编译到四件套的映射（域条目 → 产物）

| 声明条目 | Prompt Guidance 产物 | Tool Interceptor 产物 | Runtime Deny 产物 | Audit 产物 |
|---|---|---|---|---|
| `filesystem.protected` | 引导"不改写受保护路径" | 文件写工具上下文约束 | BeforeWrite 守卫 deny（不可豁免） | audit/denial |
| `filesystem.deny_read` | 引导"不读凭据文件" | Read 工具暴露面裁剪（schema 提示） | Read 守卫 deny + 沙箱 denyRead | audit/denial |
| `filesystem.confinement` (task 073) | 引导"文件访问限于允许集合"（工作区根 + 显式 allow） | 工具层 `assertConfined` 硬执法（Mode 区分） | `fs-confinement` 规则执行前词法预检（逃逸/绝对越界）+ 工具 canonical 权威拒绝 | audit/denial |
| `shell.deny.*` | 引导"破坏性命令先说明" | Shell 工具暴露面裁剪 | Policy Engine deny（never_auto 服务内强制）+ 沙箱兜底 | audit/denial |
| `shell.scoped_rules[ask]` | 引导"此命令需确认" | — | Policy Engine → ask → ApprovalRequest | approval/asked→decided |
| `network.default/domains` | 引导"只访问必需域名" | （WebFetch 类工具暴露面） | 域名裁决 + （v0.2）代理 allowlist | audit/decision |
| `git.force_push` | 引导"不重写共享历史" | Git 命令门控 | 命令裁决 deny/ask + 沙箱受保护 | audit/decision/denial |
| `tools.deny[裸名]` | —（不提示禁工具） | **移出上下文**（不可见）+ 执行层拒绝 | denied_tools 无条件拒绝（先于一切） | audit/denial |
| `tools.rules[scoped]` | 引导 | — | 规则引擎裁决 | audit/decision/denial |

去重纪律：同一主张多处声明时（如 git.force_push 与 shell 层 scoped 规则），编译期按**语义合并去重**（取最严 action），decisionPath 记录全部命中 ref 便于审计。

---

## 4. Policy Engine

### 4.1 执行链落地（任务书 §8 → v0.1）

任务书 §8 链条 `Agent → Tool Call → BeforeTool → Policy Engine → ALLOW/DENY → Runtime → Audit` 在 v0.1 事件面中落地为（D5 EVENT-SPEC §7.1 逐项映射，此处补引擎内部语义）：

```text
Agent → Tool Call              AfterModel(A10) 产出 toolCalls → 每调用落 tool/call(B04)
→ BeforeTool                   BeforeTool(A12) waterfall（决策闸口）
→ Policy Engine                Policy 规则引擎作为 A12 上的权威监听器（§4.2 裁决序）
→ ALLOW / DENY                 guard 单调收窄 + PolicyDecision(A13) emit + audit/decision(B19)
   （ask 分支）                 ApprovalRequest(A16) → approval/asked(B17) → 应答
                               → ApprovalDecided(A17) → approval/decided(B18)
→ Runtime                      沙箱 confine（A20 BeforeShell / 工具执行）→ AfterTool(A14)
→ Audit                        audit/denial(B20) / audit/decision(B19) / audit/safety(B21)
```

### 4.2 权威裁决序

对照 claude-code（deny→ask→allow 先匹配生效、hook 不 bypass 规则）、claw（denied_tools → deny → hook override → ask → allow → 模式比较）、codex execpolicy（allow/prompt/forbidden）、DSH（单调 guard + fail-closed）。v0.1 裁决序定为：

```text
① denied_tools     裸工具名 deny：无条件拒绝，先于一切；工具同时移出上下文
② deny 规则        命中 deny（scoped/命令/路径/域名）→ DENY（不可被任何 allow 豁免）
③ hook override    BeforeTool 监听器裁决（外部 PreToolUse 型 hooks / 工具拦截器）
                    → 可 deny/ask/defer（defer 不 bypass ①②）；不 bypass 规则
④ ask 规则         命中 ask → ASK（转 ApprovalRequest）
⑤ allow 规则       命中 allow → ALLOW（可用 updatedInput 改写参数）
⑥ profile 比较     未命中规则时：工具 spec 的 required_permission 与当前 profile 比较
                    （read-only 下写类工具 = ask/deny；未注册 required_permission 默认 danger 级）
```

先匹配生效；**deny 优先且更细 allow 不豁免 deny**（同一次调用多规则命中取最严 action）；hook 只在 ①② 未决时介入且只能收窄。

### 4.3 guard 单调与 fail-closed

- **guard 单调**：BeforeTool waterfall 全链（规则引擎、审批、沙箱解析、外部 hooks 各自以监听器注入）结束后，ToolGuard 统一收窄：只允许把结果变得更严（ALLOW→ASK/DENY、ASK→DENY），**任何监听器顺序都无法把拒绝翻回允许**（deepseek-harness.md 行 411）。同一事件多监听器并行裁决取最严（任一 deny 即 deny，claude-code.md 行 180）。
- **fail-closed 三处落点**：① ask 无应答者 = unavailable = 拒绝；② `approval: never` 在 waterfall 分发**之前**服务内强制拒绝（应答者也绕不过）；③ 沙箱无后端 `SANDBOX_UNAVAILABLE` = 拒绝危险调用（H08）。

### 4.4 ASK 审批流

- **触发**：裁决为 ask（ask 规则命中 / hook ask / profile 比较要求确认）。
- **流程**（对照 DSH `ctx.approval.request()` → `approval/request` waterfall；D5 A16/A17）：`approval/asked` 先落日志 → 应答者链（CLI 人类 / ACP 机器监听器，可短路作答）→ `approval/decided` 恰好一次闭合。
- **应答语义**：`allowed-once`（放行本次）/ `allowed-session`（写入会话级缓存 ApprovedForSession，同 key 免重复问；key 按 permission+pattern 可序列化，codex 语义）/ `rejected` / `cancelled` / `unavailable`（后三者一律拒绝并 fail-closed 回灌模型）。
- **拒绝反馈**：deny/拒绝文本回灌模型 → 模型改写后重试；同调用意图连续 deny ≥3 次即终结该路径（denial breaker/doom-loop，Hermes/OpenCode 纪律；D5 §7.2 第 4 条）。
- **批准后可追加**：用户批准后按 `proposed_execpolicy_amendment` 语义把该命令追加进 allow 前缀规则（codex.md 行 120）。
- **缓存纪律**：拒绝不缓存；会话内 granted 不落项目文件（仅运行期）。

### 4.5 执行链伪代码

```text
function onBeforeTool(toolCall):                       # BeforeTool(A12) 上的权威监听器
    # ── 0) never 服务内强制（先于 waterfall 分发，应答者绕不过）──
    if policy.approval == never and needsApproval(toolCall):
        return DENY(reason="approval:never", stage="approval", ref="policy-never")

    path := []                                        # decisionPath 审计轨迹

    # ── ① denied_tools ──
    if toolCall.toolName in resolved.denied_tools:
        return DENY(stage="rule", ref="denied_tools:" + toolName, reason=…)

    # ── ② deny 规则（先匹配生效，最严优先）──
    if rule := matchFirst(resolved.denyRules, toolCall):
        return DENY(stage="rule", ref=rule.id, reason=rule.reason)

    # ── ③ hook override（工具拦截器 + 外部 hooks；只收窄不放宽）──
    override := runBeforeToolListeners(toolCall)      # deny|ask|allow(+updatedInput)|defer|no-op
    if override == deny:  return DENY(stage="hook", ref=override.hook)
    if override == ask:   decision := ASK(ref=override.hook)

    # ── ④ ask 规则 ──
    if not decided and rule := matchFirst(resolved.askRules, toolCall):
        decision := ASK(ref=rule.id)

    # ── ⑤ allow 规则 ──
    if not decided and rule := matchFirst(resolved.allowRules, toolCall):
        decision := ALLOW(ref=rule.id); apply(rule.updatedInput)

    # ── ⑥ profile 比较（未命中规则时按 required_permission × profile）──
    if not decided:
        decision := compare(requiredPermission(toolCall), policy.profile)   # 写类×read-only → ask/deny

    # ── guard 单调收窄 ──
    decision := toolGuard.narrow(toolCall, decision)   # 只能变严

    # ── ask 分支：审批流（先持久后等待，fail-closed）──
    if decision == ASK:
        audit.write("approval/asked", requestId=…)     # 先落日志
        ans := ctx.approval.request(toolCall)          # 应答者链（UI 人类/ACP 机器）
        audit.write("approval/decided", ans)
        if ans not in {allowed-once, allowed-session}:
            return DENY(stage="approval", ref=reqId, reason="fail-closed")
        if ans == allowed-session: cache.put(cacheKey(toolCall))

    # ── 裁决落点 + 审计 ──
    emit PolicyDecision(toolCallId, verdict=decision, decisionPath=path, effectiveSandboxMode)
    audit.write("audit/decision", …)

    if decision == DENY:
        audit.write("audit/denial", …)                 # B20
        return REJECT(text=denyReason)                 # 回灌模型改写（denial breaker 计数）
    return ALLOW(updatedArguments)                     # → Runtime（sandbox confine）→ AfterTool
```

### 4.6 与 hook 集成对照（研究对齐表）

| 对照项 | claude-code（H07） | codex（execpolicy） | dsh（H07） | 本项目 v0.1 |
|---|---|---|---|---|
| 规则三态 | allow/ask/deny，deny→ask→allow 先匹配 | allow/prompt/forbidden | 无内置规则（sandbox+approval 组合） | allow/ask/deny，deny 先匹配不可豁免 |
| 决策入口 | permission 评估 → PreToolUse hook → PermissionRequest | 审批判定 → 沙箱 → 升级重试 | pre-execute waterfall → ToolGuard → ctx.approval | denied_tools → deny → hook → ask → allow → profile（§4.2） |
| 审批语义 | once/always、permission prompt | AskForApproval、ApprovedForSession 缓存、escalate 二次审批 | ask|never、应答者链、fail-closed、never 服务内强制 | ask|never + once/session + 缓存 + escalate_on_failure |
| deny 工具 | 移出上下文 | denied_tools | disabled/visibleTools | 移出上下文 + 执行层拒绝 |
| 单调性 | hook 不 bypass 规则 | — | ToolGuard 单调（只收窄） | guard 单调全链强制 |
| 危险集合 | 任何模式不自批 | is_dangerous_command 黑名单 + 沙箱兜底 | sandbox 文件效果策略兜底 | never_auto（任何 profile 不自动放行） |

---

## 5. Behavior Safety 与 Runtime Safety 分层

### 5.1 分层定义与职责边界

- **Behavior Safety（行为安全）——管"模型试图做什么"**（claude-code.md 行 213 官方区分）。载体：Behavior IR 行为条目 + Policy 的 `guidance` 措辞 → Model Profile 渲染进 prompt；Guardian/classifier 型模型审查在 H07 各家属此层（v0.1 **不进主链**，见 §8.2）。它负责：先导行为塑造（先读后改、破坏性操作先说明、凭据不外发等），减少"坏意图"的产生。
- **Runtime Safety（运行时安全）——管"命令/工具能碰到什么"**。载体：Policy 硬通道（deny/ask 规则 + guard 单调 + fail-closed）+ 审批 + BeforeWrite/BeforeShell 守卫 + 沙箱 confine（OS 级能力边界）。它负责：意图即使产生也被拦下，且拦得住任意子进程的越界读写/联网。

职责边界一句话：**行为层决定"模型该不该发起"，运行时层决定"发起后能不能碰到"**；两层的配置意图共享同一份 Policy（profile/approval 捆绑为单一选择器，deepseek-harness.md 行 262/250 permission-presets 语义），但执行与失效互相独立、不可互相替代。

### 5.2 失效面声明（文档必须明示，不夸大）

| 层 | 载体 | 失效面 | 兜底 |
|---|---|---|---|
| Behavior Safety | prompt/引导、guidance | 模型可能不遵循；prompt 可被注入内容污染（UNTRUSTED 纪律）；**管不住任意子进程** | 硬通道 + 沙箱 |
| Runtime Safety（规则/审批） | deny/ask 规则、guard | 规则匹配漏网（黑名单本质易漏）；**deny 规则拦不住子进程自己开文件/联网**（claude-code.md 行 213） | OS 级沙箱边界 |
| Runtime Safety（沙箱） | confine + 平台后端 | partial enforcement（Windows ACL/旧 Landlock）不是绝对边界 | enforcement full|partial 透明上报，绝对边界消费方拒绝或暴露差异（H08） |

> 三条铁律：① 任何安全主张都**必须**有硬通道产物（编译器强制）；② 硬通道产物**不得**只依赖字符串解析做最终防线（沙箱是兜底）；③ enforcement 强度**不得**夸大（partial 如实上报，H08 Rejected 纪律）。

### 5.3 与 Behavior IR 双通道（policy_ref）

Behavior IR 中 `channel: [prompt_guidance, runtime_policy]` 的条目（BEHAVIOR-IR-SPEC E33 网络使用纪律 / E42 破坏性判断模型自持 / E44 凭据不外发）在 L3 Harness Profile 编译时产出一个 **policy_ref** 指向 D6 规则；本规范要求：

```yaml
# Behavior IR 侧（示意）
safety:
  destructive_judgment_model_held:   # E42
    channel: [prompt_guidance, runtime_policy]
    policy_ref: policy#shell.deny.destructive-delete   # → 本规范 §3.4 shell.deny
  no_secret_echo:                    # E44
    channel: [prompt_guidance, runtime_policy]
    policy_ref: policy#filesystem.deny_read            # → 本规范 §3.4 deny_read
```

编译期：policy_ref 指向的 D6 规则缺失或 enforcement 非硬通道 → **编译告警/失败**（防只写 Prompt）；双通道都产出后才算该安全条目完整（BEHAVIOR-IR-SPEC §7.2）。

---

## 6. 策略作用域与合并/覆盖

### 6.1 作用域定义

> **实现状态（截至 Round 15）**：**已实现的只有 `system` + `project` 两层**（`inspectPolicyLayers`
> 的层集合即 `'system' | 'project'`；`--policy` 只覆盖 system 层，project 层固定取
> `<workspace>/.harness/policy.yaml`）。**`user` 层**（`~/.harness/policy.*.yaml`）**无 loader**；
> **workspace trust 门**（§6.3）**只存在于注释**（`PolicyLoader.ts:16,25`）；**`session` 层无实现**
> （仅 `permission` → profile 一处 compose 层覆盖槽）。本节下述作用域定义与 §6.2 / §6.3 的其余
> 描述均属**目标设计**，不代表当前可用行为。

| 作用域 | 载体 | 装载时机 | 内容定位 |
|---|---|---|---|
| `system` | harness 内置基线 + 受管设置（managed settings） | 进程启动 | 不可降级的默认 deny 集（destructive-delete/disk-format/partition-write、deny_read 基线）、内置 profile 模板 |
| `user` | `~/.harness/policy.*.yaml`（全局用户配置） | 进程启动 | 用户的跨项目偏好（approval 策略、常用 allow 域） |
| `project` | `<workspace>/.harness/policy.yaml` | workspace trust 通过后装载 | 项目安全规则（§3.4 示例） |
| `session` | 运行期（CLI flag、审批缓存、会话授权） | 会话内动态 | 会话级授权（ApprovedForSession、once 放行、`--danger-full-access` 等显式 flag） |

### 6.2 合并/覆盖规则

- **加载序与优先级**：`system > user > project > session`；每层内部 deep-merge，未知 key 拒绝（fail loud，不静默丢字段，对齐 BEHAVIOR-IR resolver 纪律）。
- **deny 全局优先**：任一层的 deny 即 deny，**不可被任何层、任何更细 allow 豁免**；同 specificity 冲突取最严（ask > allow）。
- **ask/allow 就近覆盖**：同层级内 allow 与 ask 冲突时按 §4.2 先匹配生效；层级间低层 allow 不能覆盖高层 ask（只能等效或更严）。
- **列表合并语义**：deny 集合并集；allow 集合并集（但 scoped allow 永不豁免 deny）；profile/approval 取高层默认、会话 flag 可显式收窄或（经审批）放宽到 danger-full-access。
- **子代理/委派**：V0.1 平面无委派；规则先声明——委派单元继承父会话的**生效快照**并只能收窄（only-narrow，codex "角色只能收窄不能放大父权限"），delegationDepth 持久化，冷恢复不降级（dsh 纪律）。

### 6.3 workspace trust 门（项目级装载门）

首次进入项目、加载项目级规则/技能/扩展**之前**询问（借鉴 Pi ProjectTrust / claude workspace trust，comparison.md H07 `workspace_trust`）：

- 未信任前：不装载 project 作用域 allow 规则与项目本地扩展（仅 system+user 生效），避免"打开目录就被项目规则放权"；
- AGENTS.md/CLAUDE.md 等**上下文指令文件不受信任门限制**（只作建议性引导，无执法力，H07 共同抽象）；
- 信任决策本身落 `session/created` 上下文，可审计。

---

## 7. 与 D5 EVENT-SPEC 衔接（D6 侧接线约定）

### 7.1 挂载点与事件

1. **Policy Engine 不在事件面内，而是 `BeforeTool`(A12) 链上的权威裁决监听器**；审批请求器、沙箱模式解析同样以 waterfall 监听器挂 A12（D5 §7.2 第 1 条）。D6 定义引擎内部语义（规则/裁决序/profile/guard），D5 定义挂载点与证据事件。
2. **PolicyDecision(A13)**：guard 收窄后、执行前恰好一次 emit，载荷含 `verdict: allow|deny|ask` 与 `decisionPath`；持久镜像 `audit/decision`(B19)。D6 为 decisionPath 提供 ref 命名（§7.2）。
3. **ApprovalRequest(A16) / ApprovalDecided(A17)**：裁决为 ask 时进入；`approval/asked`(B17) 先落、`approval/decided`(B18) 恰好一次闭合；fail-closed 语义由 loop 强制执行（allowed-once 放行本次，其余拒绝）。
4. **deny 反馈纪律**：deny 文本回灌模型后可改写重试；连续 deny ≥3 次终结该意图路径（denial breaker）。
5. **软/硬分离不变**：prompt 段落不产生 Audit 事实；只有执法路径产生（audit/decision、audit/denial、approval/*）。

### 7.2 decisionPath 命名与 ref 格式（供 A13 载荷）

```yaml
decisionPath:
  - { stage: "rule",     ref: "rule:shell-force-push",       outcome: "ask" }
  - { stage: "hook",     ref: "hook:tool-interceptor",       outcome: "pass" }
  - { stage: "guard",    ref: "guard:toolguard",             outcome: "pass" }
  - { stage: "approval", ref: "approval:req_1f9c",           outcome: "allowed-session" }
  - { stage: "profile",  ref: "profile:workspace-write",     outcome: "pass" }
```

命名约定：`rule:<id>`（Policy 声明 id）、`hook:<名称>`、`guard:<守卫名>`、`approval:<requestId>`、`profile:<档名>`、`policy-never`（服务内强制拒绝）。`audit/denial`(B20) 的 `stage` 取自终态所在阶段。

### 7.3 与审计/度量衔接

- `audit/denial` 的 toolCallId/stage/ruleRef 构成 **D7 Safety Violations** 口径（benchmark 安全指标）与 Evaluator 证据（回放"为什么拒绝"）。
- `approval/asked→decided` 配对数构成 **Autonomy 指标**（人工介入次数，D5 A17 消费方）；`audit/decision` 供 UI 透明展示与 conformance 校验（行为断言：被 deny 的调用不应重复出现于日志）。

---

## 8. v0.1 范围声明

### 8.1 v0.1 纳入

**声明域与规则：**

- `filesystem`：`protected`（写保护不可豁免）、`deny_read`（凭据默认）、`allow`（显式目录）、scoped 路径规则；canonical 规范化 + symlink/`..` 防逃逸；默认读 = workspace + 显式 allow（比 Claude 保守）。
- `shell`：`deny` 危险集合（destructive-delete / disk-format / partition-write，never_auto）、只读命令前缀 allowlist（仅只读识别用）、scoped 规则（命令前缀 + 标志）。
- `network`：`default`/`allow_domains`/`deny_domains` 的**声明与裁决**（default: allow 任务书语义）；执行面说明——v0.1 无 WebFetch 工具（6 工具集），域名裁决作用于 shell 命令的已知网络动词与未来工具声明，代理级执行（MITM/出站注入）v0.2。
- `git`：`force_push` 布尔 deny/ask（与 shell 层合并去重）。
- `tools`：三态规则 + denied_tools（裸名 deny = 移出上下文）+ 工具 required_permission 声明（未注册默认 danger 级）。

**引擎与机制：**

- profile 三档 read-only / workspace-write / danger-full-access + approval ask|never（V0.1 默认 `never` 落地，ask 交互后置，D5 §10.3 第 4 条）；
- 决策序（§4.2）、guard 单调、fail-closed 三落点、never_auto、ApprovedForSession 缓存、escalate_on_failure 二次审批（带 retry_reason）语义定义；
- 作用域合并（system/user/project/session，§6）与 workspace trust 门；
- 审计接线（§7）：A13/A16/A17 + B17–B21；denial breaker ≥3；
- 四件套编译映射与编译器防漏规则（§2/§3.5/§5.3）。

**承载形态：** 声明文件 YAML 解析 → Resolver 合并 → 编译四件套 → 装载（任务书 §9 `policy/{engine,hooks,risk}` 与 `runtime/{executor,sandbox}` 边界由 D8 落定）。

### 8.2 明确不做（v0.2+，规则先声明不装载）

| 项 | 去向 | 原因 |
|---|---|---|
| 网络代理 MITM / 凭据 mask + 出站注入 | v0.2（H07/H08 network layer） | 依赖代理基础设施，超出 v0.1 6 工具平面 |
| 容器 / 微 VM 沙箱后端（docker/ssh/microVM 同级提供方） | v0.2+（H08 container_seam） | v0.1 平台后端（bwrap/seatbelt/Windows ACL partial）足够 |
| Guardian / classifier 模型审查入主链 | evaluator/验证层（H12）而非 v0.1 权限主链（comparison.md H07 Why） | 黑盒不可本地审计，违背"安全可审计"取向 |
| async hooks + rewake | v0.2（D5 §10.3） | v0.1 钩子同步跑带超时 |
| prompt/agent 型 hook handler | 不进 hook 语义 | 非确定性决策，留 evaluator 扩展 |
| MCP 动态工具注册的细粒度策略 | v0.2（MCP 平面） | v0.1 无 MCP；工具名命名 `mcp__<server>__<tool>` 规则先预留 |
| 计划模式（plan-mode）独立权限面 | v0.2 | v0.1 无 plan 工具 |
| 凭据 mask 的 macOS 文件退化逻辑等平台细节 | v0.2 | 依赖网络代理层 |

范围判据一句话：**v0.1 把"声明—裁决—审批—审计"的骨架与 fail-closed/deny 优先语义做完整、做确定；把依赖外部基础设施（代理/容器/模型审查）的强化层留给 v0.2 按同级 seam 追加，不改变已定骨架。**

---

## 附录 A：执行链伪代码（完整）

```text
# 工具调用生命周期（Policy 视角，v0.1 单 agent / 6 工具）
1  AfterModel(A10) 产出 toolCalls
2  for each toolCall:
3      tool/call(B04) 记录
4      BeforeTool(A12) ── waterfall：
5        ├─ 监听器 1：Policy 规则引擎（§4.5 onBeforeTool 裁决序）
6        │     ├─ deny ──→ PolicyDecision deny(A13) → audit/denial(B20)
7        │     │           → 拒绝文本回灌模型 → denial breaker 计数（≥3 终结意图）
8        │     ├─ ask ───→ ApprovalRequest(A16) → approval/asked(B17)
9        │     │           → 应答者链(UI 人类|ACP 机器) → ApprovalDecided(A17)
10       │     │             → approval/decided(B18)
11       │     │             └─ allowed-once/session → 继续；其余 → 拒绝(fail-closed)
12       │     └─ allow ──→ PolicyDecision allow(A13) → audit/decision(B19)
13       ├─ 监听器 2：审批请求器（approval:never → 服务内强制拒绝，分发前）
14       ├─ 监听器 3：沙箱模式解析（effectiveSandboxMode → A13 载荷）
15       └─ guard 单调收窄（ToolGuard：只收窄）
16     Runtime：写文件 → BeforeWrite(A18) fs 守卫 → 执行 → AfterWrite(A19)
17              shell   → BeforeShell(A20) 只读识别 + confine → 执行 → AfterShell(A21)
18     AfterTool(A14) → tool/result(B05)
19     {执行失败 → ToolError(A15)：SANDBOX_DENIAL/RUNNER_FAILURE 分类
20       → 可升级 → 二次审批(retry_reason) 以更宽松沙箱重试；否则 deny 回灌}
```

不变式：任何工具调用要么有 `PolicyDecision`（allow/ask 终态经审批后）要么在 `audit/denial` 留痕；`approval/asked→decided` 配对完整；guard 收窄方向唯一（只严不松）。

## 附录 B：术语与机制对照

| 术语 | 含义 | 研究来源对照 |
|---|---|---|
| Prompt Guidance | 软通道，Policy→prompt 措辞，不执法 | dsh"引导而非强制"；cc 指令是建议 |
| Tool Interceptor | 暴露面裁剪 + pre-execute 拦截器 | dsh disabled/visibleTools；cc deny 移出上下文 |
| Runtime Deny | 硬通道：裁决 + guard + 守卫 + 沙箱 | cc/ccx/dsh H07/H08 |
| Audit Event | 裁决证据（A13/A16/A17 + B17–B21） | dsh approval/asked\|decided；H07 证据链 |
| denied_tools | 裸工具名 deny，先于一切 | claw decision order；cc 裸名 deny |
| guard 单调 | 只收窄不放宽的强制收尾 | dsh ToolGuard |
| fail-closed | 无应答=拒绝；never 服务内强制；无沙箱=拒危险调用 | dsh；H07/H08 |
| never_auto | 任何 profile 不自批的危险集合 | cc"任何模式不自批"；cmp:H07 |
| ApprovedForSession | 会话级审批缓存（按 key） | codex ApprovalStore |
| escalate_on_failure | 沙箱拒绝→带 retry_reason 二次审批→更宽松重试 | codex orchestrator |
| decisionPath | A13 可审计决策轨迹 | D5 A13 |
| workspace trust | 项目规则装载门 | Pi ProjectTrust / cc workspace trust |

（完）
