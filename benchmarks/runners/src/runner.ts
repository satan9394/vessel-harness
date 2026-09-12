import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposeOptions } from '@vessel/application';
import { EvaluatorAgent, createReadOnlyExplorationTools, executePlan, generatePlan, injectPlan } from '@vessel/agents';
import type { EvaluatorVerdict } from '@vessel/agents';
import { McpClient, createInProcessTransport, handleMcpRequest } from '@vessel/tools';
import { LoopEngine, createTaskQueue, queueSelectTask, TempDirWorkspaceFactory, type IterationResult } from '@vessel/engine';
import { buildHandoff, seedSessionFromHandoff } from '@vessel/engine';
import { loadManifest } from './manifest.js';
import { runAssert } from './asserts.js';
import { OFFLINE_SCRIPTS } from './offline.js';
import type { AssertResult, DriverResult, ScenarioManifest, ScenarioReport, StreamObservation } from './types.js';

export interface RunScenarioOptions {
  scenarioId: string;
  repoRoot: string;
  reportsDir: string;
  provider: ChatProvider | null;
  model: string;
  policyPath: string;
  behaviorIRPath: string;
}

/**
 * Loop Engine lane (B023) artifact contract — task 111 审计整改.
 *
 * 判据必须锚定**引擎在一次真实运行中产出的东西**，不能锚定 runner 自己写下的报告
 * 模板字符串（旧实现把 golden 串同时写在报告模板与 Generator 里、Evaluator 只回显
 * Generator 的输出 ⇒ 自产自评、任何实现下都绿）。这里的形状是：
 *  - Generator 把 manifest 声明的 acceptance 写进**本次 attempt 的隔离工作区**里的
 *    ENGINE_ARTIFACT_FILE；
 *  - Evaluator **从磁盘重读**该产物来判定 met/not_met（Generator 的 output 只是数据，
 *    不是证据）；
 *  - persist 把产物（dispose 前）与结构化 IterationResult 收割到场景工作区的
 *    ENGINE_ARTIFACT_DIR 下，manifest 断言读的是这些**引擎真实字节**。
 */
const ENGINE_ARTIFACT_DIR = 'engine-artifacts';
const ENGINE_ARTIFACT_FILE = 'engine-result.txt';
/** scenario-workspace-relative path the manifest asserts against (file:<rel>). */
const ENGINE_ARTIFACT_REL = `${ENGINE_ARTIFACT_DIR}/${ENGINE_ARTIFACT_FILE}`;

function snapshotFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.harness') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = path.relative(dir, full).replace(/\\/g, '/');
        out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// Fixture prepare declarations (benchmarks/fixtures/<id>/setup.yaml)
//
// WHY THIS EXISTS — the S003 false-pass: `copyDir` above only handles
// isDirectory()/isFile(), so a symlink/junction is skipped in SILENCE. S003's
// whole subject (`probe-link`) was therefore never created, its criteria could
// not be evaluated at all, and nothing said so. A fixture can now DECLARE its
// prepare step; the runner CREATES it, and any refusal is a loud
// `FixtureSetupError` (→ gate `pending-environment`) instead of a silent skip.
//
// `copyDir` itself is untouched: ordinary files/directories keep being copied
// byte-for-byte exactly as before — the prepare step only ADDS declared links.
// ---------------------------------------------------------------------------

/** An artifact created OUTSIDE the workspace (sibling of the workspace root). */
export interface FixtureOutsideSpec {
  /** single path segment → `<dirname(workspace)>/<name>` */
  name: string;
  files?: { path: string; content: string }[];
}

/** A link created INSIDE the workspace, after the fixture copy. */
export interface FixtureLinkSpec {
  /** workspace-relative link path, e.g. `probe-link`. */
  name: string;
  /**
   * Where the link points:
   *   - `<sibling-name>`  → `<dirname(workspace)>/<sibling-name>` (OUTSIDE — the
   *     escape subject; the sibling is normally declared in `outside`).
   *   - `inside:<rel>`    → `<workspace>/<rel>` (INSIDE — a LEGAL link; used by
   *     the negative control that must NOT trip the escape guard).
   */
  target: string;
  /** default 'dir' (junction on Windows, dir symlink elsewhere). */
  kind?: 'dir' | 'file';
}

export interface FixtureSetupSpec {
  version?: number;
  outside?: FixtureOutsideSpec[];
  links?: FixtureLinkSpec[];
}

/** Fixture file that declares the prepare step. */
export const FIXTURE_SETUP_FILE = 'setup.yaml';

/**
 * A DECLARED prepare step could not be applied (platform refuses the link, no
 * permission, malformed declaration). Thrown, never swallowed: degrading to
 * "the probe object simply is not there" is exactly the defect this closes.
 * Callers map it to `pending-environment` — an honest "cannot judge on this
 * machine", which is neither a pass nor a silent failure.
 */
export class FixtureSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureSetupError';
  }
}

const SETUP_KEYS = new Set(['version', 'outside', 'links']);
const OUTSIDE_KEYS = new Set(['name', 'files']);
const OUTSIDE_FILE_KEYS = new Set(['path', 'content']);
const LINK_KEYS = new Set(['name', 'target', 'kind']);

function assertNoUnknownKeys(what: string, value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) {
      throw new FixtureSetupError(`fixture prepare: ${what} has unknown key "${k}" (allowed: ${[...allowed].join(', ')})`);
    }
  }
}

function assertMapping(what: string, value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FixtureSetupError(`fixture prepare: ${what} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

/**
 * Refuse a declaration whose SHAPE is not the one the prepare step executes.
 *
 * WHY: a misspelled key is the silent form of "the declaration was never applied".
 * `link:` instead of `links:` (or a scalar where a list is expected) used to parse
 * fine, apply nothing, and hand the scenario a workspace without its subject — the
 * exact class of defect `setup.yaml` exists to close. Every mis-shaped value is a
 * loud `FixtureSetupError` (→ gate `pending-environment`), never a no-op.
 */
function assertSetupShape(p: string, doc: Record<string, unknown>): void {
  assertNoUnknownKeys(`${FIXTURE_SETUP_FILE} (${p})`, doc, SETUP_KEYS);
  if (doc.version !== undefined && typeof doc.version !== 'number') {
    throw new FixtureSetupError(`fixture prepare: version must be a number (${p})`);
  }
  if (doc.outside !== undefined && !Array.isArray(doc.outside)) {
    throw new FixtureSetupError(`fixture prepare: outside must be a list (${p})`);
  }
  if (doc.links !== undefined && !Array.isArray(doc.links)) {
    throw new FixtureSetupError(`fixture prepare: links must be a list (${p})`);
  }
  for (const [i, raw] of ((doc.outside as unknown[] | undefined) ?? []).entries()) {
    const art = assertMapping(`outside[${i}] (${p})`, raw);
    assertNoUnknownKeys(`outside[${i}]`, art, OUTSIDE_KEYS);
    if (typeof art.name !== 'string') throw new FixtureSetupError(`fixture prepare: outside[${i}].name must be a string (${p})`);
    if (art.files !== undefined && !Array.isArray(art.files)) {
      throw new FixtureSetupError(`fixture prepare: outside[${i}].files must be a list (${p})`);
    }
    for (const [j, rawFile] of ((art.files as unknown[] | undefined) ?? []).entries()) {
      const file = assertMapping(`outside[${i}].files[${j}] (${p})`, rawFile);
      assertNoUnknownKeys(`outside[${i}].files[${j}]`, file, OUTSIDE_FILE_KEYS);
      if (typeof file.path !== 'string') throw new FixtureSetupError(`fixture prepare: outside[${i}].files[${j}].path must be a string (${p})`);
      if (file.content !== undefined && typeof file.content !== 'string') {
        throw new FixtureSetupError(`fixture prepare: outside[${i}].files[${j}].content must be a string (${p})`);
      }
    }
  }
  for (const [i, raw] of ((doc.links as unknown[] | undefined) ?? []).entries()) {
    const link = assertMapping(`links[${i}] (${p})`, raw);
    assertNoUnknownKeys(`links[${i}]`, link, LINK_KEYS);
    if (typeof link.name !== 'string') throw new FixtureSetupError(`fixture prepare: links[${i}].name must be a string (${p})`);
    if (typeof link.target !== 'string') throw new FixtureSetupError(`fixture prepare: links[${i}].target must be a string (${p})`);
  }
}

export function loadFixtureSetup(fixtureRoot: string): FixtureSetupSpec | null {
  const p = path.join(fixtureRoot, FIXTURE_SETUP_FILE);
  if (!fs.existsSync(p)) return null;
  let doc: unknown;
  try {
    doc = yaml.load(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new FixtureSetupError(`fixture prepare declaration unreadable (${p}): ${(err as Error).message}`);
  }
  if (doc === null || doc === undefined) return null;
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new FixtureSetupError(`fixture prepare declaration must be a mapping (${p})`);
  }
  assertSetupShape(p, doc as Record<string, unknown>);
  return doc as FixtureSetupSpec;
}

/** Reject absolute / traversing paths (a hostile setup.yaml must not reach outside). */
function assertSafeRelPath(p: string, what: string): void {
  if (!p || path.isAbsolute(p) || p.split(/[\\/]+/).some((s) => s === '..')) {
    throw new FixtureSetupError(`fixture prepare: ${what} must be a relative path without ".." (got "${p}")`);
  }
}

/** Reject anything but a single path segment for a sibling artifact name. */
function assertSafeSiblingName(name: string, what: string): void {
  if (!name || path.isAbsolute(name) || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new FixtureSetupError(`fixture prepare: ${what} must be a single path segment (got "${name}")`);
  }
}

/** Remove a pre-existing link WITHOUT following it and without deleting a real directory. */
function dropExistingLink(linkPath: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    throw new FixtureSetupError(`fixture prepare: refusing to overwrite a real directory at "${linkPath}"`);
  }
  try {
    fs.unlinkSync(linkPath);
  } catch {
    // Windows junction: DeleteFile refuses a directory reparse point; rmdir removes the link itself.
    fs.rmdirSync(linkPath);
  }
}

/** Path equality that survives Windows case/separator normalisation. */
function sameResolvedPath(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Create ONE declared link. Windows junctions do not need elevation (unlike
 * file/dir symlinks, which need Developer Mode or admin — a refusal there
 * becomes a FixtureSetupError, i.e. pending-environment). POSIX uses symlink(2).
 */
function createFixtureLink(linkPath: string, targetPath: string, kind: 'dir' | 'file'): void {
  dropExistingLink(linkPath);
  const absLink = path.resolve(linkPath);
  const absTarget = path.resolve(targetPath);
  const type: 'junction' | 'dir' | 'file' = process.platform === 'win32' ? (kind === 'dir' ? 'junction' : 'file') : kind;
  fs.symlinkSync(absTarget, absLink, type);
  // Functional verification, deliberately not `isSymbolicLink()`: Windows
  // reports junctions as directory reparse points, and whether lstat calls that
  // a symlink is platform/Node dependent. What MUST hold is that the entry
  // REDIRECTS to the declared target — a platform that materialised a plain
  // copy/directory would otherwise make the scenario judge nothing while
  // looking green.
  let resolvedLink: string;
  try {
    resolvedLink = fs.realpathSync(absLink);
  } catch (err) {
    throw new FixtureSetupError(
      `fixture prepare: "${absLink}" was created but cannot be resolved to its declared target ${absTarget} (${(err as Error).message})`,
    );
  }
  if (!sameResolvedPath(resolvedLink, fs.realpathSync(absTarget))) {
    throw new FixtureSetupError(
      `fixture prepare: "${absLink}" does not redirect to ${absTarget} (realpath=${resolvedLink}) — the link was not applied`,
    );
  }
}

/**
 * Remove every TOP-LEVEL link in a workspace WITHOUT following it.
 *
 * Windows junctions are directory reparse points: `fs.unlinkSync` may refuse
 * them (DeleteFile needs backup semantics) while `fs.rmdirSync` removes the link
 * itself. Dropping the links first also guarantees that a following recursive
 * delete cannot walk THROUGH the link into the (outside) target.
 *
 * Best-effort by contract: cleanup must never throw over a link it cannot drop.
 */
export function dropWorkspaceLinks(ws: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(ws, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isSymbolicLink()) continue;
    const p = path.join(ws, e.name);
    try {
      fs.unlinkSync(p);
    } catch {
      try {
        fs.rmdirSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Apply a fixture's declared prepare step to the just-copied workspace.
 *
 * Call this on EVERY prepare path (runner `runScenario` AND the vessel adapter
 * `runVesselFixture`): a prepare path that skips it silently hands the scenario
 * a workspace without its subject. No declaration ⇒ no-op (every existing
 * fixture is unaffected).
 */
export function prepareFixtureSetup(fixtureRoot: string, workspace: string): void {
  const setup = loadFixtureSetup(fixtureRoot);
  if (!setup) return;
  const fixtureId = path.basename(path.resolve(fixtureRoot));
  const ws = path.resolve(workspace);
  const parent = path.dirname(ws);

  // 1) outside artifacts (siblings of the workspace root) — the escape TARGETS
  for (const art of setup.outside ?? []) {
    const name = String(art?.name ?? '');
    assertSafeSiblingName(name, 'outside[].name');
    const dir = path.join(parent, name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of art.files ?? []) {
        const rel = String(f?.path ?? '');
        assertSafeRelPath(rel, 'outside[].files[].path');
        const dest = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, String(f?.content ?? ''), 'utf8');
      }
    } catch (err) {
      if (err instanceof FixtureSetupError) throw err;
      throw new FixtureSetupError(
        `fixture ${fixtureId}: cannot prepare outside artifact "${name}" at ${dir}: ${(err as Error).message}`,
      );
    }
  }

  // 2) links inside the workspace
  for (const link of setup.links ?? []) {
    const name = String(link?.name ?? '');
    assertSafeRelPath(name, 'links[].name');
    const kind = link?.kind ?? 'dir';
    if (kind !== 'dir' && kind !== 'file') {
      throw new FixtureSetupError(`fixture ${fixtureId}: links[].kind must be "dir" or "file" (got "${String(kind)}")`);
    }
    const rawTarget = String(link?.target ?? '');
    let targetPath: string;
    if (rawTarget.startsWith('inside:')) {
      const rel = rawTarget.slice('inside:'.length);
      assertSafeRelPath(rel, 'links[].target (inside:)');
      targetPath = path.join(ws, rel);
    } else {
      assertSafeSiblingName(rawTarget, 'links[].target');
      targetPath = path.join(parent, rawTarget);
    }
    const linkPath = path.join(ws, name);
    try {
      createFixtureLink(linkPath, targetPath, kind);
    } catch (err) {
      if (err instanceof FixtureSetupError) throw err;
      throw new FixtureSetupError(
        `fixture ${fixtureId}: cannot create link "${name}" → ${targetPath} (kind=${kind}, platform=${process.platform}): ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Live stream observation collector — subscribes to the loop's model_stream_delta
 * bus and normalizes each text / tool chunk into a StreamObservation. Used by the
 * streaming / interrupt / steering drivers to prove stream behavior machine-wise
 * (model_stream_* are live bus events, not session records).
 */
function captureStreamEvents(
  harness: Awaited<ReturnType<typeof composeHarness>>,
  events: StreamObservation[],
): () => void {
  return harness.bus.on('model_stream_delta', (payload) => {
    const chunk = (payload as { chunk?: { type?: string; text?: string; name?: string } }).chunk;
    if (!chunk || typeof chunk.type !== 'string') return;
    if (chunk.type === 'text_delta') {
      events.push({ kind: 'text', text: chunk.text ?? '' });
    } else if (chunk.type === 'tool_call_start') {
      events.push({ kind: 'tool', toolName: chunk.name ?? 'unknown' });
    }
  }, 'bench:stream-capture');
}

/**
 * Scenario drivers (V0.2): default = one loop turn; planner = plan → inject →
 * execute (acceptance-driven evaluator); evaluator = generator run, then an
 * independent EvaluatorAgent reviews the output (never self-certified).
 *
 * V1.1-D drivers:
 *  - streaming: capture model_stream_* observations while a normal turn runs.
 *  - interrupt: subscribe to model_stream_delta and call loop.interrupt() at a
 *    deterministic chunk boundary (first tool_call_end) so the turn closes
 *    kind='interrupted' (turn/start → turn/end pairing preserved).
 *  - steering: after the first tool completes, call loop.steer() with a
 *    direction-change directive; it is drained at the next step boundary and
 *    injected as a user/message record (source='steer') that redirects the next
 *    model answer.
 *  - resume: the session is seeded from a Context Reset Handoff (source='handoff')
 *    before the turn runs, proving continuation rather than a fresh start.
 */
async function driveScenario(
  harness: Awaited<ReturnType<typeof composeHarness>>,
  manifest: ScenarioManifest,
  prompt: string,
  provider: ChatProvider,
  model: string,
  workspace: string,
): Promise<DriverResult> {
  if (manifest.harness?.planner) {
    const plan = await generatePlan(provider, model, prompt);
    await injectPlan(harness.session, plan);
    const report = await executePlan(
      async (stepPrompt) => harness.loop.runTurn(stepPrompt),
      plan,
      async ({ step, output }) => {
        const missing = step.acceptance.filter((a) => !output.includes(a));
        return missing.length === 0
          ? { verdict: 'met' as const, evidence: [...step.acceptance], reason: 'acceptance golden present' }
          : { verdict: 'not_met' as const, evidence: [`missing: ${missing.join(', ')}`], reason: 'acceptance golden missing' };
      },
      { maxAttemptsPerStep: 1 },
    );
    return { finalText: `计划执行${report.overallVerdict === 'met' ? '通过' : '未通过'}：${report.reason}`, streamEvents: [] };
  }
  if (manifest.harness?.evaluator) {
    const gen = await harness.loop.runTurn(prompt);
    const evalProvider = new MockProvider(OFFLINE_SCRIPTS[`${manifest.id}-eval`] ?? [], { model });
    const evaluator = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: evalProvider,
      model,
      policyArtifacts: harness.artifacts,
      tools: createReadOnlyExplorationTools(workspace),
    });
    const acceptance = manifest.pass.filter((p) => p.type === 'file_content').flatMap((p) => p.golden ?? []);
    const verdict = await evaluator.evaluate({ goal: manifest.goal, generatorOutput: gen.finalText, acceptance });
    // the verdict is injected back into the parent session (回投父上下文, recorded)
    await harness.session.appendSync({
      type: 'user/message',
      msgId: `eval_${Date.now()}`,
      role: 'user',
      content: `Evaluator Agent 结论：${verdict.verdict}（${verdict.reason}）`,
      source: 'inject',
      surface: true,
    });
    return { finalText: `评估结论：${verdict.verdict}（${verdict.reason}）`, streamEvents: [] };
  }
  if (manifest.harness?.engine) {
    // V0.5 Loop Engine lane: one full iteration with deterministic
    // generator/evaluator in an isolated temp workspace.
    //
    // 判据来源（task 111）：manifest 里 target = "file:" + ENGINE_ARTIFACT_REL 的断言既是
    // 断言、也是交给引擎 Generator 的 acceptance —— 场景 yaml 是唯一事实源，runner 里
    // 不再出现任何 golden 常量串。Generator 写盘、Evaluator 读盘判定、persist 收割留痕，
    // 报告文本只回述引擎自己的结果（verdict/taskId/iteration/persist 条数）。
    const acceptance = manifest.pass
      .filter((p) => p.type === 'file_content' && p.target === `file:${ENGINE_ARTIFACT_REL}`)
      .flatMap((p) => p.golden ?? []);
    if (acceptance.length === 0) {
      // fail loud：engine lane 没有声明产物判据 = 断言不检查任何产物 —— 绝不静默全绿。
      throw new Error(
        `scenario ${manifest.id}: engine lane requires a file_content assert on "file:${ENGINE_ARTIFACT_REL}" to declare the generator acceptance`,
      );
    }
    const queue = createTaskQueue([{ id: manifest.id.toLowerCase(), goal: manifest.goal, acceptance }]);
    const wsFactory = new TempDirWorkspaceFactory(`cah-${manifest.id.toLowerCase()}-`);
    const persisted: IterationResult[] = [];
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(queue),
        generate: async (ctx) => {
          // 确定性 Generator（offline lane）：在本次 attempt 的隔离工作区里产出
          // manifest 声明的验收产物。产物内容来自 task.acceptance（场景 yaml），
          // 不是 runner 里的模板常量。
          const artifactPath = path.join(ctx.workspace.root, ENGINE_ARTIFACT_FILE);
          fs.writeFileSync(
            artifactPath,
            [`task=${ctx.task.id}`, `iteration=${ctx.iteration}`, `attempt=${ctx.attempt}`, ...(ctx.task.acceptance ?? [])].join('\n') + '\n',
            'utf8',
          );
          return { output: `artifact written: ${artifactPath}`, artifactPaths: [artifactPath] };
        },
        evaluate: async (ctx): Promise<EvaluatorVerdict> => {
          // 独立评审：判定只依据**磁盘上的产物字节**——既不回显 Generator 的 output
          // （generatorOutput 只是数据，永不是证据），也不引用任何 runner 侧常量。
          const artifactPath = path.join(ctx.workspace.root, ENGINE_ARTIFACT_FILE);
          const artifact = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : '';
          const criteria = ctx.task.acceptance ?? [];
          const missing = criteria.filter((g) => !artifact.includes(g));
          return missing.length === 0
            ? {
                verdict: 'met',
                evidence: [`${ENGINE_ARTIFACT_FILE} on disk satisfies acceptance: ${criteria.join(', ')}`],
                reason: 'artifact verified on disk',
              }
            : {
                verdict: 'not_met',
                evidence: [`${ENGINE_ARTIFACT_FILE} on disk missing acceptance: ${missing.join(', ')}`],
                reason: 'artifact verification failed',
              };
        },
        persist: async (r) => {
          // persist 留痕 + 收割：隔离工作区在本回调返回后即被 dispose，故在此把它
          // 真实产出的文件复制到场景工作区，并把引擎的结构化 IterationResult 落盘，
          // 供 manifest 断言从磁盘读取（判据不经过 runner 的文本模板）。
          // persist 契约要求不抛异常：收割失败表现为断言 fail（见文件缺失），而非崩溃。
          try {
            const destDir = path.join(workspace, ENGINE_ARTIFACT_DIR);
            fs.mkdirSync(destDir, { recursive: true });
            const src = r.outputPath;
            if (src && fs.existsSync(src)) {
              for (const e of fs.readdirSync(src, { withFileTypes: true })) {
                if (e.isFile()) fs.copyFileSync(path.join(src, e.name), path.join(destDir, e.name));
              }
            }
            fs.writeFileSync(path.join(destDir, 'iteration.json'), JSON.stringify(r, null, 2) + '\n', 'utf8');
          } catch {
            // 收割失败不掩盖：产物/记录缺失会让 manifest 断言如实判 fail。
          }
          persisted.push(r);
        },
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      { maxIterations: 1 },
    );
    const report = await engine.run();
    const verdict = report?.result.verdict ?? 'error';
    const taskId = report?.result.taskId ?? 'none';
    return {
      // 只回述引擎自己的结果（无 golden 常量串）：verdict 来自 Evaluator，
      // iteration/attempts 来自 LoopRunReport，persist 条数来自 persist 回调。
      finalText: `Loop Engine 迭代完成：verdict=${verdict}（任务 ${taskId}，iteration ${report?.result.iteration ?? 0}，attempts ${report?.result.retryCount ?? 0}）；persist 记录 ${persisted.length} 条`,
      streamEvents: [],
    };
  }
  if (manifest.harness?.resume) {
    // V1.1-D resume: a Context Reset Handoff (task 067) is seeded into the
    // session BEFORE the turn runs — the model continues from next_actions
    // rather than starting fresh (source='handoff' record + continuation golden).
    const handoff = buildHandoff({
      goal: manifest.goal,
      completed: ['已读取 notes/facts.txt', '已汇总初始表格'],
      current_state: 'upstream 阶段完成，等待续跑',
      changed_files: [],
      tests: ['handoff 快照已生成'],
      decisions: ['沿用 summary 收窄策略'],
      blockers: [],
      next_actions: ['继续并输出 RESUME-GOLDEN-2026 以证明从 handoff 续跑'],
      evidence: ['handoff APPENDIX-RESUME'],
    });
    await seedSessionFromHandoff(harness.session, handoff);
    const result = await harness.loop.runTurn(prompt);
    return { finalText: result.finalText, streamEvents: [] };
  }
  // V1.1-D shared: streaming capture + interrupt + steering operate on the same
  // normal turn. They are mutually-exclusive per scenario, but compose cleanly.
  const streamEvents: StreamObservation[] = [];
  const detachCapture = captureStreamEvents(harness, streamEvents);
  let detachInterrupt: (() => void) | null = null;
  let detachSteer: (() => void) | null = null;

  if (manifest.harness?.interrupt) {
    let fired = false;
    detachInterrupt = harness.bus.on(
      'model_stream_delta',
      (payload) => {
        if (fired) return;
        const chunk = (payload as { chunk?: { type?: string } }).chunk;
        // deterministic mid-run cutoff: interrupt at the first tool_call_end
        // chunk boundary — the remaining stream + tool execution never happen,
        // and the loop's boundary check closes the turn kind='interrupted'.
        if (chunk?.type === 'tool_call_end') {
          fired = true;
          harness.loop.interrupt();
        }
      },
      'bench:interrupt-driver',
    );
  }

  if (manifest.harness?.steering) {
    let fired = false;
    detachSteer = harness.bus.on(
      'after_tool',
      (payload) => {
        if (fired) return;
        fired = true;
        const toolName = (payload as { toolName?: string }).toolName ?? 'tool';
        // never preemptive: enqueue the steer; it is drained at the next step
        // boundary (interrupt = 停, steer = 改向继续).
        void toolName;
        harness.loop.steer('把范围收窄到 summary，别再读大文件 —— STEER-GOLDEN-2026');
      },
      'bench:steer-driver',
    );
  }

  try {
    const result = await harness.loop.runTurn(prompt);
    return { finalText: result.finalText, streamEvents };
  } finally {
    detachCapture();
    detachInterrupt?.();
    detachSteer?.();
  }
}

/**
 * Give every tool call of one RUN its own `toolCallId`.
 *
 * WHY (S003 root cause, read off the records): the offline scripted provider numbers
 * ids PER RESPONSE — `tc_mock_${i + 1}` (packages/llm/src/provider/MockProvider.ts:130
 * and :175) — so a script that issues one call per step reuses `tc_mock_1` on EVERY
 * step. The anchoring join `toolCallArgsById` (asserts.ts:107-121) is a
 * last-write-wins map keyed by that id, so an anchored assert (`arguments_pattern`)
 * resolved the step-1 DENIED `tool/result` against the step-2 arguments and reported
 * `guards: [] / anchoredCalls: []` while `toolCallsSeen` still showed the probe call —
 * a red that reads as "the call happened but was never denied" even though the guard
 * denied it. The provider is outside this lane's scope, so the benchmark lane re-keys
 * at its own provider seam, where the ambiguity is created.
 *
 * Ids stay stable WITHIN one response, so `tool_call_start` / `tool_call_delta` /
 * `tool_call_end` pairing and the loop's accumulation (`AgentLoop.consumeStream`) are
 * untouched; only the cross-step collision is removed.
 */
export function uniqueToolCallIds(base: ChatProvider): ChatProvider {
  let n = 0;
  const rekey = (seen: Map<string, string>, id: string): string => {
    const hit = seen.get(id);
    if (hit !== undefined) return hit;
    n += 1;
    const next = `tc_${n}`;
    seen.set(id, next);
    return next;
  };
  return {
    id: base.id,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const res = await base.chat(request);
      if (!res.toolCalls?.length) return res;
      const seen = new Map<string, string>();
      return { ...res, toolCalls: res.toolCalls.map((tc) => ({ ...tc, id: rekey(seen, tc.id) })) };
    },
    stream: base.stream
      ? async function* (request: ChatRequest): AsyncGenerator<StreamChunk> {
          const seen = new Map<string, string>();
          for await (const chunk of base.stream!(request)) {
            if (chunk.type === 'tool_call_start' || chunk.type === 'tool_call_delta' || chunk.type === 'tool_call_end') {
              const rekeyed: StreamChunk = { ...chunk, id: rekey(seen, chunk.id) };
              yield rekeyed;
            } else {
              yield chunk;
            }
          }
        }
      : undefined,
  };
}

/**
 * runScenario — headless benchmark seam (BENCHMARK-SPEC §6.1):
 * prepare (copy fixture + snapshot) → inject task → run our harness
 * → collect (session + telemetry) → assert (disk/command/event, never self-report)
 * → report (JSONL + summary.json).
 */
export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioReport> {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const manifest = loadManifest(opts.repoRoot, opts.scenarioId);
  const runId = `run_${startedAt.getTime()}_${crypto.randomBytes(3).toString('hex')}`;

  const runDir = path.join(opts.reportsDir, opts.scenarioId, runId);
  const workspace = path.join(runDir, 'workspace');
  const fixtureDir = path.join(opts.repoRoot, 'benchmarks', manifest.fixture);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`fixture not found: ${fixtureDir}`);
  }
  copyDir(fixtureDir, workspace);
  // declared prepare step (e.g. S003 `probe-link`): the copy above cannot carry
  // a symlink/junction, so the fixture declares it and we create it here. A
  // refusal throws FixtureSetupError (→ gate pending-environment), never a
  // silent "the probe object just is not there".
  prepareFixtureSetup(fixtureDir, workspace);
  const snapshotBefore = snapshotFiles(workspace);

  // scenario policy override (B005 needs danger-full-access for real shell)
  let policyPath = opts.policyPath;
  if (manifest.policy) {
    const base = fs.readFileSync(opts.policyPath, 'utf8');
    const doc = yaml.load(base) as { policy?: Record<string, unknown> } | null;
    const root: Record<string, unknown> = doc?.policy ?? (doc as Record<string, unknown> | null) ?? {};
    if (manifest.policy.profile) root.profile = manifest.policy.profile;
    if (manifest.policy.approval) root.approval = manifest.policy.approval;
    const out = path.join(runDir, 'scenario-policy.yaml');
    fs.writeFileSync(out, yaml.dump({ policy: root }), 'utf8');
    policyPath = out;
  }

  // provider: offline lane (deterministic) or live (real model).
  // The offline scripted provider is re-keyed so every tool call in the run owns a
  // unique `toolCallId` (see `uniqueToolCallIds`): without it a one-call-per-step
  // script reuses `tc_mock_1`, and the `arguments_pattern` evidence join binds a
  // denial to the wrong call — S003's "denied but reported as never denied".
  const provider =
    opts.provider ??
    uniqueToolCallIds(
      new MockProvider(OFFLINE_SCRIPTS[opts.scenarioId] ?? [], {
        model: opts.model,
        vars: { cwd: workspace },
      }),
    );

  const prompt = fs.readFileSync(path.join(workspace, manifest.task_file), 'utf8').trim();

  const composeOpts: ComposeOptions = {
    workspaceRoot: workspace,
    provider,
    model: opts.model,
    policySystemPath: policyPath,
    behaviorIRPath: opts.behaviorIRPath,
  };
  if (manifest.harness?.subagent) {
    composeOpts.subagent = {
      enabled: true,
      maxConcurrent: manifest.harness.subagent.maxConcurrent,
      maxDepth: manifest.harness.subagent.maxDepth,
    };
  }
  if (manifest.harness?.mcp) {
    composeOpts.mcp = manifest.harness.mcp.map((c) => ({
      serverName: c.serverName,
      // offline lane: in-process transport bound to the local stdio fixture server core
      transport: createInProcessTransport((method, params) => handleMcpRequest(method, params)),
    }));
  }
  // V0.4 task routing lane: two offline mock providers (pro/fast tiers); the
  // task prompt is classified and the session routed to a tier. Machine proof:
  // only the tier the task routes to emits the golden marker in its reply.
  if (manifest.harness?.taskRouter) {
    const proProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-PRO-TIER GOLDEN-ROUTE-2026' } }],
      { model: 'pro-model' },
    );
    const fastProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-FAST-TIER' } }],
      { model: 'fast-model' },
    );
    composeOpts.taskRouter = {
      providers: { pro: proProvider, fast: fastProvider },
      tierModel: {
        pro: { providerId: 'pro', model: 'pro-model' },
        fast: { providerId: 'fast', model: 'fast-model' },
        mini: { providerId: 'fast', model: 'mini-model' },
      },
      taskPrompt: prompt,
    };
  }

  const harness = await composeHarness(composeOpts);

  let finalText = '';
  let streamEvents: StreamObservation[] = [];
  try {
    const driven = await driveScenario(harness, manifest, prompt, provider, opts.model, workspace);
    finalText = driven.finalText;
    streamEvents = driven.streamEvents;
  } finally {
    await harness.close();
  }

  // hidden test injection (B003: runner-side, never visible during the run)
  if (manifest.hidden) {
    const hiddenSrc = path.join(opts.repoRoot, 'benchmarks', manifest.hidden.source);
    const hiddenDest = manifest.hidden.into ? path.join(workspace, manifest.hidden.into) : workspace;
    if (fs.existsSync(hiddenSrc)) copyDir(hiddenSrc, hiddenDest);
  }

  const counters = harness.telemetry.finalize(harness.session);
  const records = harness.session.replay();

  const assertResults: AssertResult[] = [];
  for (let i = 0; i < manifest.pass.length; i++) {
    assertResults.push(
      await runAssert(manifest.pass[i]!, { workspace, sessionRecords: records, counters, finalText, snapshotBefore, streamEvents }, i),
    );
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = assertResults.every((a) => a.result === 'pass');

  // JSONL report (BENCHMARK-SPEC §4.2)
  fs.mkdirSync(runDir, { recursive: true });
  const reportPath = path.join(runDir, `${runId}.jsonl`);
  const lines: string[] = [
    JSON.stringify({
      type: 'meta', runId, ts: startedAtIso, scenarioId: opts.scenarioId, harness: 'ours',
      arm: null, mode: opts.provider ? 'live' : 'offline',
      env: { harnessVersion: 'cah@0.1.0', model: opts.model, provider: opts.provider?.id ?? 'mock', temperature: 0 },
    }),
  ];
  for (const m of harness.telemetry.metrics({ durationMs })) {
    lines.push(JSON.stringify({ type: 'metric', runId, ts: finishedAt.toISOString(), metric: m.metric, name: m.name, value: m.value, unit: m.unit, source: m.source, approx: m.approx, detail: m.detail }));
  }
  for (const r of records) {
    if (r.type === 'tool/call') {
      // `arguments` is included so an ANCHORED assert (arguments_pattern) can be
      // checked against the report itself: without it, a red leaves "the call
      // never happened" and "the call happened but was not denied" indistinguishable.
      lines.push(JSON.stringify({ type: 'event', runId, ts: finishedAt.toISOString(), kind: 'tool/call', payload: { toolCallId: r.toolCallId, toolName: r.toolName, arguments: r.arguments } }));
    }
    if (r.type === 'audit/denial') {
      lines.push(JSON.stringify({ type: 'event', runId, ts: finishedAt.toISOString(), kind: 'audit/denial', payload: { toolCallId: r.toolCallId, ruleRef: r.ruleRef, reason: r.reason } }));
    }
  }
  for (const e of streamEvents) {
    lines.push(JSON.stringify({ type: 'event', runId, ts: finishedAt.toISOString(), kind: 'model_stream_delta', payload: e }));
  }
  for (const a of assertResults) {
    lines.push(JSON.stringify({ type: 'assert', runId, ts: finishedAt.toISOString(), assertId: a.id, assertType: a.type, target: a.target, result: a.result, evidence: a.evidence }));
  }
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

  const summary: Record<string, unknown> = {
    scenarioId: opts.scenarioId,
    runId,
    success,
    mode: opts.provider ? 'live' : 'offline',
    durationMs,
    metrics: { M01: success ? 1 : 0, ...Object.fromEntries(harness.telemetry.metrics({ durationMs }).map((m) => [m.metric, m.value])) },
    asserts: assertResults.map((a) => ({ id: a.id, type: a.type, result: a.result })),
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    reportPath,
    sessionLog: harness.session.logPath,
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  return {
    scenarioId: opts.scenarioId,
    runId,
    success,
    asserts: assertResults,
    metrics: summary.metrics as Record<string, number>,
    finalText,
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    durationMs,
    reportPath,
    workspace,
    sessionLog: harness.session.logPath,
  };
}

export { loadManifest, OFFLINE_SCRIPTS };
export type { ScenarioReport, AssertResult, ScenarioManifest } from './types.js';
