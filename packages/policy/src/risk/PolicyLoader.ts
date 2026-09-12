import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyArtifacts, PolicyDeclaration, ProfileMode } from '@vessel/shared';
import { compilePolicy, compilePolicyYaml, parsePolicyYaml } from './Compiler.js';

export interface PolicyLoadOptions {
  /** system-scope builtin (configs/policy.default.yaml) */
  systemPath?: string;
  /** project-scope override (.harness/policy.yaml) — loaded when workspace trust passes */
  projectPath?: string;
  sessionOverrides?: { approval?: 'ask' | 'never'; profile?: ProfileMode };
}

/**
 * policy/risk loader — scope merge (system > project > session) per
 * POLICY-SPEC §3.5 / §8. Project policy loads only when the workspace is trusted.
 */
export function loadPolicyArtifacts(opts: PolicyLoadOptions = {}): PolicyArtifacts {
  const decls: PolicyDeclaration[] = [];

  if (opts.systemPath && fs.existsSync(opts.systemPath)) {
    decls.push(parsePolicyYaml(fs.readFileSync(opts.systemPath, 'utf8')));
  }
  if (opts.projectPath && fs.existsSync(opts.projectPath)) {
    // workspace trust gate: project policy is honored only for trusted workspaces
    decls.push(parsePolicyYaml(fs.readFileSync(opts.projectPath, 'utf8')));
  }

  if (decls.length === 0) {
    throw new Error('policy loader: no policy declaration found');
  }

  const merged = mergeScopes(decls);
  // V0.7: session-level overrides — approval mode and/or permission profile
  // (permission modes read-only / workspace-write / danger-full-access map to
  // the policy profile slot at the compose layer).
  if (opts.sessionOverrides?.approval) merged.approval = opts.sessionOverrides.approval;
  if (opts.sessionOverrides?.profile) merged.profile = opts.sessionOverrides.profile;

  return compilePolicy(merged);
}

/** 策略层次名（POLICY-SPEC §3.5：`system > project`；session 覆盖见 `PolicyLoadOptions`）。 */
export type PolicyLayerName = 'system' | 'project';

/**
 * 单层策略的**只读事实**（G-17 / BRIEF-15 AC2）：`vessel policy status` 与「部分装载」
 * 警告共用同一份产物，避免两处各算一套。
 */
export interface PolicyLayerFact {
  layer: PolicyLayerName;
  /** 该层的**候选**路径（文件不存在时也照实给出，便于提示「补齐到哪」）；该层未给路径时为 `''`。 */
  path: string;
  exists: boolean;
  /**
   * 该层贡献的**声明条数**——与 `loadPolicyArtifacts` 的 `decls` 同源：一个层文件解析出
   * 一个 `PolicyDeclaration`，故取值只能是 0（缺失 / 读不到 / 解析失败）或 1。
   */
  declarationCount: number;
  /**
   * 文件**存在**但读不到 / 解析不了时的原因（**存在→invalid 与 missing 必须可区分**）。
   *
   * 三态（与 `exists` 组合，互斥且穷尽）：
   * - `!exists`（**缺失**）→ **无**本字段；
   * - `exists && error`（**存在但无效**）→ 读取失败（IO：权限 / 路径是目录等）或
   *   YAML / 结构非法的原因原文；
   * - `exists && !error`（**存在且合法**）→ **无**本字段。
   *
   * **可选**：既有消费者不读 / 不写它也不会破（测试或第三方构造事实对象时无需补字段）。
   */
  error?: string;
  /** 文件**真实内容**的 sha256 十六进制前 12 位（AC2：改内容 → 哈希变）；不存在或读不到时无此字段。 */
  hash?: string;
}

/**
 * 只读地检视策略层次（G-17 / BRIEF-15 AC2/AC3）。
 *
 * 契约：**纯查询**——不做任何执法判定、不改 `loadPolicyArtifacts` 的既有行为、**绝不抛**：
 * - 路径未给或文件不存在 → `exists:false` + 0 条 + **无 `error`**（= **缺失**）；
 * - 文件存在但读不到（权限 / 路径是目录等 IO 失败）→ `exists:true` + 0 条 + `error:'<读取失败原因>'`；
 * - 文件存在但 YAML/结构非法 → `exists:true` + 0 条 + `error:'<解析原因>'`
 *   （**仍然不抛**；是否 fail-loud 由 `loadPolicyArtifacts` 那条装载路径决定）；
 * - 文件存在且合法 → `exists:true` + `declarationCount >= 1`（当前恒为 1）+ **无 `error`**。
 *
 * 「存在但无效」与「缺失」由 `error` 字段**可区分**：调用方据此给出**正确的补救动作**
 * （修复这个文件 vs 放置一个文件），不再把"文件就在那儿、只是坏的"误报成"没有文件"。
 *
 * 返回顺序即**合成顺序**（system 在前、project 在后；`profile`/`approval`/`version` 与 **allow 类**列表取
 * **靠前的层**即高层优先；**deny 类**列表拼接为并集——逐字段口径见 `mergeScopes` 的 JSDoc）。
 *
 * 分工（G-18）：本函数只给**逐层事实**（存在性 / YAML 结构解析 / 哈希），**不判断策略能否真正编译**——
 * `shell.deny: [not-a-real-category]` 这类只有编译器才认得出的错误，在逐层视角下就是「该层有效」。
 * 判断「这套层跑得起来吗」用同文件的 `inspectCombinedPolicy`（它复用装载路径本身；为何不做
 * 「逐层单独编译」见其 JSDoc）。两者都只读，且都**不写** `layers[].error`。
 */
export function inspectPolicyLayers(
  opts: { systemPath?: string; projectPath?: string } = {},
): PolicyLayerFact[] {
  const candidates: { layer: PolicyLayerName; path: string }[] = [
    { layer: 'system', path: opts.systemPath ?? '' },
    { layer: 'project', path: opts.projectPath ?? '' },
  ];
  return candidates.map(({ layer, path: target }): PolicyLayerFact => {
    if (target === '' || !fs.existsSync(target)) {
      // **缺失**：无 error —— 与「存在但无效」必须可区分（调用方据此决定"放置"还是"修复"）
      return { layer, path: target, exists: false, declarationCount: 0 };
    }
    const read = readLayerBytes(target);
    if (!read.ok) {
      // IO 异常不抛：文件在但读不到（权限 / 路径是目录等）→ exists:true / 0 条 / error / 无哈希
      return { layer, path: target, exists: true, declarationCount: 0, error: read.error };
    }
    const hash = crypto.createHash('sha256').update(read.raw).digest('hex').slice(0, 12);
    try {
      parsePolicyYaml(read.raw.toString('utf8'));
    } catch (err) {
      // YAML / 结构非法：仍算「文件在」，但 0 条 + error（**仍然不抛**；
      // 是否 fail-loud 由装载路径 `loadPolicyArtifacts` 决定）
      return { layer, path: target, exists: true, declarationCount: 0, error: errorMessage(err), hash };
    }
    return { layer, path: target, exists: true, declarationCount: 1, hash };
  });
}

/** 读取层文件字节；失败时**返回原因而不抛**（`inspectPolicyLayers` 的「绝不抛」契约要用）。 */
function readLayerBytes(target: string): { ok: true; raw: Buffer } | { ok: false; error: string } {
  try {
    return { ok: true, raw: fs.readFileSync(target) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** 异常 → 人话原因（`error` 字段的取值口径；非 Error 抛出物也兜住）。 */
function errorMessage(err: unknown): string {
  return (err as Error | undefined)?.message ?? String(err);
}

/**
 * **合成后可编译性**（G-18 / BRIEF-16 AC）：`inspectPolicyLayers` 的逐层视角**看不到**的
 * 「只有编译器才认得出」的那类错误（如 `shell.deny: [not-a-real-category]`）——逐层说「该层有效」，
 * 而 `run` 的装载路径当场抛 `policy compile error: unknown shell.deny category "…"`。
 */
export interface CombinedPolicyCompilability {
  /** `true` = 这组层路径合并后能编译；`false` = `vessel run` 在同一组路径下会装载失败。 */
  compiled: boolean;
  /** `compiled === false` 时装载路径抛出的**原始**消息（不改写、不加路径前缀）；成功时无此字段。 */
  error?: string;
}

/**
 * 只读地检视**合成后**能否编译（G-18 / BRIEF-16 AC）——与真实装载**同一次调用**。
 *
 * 契约：**纯查询**，不抛、不写盘、不改执法。`loadPolicyArtifacts` 只做「读文件 → `mergeScopes`
 * → `compilePolicy`」的纯计算（无副作用），故这里直接调它，而不是另写一套合并逻辑：
 * `compiled === false` **当且仅当** `vessel run` 在同一组候选路径下装载失败（口径不可能再分裂）。
 * 成功 `{compiled:true}`；抛错 `{compiled:false, error:<原始消息>}`（含「两层都没有声明」这种
 * `policy loader: no policy declaration found` 的失败——那同样是 `run` 的真实结局）。
 *
 * **为何不做「逐层单独编译」**：层是否合法**不是逐层性质**，`mergeScopes` 会补兜底默认
 * （`profile` / `approval` 在无任何层声明时补 `workspace-write` / `never`）并做跨层合成
 * （allow 类取高层先声明者、deny 类取并集、**未知顶层键在合成期被丢弃**）。据此：
 * - `shell: {deny: [destructive-delete]}` 单独编译会因缺 `version` / `profile` / `approval` 而
 *   **合法地**抛错 ⇒ 逐层编译把**有效层误报为无效**（假阳）；
 * - 未知**顶层**键 `totally_unknown_key` 在合成期被丢弃，合成后编译**不抛** ⇒ 逐层编译、或
 *   「有没有未知键」这类猜测，会把**无效误报为有效**（假阴）。
 * 两者都不可接受，故判据只能落在**真实编译这条路径**上。
 *
 * 与 `inspectPolicyLayers` 的分工：前者给**逐层事实**（存在性 / 声明条数 / 解析错误 / 哈希），
 * 本函数给**合成后可编译性**。「层文件本身解析失败」与「合成后编译失败」是两件事——后者归属
 * 哪一层是**歧义**的，故本函数的结果**不进** `layers[].error`，只作为独立的整体判据返回。
 */
export function inspectCombinedPolicy(
  opts: { systemPath?: string; projectPath?: string } = {},
): CombinedPolicyCompilability {
  try {
    loadPolicyArtifacts({ systemPath: opts.systemPath, projectPath: opts.projectPath });
    return { compiled: true };
  } catch (err) {
    return { compiled: false, error: errorMessage(err) };
  }
}

/** 动作严格度序（POLICY-SPEC §4.2 决策序 + §6.2「同 specificity 冲突取最严」）。 */
const ACTION_STRICTNESS: Readonly<Record<string, number>> = { allow: 0, ask: 1, deny: 2 };

/**
 * 取**更严**的一侧：`deny` > `ask` > `allow`（`network.default` 的 `deny` > `allow` 同表）。
 *
 * 未声明的一侧让位；两侧同严时保留**高层**（`higher`）取值。未登记的动作取值按**最宽松**计，
 * 因此一个不认识的取值**永远不会**压过已认识的更严取值（fail-closed：宁可保留旧的严）。
 */
function strictestAction<T extends string>(higher: T | undefined, lower: T | undefined): T | undefined {
  if (higher === undefined) return lower;
  if (lower === undefined) return higher;
  return (ACTION_STRICTNESS[lower] ?? 0) > (ACTION_STRICTNESS[higher] ?? 0) ? lower : higher;
}

/** `audit.details` 的详尽度序；**未登记的取值按最详尽处理**（不认识的层级不得被低层降级）。 */
const AUDIT_DETAIL_RANK: Readonly<Record<string, number>> = {
  none: 0,
  off: 0,
  minimal: 1,
  summary: 1,
  redacted: 1,
  full: 2,
};

/** 取**更详尽**的 `audit.details`（`full` > summary/redacted/minimal > none；未知 ⇒ 最详尽）。 */
function strictestAuditDetails(higher: string | undefined, lower: string | undefined): string | undefined {
  if (higher === undefined) return lower;
  if (lower === undefined) return higher;
  // YAML 里 `details:` 空值解析为 null，做一次防御（未登记取值一律按最详尽处理，不抛）
  const rank = (v: string): number =>
    typeof v === 'string' ? (AUDIT_DETAIL_RANK[v.trim().toLowerCase()] ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  return rank(lower) > rank(higher) ? lower : higher;
}

/**
 * **deny 语义**列表的并集（拼接、**不去重**，与 `shell.deny` / `tools.deny` / `network.deny_domains`
 * 口径一致）：低层追加只会**加限制**，故并集即单调趋严。
 * **allow 语义**列表**不得**走本函数（低层追加即放宽执行）——见 `firstDeclared`。
 * 返回 `undefined` 表示**所有层都未声明**该键 —— 保持「未声明」形状，不伪造空数组。
 */
function unionLists(higher: readonly string[] | undefined, lower: readonly string[] | undefined): string[] | undefined {
  if (higher === undefined && lower === undefined) return undefined;
  return [...(higher ?? []), ...(lower ?? [])];
}

/**
 * **allow 语义**列表的高层优先合成（first-declared wins，与 `profile` / `approval` 同款口径）。
 *
 * `shell.allow` / `filesystem.allow` 是**允许**语义：低层追加一条即可把原本被拒的调用放行——
 * `shell.allow` 会被 `Engine` 的 readonly allowlist 用来把所需权限从 `danger-full-access`
 * **降级为 `read`**（⇒ 由 deny 变 allow），`filesystem.allow` 会放宽 `Compiler` 的 `fs-confinement`
 * 允许集合与 `tools/guards.ts` 的 `assertConfined`。因此**只有首个声明该键的层**的取值被采纳，
 * 低层不得追加任何条目。
 *
 * `higher === undefined`（更高层**完全未声明**该键）时低层才可补空档；返回 `undefined` 表示
 * 所有层都未声明该键（保持「未声明」形状，不伪造空数组）。
 */
function firstDeclared<T>(higher: readonly T[] | undefined, lower: readonly T[] | undefined): T[] | undefined {
  if (higher !== undefined) return [...higher];
  return lower === undefined ? undefined : [...lower];
}

/**
 * 三态布尔取 **any-true**：`filesystem.confinement` 是硬执法开关（task 073），任一层打开即打开，
 * 低层**不得关闭**高层已打开的开关。两层都未声明时返回 `undefined` —— 保持「未声明」语义
 * （`Compiler` 只在 `=== true` 时生成 `fs-confinement` 规则，故**不得**把未声明写成 `false`）。
 */
function anyTrue(higher: boolean | undefined, lower: boolean | undefined): boolean | undefined {
  if (higher === true || lower === true) return true;
  if (higher === undefined && lower === undefined) return undefined;
  return higher ?? lower; // 至少一层显式声明且无 true → 保留已声明取值（含显式 false）
}

/**
 * `shell.scoped_rules` / `tools.rules` 的**按 action 分流**判据：低层可继续追加的只有收紧方向的
 * `deny` / `ask`（`ask` 在 `Engine` 的决策序里先于 allow 命中，只会把 allow 收紧为 ask/deny）；
 * `allow` 规则会让原本被拒的调用放行（`Engine` ⑤），低层一律不得追加。未登记的动作取值按**最宽松**
 * 计（与 `strictestAction` 同口径），因此同样不采信。
 */
function isTighteningRule(action: string): boolean {
  return (ACTION_STRICTNESS[action] ?? 0) >= (ACTION_STRICTNESS['ask'] ?? 1);
}

/**
 * 规则列表合成：最高层（`decls[0]`）贡献全部规则；低层只贡献收紧方向的 `deny` / `ask` 规则，
 * 其 `allow` 规则一律丢弃（低层不得凭空造出豁免）。始终返回数组（与既有形状一致）。
 */
function mergeRuleLists<T extends { action: string }>(
  higher: readonly T[] | undefined,
  lower: readonly T[] | undefined,
  isTopLayer: boolean,
): T[] {
  const fromLower = lower ?? [];
  const picked = isTopLayer ? fromLower : fromLower.filter((r) => isTighteningRule(r.action));
  return [...(higher ?? []), ...picked];
}

/** `git` 域已登记字段（语义已定序；其余键走 `inheritUnknownKeys`）。 */
const GIT_KNOWN_KEYS: ReadonlySet<string> = new Set(['force_push']);
/** `network` 域已登记字段。 */
const NETWORK_KNOWN_KEYS: ReadonlySet<string> = new Set(['default', 'deny_domains']);
/** `audit` 域已登记字段。 */
const AUDIT_KNOWN_KEYS: ReadonlySet<string> = new Set(['events', 'details']);

/**
 * `git` / `network` / `audit` 里**未登记**字段的合成：**高层先声明者胜出**——低层只能补高层没有的键，
 * 不得改写高层已给出的未知字段（「不确定的字段一律选更严」）。`undefined` 取值一律忽略。
 */
function inheritUnknownKeys(higher: object | undefined, lower: object, known: ReadonlySet<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(lower)) {
    if (!known.has(k) && v !== undefined) picked[k] = v;
  }
  for (const [k, v] of Object.entries(higher ?? {})) {
    if (!known.has(k) && v !== undefined) picked[k] = v; // 高层覆盖低层
  }
  return picked;
}

/**
 * merge scopes — 多层合成（层序 `system > project`：**左侧为高层**，`decls` 即按此序传入）。
 *
 * 语义分四类（对齐 POLICY-SPEC §6.2「deny 全局优先 / 低层只能加限制，不能放宽」）：
 *
 * - **`profile` / `approval` / `version` 采用高层优先（first-declared wins）**：只有更高层都没声明时才采用本层的值，
 *   故 `project`（`.harness/policy.yaml`）**不能**把 `system` 的 `workspace-write` 抬升为
 *   `danger-full-access`，也不能把 `approval` 从 `ask` 放宽为 `never`（收窄/放宽只能由会话 flag 显式完成，
 *   见 `loadPolicyArtifacts` 的 `sessionOverrides`）。若**所有**层都未声明，遍历结束后补兜底默认
 *   （`profile: 'workspace-write'`、`approval: 'never'`），即「无任何层声明」时行为与改前一致。
 *   `version` 一并改为 first-wins：它是**非安全字段**（`Compiler` 只校验其存在、不比较取值），
 *   改动只为消除「低层改写版本号、日后按版本切语义即成降级通道」的潜伏风险。
 * - **`git` / `network` / `audit` 单调趋严（monotonic tightening）**：低层**只能收紧，不能放宽**——
 *   - `git.force_push`：三态取**最严**（`deny` > `ask` > `allow`）。project 写 `allow` **覆盖不掉** system 的
 *     `deny`（与 POLICY-SPEC §3.5「同主张多处声明取最严 action」同源；`Compiler.ts:216` 据此产出
 *     `git:force-push` 规则，故克隆一个仓库放进 `.harness/policy.yaml` 无法放宽 force-push 保护）。
 *   - `network.deny_domains`：**并集**（拼接、不去重）——project 写 `[]` 抹不掉 system 的
 *     `169.254.169.254` 元数据 IP（§6.2「deny 集合并集」）。`network.default` 取**最严**
 *     （`deny` > `allow`）：default-deny 不可被低层降级为 default-allow。
 *   - `audit.events`：**并集**（审计面只能扩大、不能缩减，project 写 `[]` 无效）；`audit.details` 取**最详尽**者
 *     （`full` > summary/redacted/minimal > none，未登记的取值按最详尽处理）。
 *   - 三个域内**未登记**的字段（类型未声明者，如 `network.allow_domains`）一律**高层先声明者胜出**：
 *     低层只能补高层没有的键，不得改写高层已给出的未知字段（「不确定的字段一律选更严」）。
 * - **逐字段口径（拒绝语义 vs 允许语义）** —— 判据：**任何「低层追加后能让原本被拒的操作变为放行」的
 *   字段，低层都不得扩张**：
 *   - **deny 语义 ⇒ 并集**（拼接、不去重）：`filesystem.protected` / `filesystem.deny_read`、`shell.deny`、
 *     `tools.deny`（以及上面的 `network.deny_domains` / `audit.events`）。低层追加 = 只能加限制。
 *   - **allow 语义 ⇒ 高层优先（first-declared wins）**：`filesystem.allow`、`shell.allow`。低层追加
 *     `shell.allow: ['bash']` 会把 `bash -c "…"` 的所需权限从 `danger-full-access` **降级为 `read`**
 *     （`Engine.isShellAllowed`）⇒ 由 deny 变 allow；`filesystem.allow` 则放宽 `fs-confinement` 的允许集合
 *     与 `tools/guards.ts` 的 `assertConfined`。故这两个键取**首个声明它的层**，低层只在更高层**完全未声明**
 *     该键时才能补空档（与 `profile` 同款；`filesystem.confinement` 另有 any-true 规则）。
 *   - `shell.scoped_rules` / `tools.rules` ⇒ **按 `action` 分流**：`deny` / `ask` 规则低层可并集追加
 *     （收紧方向：`ask` 先于 allow 命中，只会把 allow 变成 ask/deny）；**`allow` 规则只能由最高层贡献**，
 *     低层追加一律丢弃（否则等于凭空造出豁免）。未登记 action 按最宽松计、同样丢弃。
 *   - `guidance` ⇒ 并集（纯文本软引导，不参与执法判定）。
 *
 *   即：**无 workspace trust 门时（§6.1 实现状态），project 层仍只能加限制、不能放宽 `system` 的限制**；
 *   放宽只能由会话 flag（`sessionOverrides`）显式完成。
 */
export function mergeScopes(decls: PolicyDeclaration[]): PolicyDeclaration {
  // `profile`/`approval` 不预置默认值：用局部变量记录「首个声明者」，遍历后再补兜底默认。
  const out: Omit<PolicyDeclaration, 'profile' | 'approval'> = {
    // C-5：`version` 亦为 first-declared wins —— 低层不得改写高层已声明的版本号（非安全字段，见 JSDoc）
    version: decls.find((d) => d.version)?.version ?? '0.1',
  };
  let profile: PolicyDeclaration['profile'] | undefined;
  let approval: PolicyDeclaration['approval'] | undefined;
  for (let index = 0; index < decls.length; index += 1) {
    const d = decls[index]!;
    const isTopLayer = index === 0;
    // first-declared wins：高层先声明者胜出，低层（project）无法覆盖高层（system）
    if (profile === undefined && d.profile) profile = d.profile;
    if (approval === undefined && d.approval) approval = d.approval;
    out.guidance = [...(out.guidance ?? []), ...(d.guidance ?? [])];
    if (d.filesystem) {
      // C-1：硬执法开关 any-true（任一层打开即打开）；都未声明时保持「未声明」（**不写 false**）
      const confinement = anyTrue(out.filesystem?.confinement, d.filesystem.confinement);
      out.filesystem = {
        // deny 语义 ⇒ 并集（低层只能加限制）
        protected: [...(out.filesystem?.protected ?? []), ...(d.filesystem.protected ?? [])],
        deny_read: [...(out.filesystem?.deny_read ?? []), ...(d.filesystem.deny_read ?? [])],
        // allow 语义 ⇒ 高层优先（低层不得扩张允许集合）
        allow: firstDeclared(out.filesystem?.allow, d.filesystem.allow),
        // 未声明时不落 `false`，保持「未声明」形状
        ...(confinement === undefined ? {} : { confinement }),
      };
    }
    if (d.shell) {
      out.shell = {
        // deny 语义 ⇒ 并集；allow 语义 ⇒ 高层优先；scoped_rules ⇒ 按 action 分流
        deny: [...(out.shell?.deny ?? []), ...(d.shell.deny ?? [])],
        allow: firstDeclared(out.shell?.allow, d.shell.allow),
        scoped_rules: mergeRuleLists(out.shell?.scoped_rules, d.shell.scoped_rules, isTopLayer),
      };
    }
    if (d.tools) {
      out.tools = {
        // deny 语义 ⇒ 并集；rules ⇒ 按 action 分流（低层不得追加 allow 规则）
        deny: [...(out.tools?.deny ?? []), ...(d.tools.deny ?? [])],
        rules: mergeRuleLists(out.tools?.rules, d.tools.rules, isTopLayer),
      };
    }
    // git / network / audit：单调趋严（低层只能收紧，不能放宽）——见上方 JSDoc 与 POLICY-SPEC §6.2。
    if (d.git) {
      const next: NonNullable<PolicyDeclaration['git']> = {};
      Object.assign(next, inheritUnknownKeys(out.git, d.git, GIT_KNOWN_KEYS));
      const forcePush = strictestAction(out.git?.force_push, d.git.force_push);
      if (forcePush !== undefined) next.force_push = forcePush;
      out.git = next;
    }
    if (d.network) {
      const next: NonNullable<PolicyDeclaration['network']> = {};
      Object.assign(next, inheritUnknownKeys(out.network, d.network, NETWORK_KNOWN_KEYS));
      const defaultAction = strictestAction(out.network?.default, d.network.default);
      if (defaultAction !== undefined) next.default = defaultAction;
      const denyDomains = unionLists(out.network?.deny_domains, d.network.deny_domains);
      if (denyDomains !== undefined) next.deny_domains = denyDomains;
      out.network = next;
    }
    if (d.audit) {
      const next: NonNullable<PolicyDeclaration['audit']> = {};
      Object.assign(next, inheritUnknownKeys(out.audit, d.audit, AUDIT_KNOWN_KEYS));
      const events = unionLists(out.audit?.events, d.audit.events);
      if (events !== undefined) next.events = events;
      const details = strictestAuditDetails(out.audit?.details, d.audit.details);
      if (details !== undefined) next.details = details;
      out.audit = next;
    }
  }
  // 兜底默认：仅当**所有**层都未声明该键时生效（保证与「无层声明」的既有行为一致）
  return {
    ...out,
    profile: profile ?? 'workspace-write',
    approval: approval ?? 'never',
  };
}

export { compilePolicy, compilePolicyYaml, parsePolicyYaml };

/** default system policy path relative to repo root */
export function defaultSystemPolicyPath(repoRoot: string): string {
  return path.join(repoRoot, 'configs', 'policy.default.yaml');
}
