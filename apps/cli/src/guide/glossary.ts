/**
 * apps/cli/src/guide/glossary.ts — 术语中英双语词库（task 117，交互引导体系）。
 *
 * CLI 侧（`vessel explain` / `vessel list-terms`）与 TUI 侧（`/explain` / `? <term>`）
 * **共用本模块**：词库只有一份实现，TUI 不做重复实现。
 *
 * 词条 = { term, name, aliases?, zh, en, usage }：
 *   - term    主词条键（小写归一；查找命中用）
 *   - name    展示名（原始大小写）
 *   - aliases 别名（昵称/中文叫法/英文缩写，查找同样命中）
 *   - zh      中文解释
 *   - en      英文术语/解释
 *   - usage   一句话用途（双语友好）
 *
 * 文案为本项目自有表述（clean-room：不复制任何第三方引导稿）。
 */

export interface GlossaryEntry {
  /** 主词条键（小写、无空格；查找命中用） */
  term: string;
  /** 展示名（如 小小蜜 / Call） */
  name: string;
  /** 别名（查找命中用：昵称、中文叫法、英文缩写） */
  aliases?: string[];
  /** 中文解释 */
  zh: string;
  /** 英文术语/解释 */
  en: string;
  /** 一句话用途（双语友好） */
  usage: string;
}

/**
 * 内建词库（≥12 条）。覆盖：小小蜜/小助手、Call、Collect、Agent、Harness、
 * Policy、Prompt、Lane、Bench、theme、locale、token 等核心术语。
 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: '小小蜜',
    name: '小小蜜',
    aliases: ['小蜜', 'vessel', '小助手', 'xiaoxiaomi'],
    zh: '本项目 CLI/小助手的昵称：一个跑在本地、可组合、可验证、可替换行为层的 Agent Harness 助手。你把任务用自然语言告诉它，它按需调用工具一步步完成，供应商、用量、会话等状态都落在本机 ~/.vessel。',
    en: 'Xiaoxiaomi — the nickname of this project\u2019s CLI assistant (the Vessel CLI).',
    usage: '用途：用来称呼这个 CLI/助手本身——问【小小蜜是什么】就能得到这段解释。\nUsage: the handle for this CLI assistant itself; asking "what is Xiaoxiaomi" returns this entry.',
  },
  {
    term: 'call',
    name: 'Call',
    aliases: ['调用', '工具调用', 'tool call'],
    zh: '一次工具调用：Harness 判断该调用某个工具（Read/Grep/Write 等）时，执行并把结果喂回模型的一轮交互。',
    en: 'Call — one tool invocation inside an agent loop.',
    usage: '用途：理解 Agent 如何「动手」——每跑一个工具就是一次 call。\nUsage: how an agent takes action — each tool invocation is a call.',
  },
  {
    term: 'collect',
    name: 'Collect',
    aliases: ['收集', '聚合', 'gathering'],
    zh: '收集/聚合：把多次调用或多份结果收集起来再汇总成最终答案（例如先读多个文件、再做总结）。',
    en: 'Collect — gathering multiple results before synthesizing the final answer.',
    usage: '用途：解释多步任务里「先收集、再汇总」的组合方式。\nUsage: describes gathering multiple results before synthesizing the final answer.',
  },
  {
    term: 'agent',
    name: 'Agent',
    aliases: ['智能体', '代理'],
    zh: '智能体：由模型 + 行为（Behavior IR）+ 工具 + 策略（Policy）组合出的执行单元，会自主规划并调用工具完成任务。',
    en: 'Agent — a unit that plans and calls tools to complete a task.',
    usage: '用途：本框架里 Agent 是「会干活」的基本单位。\nUsage: in this harness, the Agent is the basic unit that performs work.',
  },
  {
    term: 'harness',
    name: 'Harness',
    aliases: ['框架', '器', 'vessel 框架'],
    zh: 'Harness（框架/器）：承载模型、行为、工具、策略等组件并让它们可靠协作运行的宿主系统——本项目的定位：系统本身不是任何一个组件。',
    en: 'Harness — the host framework that carries and orchestrates model, behavior, tools and policy.',
    usage: '用途：区分「模型本身」与「组织它们的环境」。\nUsage: distinguishes the model from the surrounding runtime that orchestrates it.',
  },
  {
    term: 'policy',
    name: 'Policy',
    aliases: ['策略', '安全策略'],
    zh: '策略：对行为的硬约束，由 Policy Engine 执法（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event），如权限档位、工具拦截、危险操作拒绝——不只写在 prompt 里。',
    en: 'Policy — hard constraints enforced by the Policy Engine, not just prompts.',
    usage: '用途：理解「谁能做什么」由策略硬性把关。\nUsage: hard-guards what a run is allowed to do.',
  },
  {
    term: 'prompt',
    name: 'Prompt',
    aliases: ['提示词', '提示'],
    zh: '提示词：给模型的指令文本（系统提示 + 用户输入）。本项目里行为定义（Behavior IR）经编译器编进稳定系统提示，prompt 与运行时分离。',
    en: 'Prompt — the instruction text steering the model (system + user).',
    usage: '用途：解释「模型为什么知道怎么干」的输入来源。\nUsage: the instruction text that steers the model.',
  },
  {
    term: 'lane',
    name: 'Lane',
    aliases: ['场景车道', '车道', 'scenario lane'],
    zh: '场景车道：基准评测里一个独立场景的执行通道——一次 lane 会话一个 UUID，隔离跑一组带判据的场景，互不干扰。',
    en: 'Lane — an isolated per-scenario execution channel in benchmarks.',
    usage: '用途：基准评测里隔离不同场景的执行环境。\nUsage: isolates per-scenario execution in benchmarks.',
  },
  {
    term: 'bench',
    name: 'Bench',
    aliases: ['基准', '基准测试', 'benchmark'],
    zh: '基准：一组带确定性判据的场景（benchmarks/scenarios，判据唯一事实源是 yaml），用来验证 Harness 行为不回归。',
    en: 'Bench — a set of benchmark scenarios with deterministic criteria.',
    usage: '用途：用可重复的判据给项目「打分」。\nUsage: gives the project repeatable, verifiable checks.',
  },
  {
    term: 'theme',
    name: 'theme',
    aliases: ['主题', '配色'],
    zh: '主题：界面/输出配色偏好设置（dark 深色 / light 浅色）。用 `vessel settings set theme <dark|light>` 保存该偏好；当前版本仅保存、不影响任何输出/渲染；`vessel settings list` 查看说明与当前值。',
    en: 'Theme — the UI/display color-scheme preference (dark | light), stored via `vessel settings set theme <dark|light>`. This version only saves the preference and does not affect any output or rendering.',
    usage: '用途：预留的界面配色偏好（当前仅保存、不生效）。\nUsage: a reserved UI color-scheme preference (stored only in this version; no effect yet).',
  },
  {
    term: 'locale',
    name: 'locale',
    aliases: ['语言', '中英文', '语言设置'],
    zh: '语言设置（中英文）：guide/解释等引导文案的输出语言，zh = 中文，en = English。用 `vessel settings set locale <zh|en>` 切换。',
    en: 'Locale — the output language of guide/explain content (zh | en).',
    usage: '用途：控制引导内容的展示语言。\nUsage: controls the language of guide and explain output.',
  },
  {
    term: 'token',
    name: 'token',
    aliases: ['令牌', '词元'],
    zh: '令牌/词元：模型输入输出的最小计量单位——用量与成本按 token 计算（usage 统计里的 input/output tokens）；在供应商语境里也指 API 凭据令牌。',
    en: 'Token — the metering unit of model input/output, also an API credential token.',
    usage: '用途：解释用量统计里的 input/output tokens 与成本的关系。\nUsage: the unit usage and cost are metered by.',
  },
  {
    term: 'permission',
    name: 'Permission',
    aliases: ['权限', '权限模式'],
    zh: '权限模式：read-only / workspace-write / danger-full-access 三档，决定工具放行范围；高危操作 fail-closed 拒绝。',
    en: 'Permission — one of read-only | workspace-write | danger-full-access.',
    usage: '用途：理解「这次任务能碰哪些东西」。\nUsage: defines what a run is allowed to touch.',
  },
  {
    term: 'model',
    name: 'Model',
    aliases: ['模型', 'llm'],
    zh: '模型：处理对话的 LLM（DeepSeek/Qwen/Claude/OpenAI/本地 Ollama 等），经供应商协议接入，可随时替换。',
    en: 'Model — the LLM doing the thinking (provider-interchangeable).',
    usage: '用途：区分「哪个大脑在干活」。\nUsage: which LLM is doing the thinking.',
  },
];

/** 归一化查询：去空白 + 小写（中文不受影响）。 */
export function normalizeTerm(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * 查词库：命中 term 或任一别名（大小写不敏感、忽略首尾空白）→ 词条；否则 undefined。
 */
export function findTerm(query: string): GlossaryEntry | undefined {
  const q = normalizeTerm(query);
  if (q === '') return undefined;
  return GLOSSARY.find(
    (e) => normalizeTerm(e.term) === q || (e.aliases ?? []).some((a) => normalizeTerm(a) === q),
  );
}

/** 全部词条（同一份 GLOSSARY；test/命令共用）。 */
export function listTerms(): readonly GlossaryEntry[] {
  return GLOSSARY;
}

/**
 * 渲染单条解释（中文解释 + 英文术语 + 一句话用途，双语友好）。
 * locale: 'zh'（默认，中文解释在前）/ 'en'（英文解释在前）——条目内容本身始终双语。
 */
export function renderExplain(entry: GlossaryEntry, locale: 'zh' | 'en' = 'zh'): string {
  const aliasLine =
    entry.aliases && entry.aliases.length > 0 ? `\n别名 (aliases): ${entry.aliases.join('、')}` : '';
  if (locale === 'en') {
    return [
      `=== Glossary: ${entry.name} ===`,
      `English: ${entry.en}`,
      `中文解释: ${entry.zh}`,
      `用途/Usage: ${entry.usage}`,
      aliasLine,
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
  return [
    `=== 术语解释: ${entry.name} ===`,
    `中文解释: ${entry.zh}`,
    `英文术语 (English): ${entry.en}`,
    `一句话用途: ${entry.usage}`,
    aliasLine,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** 渲染词库清单（每行 = 主词条 + 英文术语 + 别名）。 */
export function renderTermsList(entries: readonly GlossaryEntry[]): string {
  const lines = entries.map((e) => {
    const alias = e.aliases && e.aliases.length > 0 ? `（${e.aliases.join('、')}）` : '';
    return `  ${e.name.padEnd(12)} ${e.en.padEnd(28)} ${e.zh.slice(0, 30)}${alias}`;
  });
  return [`=== 术语词库（${entries.length} 条）===`, ...lines, `查单个: vessel explain <term>`].join('\n');
}