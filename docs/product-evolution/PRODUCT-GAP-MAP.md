# PRODUCT-GAP-MAP — Vessel 产品缺口地图（第三阶段：独立综合）

> Orchestrator 综合自 4 份独立审计（UX / CAPABILITY-MATRIX / ARCHITECTURE / RELIABILITY），
> 执行去重、冲突检测、依赖分析、成本/收益判断。每项含：ID/问题/证据/用户影响/根本原因/建议/涉及模块/成本/风险/依赖/优先级。

优先级定义：P0 阻碍核心使用/严重安全/数据风险；P1 明显破坏核心体验；P2 显著提升成熟度；P3 高级能力；P4 可选优化。

---

## 缺口清单（去重后 15 项）

| ID | 问题 | 证据来源 | 用户影响 | 建议（一句话） | 涉及模块 | 成本 | 优先级 |
|---|---|---|---|---|---|---|---|
| G-01 | **首次运行 mock 冒烟演示在仓库工作区 100% 失效**：README 首条示例 `run --prompt "总结当前工作区 README"` 实测输出 `(mock: no script entry matched)` 且 exit 0 | UX-1.1（实跑复现 + 空工作区对照组） | 无配置新用户复制首条命令即"假成功"，第一次成功使用被阻断 | mock 匹配跳过注入型 user 消息（skills index 等 volatile），仅匹配真实 surface 输入；或冒烟脚本给确定性兜底应答 | rules/context Builder、llm MockProvider、cli | 低 | **P0** |
| G-02 | **未知/拼错命令被静默当作 run 执行**（exit 0）：`vessel foo`、`vessel chat`（文档声称的 TUI 入口，实际是无参 `vessel`）都变成静默 mock run，拼错永不报错 | UX-1.2（实跑复现）| 用户打错命令得到无意义"成功"，且 TUI 入口认知错误 | main() 增加未知子命令分支：提示 + `vessel --help` 指引 + exit 2 | cli | 极低 | **P0** |
| G-03 | **CLI 顶层无异常兜底**：配置损坏（settings/secrets/current/providers.json）→ 核心命令裸栈崩溃、无恢复指引 | RELIABILITY-R1/R5（cli.ts:1513-1515 无 .catch） | 用户遇"unhandled rejection"式崩溃，不知怎么修（对新手=坏） | main() 加统一 .catch：describeProviderError + 按错误特征给一句恢复指引 + exit 1 | cli | 中低 | P1 |
| G-04 | **usage.json 损坏 → 静默清零 + 无备份 = 用量历史永久丢失** | RELIABILITY-R2（UsageStore.ts:432-519 load 吞错、save 无备份） | 全部用量/成本历史静默消失，无法回滚 | 损坏时 fail-loud/隔离改名+warn（复用 secrets quarantine 样板）+ 写前备份轮转；load 失败不覆盖 | cli usage | 中 | P1 |
| G-05 | **密钥暴露面**：DPAPI 把 base64 密钥拼进 PowerShell 命令行（本机同级进程可读）；openai-compatible 错误体原文回显 500 字符（潜在密钥进日志）；secrets.json 损坏默认无恢复 | RELIABILITY-R3/R4/R5 | 密钥可被本机同级进程/日志捕获 | DPAPI 改 stdin 传参或 native 库；错误体仿 OpencodeGoProvider 脱敏；默认 recoverCorrupted:true | application CredentialStore、llm OpenAICompatibleProvider | 中 | P1 |
| G-06 | **i18n 无统一架构**：CLI settings.locale（仅 guide 消费）、web 自检测 i18n、永远双语 glossary 三套互不相通；CLI 217 处 console.* 中文内联无消息目录；settings 提示文案宣称"已切换"但 explain/TUI 写死中文（名不副实） | ARCHITECTURE-S1 + UX-P1 | 用户改设置无效却不自知；加语言=全量改造 | 短期：修 settings 提示话术 + 让 explain/TUI 尊重 locale；长期：消息目录统一架构成单独里程碑 | cli/web/glossary | 高（全量） | P1→缓 |
| G-07 | **apps/web 游离 tsc -b 图外**：Gate1 只跑根 tsc -b、Gate7 只探 web dist、web 无 typecheck 脚本 → web 类型错误可静默过 8 门禁 | ARCHITECTURE-S2（gates.ts:461,562-573） | 发布门禁形同虚设于 web | web 加 typecheck 脚本并入 tsc -b 图（或 Gate1 显式跑 tsc -p web） | web、gates | 低 | P1 |
| G-08 | **~/.vessel 状态根解析复制 7 次** + settings 根耦合 usage 根 + migrate KNOWN_STATE_ENTRIES 硬编码清单缺后出现状态文件会腐烂 | ARCHITECTURE-S3 | 新增状态文件后一次性迁移失效、根解析行为不一致 | 收敛为单一 resolveStateRoots 工具 + migrate 清单动态化/按目录扫描 | application/cli stores | 中 | P1/P2 |
| G-09 | **TUI 会话内成本可见性缺失**（数据已采集只缺展示）——直击 deepseek-flash 成本波动痛点 | CAPABILITY-gap1 | 用户无法在会话中感知成本；B 判为性价比最高差距 | TUI 会话内成本栏（每次 turn 后展示 token/成本）+ `/cost` | tui、usage | 极低 | P2 |
| G-10 | **会话续跑 + 会话级快照回滚缺失**（diff 报告 + 单命令 revert 的克制形态，不做自动 commit） | CAPABILITY-gap2、矩阵行 11（8 竞品全有） | 长会话中断后丢失进展，无法回到事故前状态 | resume/checkpoint + snapshot + revert（复用现有持久化） | engine/session | 中高 | P2 |
| G-11 | **CLI 面 MCP 配置命令 + 通用 JSON 输出缺失**（库级管道已通，只差出口） | CAPABILITY-gap3、矩阵行 13/14 | headless/CI 集成能力不足 | `vessel mcp` 子命令 + `--json` 输出开关 | cli | 中 | P2 |
| G-12 | **cli→local-server 引用边未声明**（apps/cli/tsconfig.json 缺 local-server reference）→ 干净 clone 构建顺序脆弱 | ARCHITECTURE-问题1 | 干净 clone 可能 TS2307 | 补 `{path:"../../apps/local-server"}` 声明该边（对齐 098） | cli tsconfig | 极低 | P2 |
| G-13 | **TUI/CLI 命令面不一致**、`/permission` 不持久、**theme 设置无任何 UI 消费** | ARCHITECTURE + UX-P1 | 设置项存在但无效，双表面行为分叉 | 先做"无消费者的设置项"收敛（theme 接入或移除）；/permission 持久化 | tui、settings | 中 | P2/P3 |
| G-14 | **向导 setup.ts 教过时命令** `cah *`（3 处）；TUI 欢迎语不提 /explain / ? <term> / setup / guide | UX-P1 | 新用户学到已废弃命令；引导入口未被发现 | 文案更新（cah→实际命令）；TUI 欢迎语补引导提示 | cli setup、tui | 极低 | P1(文案) |
| G-15 | **原子写 wrapper 各 Store 重复实现**（技术债） | ARCHITECTURE-T 清单 | 维护成本，无用户影响 | 统一抽 shared atomicWrite（113 已有 helper，收敛各 Store） | stores | 低 | P4 |

---

- ✅ **Round 2 已闭环（提交 22c1463 / c5d491b）**：**G-03**（CLI 顶层无 catch → 崩溃面收敛为「人话 + 路径 + 恢复指引 + exit 1」）、**G-12**（`apps/cli/tsconfig.json` 补 local-server 构建边）、**G-16**（`MESSAGE_SOURCES` 运行时事实源 + 漂移守卫测试）。独立裁定：`EVALUATION-REPORT-03.md` **ACCEPT（7/7）**、`EVALUATION-REPORT-03-RECHECK.md` **ACCEPT（A–D）**；证据：`tsc 0`、`vitest 116 文件 / 1248 passed + 1 skipped`、崩溃面 E2E 双例 exit 1 且无裸栈。
- 🆕 **N1（P2 → Round 3 NOW 首选）**：「坏配置 → exit 1」用户可见契约**无自动化测试**（删 `.catch` 不变红）。
- 🆕 **N2（P3）**：JSON 特征探测过宽（裸 `/JSON/i`）→ 目录名含 json 的 ENOENT 误判。
- 🆕 **N5（P3，跨轮）**：`ChatMessage.source` 仍裸 `string` → 收窄为 `MessageSource | 'environment'`。
- 🆕 **LOW**：路径清洗截断以 `]`/`）` 结尾的真实路径（仅展示文案）。

## 状态更新（第 1 轮闭环 + 新增候选）

- ✅ **已闭环（提交 080423d → 76a19e1）**：**G-01**（mock 遮蔽真实输入）、**G-02**（未知命令静默 run）、**G-14**（引导文案 + setup 向导 `cah`→`vessel`）。独立 Evaluator 两轮裁定：Round 1 **REJECT**（S1 未知命令零测试 / S2 `cah` 属实 / S3 注入源漏 plan·handoff·inject / S4 TUI 未同步）→ FIX 轮 → Round 2 **ACCEPT**（逐项行号证据）。验收侧证据：`tsc 0`、`vitest 114 文件 1235 passed + 1 skipped`、CLI E2E 冒烟 6 项全过。
- 🆕 **G-16（P2/P3，低成本）**：`ChatMessage.source` 仍为裸 `string`、`INJECTED_MESSAGE_SOURCES` 手写 → 未来新增注入源会**静默退化**（`plan/handoff/inject` 正是本轮由 Evaluator 抓出的实例）。建议收窄类型或加"漂移守卫"测试（断言 events 联合中注入类 source 全在集合内）。
- 🆕 **G-17（P3）**：**文档-命令一致性无门禁**——`vessel chat` 漂移由本轮暴露（3 份文档 + `PROJECT-BRIEF.md` 曾把它当 TUI 入口，实际 exit 2）。本轮已手工修正 8 处；建议发布门禁加一条 grep 检查或文档命令回归测试，防复发。
- 观察（未定性为回归）：全量 vitest 偶发 exit 1，仅伴随 "unhandled errors" 警告且测试全过，复跑 exit 0。

## 冲突与依赖检测

- **无冲突审计结论**：4 份报告对"引导体系（117）本身质量高"一致正面；对"settings/locale 接线不全"从 UX 与架构两视角互证（G-06/G-13）。
- **强依赖链**：G-01(G-02) → 阻塞"首次成功使用"（P0 同组）；G-03 兜底依赖 G-02 的分支落点；G-06 短期修复依赖 G-13 的 settings 语义先定。
- **高性价比聚集**：G-01/G-02/G-14（P0+P1 文案）都落在 CLI 入口层，一次改动可修一组。

---

## 路线图（第四阶段）

**NOW（本轮 vertical slice）**：G-01 + G-02（高度耦合的 CLI 入口健壮性问题：首次成功使用 + 未知命令分派）——一组小问题，非功能堆砌。
**NEXT**：G-14（文案/引导，极低）+ G-03（CLI 兜底）+ G-07（web 入图）+ G-12（引用边）+ G-09（TUI 成本可见性）——全为低成本高价值。
**LATER**：G-04（usage 备份）+ G-05（密钥暴露面）+ G-10（续跑/回滚）+ G-11（MCP/JSON 出口）+ G-13（TUI/CLI 一致）。
**NOT_NOW（主动拒绝）**：G-06 全量 i18n 改造（成本≈全量改造、当前用户仅中英、收益不足——记录为"里程碑级候选"）；G-08 重构（可小步缓行，非阻塞）；竞品形态追逐（插件市场、消息平台、云协作/多人、大众基准榜单、IDE/桌面表面——B 已逐条论证不做）；G-15（P4 技术债，顺手时清理）。