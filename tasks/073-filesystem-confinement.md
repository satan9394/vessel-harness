# 073 — Filesystem Confinement（文件系统访问约束）

- 状态：已合入
- 优先级：P0（Wave 4 / Milestone F）
- 创建日期：2026-09-08
- 关联：071/072（进程隔离 + 树约束，本卡补文件面）；既有 tools/filesystem/guards.ts（路径守卫基础）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（V1.4 Security：filesystem confinement）

## 目标

Filesystem Confinement：沙箱/受限执行内文件系统访问被约束到允许集合（工作区 + 显式授权路径），
越界读写拒绝（机制层硬执法，非只 prompt）；与 071/072 的进程隔离配套，形成"进程 + 文件"双层约束。
复用既有 guards（packages/tools/src/filesystem/guards.ts）与沙箱隔离目录语义。

## 验收标准（执行器逐条勾选）

- [x] 摸清现状：tools/filesystem/guards.ts（路径守卫/允许集合现状）+ 071 隔离目录 + 工具注册方式——
      明确本卡补什么（confinement 策略接入工具执行链）
- [x] Confinement 策略：允许集合（工作区根 + 显式授权路径）+ 拒绝规则（越界读写/逃逸路径/符号链接出界）；
      与 055 capabilities（preset tools shrink-only）、051 tool 执行 seam 衔接（硬执法点：工具执行前校验）
- [x] 越界响应：拒绝 + 记录（审计事件可查——072 audit 风格）+ 可选 fail-closed 语义；不破坏正常工作区操作
- [x] 测试 ≥6 例：允许/拒绝/逃逸路径/符号链接/审计/与既有 guards 共存；全量 vitest/tsc 绿（693+ 无回归）
- [x] 文档同步（filesystem confinement 语义与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做文件访问约束。telemetry（074）、safety benchmark（075）各自成卡。
- 不重写既有 guards；在其上补 confinement 策略接入执行链。

## 涉及文件（指针，执行器自行精化）

- packages/tools/src/filesystem/guards.ts（既有路径守卫——扩展或接入）
- packages/runtime（sandbox/executor：工具执行 seam——confinement 校验点）
- 055 capabilities（preset 工具面收窄衔接）；072 audit 模式（越界记录风格）
- 测试（guards/confinement 新增）

## 方法

- 读 guards.ts 现状与工具执行链；定 confinement 策略（允许集合 + 拒绝规则）+ 执行前校验点
- 越界 → 拒绝 + 审计记录；符号链接/相对路径逃逸防护测试

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 摸清现状（验收 1）

- `packages/tools/src/filesystem/guards.ts`：已有 `canonicalize`（词法 `..`/绝对路径逃逸 + symlink realpath 出界拒绝）、
  `assertReadable`/`assertWritable`（denyRead/protected glob）。**发现 `allow` 字段已声明但从未被 enforce（死字段）**；
  无 Mode 区分、无 out-of-allow 拒绝、`PolicyArtifacts.fsConfig` 不携带 `allow`。这是本卡补的唯一实质空白。
- 工具执行链：`createFsTools`（Read/Write/Edit）+ `createSearchTools`（Glob/Grep）在 execute 内先跑 guards 再做 fs 调用；
  `Executor.runTool` 的 `decide` 前置 seam 走 `PolicyEngine`（`onPreExecuteDeny` → AgentLoop 落 `audit/denial`，072 风格可查）。
- 071 隔离目录：`os.tmpdir()` 下 `vessel-sandbox-*`，绝不落主工作区；本卡 confinement 复用该语义。
- 接入点结论：**允许集合权威判断在工具层守卫（canonical + 词法双关，Mode 区分）** + **policy 层词法预检（执行前 deny → audit/denial）**。

### 改动文件 + diff 摘要

- `packages/tools/src/filesystem/guards.ts`
  - `FsPolicyConfig` 增 `confinement?: boolean`（allow-set 开关；未开时 073 前行为，`allow` 仍无效果）。
  - `FsGuardError.guard` 增 `'confinement'` 成员。
  - `canonicalize(root, p, config?)`：可选 3 参，back-compat；`confinement:true` 且路径词法逃逸时，
    若落于显式**绝对** allow 目录 → 放行（"显式授权路径"可达），否则照旧抛 `'escape'`。**symlink 出界永远拒绝**（比 allow 更严）。
  - 新增 `withinAbsoluteAllow(config, resolved)`、`isWithinAllow(root, canonical, entry, mode)`、
    `assertConfined(root, canonical, mode, config)`：允许集合 = 工作区根 ∪ 匹配 Mode 的显式 allow；越界抛 `'confinement'`。
- `packages/tools/src/filesystem/fsTools.ts`：Read/Write/Edit 的 execute 首步改 `canonicalize(root, p, fsPolicy)` + 新增
  `assertConfined(root, canonical, 'read'|'write', fsPolicy)`；guard 错误统一映射 `errorClass:'DENIED'` + `meta.guard`（
  Read 从 `TOOL_FAILURE` 提为 `DENIED`，便于审计/权限语义一致）。
- `packages/tools/src/search/searchTools.ts`：Grep 循环内 `canonicalize(root, f, fsPolicy)` + `assertConfined(...,'read',...)`。
- `packages/shared/src/policy.ts`：`PolicyArtifacts.fsConfig` 增 `allow?` + `confinement?`；`PolicyDeclaration.filesystem` 增 `confinement?: boolean`。
- `packages/policy/src/risk/Compiler.ts`：`confinement:true` 时——① 引导文案注入允许集合；② 铸 `fs-confinement` deny 规则
  （词法预检：`..` 逃逸、未被绝对 allow 覆盖的绝对路径 → 执行前 deny → audit/denial）；③ `fsConfig` 回填 `allow` + `confinement`。
- `packages/application/src/compose.ts`：`fsPolicy` 增 `allow: artifacts.fsConfig?.allow ?? []` + `confinement` 透传。
- 测试新增 `packages/tools/src/filesystem/confinement.test.ts`（13 例）+ `packages/policy/src/policy.test.ts` 增 6 例 confinement。
- 文档 `docs/SANDBOX-WINDOWS.md`（新增「073 — Filesystem Confinement」能力/限制/API 节）、`docs/POLICY-SPEC.md`（§3.5 映射表加 confinement 行）。

### 新增测试数与命令输出

- `packages/tools/src/filesystem/confinement.test.ts`（13 例）：confinement 开关 back-compat / 工作区内恒在允许集合 /
  越界 guard kind='confinement' / `isWithinAllow`（绝对 + workspace-relative glob + Mode 区分）/ 显式绝对 allow 放行外部读写 /
  read-mode allow 不放行写（Mode gate）/ `..` 逃逸 / 目录 junction symlink 出界拒绝 / Grep 服从 confinement 且与 denyRead 共存 / 正常工作区往返不破。
- `packages/policy/src/policy.test.ts` +6 例：`confinement:true` 编译进 `fsConfig.allow/confinement` / 铸 `fs-confinement` 规则 /
  `..` 逃逸执行前 deny / 未覆盖绝对路径 deny + 已覆盖绝对 allow 放行 / 正常工作区相对路径不被词法误伤 / confinement 关闭不铸规则。

命令输出（本机受限环境直跑可行，全量绿）：

```
npx vitest run
  Test Files  78 passed (78)
      Tests  712 passed | 1 skipped (713)

npx tsc -b tsconfig.json   # exit 0，无类型错误
```

基线 693+1 → **712+1**，净增 19 例，无回归。

### 设计选择与理由（含诚实限制）

1. **允许集合权威判断放工具层守卫**（`assertConfined` canonical 双关 + Mode 区分），policy 层只做词法预检——
   因为工具层有 `workspaceRoot` 与 realpath，能给出权威事实；policy `match` 是纯函数无 FS 上下文，词法层只拦
   明确的逃逸/绝对越界，绝不对 workspace-relative 误伤（不破坏正常工作区操作）。
2. **双通道强制的执行前 seam**：`fs-confinement` 规则让 Executor `decide` 前置拒绝 → AgentLoop `recordDenial`
   落 `audit/denial`（072 风格可查），同时工具守卫兜底——即使绕过 pre-check，execute 内 `assertConfined`/`canonicalize`
   仍拒绝。拒绝统一 `DENIED` + `meta.guard`，进 `tool/result` 记录（审计可见）。
3. **fail-closed**：越界一律 deny，不静默放行；无 `approval` 交互面，approval:never 语义沿用。
4. **symlink 出界永远拒绝（含 allow 目录内指向外部的链接）**：比词法 allow 更严，allow 命名真实路径而非重定向链接（"符号链接出界"拒绝规则）。
5. **back-compat**：`confinement:false`/未设置时行为与 073 前完全一致（`allow` 仍无效果、工作区根为唯一边界）——
   现有 693 测试零改动全绿证明无回归。

踩坑记录：

- **`allow` 原为死字段**：初版以为是"已有 allow 只是未接通"，接入后发现还需把 `allow` 从 policy 一路透传到
  compose 的 `fsPolicy` 与 `canonicalize` 的逃逸 hatch——否则"显式外部授权路径"无法真正可达。
- **词法 vs canonical 边界**：最初设想 `assertConfined` 直接拦所有越界，实测 `canonicalize` 先抛 `'escape'`，
  `assertConfined` 根本到不了。析清后把"显式绝对 allow"的放行下沉到 `canonicalize` 的 hatch、把 Mode 授权留在
  `assertConfined`，职责分离才正确。
- **policy 层误伤风险**：不给 `fs-confinement` 规则配 workspace 根就做 canonical，会对绝对相对路径误 deny；
  故词法规则只拦 `..` 与"未覆盖的绝对路径"，相对路径全放行给工具守卫（测试固定此契约，防未来回归）。
- **测试性细节**：policy engine 的 `decide` 对未传 spec 的工具默认 danger 权限，会导致 Read 在 workspace-write profile
  下被 profile deny——confinement 放行用例需显式传 `{requiredPermission: 'read'}`；Windows junction 需指向目录而非文件。

### 验收结论

- [x] 合入（commit f4cb415）
- 备注：指挥独立复核——全量 vitest 78 文件 712 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  设计认可：allow-set confinement（工作区根 ∪ 显式 allow 授权路径，Mode 区分 read/write）+ canonicalize 显式绝对
  allow hatch + symlink 出界永远拒绝（比词法 allow 更严）；硬执法点=工具执行 seam（Read/Write/Edit/Grep 首步
  assertConfined，越界 DENIED+meta.guard）+ policy 层 fs-confinement 词法预检（Executor 前置拒绝 → audit/denial，
  072 风格可查）；`allow` 死字段接通贯穿 policy→compose；默认关闭 back-compat。下一张：074（runtime enforcement
  telemetry）。
