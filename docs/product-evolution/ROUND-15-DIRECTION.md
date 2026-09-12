# ROUND-15-DIRECTION — 由独立现状重审得出的下一轮方向（Orchestrator 记录）

> 来源：**独立现状差距审计**（全新上下文、只读、不被告知既往结论）＋ **Orchestrator 的判别性实测**。
> 目的：让"下一轮做什么"由**对现状的独立取证**决定，而不是由编排者回忆历史。

## 一、P0：策略执法在用户真实工作区**部分失效且不可观测**

**独立审计的原始论断**：`repoRoot()` 只在仓库内找到 `configs/policy.default.yaml`；`PolicyLoader` 对缺失的 `systemPath` 静默跳过；`apps/**` 无任何地方给 `policyProjectPath` 赋值。

**Orchestrator 实测（判别性，两次）**：

| 场景 | 实测结果 |
|---|---|
| 在**仓库外**临时工作区跑 `run --prompt` | `exit=1` + 打印 `policy loader: no policy declaration found` → **并非静默**（审计此半条**不成立**） |
| 同场景，但放入文档宣称的项目级策略 `<ws>/.harness/policy.yaml`（2.7KB，取自仓库默认） | **仍** `exit=1` + `no policy declaration found` → **项目级策略确实未被读取** |
| `apps/**` 对 `policyProjectPath` 的赋值点 | **0 处**（`compose.ts:47` 声明、`:175` 透传为 `projectPath`，无人赋值） |

**结论（裁量为 P0）**：`docs/POLICY-SPEC.md:457-458` 宣称的 **project 级作用域不存在**，用户照文档写 `.harness/policy.yaml` 会被**静默忽略**；同时**没有任何命令能查看"当前生效的策略来自哪里"**。产品差异化是"Behavior IR + Policy 编译执法"，而执法边界在用户的工作区里**既可能缺失又不可见**。

## 二、Round 15 切片的取舍

**NOW（Round 15）—— 策略可装载 + 可见 + 不静默降级**（一个主题、三件强耦合的事）：
1. **打通 project 级策略**：CLI/TUI 把 `<workspace>/.harness/policy.yaml`（存在时）接到 `policyProjectPath`；不存在则视为正常缺省（可选层）。
2. **生效策略可见**：新增只读命令（如 `vessel policy status`）打印**每一层的来源路径、是否存在、声明条数、内容哈希**，以及**合成后的生效层序**；`--json` 亦可用（沿用 Round 10/14 的信封与出口纪律）。
3. **不静默降级**：当**系统策略缺失**而其它声明存在（即"部分装载"）时给出**明确警告**（不是静默通过）；警告与 `policy status` 使用同一套事实。

**不做（明确拒绝，均来自重审）**：更多 provider（已 56–71 个，PROJECT-BRIEF:40 已定不扩）；Web 功能对齐（`apps/web/src/i18n.ts:79,114` 仍是占位，而 CLI 主路径未修）；新增第 7 个 adapter 或更多设计文档（Conformance 076-084 已完成，缺口在**暴露**而非**能力**：CLI 无命令可跑外部 adapter）；插件市场/云/远程控制（PROJECT-BRIEF:38-39 已排除）；拆微服务。

## 三、Round 16 候选（"宣称与实际不符"同族，低成本）

重审同时报出四处**同类**缺口，都属我们反复收口的那一族（**文案/文档宣称与实现不一致**）：
- **1B**：`guide.ts:20,22,31,33` 自称「小小蜜 / Xiaoxiaomi」，与产品名 **Vessel** 不一致（`README.md:1,7`）。
- **1C**：无配置时默认 **mock** 会给出"像真模型一样"的回答，**运行期无任何提示**（`cli.ts:299,334,339`；README 仅在文档里提 mock）→ 新人误判已接上模型。
- **2B**：`PROJECT-BRIEF.md:43`「密钥不落盘 / DPAPI」与 `CredentialStore.ts:17-18,208,262-266,624`（非 Windows 降级明文落 `secrets.json`）矛盾；`setup.ts:74` 向导又反向写成"明文存 ~/.vessel"（Windows 上实为 DPAPI）。
- **2C**：`PROJECT-BRIEF.md:51`、`README.md:61` 仍把 `vessel chat` 当入口，实际是「未知命令」exit 2。

## 四、暂缓（记录但不做）

- **3. 发布/交付缺口**：依赖未发布的 workspace 包（`@vessel/cli` 依赖 `@vessel/application`/`@vessel/local-server ^0.10.0`）、root `private: true`、无 `files`/`engines`/publish 流程 → 唯一可用路径是 clone→build→`npm link`。**这是"对外成熟"的真实缺口（P2）**，但改动面涉及包发布策略与版本治理，需单独一轮并先定策略（打不打包？只发 CLI 还是全发？），不在本轮混做。
- **4A. help / README 命令表 / dispatch 三份手工副本已漂移**（help 有 `sessions`/`resume`/`review`/`bench-report`/`pricing sync|override`，README 表全无）→ 建议后续由**命令注册表生成 help**（P2，现在小、再拖变贵）。
- **4B. 状态根 3 套实现 / 3 个 env 名**（`defaultStore.ts:18-19`、`UsageStore.ts:367`、`settings.ts:24-26`，8 个文件引用）→ P3；**注意**：它是 AGENTS.md 规则 8 隔离契约的基础，动之前要先有测试网。
- **反例（明确不要动）**：`atomicWrite.ts` 单点定义 + 17 导入点；`glossary.ts:169` 术语词库单点由 CLI 与 TUI 共用——这两处是**已收敛**的正面样本。
