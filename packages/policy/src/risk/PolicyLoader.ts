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
 * 返回顺序即**合成顺序**（system 在前、project 在后；后者覆盖标量 / 拼接数组）。
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

/** merge scopes: later declarations override scalars; arrays concatenate (dedup). */
export function mergeScopes(decls: PolicyDeclaration[]): PolicyDeclaration {
  const out: PolicyDeclaration = {
    version: decls[0]?.version ?? '0.1',
    profile: 'workspace-write',
    approval: 'never',
  };
  for (const d of decls) {
    if (d.version) out.version = d.version;
    if (d.profile) out.profile = d.profile;
    if (d.approval) out.approval = d.approval;
    out.guidance = [...(out.guidance ?? []), ...(d.guidance ?? [])];
    if (d.filesystem) {
      out.filesystem = {
        protected: [...(out.filesystem?.protected ?? []), ...(d.filesystem.protected ?? [])],
        deny_read: [...(out.filesystem?.deny_read ?? []), ...(d.filesystem.deny_read ?? [])],
        allow: [...(out.filesystem?.allow ?? []), ...(d.filesystem.allow ?? [])],
      };
    }
    if (d.shell) {
      out.shell = {
        deny: [...(out.shell?.deny ?? []), ...(d.shell.deny ?? [])],
        allow: [...(out.shell?.allow ?? []), ...(d.shell.allow ?? [])],
        scoped_rules: [...(out.shell?.scoped_rules ?? []), ...(d.shell.scoped_rules ?? [])],
      };
    }
    if (d.tools) {
      out.tools = {
        deny: [...(out.tools?.deny ?? []), ...(d.tools.deny ?? [])],
        rules: [...(out.tools?.rules ?? []), ...(d.tools.rules ?? [])],
      };
    }
    if (d.git) out.git = { ...(out.git ?? {}), ...d.git };
    if (d.network) out.network = { ...(out.network ?? {}), ...d.network };
    if (d.audit) out.audit = { ...(out.audit ?? {}), ...d.audit };
  }
  return out;
}

export { compilePolicy, compilePolicyYaml, parsePolicyYaml };

/** default system policy path relative to repo root */
export function defaultSystemPolicyPath(repoRoot: string): string {
  return path.join(repoRoot, 'configs', 'policy.default.yaml');
}
