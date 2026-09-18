# 123 — 修复 CI 从未通过：`tsc -b` 在干净检出上失败

- 编号：123
- 状态：已合入（首次绿 `35332162326`；后续 12 个提交持续保持绿）
- 优先级：P0（阻断唯一 CI 门禁）
- 创建日期：2026-09-18
- 对象仓库：`satan9394/composable-agent-harness`
- 失败提交：`e6caaf0`（main 上最后一个代码提交，2026-09-13）
- 影响：CI workflow 从建立至今**三次运行全部失败，从未有过绿色构建**
- 执行器：指挥侧直接执行 + 多 Agent 分片（本机 Windows 无法复现 Linux 面，靠 GitHub API 取证）

> 说明：本卡下半部分是**原始报告**（根因与修复方案，撰写时状态为"根因已定位、临时克隆验证通过"）；
> 上半部分由执行阶段回填。原始报告保留不改，与 `tasks/122` 同做法。

## 0. 执行结果（回填）

**根因**：`tsconfig.base.json` 缺 `exclude`，`tsc -b` 把 `*.test.ts` 纳入 composite 构建；测试跨包 import 的依赖未进 `references`，`-b` 按引用图排产时 `packages/core` 排在 `packages/llm` 之前 → `TS2307`，其余是类型退化成 `any` 的级联。补 `references` 会撞真循环（`TS6202`），故走 `exclude`。

**落地**（main）：

| 提交 | 内容 |
|---|---|
| `8664b39` | `tsconfig.base.json` 加 `exclude`（一行；干净检出 159 → 0 error） |
| `d99bfdb` | 新增 `tsconfig.test.json` + `typecheck:tests` + CI 步骤（补回测试类型检查，171 文件 0 error）；清 runtime/policy/tools 三个陈旧 `../core` 引用；actions v4→v5 |
| `aa5ea99` | 首次绿后暴露的 4 个平台/时序缺陷：`chat.test` 只设 `USERPROFILE`（Linux 读 `HOME`）；`Session.loadExisting` 浮动写（DEP0137，附回归测试 + 阴性对照）；`project-task-queue` 同毫秒破平改用单调时钟；Windows job holder 退出即删目录导致轮询漏读 → 改由 `createJobObject` 的 `finally` 独占 |
| `9be48ef` | `SessionRegistry` 排序用例注入单调时钟（同毫秒破平） |
| `a4257e8` | CodeQL：workflow `permissions: contents: read`；6 处 `polynomial-redos` 改等价扫描/索引解析 |
| `04c6a9f` | `Compiler.ts` path matcher 改为手写解析（去掉重叠量词），附判别测试 |
| `9f8119b` | 修正 `dependabot.yml`（原两条 `package-ecosystem`/`directory` 为空，无效）→ npm 根 + github-actions |
| `30a8510` / `afa5ff0` | 合并 vite 8 / vitest 5（Dependabot PR #7 / #9） |
| `3ccb082` (#12) | vite 8 与 `@vitejs/plugin-react@4` peer 冲突（CI 不构建 `apps/web` 才漏过）→ 升 `^5.2.0` 并补 web 的 tsc + `vite build` 门禁 |
| `037a2bd` / `6ff83d2` / `d51de03` | actions checkout/setup-node v5→v7；1500 任务性能测试加显式 120s 超时（慢 runner flake） |

**告警收敛**：CodeQL 10 → **0**（8 fixed + 2 按设计行为驳回）；Dependabot 12 → **0**；Secret scanning **0**。

**验证（均在最后一次编辑之后）**：`npm run build` exit 0；`npm run typecheck:tests` exit 0；`npm run test:all` 根 171 files / 2197 passed | 6 skipped + web 11 / 120；`npm run -w @vessel/web build` exit 0；两个 CLI 冒烟 exit 0。CI 与 CodeQL 在 main 上均 `success`。

**未闭合（留给独立卡）**：Dependabot PR #8（TypeScript 5→7）、#10（js-yaml 4→5）、#11（React 18→19）属非安全的大版本迁移，CI 红或未验证到位，未盲并；仓库设置里 `secret_scanning_non_provider_patterns` / `validity_checks` 需人工在 Settings 页开启（API 改不动）。

---

# 附：原始报告（撰写时状态）

## 一、结论（TL;DR）

`tsconfig.base.json` 缺少 `exclude`，导致 `tsc -b` 把 `*.test.ts` 也纳入 composite 构建。
而测试文件**跨包互相 import**（`packages/core` 的测试 import `@vessel/llm` / `@vessel/tools` / `@vessel/runtime`），
这些依赖既没写进 `package.json`，也没写进 tsconfig `references`。

`tsc -b` 按 references 的依赖图拓扑排产，`packages/core` 排在 `packages/llm` **之前**构建，
轮到 core 时 `packages/llm/dist/index.d.ts` 还不存在 → `TS2307 Cannot find module '@vessel/llm'`。

**修复是一行**：在 `tsconfig.base.json` 加 `exclude`，让 composite 构建只编译生产源码，测试交给 vitest。

```diff
--- a/tsconfig.base.json
+++ b/tsconfig.base.json
@@ -17,5 +17,7 @@
     "noImplicitOverride": true,
     "noFallthroughCasesInSwitch": true,
     "types": ["node"]
-  }
+  },
+  "exclude": ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"]
 }
```

---

## 二、复现（已实测）

```bash
git clone https://github.com/satan9394/vessel-harness.git /tmp/cah
cd /tmp/cah
git checkout e6caaf0
npm ci                 # 成功，130 packages，exit 0
npm run build          # → tsc -b tsconfig.json
```

`npm run build` 输出（节选，与 CI 日志一致）：

```
packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts(5,30): error TS2307: Cannot find module '@vessel/llm' or its corresponding type declarations.
packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts(8,45): error TS2307: Cannot find module '@vessel/tools' or its corresponding type declarations.
packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts(9,35): error TS2307: Cannot find module '@vessel/runtime' or its corresponding type declarations.
packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts(59,42): error TS7006: Parameter 't' implicitly has an 'any' type.
packages/behavior/src/compiler/Compiler.test.ts(8,35): error TS2307: Cannot find module '@vessel/policy' ...
packages/tools/src/git/Worktree.ts(4,28): error TS2307: Cannot find module '@vessel/runtime' ...
```

CI 日志（run `34792538908`）**两个 OS 腿合计**：`TS2307` ×202、`TS7006` ×102、`TS2741` ×8、`TS4112` ×4、`TS2322` ×2，共 318。
本地单腿复现为 **159**（`TS2307` ×101、`TS7006` ×51、`TS2741` ×4、`TS4112` ×2、`TS2322` ×1），恰好是 318 的一半——两个矩阵腿各 159。
其中 `TS7006` 是级联产物——模块解析失败后类型退化为 `any`，回调参数随之报隐式 any。

---

## 三、根因推导（三步证据）

### 证据 1：`dist` 全都生成了，所以不是"没编译出来"

失败构建结束后，14 个 `packages/*/dist/index.d.ts` **全部存在**，`npx tsc -b packages/llm` 单独跑也 exit 0。
说明问题出在**构建顺序**，不是产物缺失。

### 证据 2：模块解析追踪显示两类解析结果

`npx tsc -p packages/core/tsconfig.json --traceResolution`：

```
======== Resolving module '@vessel/llm' from '.../packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts' ========
Found 'package.json' at '.../node_modules/@vessel/llm/package.json'.
Matched 'exports' condition 'types'.
File '.../node_modules/@vessel/llm/dist/index.d.ts' exists - use it as a name resolution result.
→ resolved to '.../packages/llm/dist/index.d.ts'        ← 走 dist 产物
```

```
======== Resolving module '@vessel/core' from '.../packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts' ========
→ resolved to '.../packages/core/src/index.ts'          ← 走源码（project reference 重定向）
```

差别原因：**只有被 `references` 声明的项目才会被重定向到源码**。
`packages/core` 只 reference 了 `../shared`，所以 `@vessel/llm` 只能去要 `dist/index.d.ts`——
而在 `-b` 模式下，如果 llm 还没轮到构建，这个文件就还不存在。

### 证据 3：构建顺序确实把 core 排在 llm 之前

`npx tsc -b tsconfig.json --dry` 的排产顺序：

```
1. packages/shared
2. packages/core      ← core 在这里构建
3. packages/llm       ← 但 llm 在这里才构建
4. packages/behavior
5. packages/context
6. packages/runtime
7. packages/policy
8. packages/tools
...
```

core 需要 llm / runtime / tools，但三者都排在它后面 → 必然 TS2307。

### 为什么不能"直接补 references"

补 references 会撞上 **真实循环依赖**。实测加入引用后 `tsc -b` 报：

```
error TS6202: Project references may not form a circular graph. Cycle detected:
  .../tsconfig.json → packages/core → packages/llm
error TS6202: ... → packages/core → packages/tools → packages/runtime
error TS6202: ... → packages/core → packages/tools → packages/policy
```

根因是这些 tsconfig 里对 `../core` 的引用（`llm` / `runtime` / `policy` 都有），而 core 的测试又要反向 import 它们。
即 **core ↔ llm 在包级别是真正的双向依赖**，只是目前暴露在测试层。

---

## 四、已验证的修复与验证结果

在临时克隆 `e6caaf0` 上，只改 `tsconfig.base.json` 一行（加 `exclude`），然后**清空所有 `dist/` 重新全量构建**：

| CI 步骤 | 命令 | 结果 |
|---|---|---|
| 安装 | `npm ci` | exit 0 |
| 构建 | `npm run build` | **0 errors**（同一腿改前 **159** errors） |
| 测试 | `npm run test:all` | **171 files / 2195 passed**（6 skipped）+ web **11 files / 120 passed** |
| 冒烟 1 | `node apps/cli/dist/cli.js --version` | 正常输出 banner |
| 冒烟 2 | `node apps/cli/dist/cli.js run --prompt "..."` | exit 0，输出最终回答 + 遥测 |

**为什么 `exclude` 能生效**：各子 tsconfig 只声明了 `include`，没声明自己的 `exclude`，
所以 base 里的 `exclude` 被继承（子配置的 `include` 覆盖 base 的 `include`，但不影响 `exclude` 继承）。

**额外收益**：`dist/` 里编译后的测试文件数量 **0**（改前会把 `*.test.js` 打进 `dist`）。
这正好消掉上一个提交 `e6caaf0`（"keep compiled tests out of the tarball"）在打的补丁——
当时是在打包环节把测试产物排除掉，现在从源头就不产出。

---

## 五、修复的代价（需要你决定是否接受）

`exclude` 之后，**测试文件不再被 `tsc` 类型检查**。vitest 默认用 esbuild 转译、不做类型检查，
所以 `*.test.ts` 里的类型错误会静默通过。

现有脚本 `npm run typecheck` = `tsc -b tsconfig.json`，与 `build` 等价，同样不含测试。
**建议后续补一个专门检查测试类型的入口**，二选一：

- 新增一个非 composite 的 `tsconfig.test.json`（`noEmit: true`，`references` 指全仓、`include` 只收测试），跑 `tsc -p tsconfig.test.json`；
- 或启用 `vitest --typecheck`（需要额外装 `@vitest/typecheck` 之类的依赖，注意本仓库依赖很克制）。

本次未验证这两条路径，仅作为待办列出。

---

## 六、顺带发现（低风险，可选清理，与本 bug 无因果关系）

这些是目前"能跑但不能细看"的不一致，**不改也不影响 CI**，但会持续制造认知负担：

1. **陈旧的 `../core` 引用**：`packages/runtime/tsconfig.json`、`packages/policy/tsconfig.json`、`packages/tools/tsconfig.json`
   都引用了 `../core`，但三者源码里 **0 处** import `@vessel/core`（已全量 grep 确认）。这些引用是 TS6202 循环的直接来源。
2. **未声明的跨包依赖**（测试层）：
   - `packages/core` 的测试 import `@vessel/llm` / `@vessel/tools` / `@vessel/runtime`，但 `package.json` 只声明了 `@vessel/shared`；
   - `packages/behavior` 的 `Compiler.test.ts` import `@vessel/policy`，未声明。
   `exclude` 之后这些不再阻塞构建，但依赖声明仍然名不副实。
3. **真正的核心↔llm 双向依赖**：`packages/llm` 的测试 import `@vessel/core`，`core` 的测试又 import `packages/llm`。
   当前靠 `exclude` 绕开；若要治本，需要把跨包的集成测试移到更高层包（如独立的 `tests/` workspace）。
4. **`packages/tools` 未声明但实际使用 `@vessel/policy`**（`src/mcp/mcp.test.ts` 有 import）。
5. **CI 提示 Node 20 弃用**：日志里 `actions/checkout@v4` / `actions/setup-node@v4` 被强制跑在 Node 24 上（GitHub 的弃用通知）。与本 bug 无关，跟一次 action 版本即可。

---

## 七、验收标准

1. `npm run build` 在**干净检出**上 0 error（必须先删掉所有 `dist/`，否则增量缓存会掩盖问题）；
2. `npm run test:all` 全绿；
3. 两个 CLI 冒烟 exit 0；
4. GitHub Actions 的 `CI` workflow 在 main 上 **首次变绿**（当前 3/3 全红）。

## 八、操作前须知

- 本目录的本地克隆目前停在 `e6caaf0`，**落后 origin/main 一个提交**（`a4f1116`，只加了 `.github/dependabot.yml` 与 `.github/CODEOWNERS`，不含代码改动）。动手前先 `git pull`。
- 复现必须**先清理 `dist/`**：`tsc -b` 是增量的，残留的 `dist/` 与 `.tsbuildinfo` 会让问题消失。
  清理命令（PowerShell）：
  ```powershell
  Get-ChildItem packages,apps,benchmarks -Directory | ForEach-Object {
    if (Test-Path "$($_.FullName)\dist") { Remove-Item "$($_.FullName)\dist" -Recurse -Force }
  }
  ```
- 提交建议：`fix(build): exclude test files from the composite build so tsc -b resolves workspace deps in order`
- 证据留存：本次验证用的临时克隆在 `%TEMP%\opencode\cah-repro`（可删），
  审查快照与完整前后对照见 `C:\work\Claude_code\2026\09\17\github-security-audit\findings\composable-agent-harness.md`。
