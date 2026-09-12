import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { composeHarness, createMcpConnections, SessionRegistry, type ComposedHarness, type ComposeMcpConnection, type SessionMeta, type SyncCredentialStore } from '@vessel/application';
import { ProviderStore, type ProviderConfig } from '../providers/ProviderStore.js';
import { McpConfigStore } from '../mcp/config.js';
import { createDefaultProviderStore } from '../providers/defaultStore.js';
import { runSetupWizard, createClackIO, fetchModelOutcome } from '../providers/setup.js';
import { buildRealProvider, describeProviderError, planProvider } from '../providers/providerFactory.js';
import { modelsForProtocol } from '@vessel/application';
import { VESSEL_LOGO } from '../brand.js';
import { findTerm, renderExplain } from '../guide/glossary.js';
import type { GuideLocale } from '../guide/guide.js';
import { SettingsStore } from '../guide/settings.js';
import type { UsageStore } from '../usage/UsageStore.js';
import { localDateKey } from '../usage/UsageStore.js';
import { renderCostLines, renderTurnDelta, renderTodayLine, type UsageTotalsLike } from './costView.js';

/**
 * apps/cli/src/tui/chat.ts — `vessel` interactive chat TUI (V0.7, task 021; brand Vessel).
 *
 * One command → chat loop, opencode-style: natural language runs the harness
 * loop; slash commands configure providers / models / permission inside the
 * session (no separate setup step needed).
 *
 * Design (research §B4): plain readline loop, model output printed to the
 * native scrollback; a status line after each turn shows provider·model·
 * permission. Forms (/provider /models /permission /setup) reuse the existing
 * @clack/prompts IO (createClackIO) — which is already injectable for tests.
 *
 * The loop is factored against a small SessionIO surface so automated tests can
 * script inputs and capture outputs without a real TTY.
 */

export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** G-13-P1：`/permission` 的唯一合法取值（顺序即用法提示的展示顺序）。 */
const PERMISSION_MODES: readonly PermissionMode[] = ['read-only', 'workspace-write', 'danger-full-access'];

/**
 * G-13-P1：取值校验。只有字面量命中上表才算「切换成功」——非法值只回用法，
 * 绝不返回 permission 字段（否则就是「文案说切了、实际没切」的假成功）。
 */
function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export interface ChatSessionIO {
  /** read one line of user input; null = EOF (ctrl-d / quit) */
  readLine(prompt: string): Promise<string | null>;
  /** write a normal output line (model reply, status, logs) */
  write(line: string): void;
  /** read a batch of canned inputs ahead of time (tests) */
  hasMore?(): boolean;
}

/**
 * Reader over one readline.Interface that supports arbitrarily many sequential
 * readLine() calls on the SAME interface.
 *
 * Why a dedicated reader instead of `for await (const line of rl)`? Breaking
 * out of that loop invokes the async iterator's return(), which Node wires to
 * rl.close() — the interface is closed after the very first line, so a second
 * readLine() would report EOF and the TUI would exit after one round. Instead
 * we attach ONE 'line' listener up front and resolve pending reads FIFO.
 */
export interface LineReader {
  /** Resolve with the next input line; null once the reader is ended. */
  readLine(): Promise<string | null>;
  /** End the reader: pending reads resolve null, later reads return null. */
  close(): void;
}

export function makeLineReader(rl: readline.Interface): LineReader {
  const waiters: Array<(line: string | null) => void> = [];
  const buffered: string[] = [];
  let closed = false;

  function end(): void {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
    // buffered lines already read off the stream stay readable (drain-then-EOF)
  }

  rl.on('line', (line: string) => {
    if (closed) return;
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else buffered.push(line);
  });
  // EOF / Ctrl+D / interface close / stream error → end the reader.
  rl.on('close', end);
  rl.on('error', end);

  return {
    readLine(): Promise<string | null> {
      const line = buffered.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (closed) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => waiters.push(resolve));
    },
    close: end,
  };
}

/**
 * Two-stage Ctrl+C policy (task 050, roadmap §7.3): the FIRST Ctrl+C while a
 * turn is active interrupts that turn; the SECOND Ctrl+C (or any Ctrl+C with
 * no active turn) exits the TUI. Pure decision logic — tests drive it without
 * a real terminal or signal; only createStdioIO's SIGINT handler calls press().
 */
export class TwoStageCtrlC {
  private stage: 'none' | 'interrupted' = 'none';

  constructor(
    private readonly deps: {
      /** true while a turn is running (its runTurn promise is in flight) */
      hasActiveTurn: () => boolean;
      /** interrupt the active turn (AgentLoop.interrupt / controller seam) */
      interruptTurn: () => void;
    },
  ) {}

  /** Route one Ctrl+C press. Returns 'stay' (keep running) or 'exit' (quit). */
  press(): 'stay' | 'exit' {
    if (!this.deps.hasActiveTurn()) {
      // idle at the prompt → first press exits (like the pre-050 behavior)
      this.stage = 'none';
      return 'exit';
    }
    if (this.stage === 'interrupted') return 'exit'; // second press → exit
    this.stage = 'interrupted';
    this.deps.interruptTurn();
    return 'stay';
  }

  /** Clear the latch when a NEW turn begins (first press interrupts it again). */
  reset(): void {
    this.stage = 'none';
  }
}

/** stdio implementation (real stdin/stdout; Ctrl+C → two-stage / graceful EOF). */
export function createStdioIO(ctrlC?: TwoStageCtrlC): ChatSessionIO {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const reader = makeLineReader(rl);

  // Ctrl+C: idle → exit (EOF). With an active turn (two-stage, task 050) the
  // FIRST press interrupts it ('stay'), the SECOND press exits. A terminal-mode
  // interface emits its own 'SIGINT'; with terminal:false the process signal
  // fires — wire both, only one ever triggers (same guard as before 050).
  const onSigint = () => {
    process.stdout.write('\n'); // move off the half-typed prompt line
    if (ctrlC && ctrlC.press() === 'stay') {
      process.stdout.write('^C 已请求中断当前 turn（再次 Ctrl+C 退出）\n');
      return;
    }
    reader.close();
    rl.close();
  };
  process.on('SIGINT', onSigint);
  rl.on('SIGINT', onSigint);

  return {
    readLine(prompt: string) {
      process.stdout.write(prompt);
      return reader.readLine();
    },
    write(line: string) {
      console.log(line);
    },
  };
}

export interface ChatOptions {
  workspaceRoot: string;
  provider?: ChatProvider;
  model?: string;
  policySystemPath: string;
  behaviorIRPath: string;
  permission?: PermissionMode;
  store?: ProviderStore;
  /** 会话内成本显示（G-09）：注入后每回合打印增量并启用 `/cost`；缺省则全部静默关闭。 */
  usageStore?: UsageStore;
  /**
   * 凭据后端（task 106）：**仅在 `store` 缺省时生效**——用于给 TUI 默认 ProviderStore
   * 接上 CredentialStore（测试注入内存后端，不碰真实 secrets.json）。
   */
  credentialStore?: SyncCredentialStore;
  /** G-10：复用既有会话 id（resume 或重建 harness 时保持一致）；缺省则新建会话。 */
  sessionId?: string;
  /**
   * G-13-P2：设置根覆盖（测试注入 tmp；缺省走 resolveSettingsRoot()：
   * `VESSEL_SETTINGS_ROOT` > `VESSEL_USAGE_ROOT` > `~/.vessel`）。
   * 只影响解释类命令的 locale 解析，不影响其它任何行为。
   */
  settingsRoot?: string;
  io?: ChatSessionIO;
}

/**
 * TUI 的 ProviderStore 解析（task 106，导出供测试断言隔离与凭据接线）。
 *
 * `store` 显式传入 → 原样使用（调用方负责凭据后端）；否则走 `createDefaultProviderStore()`：
 * 状态根 = `VESSEL_PROVIDER_ROOT` / `~/.vessel`，并**接上 CredentialStore** —— 这是 106 的
 * 修复点：修前是 `new ProviderStore()`，`secretRef` 解析不出 apiKey → 401 `Missing API key`。
 */
export function resolveChatStore(
  opts: { store?: ProviderStore; credentialStore?: SyncCredentialStore } = {},
): ProviderStore {
  if (opts.store) return opts.store;
  return createDefaultProviderStore(
    opts.credentialStore ? { credentialStore: opts.credentialStore } : {},
  );
}

/**
 * G-13-P2：TUI 的生效 locale（`/explain` 与 `? <术语>` 共用，**每会话解析一次**）。
 *
 * 优先级与 `vessel explain`（guideCommands.ts `cmdExplain`）逐字一致：settings.locale > 'zh'
 * —— TUI 内没有 `--locale` 这种显式开关，所以只有 settings 一层。读取 settings 的**任何**失败
 * （文件损坏 / locale 非法值 / IO 异常）一律回落 'zh'：解释类命令绝不能因为设置读不出来就失败；
 * settings.json 缺失时 SettingsStore.load() 本身返回默认值 'zh'，行为与改前逐字一致。
 */
export function resolveChatLocale(settingsRoot?: string): GuideLocale {
  try {
    return new SettingsStore({ rootDir: settingsRoot ?? undefined }).load().locale;
  } catch {
    return 'zh';
  }
}

/**
 * 复评未闭合项 2：window shim 判定的 TUI 侧复用。**必须与 `cli.ts` 的 `windowsShimHint()`
 * （`apps/cli/src/cli.ts:243-250`）逐字一致**：win32 + `.cmd`/`.bat` 后缀 + 不在包管理器白名单
 * → 该命令注定 spawn 失败（CVE-2024-27980 之后 Node 对 .cmd/.bat 直接 EINVAL），所以**不 spawn**，
 * 改走「未启动（已跳过）」通道并给出可操作原因，而不是把含糊的 ENOENT/EINVAL 丢给用户。
 *
 * 为什么内联而不是 `import { windowsShimHint } from '../cli.js'`：`cli.ts:32` 已经
 * `import { runChat } from './tui/chat.js'` —— chat.ts 反向 import cli.ts 会**成环**
 * （ESM 下表现为 TDZ/undefined，属于会踩雷的隐式耦合），故按同一份逻辑内联。
 * 与 `resolveSpawnCommand`（packages/tools/src/mcp/McpClient.ts:55-64）的白名单同样逐字对齐：
 * 白名单命令（自身不带后缀）由那边开 shell，命不中这里。
 *
 * @returns 直接可读的原因文案；`null` = 该命令可照常直连 spawn。
 */
function windowsShimHint(command: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return null;
  const cmd = command.trim().toLowerCase();
  if (!cmd.endsWith('.cmd') && !cmd.endsWith('.bat')) return null;
  // 与 cli.ts 同一份白名单判定（含「用原始 command 比对」这一细节，保持两处行为一致）。
  if (new Set(['npx', 'npm', 'pnpm', 'yarn', 'uvx']).has(command)) return null;
  return `命令 "${command}" 在 Windows 上需要 shell 才能执行（.cmd/.bat shim）；请改用白名单命令（npx/npm/pnpm/yarn/uvx）或把命令指向 .exe / 绝对路径`;
}

/**
 * G-11 MCP 半（BRIEF-13）：每次构建 harness 前读一次 `~/.vessel/mcp.json` 并构造连接
 * （单个 server 失败降级、逐个 warn）。
 *
 * 与 CLI 一次性路径（`cli.ts` 的 `applyMcpConnections`）**故意不同**：这里配置本身坏了
 * 只 `console.warn` 并返回 `undefined`，**绝不拒绝启动** —— TUI 已进入交互会话，用户
 * 可以就地改配置（或直接 /quit 重开）；把"配置写错"升级成"TUI 起不来"是把用户锁在门外。
 *
 * 每次重建都新建连接是**安全**的：`harness.close()` 会 close 掉 `mcpClients`
 * （`packages/application/src/compose.ts:385-392` → `McpClient.close()`
 * → `McpTransport.close()`），而 `applyPendingChanges()` 是**先 `await previous.close()`
 * 再 `buildHarness()`**，旧连接先释放、新连接后建立，不存在累积。
 * 反过来**不能**做模块级缓存：transport 是一次性的，缓存会把已 `close()` 的 transport
 * 交给新 harness（`StdioTransport.request` 此后恒 reject `MCP transport closed`）。
 */
function loadMcpConnections(): ComposeMcpConnection[] | undefined {
  try {
    const servers = new McpConfigStore().load();
    if (servers.length === 0) return undefined;
    // 复评未闭合项 2：与 cli.ts 的 `applyMcpConnections` 同序 —— 先按 win32 shim 判定分流
    // （命中的**不 spawn**，直接进「未启动（已跳过）」通道并带上可操作原因），再建连接。
    // 改前 TUI 直接把声明丢给 createMcpConnections，`.cmd` 只得到含糊的 ENOENT/EINVAL。
    const spawnable: typeof servers = [];
    const shimFailures: { serverName: string; reason: string }[] = [];
    for (const s of servers) {
      const hint = windowsShimHint(s.command);
      if (hint === null) spawnable.push(s);
      else shimFailures.push({ serverName: s.name, reason: hint });
    }
    const { connections, failures } = createMcpConnections(spawnable);
    for (const f of [...shimFailures, ...failures]) {
      console.warn(`[vessel] MCP server "${f.serverName}" 未启动（已跳过）：${f.reason}`);
    }
    return connections.length > 0 ? connections : undefined;
  } catch (err) {
    console.warn(`[vessel] MCP 配置错误（已忽略）：${(err as Error).message}`);
    return undefined; // TUI 里不因 MCP 配置坏掉而拒绝启动
  }
}

export interface SlashResult {
  /** text to print after the command */
  output?: string;
  /** true → exit the TUI */
  quit?: boolean;
  /** 待应用的会话级变更（G-13-P1）：主循环负责真正生效，而不是只打印。 */
  permission?: PermissionMode;
  model?: string;
}

/**
 * Run the interactive chat session. Returns the exit code.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  // task 106：默认 store 必须接 CredentialStore（否则 secretRef → apiKey 解析失败 → 401）。
  const store = resolveChatStore(opts);

  // real-stdio mode wires two-stage Ctrl+C (task 050): the first press
  // interrupts the active turn, the second press (or a press with no active
  // turn) exits. Scripted IO (tests) never registers signals.
  let activeTurnInterrupt: (() => void) | null = null;
  const ctrlC = opts.io
    ? null
    : new TwoStageCtrlC({
        hasActiveTurn: () => activeTurnInterrupt !== null,
        interruptTurn: () => {
          if (activeTurnInterrupt) activeTurnInterrupt();
        },
      });
  const io = opts.io ?? createStdioIO(ctrlC ?? undefined);

  // current provider resolution (like cmdRun): explicit > current default > mock
  const currentId = store.getCurrent();
  const currentCfg: ProviderConfig | undefined = currentId === 'mock' ? undefined : store.get(currentId);
  let provider = opts.provider;
  let model = opts.model ?? currentCfg?.model ?? 'mock-model';
  let permission: PermissionMode = opts.permission ?? 'workspace-write';
  let providerId = currentCfg?.id ?? 'mock';
  let harness: ComposedHarness | null = null;
  /**
   * BRIEF-12：`/permission`、`/model` 的会话级变更**先挂起**，等下一次真正需要 harness 时
   * 再连同重建一起应用。**绝不预先置空 `harness`** —— 预置空会把「重建失败」退化成
   * 「新设置没生效、旧会话也没了」：用户既没切成功，又丢掉了可用会话。
   */
  let pendingPermission: PermissionMode | undefined;
  let pendingModel: string | undefined;
  /**
   * G-13-P1：最近一次 buildHarness 建出的会话 id。`/permission`、`/model` 之后要回写
   * 会话登记表（保留 createdAt），而登记表只认 id —— 所以必须在构建时把它记到外层。
   */
  let currentSessionId: string | undefined;
  let sessionWorkspace = opts.workspaceRoot;
  // task 103: opencode-go 的会话 id 在**一个 TUI 会话**内稳定（换模型 / 重建 harness 不换），
  // 与 102 lane 的「一次 lane 会话一个 UUID」语义对齐。
  const opencodeGoSessionId = randomUUID();

  const buildHarness = async (): Promise<ComposedHarness> => {
    const cfg = providerId === 'mock' ? undefined : store.get(providerId);
    let effProvider = provider;
    let effModel = model;
    if (cfg && cfg.protocol !== 'mock') {
      // task 103: CLI/TUI 共用 providerFactory —— preset id `opencode-go` 自动解析为专用
      // provider（x-opencode-session + 具名 UA），与 benchmark lane 是同一份实现。
      // G-13-P1：把会话内的 `model` 作为覆盖项传进去 —— 否则 `/model <id>` 只改了状态行，
      // 真实 provider 仍按配置里的旧模型发请求（又是一条「文案说切了但没生效」的路径）。
      const plan = planProvider({ config: cfg, model });
      effProvider = buildRealProvider(plan, { sessionId: opencodeGoSessionId }) ?? undefined;
      effModel = plan.model;
    }
    if (!effProvider) {
      const smoke = [
        { when: /阅读|read|总结|summary/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/README.md' } }] } },
        {
          when: /.*/,
          minToolResults: 1,
          whenToolResult: /^\[(TOOL_FAILURE|DENIED|INVALID_ARGS|TIMEOUT|SANDBOX_DENIAL)\]/,
          response: { text: '（mock）未能读取工作区 README.md——文件可能不存在或被拒。请确认工作区包含 README.md；要获得真实回答请配置模型：vessel setup。' },
        },
        { when: /.*/, minToolResults: 1, response: { text: '（mock）读取结果：\n{last_tool_result}' } },
      ];
      effProvider = new MockProvider(smoke, {
        model: effModel,
        vars: { cwd: sessionWorkspace },
        fallbackText: '（mock 离线冒烟）已收到你的输入。当前无匹配脚本应答——配置真实模型后即可获得完整回答：vessel setup（交互向导）或 vessel provider add。',
      });
    }
    // G-11 MCP 半：读 mcp.json → 构造连接（配置坏了只 warn、不拒绝启动，见 loadMcpConnections）。
    const mcpConnections = loadMcpConnections();
    let harness: ComposedHarness;
    try {
      harness = await composeHarness({
        workspaceRoot: sessionWorkspace,
        provider: effProvider,
        model: effModel,
        policySystemPath: opts.policySystemPath,
        behaviorIRPath: opts.behaviorIRPath,
        permission,
        // G-09 接线修复：只有把 usageStore 交给 composeHarness，after_model 才会记账；
        // 缺了它每回合恒为 $0.0000（无用量记录）、/cost 恒为「本会话暂无用量记录」。
        usageStore: opts.usageStore,
        usageProvider: providerId,
        // G-10：复用既有会话 id（resume 或重建 harness 时保持一致）；缺省则新建。
        // BRIEF-13：会话内重建（/permission、/model 生效）必须沿用**本 TUI 会话已经建出的** id。
        // 否则每次重建都会另开一个 session 目录：登记表里凭空多出一条「孤儿会话」（旧权限一条、
        // 新权限一条），`vessel sessions list` 也会看到幽灵条目，而 syncSessionMeta 只回写新那条。
        sessionId: currentSessionId ?? opts.sessionId,
        mcp: mcpConnections,
      });
    } catch (err) {
      // 本次建出的连接不会被任何 harness 持有（compose 抛错时连返回值都没有），就地回收。
      // 成功那份由 harness.close() 负责（compose.ts:365-367），这里只补**失败**路径：
      // 否则 /permission、/model 反复触发失败重建时会一茬茬攒下孤儿子进程。
      for (const conn of mcpConnections ?? []) {
        try {
          await conn.transport.close();
        } catch {
          /* 回收失败不掩盖原始错误 */
        }
      }
      throw err;
    }
    // G-13-P1：把会话 id 记到外层，供 /permission、/model 之后回写登记表（拿不到 id 就没法 put）。
    currentSessionId = harness.session.sessionId;

    // G-10：让 TUI 建的会话也进入会话登记表，否则 `vessel sessions list` 看不到它、无法 resume。
    try {
      const registry = new SessionRegistry();
      const now = new Date().toISOString();
      const existing = registry.get(harness.session.sessionId);
      const meta: SessionMeta = {
        id: harness.session.sessionId,
        workspaceRoot: sessionWorkspace,
        provider: providerId,
        model: effModel,
        permission,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      registry.put(meta);
    } catch (err) {
      console.warn(`[vessel] 会话登记失败（不影响本次会话）：${(err as Error).message}`);
    }

    return harness;
  };

  /**
   * G-13-P1：把会话级变更（permission / model）同步进会话登记表。
   *
   * 只在「harness 已经建过」时有意义：此时登记表里已有本会话的 meta，用 get → put
   * 保留原 `createdAt`、刷新 `updatedAt`。拿不到 id（harness 尚未懒建）就直接返回 ——
   * 下一次 buildHarness 会用新值登记，无需凭空补写。任何失败都只 warn，绝不阻断会话。
   */
  const syncSessionMeta = (): void => {
    if (!currentSessionId) return;
    try {
      const registry = new SessionRegistry();
      const prev = registry.get(currentSessionId);
      if (!prev) return; // 没有既有登记项（例如登记当时就失败了）→ 不伪造一条
      const meta: SessionMeta = {
        ...prev,
        provider: providerId,
        model,
        permission,
        createdAt: prev.createdAt, // 保留原创建时间
        updatedAt: new Date().toISOString(),
      };
      registry.put(meta);
    } catch (err) {
      console.warn(`[vessel] 会话登记更新失败（不影响本次会话）：${(err as Error).message}`);
    }
  };

  /**
   * BRIEF-13：把挂起的会话级变更（permission / model）连同重建一起就地应用。
   *
   * 两个调用点共用**同一套**语义，避免「两条路径各写一遍、早晚跑偏」：
   *  - slash 命令确认后 harness **已存在** → 立即应用：重建 harness + 回写登记表，使
   *    文案 / 状态行 / 会话登记表三者立刻一致（改前只挂起到下一回合：用户切完直接 /quit
   *    这条变更就永不落地，而文案已经宣称切好了）；
   *  - harness **尚未懒建** → 保持挂起，交给首次构建自然带上新值（没有旧会话可重建）。
   *
   * 一致性契约：只有 `buildHarness()` 成功才替换 harness 并落盘；失败一律回滚 permission/model、
   * 保留原 harness 对象，TUI 继续可用 —— 既不退出，也不留「宣称切了却没生效」的状态。
   * 任何情况下都会清掉挂起项：否则每一回合都拿同一个坏配置重试，用户只能看到刷屏的同一个错误。
   */
  const applyPendingChanges = async (): Promise<void> => {
    if (pendingPermission === undefined && pendingModel === undefined) return;
    const prevPermission = permission;
    const prevModel = model;
    const previous: ComposedHarness | null = harness; // 可能是 null（还没建过）：此时没有旧会话可保，等同首次懒建
    /**
     * 复评未闭合项 1：旧 harness 是否已在本次重建前**真正关闭**（`close()` 正常返回）。
     * 只有它为 true 时，`previous` 的 MCP transport 才必定已死（`compose.ts:385-392`
     * → `McpClient.close()` → `McpTransport.close()`），回滚时才需要摘掉 `mcp__*`。
     */
    let previousClosed = false;
    try {
      // 新值先落到外层变量：buildHarness 读的就是它们（policy profile、provider 的 model 覆盖）
      permission = pendingPermission ?? permission;
      model = pendingModel ?? model;
      // 重建会沿用同一个会话 id（见 buildHarness），而 Session 的单写者租约按**目录** fail-closed：
      // 旧 harness 不先 close 释放租约，新 harness 会以「目录已被本进程占用」失败。
      // 关闭只影响旧对象自己（fd + mcp 客户端 + 遥测订阅）；Session.append 对已关闭的句柄是
      // 惰性重开的，所以即便重建失败、回滚到 previous，会话下一步仍能继续追加。
      if (previous) {
        try {
          await previous.close();
          previousClosed = true; // 关闭完整跑完 → mcpClients 全部已 close，其工具已死（见上）
        } catch {
          /* 旧会话关闭失败不阻断重建：真取不到租约时 buildHarness 会给出明确错误 */
        }
      }
      harness = await buildHarness();
      pendingPermission = undefined;
      pendingModel = undefined;
      syncSessionMeta(); // 只有真切换成功才落盘（保留既有行为，且不写入未生效的值）
    } catch (err) {
      // 一致性：变量必须回滚到旧 harness 的构建参数，否则状态行会宣称一个没生效的值
      permission = prevPermission;
      model = prevModel;
      harness = previous;
      pendingPermission = undefined;
      pendingModel = undefined;
      /**
       * 复评未闭合项 1：回滚到 `previous` 时，若上面已经**真的**把它 close 掉了，那么它的
       * MCP transport 也已关闭，但 `mcp__*` 工具仍留在 `previous.registry` 里对模型可见 ——
       * 调用必 reject，正是「宣称可用、实际不可用」。这里按 `ToolRegistry.unregister(name)`
       * （packages/tools/src/registry/Registry.ts:49）把已死的 MCP 工具从 registry 摘掉，
       * 让可见集与真实可用集重新一致（loop 的 `getVisibleTools` 每步都读 registry，立即生效）。
       *
       * 只在 `previousClosed` 时摘：`close()` 抛错可能是 `session.close()` 先抛、MCP 其实
       * 还活着，误摘会把「可用工具」变成「不可见工具」—— 比不摘更糟。摘不掉时只提示，
       * 绝不静默假装可用。
       */
      const staleMcpTools =
        previousClosed && previous ? previous.registry.listAll().filter((t) => t.name.startsWith('mcp__')) : [];
      let droppedMcpTools = 0;
      for (const t of staleMcpTools) {
        try {
          if (previous!.registry.unregister(t.name)) droppedMcpTools += 1;
        } catch {
          /* 单个摘除失败不阻断回滚：下面按实际摘除数给出提示 */
        }
      }
      if (staleMcpTools.length > 0) {
        const note =
          droppedMcpTools === staleMcpTools.length
            ? '已从工具表移除'
            : `已移除 ${droppedMcpTools}/${staleMcpTools.length}，其余无法移除、调用必失败`;
        io.write(`[提示] 会话重建失败，MCP 工具在本会话内已不可用（${note}；配置修好后可 /quit 重启）`);
      }
      io.write(`[错误] 重建会话失败（已保留原设置：${providerId}/${prevModel} · ${prevPermission}）：${describeProviderError(err)}`);
    }
  };

  io.write(`${VESSEL_LOGO}Vessel — 交互会话开始（当前 ${providerId} · ${model} · ${permission}）。输入 /help 查看命令，/explain <术语> 或 ? <术语> 查术语解释，/quit 退出；命令行「vessel guide」有新手指引。`);

  // 会话内成本显示（G-09）：基线 = 进入循环前的累计值；未注入 usageStore 则全程静默。
  const usage = opts.usageStore;
  let usageBaseline: UsageTotalsLike | undefined;
  try {
    usageBaseline = usage ? usage.totals() : undefined;
  } catch {
    usageBaseline = undefined;
  }
  // 回合增量用「上一回合末」的基线；会话累计用「会话起始」基线（两者分开，避免重复计账）。
  const sessionBaseline = usageBaseline;

  // G-13-P2：解释类命令的输出语言 —— 进循环前按 settings 解析**一次**，/explain 与 ?
  // 共用同一个值，会话期间稳定（与 `vessel explain` 跟随 settings.locale 的口径一致）。
  const locale = resolveChatLocale(opts.settingsRoot);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await io.readLine(`\n${providerId}/${model} [${permission}]> `);
    if (line === null) break;
    const input = line.trim();
    if (input === '') continue;

    // slash command dispatch（`? <term>` 与 `/explain <term>` 同义，task 117 引导体系）
    if (input.startsWith('/') || input.startsWith('?')) {
      const res = await dispatchSlash(input, { store, io, sessionWorkspace: opts.workspaceRoot, usageStore: usage, usageBaseline: sessionBaseline, locale });
      if (res?.output) io.write(res.output);
      if (res?.quit) break;
      // G-13-P1：会话级变更必须真正生效，而不是只打印。
      // BRIEF-12：仍然**不在这里丢缓存**（不写 `permission = ...; harness = null`）——「先置空」
      // 一旦 `buildHarness()` 抛错就只剩「新旧都没有」。挂起项统一交给 applyPendingChanges：
      // 新值先落变量 → buildHarness → 失败回滚 + 保留旧 harness。
      // 挂起期间 `permission`/`model` 仍等于**在用 harness 的**构建参数，两者始终自洽，
      // 状态行不会宣称一个尚未生效的值。
      // 「切回当前值」要清掉挂起项，否则被撤销的变更会被后一回合补上。
      if (res?.permission) {
        pendingPermission = res.permission === permission ? undefined : res.permission;
      }
      if (res?.model) {
        pendingModel = res.model === model ? undefined : res.model;
      }
      // BRIEF-13：harness **已存在** → 立即应用（重建 + 回写登记表），使文案 / 状态行 /
      // 会话登记表立刻一致；否则用户切完直接 /quit 时这条变更永不落地，而文案已经宣称切好了。
      // harness 尚未懒建则继续挂起：首次构建自然带上新值，不为一条命令凭空建会话。
      if (harness && (pendingPermission !== undefined || pendingModel !== undefined)) {
        await applyPendingChanges();
      }
      continue;
    }

    // natural language → run the harness loop (lazy-build once)
    // BRIEF-12/BRIEF-13：挂起的会话级变更（slash 分支已就地把「harness 已存在」的那些应用掉，
    // 所以走到这里的一定是「harness 还没懒建」）连同重建一起应用。成功才替换 harness；
    // 失败则回滚 permission/model、保留旧 harness —— 会话继续可用，TUI 不退出。
    if (pendingPermission !== undefined || pendingModel !== undefined) {
      await applyPendingChanges();
    } else if (!harness) {
      // 首次懒建同样不能把异常冒泡出去：否则一个建不出来的 provider 会直接终止整个 TUI
      try {
        harness = await buildHarness();
        syncSessionMeta();
      } catch (err) {
        io.write(`[错误] 创建会话失败：${describeProviderError(err)}`);
      }
    }
    // 建不出来也要活着：回到提示符，用户可重试、可 /model 换配置、可 /quit（不再 TypeError 崩栈）
    if (!harness) continue;
    ctrlC?.reset(); // fresh turn → first Ctrl+C interrupts (not exits)
    activeTurnInterrupt = () => {
      harness!.loop.interrupt();
    };
    try {
      const result = await harness.loop.runTurn(input);
      if (result.kind === 'interrupted') io.write('\n^C turn 已中断（kind=interrupted）');
      else if (result.finalText) io.write(`\n${result.finalText}`);
      else io.write('(无文本回复)');
    } catch (err) {
      io.write(`[错误] ${describeProviderError(err)}`);
    } finally {
      activeTurnInterrupt = null;
    }

    // 每回合成本增量（G-09）：成功 / 中断 / 出错三种分支都在 finally 后执行一次。
    if (usage && usageBaseline) {
      try {
        const turnNow = usage.totals() as UsageTotalsLike;
        io.write(renderTurnDelta(turnNow, usageBaseline));
        usageBaseline = turnNow;
      } catch {
        io.write('· 本回合成本读取失败');
      }
    }
  }

  await harness?.close();
  return 0;
}

async function mockProvider(model: string) {
  return new MockProvider([{ when: /.*/, response: { text: '（mock 离线回复）' } }], { model });
}

/** Slash command table — reused by tests. */
export async function dispatchSlash(input: string, ctx: {
  store: ProviderStore;
  io: ChatSessionIO;
  sessionWorkspace: string;
  /** G-09：注入后启用 `/cost`；缺省时 `/cost` 返回未启用提示。 */
  usageStore?: UsageStore;
  usageBaseline?: UsageTotalsLike;
  /**
   * G-13-P2：解释类命令（`/explain`、`? <术语>`）的输出语言，由 `runChat` 按 settings
   * 解析后传入。**缺省 'zh'**：直接调 `dispatchSlash` 的既有调用方（测试）行为不变。
   */
  locale?: GuideLocale;
}): Promise<SlashResult> {
  // `? <term>` 前缀 = `/explain <term>`（task 117：TUI 内解释，复用同一词库，不重复实现）
  if (input.startsWith('?')) {
    const raw = input.slice(1).trim();
    if (raw === '') return { output: '用法: ? <术语>（如 ? Call）；或用 /explain <术语>' };
    const hit = findTerm(raw);
    return {
      output: hit
        ? renderExplain(hit, ctx.locale ?? 'zh')
        : `未收录术语 "${raw}"（vessel list-terms 查看全部词条）`,
    };
  }
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'cost':
    case 'usage': {
      const costStore = ctx.usageStore;
      if (!costStore) return { output: '成本显示未启用（本会话未注入 usage store）' };
      try {
        const now = costStore.totals();
        const lines = [renderCostLines(now, ctx.usageBaseline)];
        try {
          const day = localDateKey(new Date());
          const rows = costStore.daily({ since: day, until: day });
          const costUsd = rows.reduce((acc, r) => acc + r.costUsd, 0);
          const calls = rows.reduce((acc, r) => acc + r.calls, 0);
          lines.push(renderTodayLine({ costUsd, calls, inputTokens: 0, outputTokens: 0 }));
        } catch {
          /* 今日数据不可得 → 省略该行，不影响本会话/累计 */
        }
        return { output: lines.join('\n') };
      } catch (err) {
        return { output: `成本读取失败: ${(err as Error).message}` };
      }
    }
    case 'help':
      return {
        output: [
          '命令：',
          '  /provider        配置供应商（搜索选 → key → 拉模型 → 勾选）',
          '  /models          拉取当前供应商模型列表',
          '  /model <id>      切换模型（本会话后续回合生效）',
          '  /permission <mode>  切换权限模式（本会话后续回合生效：read-only / workspace-write / danger-full-access）',
          '  /setup           完整引导配置',
          '  /explain <术语>  查术语中英文解释（同 ? <术语>，如 /explain Call）',
          '  /cost            查看本会话成本与累计（同 /usage）',
          '  /help            本帮助',
          '  /quit            退出',
          '直接输入文字 = 对话跑任务',
        ].join('\n'),
      };
    case 'provider':
    case 'connect': {
      const setupIO = createClackIO(ctx.store);
      const id = await runSetupWizard({ store: ctx.store, io: setupIO });
      return { output: id ? `已配置供应商 "${id}"` : '已取消' };
    }
    case 'setup': {
      const setupIO = createClackIO(ctx.store);
      const id = await runSetupWizard({ store: ctx.store, io: setupIO });
      return { output: id ? `已配置供应商 "${id}"` : '已取消' };
    }
    case 'models': {
      const id = ctx.store.getCurrent();
      const cfg = ctx.store.get(id);
      if (!cfg || cfg.protocol === 'mock') return { output: '当前是 mock 或无配置供应商。先 /provider 配置。' };
      const outcome = await fetchModelOutcome(cfg.protocol, cfg.baseUrl ?? '', cfg.apiKey);
      if (!outcome.ok || outcome.models.length === 0) {
        const reason = outcome.ok ? '无模型' : outcome.message;
        return { output: `拉取失败（${reason}）。内置清单：\n${modelsForProtocol(cfg.protocol).models.map((m: string) => `  ${m}`).join('\n')}` };
      }
      return { output: `模型列表（${cfg.id}，${outcome.note}）：\n${outcome.models.map((m: string) => `  ${m}`).join('\n')}` };
    }
    case 'model': {
      if (!arg) return { output: '用法：/model <id>（如 /model deepseek-chat）' };
      // G-13-P1：不再有「只打印不生效」的路径——返回 model 字段即由主循环落在会话状态上。
      // 说明：本命令**不校验** id 是否在可用清单内。清单只有 /models（一次真实网络拉取）或
      // modelsForProtocol 的内置表可得，前者会让一次廉价切换发起网络请求、后者对用户自定义
      // 端点/自建模型不成立；拼错 id 会在下一回合由 provider 报错（可读、可恢复），
      // 因此这里保持不校验，而不是引入一次可能误判的昂贵校验。
      return { output: `已切换模型为 ${arg}（本会话后续回合生效）`, model: arg };
    }
    case 'permission': {
      if (!arg) return { output: '用法：/permission <read-only|workspace-write|danger-full-access>' };
      // 先校验取值：非法值**不返回** permission 字段 → 主循环不会应用任何变更，
      // 也就不会出现「文案说切了、实际还是旧权限」的假成功。
      if (!isPermissionMode(arg)) {
        return { output: '用法：/permission <read-only|workspace-write|danger-full-access>' };
      }
      return { output: `已切换权限为 ${arg}（本会话后续回合生效）`, permission: arg };
    }
    case 'explain':
    case 'term': {
      if (!arg) return { output: '用法：/explain <术语>（如 /explain Call）；或用 ? <术语>' };
      const hit = findTerm(arg);
      return { output: hit ? renderExplain(hit, ctx.locale ?? 'zh') : `未收录术语 "${arg}"（vessel list-terms 查看全部词条）` };
    }
    case 'quit':
    case 'exit':
      return { quit: true };
    default:
      return { output: `未知命令 /${cmd}（/help 查看）` };
  }
}
