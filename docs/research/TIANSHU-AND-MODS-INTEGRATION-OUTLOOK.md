# 天枢（Tianshu Harness）与 Claude Mods / DSH 架构前沿调研与后续规划索引 (TIANSHU-AND-MODS-INTEGRATION-OUTLOOK.md)

> **文档定位**：记录 2026-10-04 阶段对前沿智能体框架的深度调研成果，包含天枢全景报告、Claude Code Mods 体系、DeepSeek Harness 兼容层事件的核心结论、权威 GitHub 链接与本地资料索引。
> **状态**：**后续参考与储备规划（当前不启动开发，仅作为演进决策基准）**。

---

## 1. 核心参考项目与权威溯源链接

| 项目 / 事件 | 权威 GitHub 链接 | 官方文档 / 博客 / 调研归档 | 核心架构特色与借鉴点 |
|---|---|---|---|
| **天枢（Tianshu Harness）** | [huiliyi37/Tianshu-harness](https://github.com/huiliyi37/Tianshu-harness) | 本地深度研报：`E:\Code_file\Claude_code\2026\09\24\tianshu_agent_framework_analysis/` | CVM 认知虚拟机、98-99% 前缀缓存工程、认知锚点坍缩防御、四层纵深拦截、Tree-sitter/AST-grep 程序分析感知。 |
| **Claude Code Mods** | [anthropics/claude-code](https://github.com/anthropics/claude-code) | [Claude Code Mods Overview](https://code.claude.com/docs/en/plugins/mods/overview) · [Blog](https://claude.com/blog/claude-code-mods) · [Issue #91870](https://github.com/anthropics/claude-code/issues/91870) | 洋葱式内部事件中间件（观察 Observe、改写 Rewrite、接管 Intercept）；内置功能 Mod 化；AI 编写与热重载。 |
| **DeepSeek Harness (DSH)** | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | [v0.2.1-alpha.1 Release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1) · [Docs](https://deepseek-harness.github.io/deepseek-harness/) | “一切皆插件”哲学；率先推出 Claude Code Mods 实验性兼容层；多模型中立底座（DeepSeek/Kimi/GLM/OpenAI）。 |

---

## 2. 天枢（Tianshu）调研报告关键结论速查

本地 8 篇专题研报位于：`E:\Code_file\Claude_code\2026\09\24\tianshu_agent_framework_analysis/`
- `01_TIANSHU_HARNESS_DEEP_DIVE.md`：天枢 CVM 架构体系与前缀缓存工程；
- `02_COMPETITIVE_FRAMEWORK_STRENGTHS.md`：主流框架（CC/Codex/OpenCode/DSH/PAgent）独门绝技剖析；
- `03_THE_MELTING_POT_INVESTIGATION.md`：“大熔炉”命题深度考证（冶炼升华型熔炉）；
- `04_TECHNICAL_ARCHITECTURE_COMPARISON_MATRIX.md`：6 大维度 40+ 指标全景比对矩阵；
- `05_COGNITIVE_RUNTIME_PARADIGM_AND_OUTLOOK.md`：从 Prompt 胶水到认知操作系统的范式演进；
- `06_UPDATE_20261004.md`：2026-10-04 增量追踪（v3.27.0 最新特性复核）；
- `07_TRANSFERABLE_STRENGTHS_20261004.md`：16 条可搬走的技术长板；
- `08_VESSEL_GAP_ANALYSIS_20261004.md`：**针对 Vessel 架构的穿透式缺口核对与优先级**。

### Vessel 对照天枢的优势与待补清单：
1. **Vessel 已领先天枢的领域**：
   - **编译式 Behavior IR**（而非静态 Prompt）：分层 Resolver 与 Conformance 对齐；
   - **事件溯源单一真源**：append-only JSONL 与投影派生，保证模型可见性严格依赖记录；
   - **Policy Compiler 双通道**：软引导（Prompt Guidance）与硬执行（Runtime Policy）完全解耦；
   - **8 道 Release Gates 与跨 Harness 一致性套件**。
2. **天枢最具价值、可供 Vessel 吸收的短板缺口**：
   - **前缀缓存经济学**：请求序列化必须保持键排序一致（`stableStringify`），防止隐式击穿 KV Cache；
   - **上下文压缩边界守卫**：压缩仅在用户输入边界（`turn === 0`）触发，禁止在微回合内重写历史；
   - **前缀三段式布局**：明确 `stableLayer`（跨会话/轮次持久复用）、`volatile`（动态工具信息）与 `appendix`（增量附录），并暴露真实的计费命中率指标；
   - **Red→Green 门禁**：修复任务在 Evaluator 中强制要求先复现红灯用例再验证通过；
   - **无进展收敛检测**：基于状态指纹（文件哈希与 mtime）识别原地打转并打断。

---

## 3. Claude Code Mods 与 DSH 兼容层事件深度剖析

### 3.1 核心事实与架构演进
- 2026-10-01，Anthropic 为 Claude Code 上线 Mods：挂载在内部事件流上的 TypeScript 函数，能够观察、改写或直接接管工具调用与权限，官方并将 `/diff` 与 `AGENTS.md` 等内置功能抽离为 Mods；
- 2026-10-03，DeepSeek Harness 发布 v0.2.1-alpha.1，推出“实验性 Claude Code Mods 兼容层”，旨在进行架构验证并争夺插件作者生态，实现跨模型复用。

### 3.2 致命隐患（Vessel 必须吸取的教训）
1. **安全裸奔风险**：
   - Claude Code 的 Mods 运行在宿主进程内部，**完全不在沙箱中**，拥有和用户相同的最高权限；
   - DSH 历史上曾曝出 **CVE-2026-82533** 漏洞：智能体读入注入文本后调用本地接口关闭沙箱与审批，危害极大；
   - **Vessel 的防火墙策略**：后续若引入 Mod 机制，**必须运行在受控隔离中**，所有子进程强制接入既有的 `NativeSandboxRunner`（Low Integrity / bwrap），Policy Engine 保持绝对的硬拦截管辖权，绝不允许 Mod 动态篡改沙箱设置或读取 `CredentialStore` 密文。
2. **前缀缓存被破坏**：
   - 随意在回合前注入易变内容的 Mod 会彻底摧毁 KV Cache 命中率；
   - **Vessel 规约**：Mod 贡献的提示词必须明确声明为静态稳定段或受控附录段，杜绝随机会话抖动。

---

## 4. 后续演进想法与规划备忘 (Ideas & Future Roadmap)

> **注**：当前阶段不创建执行任务卡，保留为待选技术方案储备池。

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        后续技术演进储备路线图 (Roadmap Ideas)            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  【方向 A：前缀缓存经济学与稳定性加固】 (低成本、高收益、高确定性)           │
│  1. 请求键序列确定性序列化 (stableStringify / canonicalJson)            │
│  2. 上下文压缩 turn===0 边界硬守卫 (防微回合内重写历史击穿缓存)          │
│  3. 前缀布局显式划分为三段：stableLayer + volatile + appendix           │
│  4. UsageProjection 增加 billedHitRate 真实计费命中率指标与监控面板      │
│                                                                        │
│  【方向 B：安全受控的 Vessel Mod / Middleware 体系】 (生态扩展与兼容)     │
│  1. 依托现有 Policy Hooks 抽象洋葱式中间件 (Observe/Rewrite/Intercept)    │
│  2. 实验性 Claude Code Mods 兼容适配器 (以沙箱化方式接入外部开源 Mod)     │
│  3. 插件级权限清单审计与 Policy 硬隔离 (严防 CVE-2026 同型提权绕过)      │
│                                                                        │
│  【方向 C：状态收敛与程序分析感知】 (长周期任务稳定性)                   │
│  1. 基于工作区文件指纹/哈希的死循环无进展检测 (No-Progress Breaker)      │
│  2. Evaluator 的 Red→Green 复现测试前置门禁                             │
│  3. 基于 Tree-sitter / AST-grep 的结构化代码感知与依赖图谱 (Meridian)  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```
