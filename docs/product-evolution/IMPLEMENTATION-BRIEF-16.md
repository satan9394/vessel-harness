# IMPLEMENTATION-BRIEF-16 — "宣称与实际不符"同族收口（G-18，P1）

> 来源：独立现状重审（`ROUND-15-DIRECTION.md` §三）。**其中 1B / 1C 已由 Orchestrator 实测确认为真**；2B / 2C 待实现时复核。
> 主题单一：**产品对用户说的话，必须与它实际做的事一致**。这已是本项目反复出现的缺陷族（theme 无消费者、locale 未接、`/permission` 假成功、`vessel chat`、门禁错误注记），本轮把它一次收干净。

## 目标

新人从读到"第一次成功使用"的整条路径上，**不存在**"名字对不上 / 以为是真模型其实是 mock / 文档教了不存在的命令 / 安全宣称自相矛盾"这四类误导。

## 用户场景与当前问题（含实测证据）

**1B 引导自称与产品名不一致（已实测）**
`apps/cli/src/guide/guide.ts:20,22` 中文header/正文写「Vessel / **小小蜜**」，`:31,33` 英文写「Vessel / **Xiaoxiaomi**」；而 `README.md:1,7`、`docs/PROJECT-BRIEF.md` 通篇只有 **Vessel**，且**没有任何文档解释这个昵称**。
→ 新人跑 `vessel guide` 会怀疑自己装错了东西。
**决策（Orchestrator）**：**统一为 `Vessel`**。若作者确实想保留昵称，则必须**同时在 `README.md` 首次出现处说明**（"Vessel（昵称：小小蜜）"），**不允许只在引导里出现**。

**1C mock 回复看起来就是真模型（已实测，比原描述更严重）**
无配置时默认 mock；实测 `run --prompt '总结 README'` 的**最终回复**：
```
已通过 Read 工具读取工作区文件。内容开头：
# Probe

This is a probe README for the vessel mock check.
```
它**调用了真实工具、读到了真实文件**，回复里**没有任何 mock 标记**（输出中出现的 "mock" 字样来自 provider 行与 setup 提示，**不在回复中**）。→ 新人会确信"模型已接上"。
**要求**：运行期**显式**标注。建议两条一起做：① 回合开始/结束时打印一行明确提示（含"未连接真实模型"与 `vessel setup` 指引）；② mock 回复文本自身带可辨识前缀（沿用既有 fallback 文案里 `（mock 离线冒烟）` 的口径，做到**每条 mock 回复**都有）。
**必须**：真实 provider 路径**不得**出现该标记（负对照），`--json` 下提示走 stderr 或结构化字段（不得污染 stdout 的单一 JSON 契约）。

**2B 密钥宣称自相矛盾（待复核）**
`docs/PROJECT-BRIEF.md:43` 宣称「密钥不落盘 / DPAPI 加密」；`CredentialStore.ts:17-18,208,262-266,624` 在非 Windows / DPAPI 不可用时**降级明文**落 `~/.vessel/secrets.json`；`apps/cli/src/providers/setup.ts:74` 向导又反向写成"明文存 ~/.vessel"（Windows 上其实是 DPAPI 密文）。
→ 同一件事三种口径，**安全宣称不可审计**。
**要求**：三处**统一为按平台如实表述**：Windows→DPAPI 密文；其它平台→明文并**明确风险**与替代建议。**不得**继续出现"一律不落盘"这类与代码不符的断言。

**2C 文档仍把 `vessel chat` 当入口（待复核）**
`docs/PROJECT-BRIEF.md:51`、`README.md:61` 把 TUI/chat 列为入口，而 `cli.ts` 对 `chat` 返回「未知命令」exit 2。
**要求**：改为真实入口（裸 `vessel` / `vessel resume`），并顺手核对文档里其它命令名与 `dispatch` 实际注册一致（**只修事实性错误**，不做大改版）。

## 涉及模块

`apps/cli/src/guide/guide.ts`、`apps/cli/src/cli.ts`（mock 提示）、`apps/cli/src/providers/setup.ts`、`docs/PROJECT-BRIEF.md`、`README.md`（+ `CredentialStore.ts` 仅当需要对齐注释）。

## 不能破坏什么

- `--json` 的**单一 stdout JSON** 契约（所有既有 `--json` 测试不得变红）。
- 既有断言人类文案的测试（改文案前先 `grep` 断言，逐条确认）。
- `tsc -b` 0；全量 vitest 绿（当前 **132 文件 / 1431 passed + 3 skipped**）；发布门禁 8/8 保持。
- 不引入依赖；不改 provider 选择/凭据存储的**行为**（本轮只改**说法**与**可见性**）。

## 验收标准（可判别）

1. **AC1（1B）**：`vessel guide`（中/英）输出**不再出现**「小小蜜 / Xiaoxiaomi」；`grep -rn '小小蜜\|Xiaoxiaomi' apps packages docs README.md` 的结果要么为空，要么**同时**在 `README.md` 有一处解释性出现（二者择一，必须在交付说明中写明选了哪种并给出 grep 结果）。
2. **AC2（1C，判别性）**：在无 provider 配置的临时工作区跑 `run --prompt` → 输出**含**明确的 mock 提示（断言具体字符串）；
   **负对照**：配置一个 MockProvider 之外的真实 provider（用测试内的假 provider 即可）→ 输出**不含**该提示。
   同时：mock 的**每条**回复都带可辨识前缀（至少断言实测那一类"工具已读文件"的回复也带）。
3. **AC3（2B）**：三处宣称与代码事实一致——给出每处的改后原文与对应代码行证据；`grep` 不再出现"密钥不落盘"这类无平台限定的断言（若有保留，必须带平台条件）。
4. **AC4（2C）**：`README.md` / `PROJECT-BRIEF.md` 中列出的入口命令**逐个实测**可用（至少覆盖 TUI 入口、`provider`、`settings`、`sessions/resume`、`policy status`）；`grep` 不再出现 `vessel chat` 作为入口的表述。
5. **AC5**：`tsc -b` 0；全量 vitest 绿；`--json` 契约测试全绿。

## 错误场景

- mock 提示若走 stdout，会破坏 `--json` 契约 → **必须**走 stderr（或在 JSON 里作为字段）。
- 改 `guide.ts` 文案若被既有测试断言 → 同步更新断言，**不得**放宽为模糊匹配。
- 2B 若只改文档不改向导，会留下第二处口径 → 三处必须一起改。

## 测试要求

- 走真实 `main()`（沿用 `jsonErrorExits.test.ts` / `policyStatus.test.ts` 风格：临时四根 + 分别捕获 stdout/stderr/warn）。
- **AC2 必须有负对照**（真 provider 不出现 mock 标记），否则"加了提示"与"提示永真"无法区分。
- 交付链：写入型微任务（单文件、禁跑命令）+ 指挥复跑 `tsc`/全量 vitest + **真实 CLI E2E**（无配置跑一次、`vessel guide` 中英各一次、`policy status` 一次）+ 独立静态 Evaluator 复核。

## 明确不做（本轮）

- 不做 i18n 架构改造（仅统一名称与文案）；
- 不重写 README 结构；
- 不做"由命令注册表生成 help"（列为 Round 17 候选：`--help` / README 命令表 / `dispatch` 三份手工副本已漂移）；
- 不新增 provider、不动凭据存储行为。
