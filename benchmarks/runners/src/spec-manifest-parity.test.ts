import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { describe, it, expect, afterAll } from 'vitest';
import { loadManifest } from './manifest.js';
import type { ScenarioManifest } from './types.js';

/**
 * **文档 ⇄ yaml 守卫**：`docs/BENCHMARK-SPEC.md` §3.1/§3.2 的场景卡与 §3.3 覆盖矩阵，
 * **逐字段**对齐 `benchmarks/scenarios/<id>.yaml`。
 *
 * 病灶（BRIEF 实测）：spec 的卡片长期与 yaml **各说各话** —— B016/B017/B019 三张卡整个
 * 描述的是**另外的场景**（`goal`/`pass`/`measured`/`mode` 四项全不符，例：B019 卡写
 * "Prompt Injection 抵抗 / `file_absent`+`no_tool_family` / live"，而 `B019.yaml` 是
 * "MCP 工具动态注册 / `file_content`+`event_seen`+`tool_family_seen` / offline"）；
 * B003/B004 的卡多列/少列了判据原语；§3.3 覆盖矩阵把 B006–B015 这些**没有 manifest**的
 * 场景、"行为纪律面"这些**没有任何场景**的能力面写成"已覆盖"，并把 B016–B019 的 `M14`
 * 写成主指标（四张卡的 yaml 里都没有 M14）。AGENTS.md 明文：**`benchmarks/scenarios/`
 * 是判据唯一事实源** ⇒ 分叉时必须改**文档**，不得改 yaml 去迁就文档。
 *
 * 本文件把这件事变成可执行断言：**期望值全部来自 `loadManifest()`（yaml 是权威）**，
 * 读的是 spec 的文件文本 —— 不存在"同一个常量既生成文档又生成期望"（纪律 23）。
 *
 * **豁免机制（未实现场景不许删卡）**：`benchmarks/scenarios/<id>.yaml` 不存在的卡片，
 * 必须在它自己的 ```yaml 块内**逐字**写出 `未实现（无 manifest）`（这就是"说明原因"）；
 * 反过来，yaml 已存在的卡片**不得**带这个标记（豁免过期即红）。标记不是免检章：
 * 它把"这个场景没有判据"变成一条可断言的事实。
 *
 * 「删哪行会红」：
 *   - 把任一张**已改准**的卡改回旧内容，或改它的 `goal`/`type`/`fixture`/`pass` 类型集合/
 *     `measured`/`mode` 中任意一项（例：B019 卡改回 `mode: live`；B003 卡把 `git_diff_scope`
 *     加回去）⇒ ② 红；
 *   - 删掉 B006–B015 任一卡的 `# ⚠️ 未实现（无 manifest）` 注释（或给它们补 yaml 却不撤标记）
 *     ⇒ ③ 红；
 *   - §3.3：删掉任一 `（未实现）`、把 `B099` 写进场景列、把 `M12` 加进 B005 那一行的括号外、
 *     或把 B016–B019 那行的 `M14` 移出括号 ⇒ ⑤ 红；
 *   - 负对照：以上都不做 ⇒ 全绿（本文件只读文件文本 + `loadManifest`，无共享常量参与期望）。
 *
 * **本轮扩展（§3.0 的两张表 + 附录 A）**：本文件同时守卫
 *   - §3.0 **表 A**（manifest 接受的键）⇄ `manifest.ts` 的 `KNOWN_KEYS`（双向）；表 A 的「必填」列不靠常量，
 *     而是**真的调 `loadManifest()`** 探针（去掉该键 ⇒ 是否抛错）；§3.0 **表 B**（规格意图字段）的每个键
 *     写进 yaml 都必须被以 `unknown key` 拒绝；
 *   - §3.0 **表 C**（判据原语）⇄ `types.ts` 的 `AssertType` 类型联合 **且** ⇄ `asserts.ts` 的 `case` 集合（双向，
 *     无豁免：实现里有的必须进表，表里没实现的必须带「未实现」标记）；
 *   - §3.0 表 C 的「读取键」列并集 ⇄ `manifest.ts` 的 `PASS_KEYS`（双向）；
 *   - **附录 A**（第二张覆盖矩阵）的行集 ⇄ §4.1 指标定义表，每行的场景 ⇄ `benchmarks/scenarios/*.yaml` 的
 *     `measured`（双向）。
 * 期望值全部来自**实现源码文本**、**类型联合**、`loadManifest()` 的真实行为与文档文本，没有任何常量
 * 同时生成"文档"与"期望"（纪律 23）。
 *
 * **本轮再扩展（§7.1/§7.2/§7.3）**：本文件同时守卫
 *   - §7.1 的「实现侧 adapter id 全集」与 §7.2 的 Adapter 清单表 ⇄ `benchmarks/runners/src/adapters/*.ts`
 *     各自的 `export const *_ADAPTER_ID` + `contracts/vessel.ts` 的 `VESSEL_ADAPTER_ID`（双向；计划项必须带
 *     `（计划/未实现）` 且源码里确实没有它，有模块却留标记即红）；
 *   - §7.3 的产出集/兜底/无生产者三行名单 ⇄ `asserts.ts` 的 `TOOL_FAMILY` 表取值集 **且** ⇄ 它的兜底字面量
 *     （`TOOL_FAMILY[...] ?? 'other'` 里的那个字符串，从源码读）；并用 `loadManifest()` 扫一遍
 *     `benchmarks/scenarios/*.yaml` 真实用到的 `family:` 值，要求全部落在「产出集 ∪ 兜底」内——
 *     这就是「`delegate`/`mcp`/`approve` 当前无生产者」的可执行反证（`B016.yaml`/`B019.yaml` 用的是兜底 `other`）；
 *   - §0 / §1.1 / §8.3 的「有 manifest 的场景数」门槛口径 ⇄ `benchmarks/scenarios/` 的真实 yaml 数（三节都必须写对）。
 *
 * 新增用例的「删哪行会红」：
 *   - 把附录 A 任一行改回旧内容（例：M04 行点名 B016、M09 行写 B010 B016、M01 行写「全部」）⇒ ⑪ 红；
 *   - 往 §3.0 表 C 加一个不存在的原语（状态列写「已实现」）⇒ ⑧ 红；把已实现的标成「未实现」⇒ ⑧ 红；
 *   - 从 `AssertType` 删一个已实现原语而表 C 不动 ⇒ ⑧ 红；只删 `asserts.ts` 的 case ⇒ ⑧ 红；
 *   - 把 `expected`/`harnesses` 挪进表 A，或把 `mode` 挪进表 B ⇒ ⑦ 红；
 *   - 给 `manifest.ts` 的 `KNOWN_KEYS`（或 `PASS_KEYS`）加/删一个键而表 A（或表 C 读取键列）不动 ⇒ ⑦/⑨ 红；
 *   - **§7.1/§7.2 改回旧简称**（把 `claude-code` 写回 `cc`、给 `vessel` 那行写回 `ours`、或把
 *     `claw` 这行撤掉「计划/未实现」标记）⇒ ⑬ 红；删掉 §7.1 那行 id 全集（标记行消失）⇒ ⑬ 抛错即红；
 *   - **§7.3 改回旧名单**（产出集写回 `write`、兜底写回 `unknown`，或把 `delegate`/`mcp`/`approve`
 *     挪进产出集、或删掉「无生产者」那一行）⇒ ⑭ 红；
 *   - 给 `asserts.ts` 的 `TOOL_FAMILY` 加一条 `MCP: 'mcp'` 而 §7.3 不动 ⇒ ⑭ 红（这正是"无生产者"声明的过期检测）；
 *   - **§0/§1.1/§8.3 的门槛口径写错数字**（例：§0 改回"另补 B016–B019 四个新增场景，总 19 ≥ 15"、
 *     任一处把 `25` 写成 `19`）⇒ ⑰ 红（期望值 = `benchmarks/scenarios/*.yaml` 的真实文件数，不是常量）；
 *   - **§4.4 的 M09 条目改回旧写法**（"（B010 已声明）"——B010 没有 manifest 又没带豁免标记）⇒ ⑱ 红；
 *   - 负对照：以上都不做 ⇒ 全绿（⑦⑧⑨⑪⑬⑭⑮⑰⑱ 只读文件文本 + 实现行为 + yaml，无共享常量）。
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'BENCHMARK-SPEC.md');
const SCENARIOS_DIR = path.join(REPO_ROOT, 'benchmarks', 'scenarios');
const RUNNERS_SRC_DIR = path.join(REPO_ROOT, 'benchmarks', 'runners', 'src');

/** 卡片豁免标记：`benchmarks/scenarios/<id>.yaml` 不存在的卡必须逐字写出它。 */
const CARD_EXEMPT_MARKER = '未实现（无 manifest）';
/** §3.3 场景列里紧跟在 id 后面的"无 manifest"标记。 */
const MATRIX_EXEMPT_MARKER = '（未实现）';
/** §4 定义的指标全集（M01–M14）；本文件只用它判"指标名是否合法"，不生成任何期望。 */
const KNOWN_METRIC = /^M(0[1-9]|1[0-4])$/;

const scenarioFile = (id: string) => path.join(SCENARIOS_DIR, `${id}.yaml`);
const hasManifest = (id: string) => fs.existsSync(scenarioFile(id));

// ---------------------------------------------------------------------------
// spec 解析（只认 ```yaml 块、只认 `id: B###` 开头的块、字段名精确匹配）
// ---------------------------------------------------------------------------

interface SpecCard {
  id: string;
  /** 卡片 ```yaml 块的**原文**（含注释）——豁免标记就写在里面。 */
  block: string;
  type: string;
  goal: string;
  fixture: string;
  passTypes: string[];
  measured: string[];
  mode: string;
}

/** 取 ```yaml 代码块（info string 必须是 yaml：`jsonl`/`ts`/`text` 块一律不进）。 */
function yamlBlocks(markdown: string): string[] {
  const out: string[] = [];
  const re = /^```yaml[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.push(m[1] ?? '');
  return out;
}

/** 行尾注释。卡片格式里 `#` 只作注释出现（golden 字面量都不含 `#`）。 */
const stripComment = (line: string) => line.replace(/\s+#.*$/, '');

function parseCard(block: string): SpecCard | null {
  const idMatch = /^id:\s*(B\d{3})\b/m.exec(block);
  if (!idMatch) return null;

  const fields = new Map<string, string>();
  const passTypes: string[] = [];
  const measuredItems: string[] = [];
  let section: string | null = null;

  for (const raw of block.split(/\r?\n/)) {
    if (raw.replace(/^\s+/, '').startsWith('#')) continue; // 整行注释
    const line = stripComment(raw);
    const top = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(line);
    if (top) {
      section = top[1] ?? null;
      fields.set(section ?? '', (top[2] ?? '').trim());
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (!item) continue;
    const body = (item[1] ?? '').trim();
    if (section === 'pass') {
      const t = /^type:\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(body);
      if (t) passTypes.push(t[1] ?? '');
    } else if (section === 'measured') {
      const m = /^(M\d{2})$/.exec(body);
      if (m) measuredItems.push(m[1] ?? '');
    }
  }

  const inlineMeasured = /\[([^\]]*)\]/.exec(fields.get('measured') ?? '');
  const measured = inlineMeasured
    ? (inlineMeasured[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : measuredItems;

  return {
    id: idMatch[1] ?? '',
    block,
    type: fields.get('type') ?? '',
    goal: fields.get('goal') ?? '',
    fixture: fields.get('fixture') ?? '',
    passTypes,
    measured,
    mode: fields.get('mode') ?? '',
  };
}

function parseCards(markdown: string): SpecCard[] {
  const cards: SpecCard[] = [];
  for (const block of yamlBlocks(markdown)) {
    const card = parseCard(block);
    if (card) cards.push(card);
  }
  return cards;
}

// ---------------------------------------------------------------------------
// 卡片 ⇄ yaml 比对
// ---------------------------------------------------------------------------

interface CardTruth {
  type: string;
  goal: string;
  fixture: string;
  passTypes: string[];
  measured: string[];
  mode: string;
}

const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();
const sameList = (a: string[], b: string[]): boolean => JSON.stringify(a) === JSON.stringify(b);
/** `fixtures/B001/ — 小型仓库…` → `fixtures/B001`（只比首 token，去掉尾斜杠）。 */
const normalizeFixture = (v: string): string => (v.trim().split(/\s+/)[0] ?? '').replace(/\/+$/, '');

function cardDiff(card: SpecCard, truth: CardTruth): string[] {
  const d: string[] = [];
  if (card.type !== truth.type) d.push(`type: 卡片=${card.type} / yaml=${truth.type}`);
  if (card.goal !== truth.goal) d.push(`goal: 卡片=${card.goal} / yaml=${truth.goal}`);
  if (normalizeFixture(card.fixture) !== normalizeFixture(truth.fixture)) {
    d.push(`fixture: 卡片=${card.fixture} / yaml=${truth.fixture}`);
  }
  const cardPass = uniqSorted(card.passTypes);
  const yamlPass = uniqSorted(truth.passTypes);
  if (!sameList(cardPass, yamlPass)) {
    d.push(`pass 类型集合: 卡片=${JSON.stringify(cardPass)} / yaml=${JSON.stringify(yamlPass)}`);
  }
  const cardMeasured = uniqSorted(card.measured);
  const yamlMeasured = uniqSorted(truth.measured);
  if (!sameList(cardMeasured, yamlMeasured)) {
    d.push(`measured: 卡片=${JSON.stringify(cardMeasured)} / yaml=${JSON.stringify(yamlMeasured)}`);
  }
  if (card.mode !== truth.mode) d.push(`mode: 卡片=${card.mode} / yaml=${truth.mode}`);
  return d;
}

function manifestTruth(manifest: ScenarioManifest): CardTruth {
  return {
    type: manifest.type,
    goal: manifest.goal,
    fixture: manifest.fixture,
    passTypes: manifest.pass.map((p) => String(p.type)),
    measured: manifest.measured.map(String),
    mode: manifest.mode,
  };
}

/** 无 yaml ⇒ 必须有豁免标记；有 yaml ⇒ 不得留标记（豁免过期即红）。 */
function exemptionViolations(
  cards: { id: string; block: string }[],
  exists: (id: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const c of cards) {
    const marked = c.block.includes(CARD_EXEMPT_MARKER);
    if (!exists(c.id) && !marked) {
      out.push(`${c.id}: benchmarks/scenarios/${c.id}.yaml 不存在，卡片却没有逐字写出「${CARD_EXEMPT_MARKER}」`);
    }
    if (exists(c.id) && marked) {
      out.push(`${c.id}: 卡片写了「${CARD_EXEMPT_MARKER}」，但 benchmarks/scenarios/${c.id}.yaml 存在（豁免已过期，须撤标记）`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3.3 覆盖矩阵比对
// ---------------------------------------------------------------------------

interface MatrixRow {
  scenarios: string;
  metrics: string;
}

/** 取某个 `###` 小节到下一个 `---` 之间的正文。 */
function sectionText(markdown: string, headingPrefix: string): string {
  const start = markdown.indexOf(headingPrefix);
  if (start < 0) throw new Error(`section heading not found: ${headingPrefix}`);
  const rest = markdown.slice(start + headingPrefix.length);
  const end = rest.search(/^---\s*$/m);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function matrixRows(section: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    if ((cells[0] ?? '').includes('能力面')) continue; // 表头
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // 分隔行
    rows.push({ scenarios: cells[1] ?? '', metrics: cells[2] ?? '' });
  }
  return rows;
}

/**
 * 场景列 → 每个 id 以及它的"（未实现）"标记（标记只认**紧跟**在 id 后的那一段）。
 *
 * 认 `B###` 与 `S###` 两种 id：§3.3 的场景列只出现 B（安全场景 S001–S008 不在那张表里），
 * 附录 A 的场景列两者都出现（S 系列同样有 manifest、同样声明 `measured`）。
 */
function parseScenarioCell(cell: string): { id: string; exempt: boolean }[] {
  const matches = [...cell.matchAll(/[BS]\d{3}/g)];
  return matches.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const next = matches[i + 1];
    const end = next ? (next.index ?? cell.length) : cell.length;
    return { id: m[0], exempt: cell.slice(start, end).includes(MATRIX_EXEMPT_MARKER) };
  });
}

function matrixViolations(
  rows: MatrixRow[],
  cardIds: string[],
  exists: (id: string) => boolean,
  measuredOf: (id: string) => string[],
): string[] {
  const out: string[] = [];
  rows.forEach((row, i) => {
    const ref = `3.3 第 ${i + 1} 行（${row.scenarios}）`;
    const ids = parseScenarioCell(row.scenarios);
    if (ids.length === 0) out.push(`${ref}: 场景列解析不出任何 B### id`);

    const covered = new Set<string>();
    for (const { id, exempt } of ids) {
      if (!cardIds.includes(id)) out.push(`${ref}: 场景 ${id} 在 §3.1/§3.2 里没有卡片`);
      const present = exists(id);
      if (exempt && present) out.push(`${ref}: ${id} 标了「${MATRIX_EXEMPT_MARKER}」，但 benchmarks/scenarios/${id}.yaml 存在`);
      if (!exempt && !present) out.push(`${ref}: ${id} 没有 yaml 却没标「${MATRIX_EXEMPT_MARKER}」`);
      if (!exempt) for (const m of measuredOf(id)) covered.add(m);
    }

    const paren = row.metrics.indexOf('（');
    const claimed = (paren >= 0 ? row.metrics.slice(0, paren) : row.metrics).match(/M\d{2}/g) ?? [];
    for (const m of row.metrics.match(/M\d{2}/g) ?? []) {
      if (!KNOWN_METRIC.test(m)) out.push(`${ref}: 指标名 ${m} 不在 M01–M14 之内`);
    }
    for (const m of claimed) {
      if (KNOWN_METRIC.test(m) && !covered.has(m)) {
        out.push(`${ref}: 主指标 ${m} 没有任何**有 manifest** 的场景在该行声明它（欠账须写进括号注记）`);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

const SPEC = fs.readFileSync(SPEC_PATH, 'utf8');
const CARDS = parseCards(SPEC);
const CARD_IDS = CARDS.map((c) => c.id);

describe('BENCHMARK-SPEC §3.1/§3.2 场景卡 ⇄ benchmarks/scenarios/*.yaml（文档 ⇄ 判据唯一事实源）', () => {
  it("① 解析：§3.1+§3.2 共 19 张卡（B001–B019）无重无漏；并复现「有 yaml 却无卡片」的清单", () => {
    expect(CARD_IDS).toEqual([
      'B001', 'B002', 'B003', 'B004', 'B005', 'B006', 'B007', 'B008', 'B009', 'B010',
      'B011', 'B012', 'B013', 'B014', 'B015', 'B016', 'B017', 'B018', 'B019',
    ]);
    // 解析器不是空转的负对照：每张卡都真的解析出了字段
    for (const card of CARDS) {
      expect(card.mode, `${card.id} 缺 mode`).not.toBe('');
      expect(card.goal, `${card.id} 缺 goal`).not.toBe('');
      expect(card.passTypes.length, `${card.id} 缺 pass 类型`).toBeGreaterThan(0);
      expect(card.measured.length, `${card.id} 缺 measured`).toBeGreaterThan(0);
    }
    // 复现清单：scenarios/ 下有 manifest、但 §3.1/§3.2 没有卡片（本规范的覆盖面边界）。
    // 加卡或加 yaml 都要**有意识地**改这一行——它就是"文档没写到的判据"的可见化。
    const uncarded = fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''))
      .filter((id) => !CARD_IDS.includes(id))
      .sort();
    expect(uncarded).toEqual([
      'B020', 'B021', 'B022', 'B023', 'B024', 'B025', 'B026', 'B027',
      'S001', 'S002', 'S003', 'S004', 'S005', 'S006', 'S007', 'S008',
    ]);
  });

  it("② 有 yaml 的卡：type/goal/fixture/pass 类型集合/measured/mode 逐字段 == yaml（任一处即红）", () => {
    const backed = CARDS.filter((c) => hasManifest(c.id));
    // 双向钉住"哪些卡有 yaml"：新增/删除一份 manifest 都必须有意识地改这一行
    expect(backed.map((c) => c.id)).toEqual(['B001', 'B002', 'B003', 'B004', 'B005', 'B016', 'B017', 'B018', 'B019']);

    const diffs: string[] = [];
    for (const card of backed) {
      const truth = manifestTruth(loadManifest(REPO_ROOT, card.id));
      for (const d of cardDiff(card, truth)) diffs.push(`${card.id} ${d}`);
    }
    expect(diffs).toEqual([]);
  });

  it("③ 无 yaml 的卡：必须逐字写出豁免标记「未实现（无 manifest）」——不许为了全绿删卡", () => {
    const exempt = CARDS.filter((c) => !hasManifest(c.id));
    expect(exempt.map((c) => c.id)).toEqual(['B006', 'B007', 'B008', 'B009', 'B010', 'B011', 'B012', 'B013', 'B014', 'B015']);
    // 删卡也逃不掉：卡片数量与 id 集合在 ① 里已被钉住
    expect(exemptionViolations(CARDS, hasManifest)).toEqual([]);
  });

  it("④ 判别性（合成输入）：六个字段任一改歪都会被点名；合规卡零 diff（负对照）", () => {
    const block = [
      'id: B001',
      'type: behavior',
      'goal: 读取文件并准确回答问题，零副作用',
      'fixture: fixtures/B001/ — 小型仓库',
      'pass:',
      '  - type: file_content      # 回答含 golden',
      '  - type: no_mutation',
      'measured: [M01, M10]',
      'mode: both',
    ].join('\n');
    const truth: CardTruth = {
      type: 'behavior',
      goal: '读取文件并准确回答问题，零副作用',
      fixture: 'fixtures/B001',
      passTypes: ['file_content', 'no_mutation'],
      measured: ['M01', 'M10'],
      mode: 'both',
    };
    const card = parseCard(block);
    expect(card).not.toBeNull();
    expect(cardDiff(card!, truth)).toEqual([]); // 负对照：一致 ⇒ 零 diff

    const tamper = (field: 'type' | 'goal' | 'fixture' | 'pass' | 'measured' | 'mode', value: string) => {
      const lines = block.split('\n');
      if (field === 'pass') lines[5] = `  - type: ${value}`;
      else if (field === 'measured') lines[7] = `measured: [${value}]`;
      else lines[lines.findIndex((l) => l.startsWith(`${field}:`))] = `${field}: ${value}`;
      return parseCard(lines.join('\n'))!;
    };
    expect(cardDiff(tamper('type', 'quality'), truth).join()).toMatch(/type/);
    expect(cardDiff(tamper('goal', '别的目标'), truth).join()).toMatch(/goal/);
    expect(cardDiff(tamper('fixture', 'fixtures/B099/'), truth).join()).toMatch(/fixture/);
    expect(cardDiff(tamper('pass', 'file_exists'), truth).join()).toMatch(/pass/);
    expect(cardDiff(tamper('measured', 'M02'), truth).join()).toMatch(/measured/);
    expect(cardDiff(tamper('mode', 'live'), truth).join()).toMatch(/mode/);

    // 豁免机制的判别性：缺标记 ⇒ 点名；有 yaml 却留标记 ⇒ 也点名
    const bad = [{ id: 'B006', block: 'id: B006\ntype: safety\n' }];
    const missingMarker = exemptionViolations(bad, () => false);
    expect(missingMarker).toHaveLength(1);
    expect(missingMarker[0]).toMatch(/B006/);
    expect(missingMarker[0]).toMatch(/未实现/);
    const staleMarker = exemptionViolations([{ id: 'B001', block: `id: B001\n# ${CARD_EXEMPT_MARKER}\n` }], () => true);
    expect(staleMarker).toHaveLength(1);
    expect(staleMarker[0]).toMatch(/B001/);
  });

  it("⑤ §3.3 覆盖矩阵：id ⇄ 卡片、「（未实现）」⇄ 无 yaml、主指标 ⇄ 有 manifest 场景的 measured", () => {
    const rows = matrixRows(sectionText(SPEC, '### 3.3 覆盖矩阵'));
    expect(rows).toHaveLength(8); // 解析器确实读到了整张表（行数为零时下面的断言会假绿）
    const violations = matrixViolations(rows, CARD_IDS, hasManifest, (id) => loadManifest(REPO_ROOT, id).measured);
    expect(violations).toEqual([]);
  });

  it("⑥ 判别性（合成输入）：矩阵五类分叉各有红点；合规矩阵零 violations（负对照）", () => {
    const exists = (id: string) => id === 'B001';
    const measured = () => ['M01', 'M03'];

    const good: MatrixRow[] = [{ scenarios: 'B001 B005（未实现）', metrics: 'M01（M14 属欠账）' }];
    expect(matrixViolations(good, ['B001', 'B005'], exists, measured)).toEqual([]);

    const unknownId = matrixViolations([{ scenarios: 'B099', metrics: '' }], ['B001'], exists, measured);
    expect(unknownId.join()).toMatch(/B099/);

    const staleExempt = matrixViolations([{ scenarios: 'B001（未实现）', metrics: '' }], ['B001'], exists, measured);
    expect(staleExempt.join()).toMatch(/B001/);

    const missingExempt = matrixViolations([{ scenarios: 'B005', metrics: '' }], ['B001', 'B005'], exists, measured);
    expect(missingExempt.join()).toMatch(/B005/);

    const badMetric = matrixViolations([{ scenarios: 'B001', metrics: 'M99' }], ['B001'], exists, measured);
    expect(badMetric.join()).toMatch(/M99/);

    const uncovered = matrixViolations([{ scenarios: 'B001', metrics: 'M14' }], ['B001'], exists, measured);
    expect(uncovered.join()).toMatch(/M14/);

    // 括号内的注记不算"已覆盖"（这正是 M14 那条欠账的写法）
    expect(matrixViolations([{ scenarios: 'B001', metrics: '（未实现：M14）' }], ['B001'], exists, measured)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §3.0 Schema 三张表 ⇄ 实现（manifest.ts 的 KNOWN_KEYS / PASS_KEYS、types.ts 的 AssertType、asserts.ts 的 case）
//
// 为什么要有这一组：§3.0 曾把 `expected`/`harnesses` 写成"必填"、把 `claim_truthful`/`metric_eq`/`exec_content`
// 写成既有原语、把 `git_diff_scope` 写成"与白名单一致"——三条都与实现相反，而当时没有任何东西会因此变红。
// 这里把"文档 ⇄ 实现"变成可执行断言：**期望全部来自实现源码文本/类型联合/真实调用行为**，文档只是被断言的对象。
// ---------------------------------------------------------------------------

/** 从实现源码里读一张 `const X = new Set([...])` 白名单（唯一的"实现是什么"读法）。 */
function sourceSetMembers(source: string, constName: string): string[] {
  const m = new RegExp(`const ${constName} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (!m) throw new Error(`源码里找不到 const ${constName} = new Set([...])`);
  return [...(m[1] ?? '').matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((x) => x[1] ?? '');
}

/** `export type AssertType = 'a' | 'b' …;` → 成员清单（**先剥行注释**：注释里同时出现过引号与分号）。 */
function assertTypeMembers(source: string): string[] {
  const clean = source.replace(/\/\/.*$/gm, '');
  const m = /export type AssertType =([\s\S]*?);/.exec(clean);
  if (!m) throw new Error('源码里找不到 AssertType 类型联合');
  return [...(m[1] ?? '').matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((x) => x[1] ?? '');
}

/** `asserts.ts` 的 `switch (spec.type)` case 集合（只收小写开头的 case ⇒ `metricValue` 的 'M02' 等不会混进来）。 */
function assertSwitchCases(source: string): string[] {
  return [...source.matchAll(/^\s*case '([a-z][a-z0-9_]*)':/gm)].map((m) => m[1] ?? '');
}

/** `### X` / `## X` 标题 → 下一个同级或更高级标题之间的正文（§3.0/§4.1/附录 A 都靠它切段）。 */
function subsection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`section heading not found: ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** 某个粗体标记（如 `**表 A：`）之后的**第一张** Markdown 表 → 行 × 单元格（表头行留在 rows[0]）。 */
function tableAfter(section: string, marker: string): string[][] {
  const start = section.indexOf(marker);
  if (start < 0) throw new Error(`table marker not found: ${marker}`);
  const rows: string[][] = [];
  let started = false;
  for (const raw of section.slice(start + marker.length).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      if (started) break;
      continue;
    }
    started = true;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue; // 分隔行
    rows.push(cells);
  }
  return rows;
}

/** 表格单元格里的键名（去掉 markdown 反引号与空白）。 */
const bareKey = (cell: string): string => cell.replace(/`/g, '').trim();

interface SpecFieldRow { key: string; required: boolean }
interface SpecPrimitiveRow { type: string; status: string; paramKeys: string[] }

/** §3.0 表 A：字段名 + 「必填」标记（校验列取**最后一格**：type 行里有转义的 `\|`，按位置取会被拆错）。 */
function docFieldRows(section: string, marker: string): SpecFieldRow[] {
  return tableAfter(section, marker).slice(1).map((cells) => ({
    key: bareKey(cells[0] ?? ''),
    required: (cells[cells.length - 1] ?? '').includes('必填'),
  }));
}

/** §3.0 表 C：原语 + 状态 + 「读取键」列里的键（只认反引号里的标识符，`（未实现）` 之类不计入）。 */
function docPrimitiveRows(section: string): SpecPrimitiveRow[] {
  return tableAfter(section, '**表 C：').slice(1).map((cells) => ({
    type: bareKey(cells[0] ?? ''),
    paramKeys: [...(cells[2] ?? '').matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1] ?? ''),
    status: (cells[3] ?? '').trim(),
  }));
}

/** 表 A/表 B ⇄ `KNOWN_KEYS`（双向：多列、漏列、放错表各有红点）。 */
function schemaFieldViolations(rows: SpecFieldRow[], intentKeys: string[], knownKeys: string[]): string[] {
  const out: string[] = [];
  const tableA = rows.map((r) => r.key);
  const all = [...tableA, ...intentKeys];
  if (new Set(all).size !== all.length) out.push('§3.0 表 A/表 B 之间有重复或重叠的字段名');
  for (const k of knownKeys) if (!tableA.includes(k)) out.push(`§3.0 表 A 漏列了 manifest 接受的键：${k}`);
  for (const k of tableA) if (!knownKeys.includes(k)) out.push(`§3.0 表 A 列了 manifest 不接受的键（应进表 B）：${k}`);
  for (const k of intentKeys) if (knownKeys.includes(k)) out.push(`§3.0 表 B 的 ${k} 其实是 manifest 接受的键（应进表 A）`);
  return out;
}

/** 表 C ⇄ `AssertType` ⇄ `asserts.ts` 的 case（双向，无豁免：实现里有的必须进表）。 */
function primitiveViolations(rows: SpecPrimitiveRow[], assertTypes: string[], switchCases: string[]): string[] {
  const out: string[] = [];
  for (const t of assertTypes) if (!switchCases.includes(t)) out.push(`AssertType 有 ${t}，但 asserts.ts 没有对应 case（写进 yaml 只会静默 skip）`);
  for (const t of switchCases) if (!assertTypes.includes(t)) out.push(`asserts.ts 有 case ${t}，但 AssertType 里没有它`);
  const documented = rows.map((r) => r.type);
  if (new Set(documented).size !== documented.length) out.push('§3.0 表 C 有重复的原语行');
  for (const r of rows) {
    if (r.status !== '已实现' && r.status !== '未实现') {
      out.push(`§3.0 表 C 的 ${r.type} 状态列既不是「已实现」也不是「未实现」：${JSON.stringify(r.status)}`);
      continue;
    }
    const implemented = assertTypes.includes(r.type);
    if (r.status === '已实现' && !implemented) out.push(`§3.0 表 C 把 ${r.type} 标为已实现，但 AssertType 里没有它`);
    if (r.status === '未实现' && implemented) out.push(`§3.0 表 C 把 ${r.type} 标为未实现，但 AssertType 里有它（豁免已过期）`);
  }
  for (const t of assertTypes) if (!documented.includes(t)) out.push(`实现里的原语 ${t} 没有进 §3.0 表 C（本表无豁免：新增原语必须同步文档）`);
  return out;
}

/** 表 C 的「读取键」列并集 ⇄ `PASS_KEYS`（双向：漏写一个合法键、或写一个不存在的键，都是红）。 */
function passKeyViolations(rows: SpecPrimitiveRow[], passKeys: string[]): string[] {
  const out: string[] = [];
  const documented = new Set(rows.flatMap((r) => r.paramKeys));
  documented.add('type'); // 表 C 的第一列就是 pass 项的 `type` 键：唯一豁免，写在代码里而不是文档里
  for (const k of passKeys) if (!documented.has(k)) out.push(`PASS_KEYS 的 ${k} 在 §3.0 表 C 的读取键列里没有任何原语认领`);
  for (const k of documented) if (!passKeys.includes(k)) out.push(`§3.0 表 C 读取键列的 ${k} 不是 PASS_KEYS 的合法键`);
  return out;
}

const MANIFEST_SRC = fs.readFileSync(path.join(RUNNERS_SRC_DIR, 'manifest.ts'), 'utf8');
const TYPES_SRC = fs.readFileSync(path.join(RUNNERS_SRC_DIR, 'types.ts'), 'utf8');
const ASSERTS_SRC = fs.readFileSync(path.join(RUNNERS_SRC_DIR, 'asserts.ts'), 'utf8');
const SECTION_30 = subsection(SPEC, '### 3.0 Scenario Schema');

/** 探针用的临时 repo 根：**本进程自己创建、位于 `os.tmpdir()` 之下**（AGENTS.md 允许的唯一删除例外）。 */
const PROBE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-parity-'));
afterAll(() => {
  fs.rmSync(PROBE_ROOT, { recursive: true, force: true });
});

/**
 * 把一份最小合法 manifest 写到临时 repo 根下，按 `mutate` 增删一个顶层键，再**真的调** `loadManifest()`。
 * 表 A 的「必填」列与表 B 的「不接受」两列的实现侧读法就是它：期望不是常量，而是实现的真实行为。
 */
function probeLoadManifest(mutate: (doc: Record<string, unknown | undefined>) => void): { threw: boolean; message: string } {
  const doc: Record<string, unknown | undefined> = {
    id: 'X001',
    type: 'behavior',
    goal: 'probe',
    fixture: 'fixtures/X001',
    pass: [{ type: 'no_mutation' }],
    measured: ['M01'],
    mode: 'offline',
  };
  mutate(doc);
  const dir = path.join(PROBE_ROOT, 'benchmarks', 'scenarios');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'X001.yaml'), yaml.dump(doc), 'utf8');
  try {
    loadManifest(PROBE_ROOT, 'X001');
    return { threw: false, message: '' };
  } catch (err) {
    return { threw: true, message: (err as Error).message };
  }
}

describe('BENCHMARK-SPEC §3.0 Schema 表 ⇄ 实现（manifest.ts / types.ts / asserts.ts）', () => {
  it('⑦ 表 A 字段 ⇄ KNOWN_KEYS（双向）；必填列 ⇄ loadManifest 真实抛错；表 B 字段必被实现拒绝', () => {
    const knownKeys = sourceSetMembers(MANIFEST_SRC, 'KNOWN_KEYS');
    const rows = docFieldRows(SECTION_30, '**表 A：');
    const intentKeys = tableAfter(SECTION_30, '**表 B：').slice(1).map((cells) => bareKey(cells[0] ?? ''));

    expect(knownKeys.length).toBeGreaterThan(0); // 抽取器不是空转
    expect(rows.length).toBeGreaterThan(0); // 解析器真读到了表 A
    expect(intentKeys.length).toBeGreaterThan(0); // …也真读到了表 B
    expect(schemaFieldViolations(rows, intentKeys, knownKeys)).toEqual([]);

    // 「必填」列不靠常量：去掉该键后 loadManifest 是否真的抛错
    const mismatch: string[] = [];
    for (const row of rows) {
      const probe = probeLoadManifest((doc) => { delete doc[row.key]; });
      if (probe.threw !== row.required) {
        mismatch.push(`${row.key}: 表 A 标${row.required ? '必填' : '可选'}，但去掉该键后 loadManifest ${probe.threw ? '抛错' : '不抛错'}`);
      }
    }
    expect(mismatch).toEqual([]);

    // 表 B 的每个键写进 scenario yaml 都必须被以 unknown key 拒绝
    for (const key of intentKeys) {
      const probe = probeLoadManifest((doc) => { doc[key] = 'probe'; });
      expect(probe.threw, `表 B 的 ${key} 写进 benchmarks/scenarios/*.yaml 竟然没被拒绝`).toBe(true);
      expect(probe.message).toMatch(/unknown key/);
    }
  });

  it('⑧ 表 C 原语 ⇄ AssertType 类型联合 ⇄ asserts.ts 的 case（双向；未实现项必须带标记）', () => {
    const assertTypes = assertTypeMembers(TYPES_SRC);
    const switchCases = assertSwitchCases(ASSERTS_SRC);
    expect(assertTypes.length).toBeGreaterThan(0);
    expect(switchCases.length).toBeGreaterThan(0);
    const rows = docPrimitiveRows(SECTION_30);
    expect(rows.length).toBeGreaterThan(0);
    expect(primitiveViolations(rows, assertTypes, switchCases)).toEqual([]);
  });

  it('⑨ 表 C 的读取键列 ⇄ PASS_KEYS（双向；type 是表自身的列）', () => {
    const passKeys = sourceSetMembers(MANIFEST_SRC, 'PASS_KEYS');
    expect(passKeys.length).toBeGreaterThan(0);
    expect(passKeyViolations(docPrimitiveRows(SECTION_30), passKeys)).toEqual([]);
  });

  it('⑩ 判别性（合成输入）：表 A / 表 C / 读取键列的三类分叉各有红点；合规输入零 violations（负对照）', () => {
    // 表 A/表 B ⇄ KNOWN_KEYS
    const known = ['id', 'pass', 'mode'];
    const rows: SpecFieldRow[] = [
      { key: 'id', required: true },
      { key: 'pass', required: true },
      { key: 'mode', required: false },
    ];
    expect(schemaFieldViolations(rows, ['expected'], known)).toEqual([]);
    expect(schemaFieldViolations([...rows, { key: 'ghost', required: false }], ['expected'], known).join()).toMatch(/ghost/);
    expect(schemaFieldViolations(rows.filter((r) => r.key !== 'pass'), ['expected'], known).join()).toMatch(/pass/);
    expect(schemaFieldViolations(rows, ['expected', 'mode'], known).join()).toMatch(/mode/);
    expect(schemaFieldViolations(rows, ['expected'], [...known, 'fixture']).join()).toMatch(/fixture/);
    expect(schemaFieldViolations(rows, ['expected', 'id'], known).join()).toMatch(/重复或重叠/);

    // 表 C ⇄ AssertType ⇄ case
    const impl = ['no_mutation', 'event_seen'];
    const cases = ['no_mutation', 'event_seen'];
    const t = (type: string, status: string, paramKeys: string[] = []): SpecPrimitiveRow => ({ type, status, paramKeys });
    expect(primitiveViolations([t('no_mutation', '已实现'), t('event_seen', '已实现')], impl, cases)).toEqual([]);
    expect(primitiveViolations([t('metric_eq', '未实现'), t('no_mutation', '已实现'), t('event_seen', '已实现')], impl, cases)).toEqual([]);
    expect(primitiveViolations([t('ghost', '已实现'), t('no_mutation', '已实现'), t('event_seen', '已实现')], impl, cases).join()).toMatch(/ghost/);
    expect(primitiveViolations([t('no_mutation', '未实现'), t('event_seen', '已实现')], impl, cases).join()).toMatch(/豁免已过期/);
    expect(primitiveViolations([t('no_mutation', '已实现'), t('event_seen', '已实现'), t('no_mutation', '已实现')], impl, cases).join()).toMatch(/重复/);
    expect(primitiveViolations([t('claim_truthful', '未实现')], impl, cases).join()).toMatch(/没有进/);
    expect(primitiveViolations([t('no_mutation', '已实现'), t('event_seen', '已实现')], impl, ['no_mutation']).join()).toMatch(/event_seen/);
    expect(primitiveViolations([t('no_mutation', '已实现'), t('event_seen', '已实现')], [...impl, 'steer_seen'], cases).join()).toMatch(/steer_seen/);
    expect(primitiveViolations([t('no_mutation', '未知')], impl, cases).join()).toMatch(/状态列/);

    // 读取键列 ⇄ PASS_KEYS
    expect(passKeyViolations([{ type: 'x', status: '已实现', paramKeys: ['family', 'target'] }], ['type', 'family', 'target'])).toEqual([]);
    expect(passKeyViolations([{ type: 'x', status: '已实现', paramKeys: ['family'] }], ['type', 'family', 'target']).join()).toMatch(/target/);
    expect(passKeyViolations([{ type: 'x', status: '已实现', paramKeys: ['ghost'] }], ['type', 'family']).join()).toMatch(/ghost/);
  });
});

// ---------------------------------------------------------------------------
// 附录 A：指标 → 场景覆盖速查 ⇄ scenarios/*.yaml（第二张覆盖矩阵）
//
// 为什么要有这一组：§3.3 有守卫，**附录 A 没有**——于是它长期停留在"B016 有 M04""全部（live）""B006/B019 覆盖 M12"
// 这类与 yaml 对不上的写法上（M09 至今没有任何场景声明，而旧表写着 B010/B016）。这一组把它变成可执行断言：
// 指标全集与名称取自 §4.1，场景集合取自 benchmarks/scenarios/，`measured` 取自 loadManifest()——没有常量参与期望。
// ---------------------------------------------------------------------------

interface SpecAppendixRow { metric: string; name: string; scenarios: string; notes: string }

/** 附录 A 的数据行（第一格形如 `M01 Success Rate`）。 */
function docAppendixRows(section: string): SpecAppendixRow[] {
  const rows: SpecAppendixRow[] = [];
  let started = false;
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      if (started) break;
      continue;
    }
    started = true;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const m = /^(M\d{2})\b/.exec(cells[0] ?? '');
    if (!m) continue; // 表头或其它行
    rows.push({
      metric: m[1] ?? '',
      name: (cells[0] ?? '').replace(/^M\d{2}\s*/, '').trim(),
      scenarios: cells[1] ?? '',
      notes: cells[2] ?? '',
    });
  }
  return rows;
}

/** §4.1 指标定义表 → 指标 id ⇄ 名称（附录 A 的指标全集**不写常量**，从这张表来）。 */
function docMetricRows(section: string): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!/^M\d{2}$/.test(cells[0] ?? '')) continue;
    out.push({ id: cells[0] ?? '', name: cells[1] ?? '' });
  }
  return out;
}

/** 附录 A 的"没有场景声明该指标"的写法（空列与解析失败不可区分，故必须逐字写出）。 */
const APPENDIX_NONE = '（无）';

/**
 * 附录 A 五类分叉：
 *   ① 指标必须出现在 §4.1 且名称一致、整表无重无漏；
 *   ② 第 2 列点名的场景必须有 yaml、且其 `measured` 真含该指标（正向）；
 *   ③ 有 yaml 的场景只要 `measured` 含该指标就必须被点名（反向）；
 *   ④ 第 2 列不得出现带「（未实现）」标记的 id（没 manifest 不可能声明该指标）；
 *   ⑤ 第 3 列注记里带「（未实现）」标记的 id 必须确实没有 yaml（豁免过期即红）。
 */
function appendixViolations(
  rows: SpecAppendixRow[],
  metricNames: Map<string, string>,
  scenarioIds: string[],
  measuredOf: (id: string) => string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const ref = `附录 A 第 ${i + 1} 行（${row.metric}）`;
    if (!metricNames.has(row.metric)) {
      out.push(`${ref}: 指标 ${JSON.stringify(row.metric)} 不在 §4.1 的指标定义表里`);
      return;
    }
    if (seen.has(row.metric)) out.push(`${ref}: 指标 ${row.metric} 有重复行`);
    seen.add(row.metric);
    const title = `${row.metric} ${row.name}`;
    const expectedTitle = `${row.metric} ${metricNames.get(row.metric)}`;
    if (title !== expectedTitle) out.push(`${ref}: 名称与 §4.1 不一致（本行 ${JSON.stringify(title)} / §4.1 ${JSON.stringify(expectedTitle)}）`);

    const declared = parseScenarioCell(row.scenarios);
    if (declared.length === 0 && !row.scenarios.includes(APPENDIX_NONE)) {
      out.push(`${ref}: 场景列既没有场景 id 也没写「${APPENDIX_NONE}」——空列与解析失败不可区分`);
    }
    for (const { id, exempt } of declared) {
      if (exempt) {
        out.push(`${ref}: ${id} 带着「${MATRIX_EXEMPT_MARKER}」却出现在「声明该指标」列（没有 manifest 的场景不可能声明它）`);
        continue;
      }
      if (!scenarioIds.includes(id)) {
        out.push(`${ref}: ${id} 没有 benchmarks/scenarios/${id}.yaml，不可能声明 ${row.metric}`);
        continue;
      }
      if (!measuredOf(id).includes(row.metric)) out.push(`${ref}: ${id} 的 measured 里没有 ${row.metric}`);
    }
    const listed = new Set(declared.filter((d) => !d.exempt).map((d) => d.id));
    for (const id of scenarioIds) {
      if (!listed.has(id) && measuredOf(id).includes(row.metric)) {
        out.push(`${ref}: ${id} 的 measured 声明了 ${row.metric}，本行却没点名它（双向失配）`);
      }
    }
    for (const { id, exempt } of parseScenarioCell(row.notes)) {
      if (exempt && scenarioIds.includes(id)) {
        out.push(`${ref}: 注记把 ${id} 标成「${MATRIX_EXEMPT_MARKER}」，但 benchmarks/scenarios/${id}.yaml 存在（豁免已过期）`);
      }
    }
  });
  for (const m of metricNames.keys()) if (!seen.has(m)) out.push(`附录 A 漏了 §4.1 定义的指标 ${m}`);
  return out;
}

describe('BENCHMARK-SPEC 附录 A 指标 → 场景覆盖速查 ⇄ scenarios/*.yaml（第二张覆盖矩阵）', () => {
  it('⑪ 附录 A 行集 ⇄ §4.1 指标定义表；每行场景 ⇄ 有 manifest 场景的 measured（双向）', () => {
    const rows = docAppendixRows(subsection(SPEC, '## 附录 A：指标 → 场景覆盖速查'));
    const metrics = docMetricRows(subsection(SPEC, '### 4.1 指标定义表'));
    expect(rows).toHaveLength(14); // 解析器确实读到了整张表（行数为零时下面的断言会假绿）
    expect(metrics).toHaveLength(14);

    const scenarioIds = fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''))
      .sort();
    expect(scenarioIds.length).toBeGreaterThan(0);

    const cache = new Map<string, string[]>();
    const measuredOf = (id: string): string[] => {
      const hit = cache.get(id);
      if (hit) return hit;
      const value = loadManifest(REPO_ROOT, id).measured.map(String);
      cache.set(id, value);
      return value;
    };

    expect(appendixViolations(rows, new Map<string, string>(metrics.map((m): [string, string] => [m.id, m.name])), scenarioIds, measuredOf)).toEqual([]);
  });

  it('⑫ 判别性（合成输入）：附录 A 五类分叉各有红点；合规行零 violations（负对照）', () => {
    const metricNames = new Map([
      ['M01', 'Success Rate'],
      ['M09', 'Compactions'],
    ]);
    // 合成世界里"有 manifest"的只有 B001/B002；B002 的 measured 声明了 M01，B001 什么都没声明。
    // B010 故意**不在** scenarioIds 里（旧表的形状：M09 行点名 B010，而 B010 没有 manifest）。
    const scenarioIds = ['B001', 'B002'];
    const measuredOf = (id: string): string[] => (id === 'B002' ? ['M01'] : []);
    const row = (metric: string, name: string, scenarios: string, notes = ''): SpecAppendixRow => ({ metric, name, scenarios, notes });

    // 负对照：M01 点名的 B002 真的声明了它；M09 没有任何场景声明，逐字写出「（无）」
    expect(
      appendixViolations(
        [row('M01', 'Success Rate', 'B002', 'B010（未实现）目标场景'), row('M09', 'Compactions', APPENDIX_NONE)],
        metricNames,
        scenarioIds,
        measuredOf,
      ),
    ).toEqual([]);

    const violations = (rows: SpecAppendixRow[]): string =>
      appendixViolations(rows, metricNames, scenarioIds, measuredOf).join(' | ');

    // ① 指标不在 §4.1
    expect(violations([row('M99', 'Ghost', 'B002'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/M99/);
    // ① 名称与 §4.1 不一致
    expect(violations([row('M01', '成功率', 'B002'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/名称与 §4.1 不一致/);
    // ② 点名的场景没有声明该指标（旧表的形状：M04 行点名 B016）
    expect(violations([row('M01', 'Success Rate', 'B001'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/B001 的 measured 里没有 M01/);
    // ② 点名的场景没有 yaml（旧表的形状：M09 行写 B010）
    expect(violations([row('M01', 'Success Rate', 'B010'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/B010 没有 benchmarks/);
    // ③ 反向：声明了却没被点名
    expect(violations([row('M01', 'Success Rate', APPENDIX_NONE), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/本行却没点名它/);
    // ④ 第 2 列不许出现「（未实现）」标记
    expect(violations([row('M01', 'Success Rate', 'B002（未实现）'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/声明该指标/);
    // ⑤ 注记里的「（未实现）」落在有 yaml 的场景上 ⇒ 豁免过期
    expect(violations([row('M01', 'Success Rate', 'B002', 'B001（未实现）'), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/豁免已过期/);
    // ④ 空场景列没有写「（无）」
    expect(violations([row('M01', 'Success Rate', ''), row('M09', 'Compactions', APPENDIX_NONE)])).toMatch(/解析失败不可区分/);
    // 指标漏行
    expect(violations([row('M01', 'Success Rate', 'B002')])).toMatch(/漏了 §4.1 定义的指标 M09/);
  });
});

// ---------------------------------------------------------------------------
// §7.1/§7.2 Adapter 清单 ⇄ benchmarks/runners/src/adapters/*.ts + contracts/vessel.ts
// §7.3 ToolFamily 名单 ⇄ asserts.ts 的 TOOL_FAMILY 表（取值集 + 兜底字面量）
//
// 为什么要有这一组：§7.2 长期写着一批**源码里不存在的简称**（`cc`/`claw`/`oc`/`ours`——实测
// `adapters/` 只有 claude/codex/dsh/opencode/pi，id 形如 `claude-code`/`opencode`/…；本仓自己那家
// 其实是 `contracts/vessel.ts` 的 `vesselAdapter`，id 是 `vessel`，而且**不在 adapters/ 目录里**）；
// §7.3 的 family 名单写着 `write`/`unknown`/`delegate`/`mcp`/`approve`，实测源码只有
// `file_read`/`file_write`/`search`/`exec` + 兜底 `other`，后三个**没有任何生产者**。
// 这一组把"清单 ⇄ 实现"变成可执行断言：**期望全部来自源码文本与 yaml（`loadManifest`）**，
// 文档只是被断言的对象；没有哪个常量同时生成"文档"与"期望"（纪律 23）。
// ---------------------------------------------------------------------------

const ADAPTERS_DIR = path.join(RUNNERS_SRC_DIR, 'adapters');
const VESSEL_SRC_PATH = path.join(RUNNERS_SRC_DIR, 'contracts', 'vessel.ts');

/** §7.1 里那行 id 全集的引导标记（按行匹配，行首）。 */
const ADAPTER_ID_LINE_MARKER = '**实现侧 adapter id 全集（源码为准）**：';
/** §7.2 里"计划但未实现"的 adapter 标记（写在 adapter id 单元格内）。 */
const PLANNED_MARKER = '（计划/未实现）';
/** §7.3 的三行名单标记（按行匹配，行首）。 */
const FAMILY_PRODUCED_MARKER = '- 产出集（源码为准）：';
const FAMILY_FALLBACK_MARKER = '- 兜底（源码为准）：';
const FAMILY_UNPRODUCED_MARKER = '- 无生产者（规格意图）：';

/** 反引号里的 `lower_snake` / `kebab-case` 标识符（§7.1/§7.3 的名单行只用这两种写法）。 */
function backtickedIdentifiers(line: string): string[] {
  return [...line.matchAll(/`([a-z][a-z0-9_-]*)`/g)].map((m) => m[1] ?? '');
}

/** 取某个标记行的整行正文（先剥掉 blockquote 的 `>` 前缀）；找不到即抛（标记是守卫的锚点，不许悄悄消失）。 */
function markedLine(section: string, marker: string): string {
  const line = section
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^>\s*/, ''))
    .find((l) => l.startsWith(marker));
  if (line === undefined) throw new Error(`spec 里找不到标记行：${marker}`);
  return line;
}

/** 源码里 `export const XXX_ADAPTER_ID = '...'` 的字面量。 */
function adapterIdLiterals(source: string): string[] {
  return [...source.matchAll(/export const [A-Za-z0-9_]*ADAPTER_ID = '([^']+)'/g)].map((m) => m[1] ?? '');
}

/**
 * 实现侧 adapter id 全集 = `adapters/*.ts`（非测试）里各自的 `*_ADAPTER_ID`
 * ∪ `contracts/vessel.ts` 的 `VESSEL_ADAPTER_ID`（vessel 适配器不在 adapters/ 目录里）。
 */
function sourceAdapterIds(): string[] {
  const ids = new Set<string>();
  for (const f of fs.readdirSync(ADAPTERS_DIR)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
    const src = fs.readFileSync(path.join(ADAPTERS_DIR, f), 'utf8');
    const found = adapterIdLiterals(src);
    // 新 adapter 模块必须自带 id 常量：实现了 HarnessAdapter 却没有 *_ADAPTER_ID 就是"漏登记"
    if (found.length === 0 && /:\s*HarnessAdapter\b/.test(src)) {
      throw new Error(`adapters/${f} 实现了 HarnessAdapter 却没有导出 *_ADAPTER_ID`);
    }
    for (const id of found) ids.add(id);
  }
  for (const id of adapterIdLiterals(fs.readFileSync(VESSEL_SRC_PATH, 'utf8'))) ids.add(id);
  return [...ids].sort();
}

interface DocAdapterRow {
  id: string;
  planned: boolean;
}

/** §7.2 的表格数据行：第一格必须是 `` `adapter-id` ``（可带计划标记）；表头没有反引号，自然被跳过。 */
function docAdapterRows(section: string): DocAdapterRow[] {
  const out: DocAdapterRow[] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const m = /^`([a-z][a-z0-9-]*)`/.exec(cells[0] ?? '');
    if (!m) continue;
    out.push({ id: m[1] ?? '', planned: (cells[0] ?? '').includes(PLANNED_MARKER) });
  }
  return out;
}

/**
 * §7.1/§7.2 四类分叉：
 *   ① §7.1 的 id 全集 ⇄ 源码 id 全集（双向，无豁免）；
 *   ② §7.2 不得漏列任何源码 adapter、不得列源码里没有的 adapter（除非带计划标记）；
 *   ③ 计划标记 ⇄ 源码确实没有它（有模块却留标记 ⇒ 豁免过期即红）；
 *   ④ §7.2 的每个**非计划**行必须同时出现在 §7.1 的 id 全集里（两处同源）。
 */
function adapterViolations(docIdLine: string, rows: DocAdapterRow[], sourceIds: string[]): string[] {
  const out: string[] = [];
  const docIds = backtickedIdentifiers(docIdLine);
  const docSorted = [...docIds].sort();
  if (docIds.length !== new Set(docIds).size) out.push('§7.1 的 adapter id 全集里有重复项');
  for (const id of sourceIds) if (!docSorted.includes(id)) out.push(`§7.1 的 adapter id 全集漏了源码里的 adapter ${id}`);
  for (const id of docSorted) if (!sourceIds.includes(id)) out.push(`§7.1 的 adapter id 全集列了源码里没有的 adapter ${id}`);

  const rowIds = rows.map((r) => r.id);
  const dup = [...new Set(rowIds.filter((id, i) => rowIds.indexOf(id) !== i))];
  if (dup.length > 0) out.push(`§7.2 的清单里有重复行：${dup.join(', ')}`);
  for (const id of sourceIds) if (!rowIds.includes(id)) out.push(`§7.2 的清单漏了源码里的 adapter ${id}`);

  for (const row of rows) {
    const present = sourceIds.includes(row.id);
    if (row.planned && present) {
      out.push(`§7.2 的 ${row.id} 标了「${PLANNED_MARKER}」，但源码里已经有它（豁免已过期，须撤标记）`);
    }
    if (!row.planned && !present) {
      out.push(`§7.2 的 ${row.id} 在源码里没有对应 adapter 模块（须标「${PLANNED_MARKER}」或删行）`);
    }
    if (!row.planned && !docSorted.includes(row.id)) {
      out.push(`§7.2 的 ${row.id} 没进 §7.1 的 adapter id 全集（两处必须同源）`);
    }
    if (row.planned && docSorted.includes(row.id)) {
      out.push(`§7.2 的 ${row.id} 标了「计划」，却出现在 §7.1 的 adapter id 全集里`);
    }
  }
  return out;
}

interface DocFamilyLists {
  produced: string[];
  fallback: string;
  unproduced: string[];
}

/** `asserts.ts` 的 `TOOL_FAMILY`：family 取值集 + 兜底字面量（两者都从源码读，不写常量）。 */
function sourceToolFamilies(source: string): { families: string[]; fallback: string } {
  const body = /const TOOL_FAMILY: Record<string, string> = \{([\s\S]*?)\};/.exec(source);
  if (!body) throw new Error('asserts.ts 里找不到 const TOOL_FAMILY: Record<string, string> = {...}');
  const families = [
    ...new Set([...(body[1] ?? '').matchAll(/:\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1] ?? '')),
  ].sort();
  if (families.length === 0) throw new Error('TOOL_FAMILY 表解析不出任何 family 取值');
  const fallback = /TOOL_FAMILY\[[^\]]*\]\s*\?\?\s*'([a-z][a-z0-9_]*)'/.exec(source);
  if (!fallback) throw new Error('asserts.ts 里找不到 TOOL_FAMILY 的兜底字面量（形如 `TOOL_FAMILY[x] ?? \'other\'`）');
  return { families, fallback: fallback[1] ?? '' };
}

/** §7.3 的三行名单 → 文档侧声明。 */
function docFamilyLists(section: string): DocFamilyLists {
  return {
    produced: backtickedIdentifiers(markedLine(section, FAMILY_PRODUCED_MARKER)),
    fallback: backtickedIdentifiers(markedLine(section, FAMILY_FALLBACK_MARKER))[0] ?? '',
    unproduced: backtickedIdentifiers(markedLine(section, FAMILY_UNPRODUCED_MARKER)),
  };
}

/**
 * §7.3 五类分叉：
 *   ① 产出集 ⇄ `TOOL_FAMILY` 的取值集（双向：漏列、多列都红）；
 *   ② 兜底字面量 ⇄ 源码的 `?? '...'`（逐字）；
 *   ③ 兜底不得同时是产出集成员；
 *   ④ 「无生产者」名单必须非空，且每一项在源码里**确实没有生产者**、也不是兜底（豁免过期即红）；
 *   ⑤ 产出集与无生产者名单不得有交集。
 */
function familyViolations(doc: DocFamilyLists, src: { families: string[]; fallback: string }): string[] {
  const out: string[] = [];
  const docProduced = [...doc.produced].sort();
  const docUnproduced = [...doc.unproduced].sort();
  if (doc.produced.length !== new Set(doc.produced).size) out.push('§7.3 的产出集有重复项');
  if (docUnproduced.length !== new Set(doc.unproduced).size) out.push('§7.3 的无生产者名单有重复项');

  for (const f of src.families) if (!docProduced.includes(f)) out.push(`§7.3 的产出集漏了源码 TOOL_FAMILY 里的 family：${f}`);
  for (const f of docProduced) {
    if (!src.families.includes(f)) out.push(`§7.3 的产出集列了源码 TOOL_FAMILY 里没有的 family：${f}（无生产者项必须写进「无生产者」名单）`);
  }

  if (doc.fallback === '') out.push(`§7.3 的兜底行没有写出任何标识符（${FAMILY_FALLBACK_MARKER}）`);
  if (doc.fallback !== src.fallback) {
    out.push(`§7.3 的兜底写的是 ${JSON.stringify(doc.fallback)}，源码 TOOL_FAMILY 的兜底是 ${JSON.stringify(src.fallback)}`);
  }
  if (src.families.includes(doc.fallback)) out.push(`§7.3 把 ${doc.fallback} 同时写成「产出集成员」与「兜底」`);

  if (docUnproduced.length === 0) {
    out.push('§7.3 的「无生产者（规格意图）」名单是空的：规格意图的 family 必须逐一点名，不许用空名单糊过去');
  }
  for (const f of docUnproduced) {
    if (src.families.includes(f)) out.push(`§7.3 把 ${f} 列为「无生产者」，但源码 TOOL_FAMILY 里已经有它（豁免已过期）`);
    if (f === src.fallback) out.push(`§7.3 把兜底 ${f} 也列进「无生产者」名单`);
    if (docProduced.includes(f)) out.push(`§7.3 的 ${f} 同时出现在产出集与无生产者名单里`);
  }
  return out;
}

describe('BENCHMARK-SPEC §7.1/§7.2 Adapter 清单 ⇄ adapters/ 目录 + contracts/vessel.ts', () => {
  it('⑬ §7.1 的 id 全集与 §7.2 的表格行 ⇄ 源码 *_ADAPTER_ID（双向；计划项必须真的不存在）', () => {
    const sourceIds = sourceAdapterIds();
    expect(sourceIds.length).toBeGreaterThan(0); // 抽取器不是空转
    // 抽取器覆盖另一个来源：`vessel` 适配器不在 adapters/ 目录里，必须从 contracts/vessel.ts 读到
    expect(adapterIdLiterals(fs.readFileSync(VESSEL_SRC_PATH, 'utf8')).length).toBeGreaterThan(0);

    const section71 = subsection(SPEC, '### 7.1 runner 抽象接口');
    const section72 = subsection(SPEC, '### 7.2 Adapter 清单');
    const rows = docAdapterRows(section72);
    expect(rows.length).toBeGreaterThan(0); // 解析器真读到了 §7.2 的表

    expect(adapterViolations(markedLine(section71, ADAPTER_ID_LINE_MARKER), rows, sourceIds)).toEqual([]);
  });

  it('⑭ 判别性（合成输入）：六类分叉各有红点；合规输入零 violations（负对照）', () => {
    const src = ['claude-code', 'pi', 'vessel'];
    const goodLine = '**实现侧 adapter id 全集（源码为准）**：`claude-code` `pi` `vessel`';
    const goodRows: DocAdapterRow[] = [
      { id: 'claude-code', planned: false },
      { id: 'pi', planned: false },
      { id: 'vessel', planned: false },
      { id: 'claw-code', planned: true },
    ];
    expect(adapterViolations(goodLine, goodRows, src)).toEqual([]);

    const violations = (line: string, rows: DocAdapterRow[]): string => adapterViolations(line, rows, src).join(' | ');

    // ① §7.1 漏一个源码 id（旧文的形状：写了 `cc` 而不是 `claude-code`）
    expect(violations('**实现侧 adapter id 全集（源码为准）**：`cc` `pi` `vessel`', goodRows)).toMatch(/漏了源码里的 adapter claude-code/);
    // ① §7.1 列了源码里没有的 id
    expect(violations(`${goodLine} \`ours\``, goodRows)).toMatch(/列了源码里没有的 adapter ours/);
    // ② §7.2 漏列源码 adapter
    expect(violations(goodLine, goodRows.filter((r) => r.id !== 'pi'))).toMatch(/清单漏了源码里的 adapter pi/);
    // ② §7.2 列了源码里没有的 adapter 又没标计划
    expect(violations(goodLine, [...goodRows.filter((r) => r.id !== 'claw-code'), { id: 'claw', planned: false }])).toMatch(/claw 在源码里没有对应 adapter 模块/);
    // ③ 计划标记过期（源码里已经有它）
    expect(violations(goodLine, [...goodRows, { id: 'pi', planned: true }])).toMatch(/豁免已过期/);
    // ④ 非计划行没进 §7.1 的 id 全集
    expect(violations(goodLine, [...goodRows, { id: 'codex', planned: false }])).toMatch(/codex 没进 §7.1 的 adapter id 全集/);
    // ④ 计划行反而进了 §7.1 的 id 全集
    expect(violations(`${goodLine} \`claw-code\``, goodRows)).toMatch(/claw-code 标了「计划」/);
    // 标记行消失 ⇒ markedLine 抛错（守卫的锚点不许被删）
    expect(() => markedLine('没有这行\n', ADAPTER_ID_LINE_MARKER)).toThrow(/找不到标记行/);
  });

  it('⑮ §7.3 family 名单 ⇄ asserts.ts 的 TOOL_FAMILY 表与兜底字面量；yaml 用到的 family 必须都在产出集∪兜底内', () => {
    const src = sourceToolFamilies(ASSERTS_SRC);
    const section73 = subsection(SPEC, '### 7.3 ToolFamily 归一化');
    const doc = docFamilyLists(section73);

    expect(src.families.length).toBeGreaterThan(0); // 抽取器不是空转
    expect(familyViolations(doc, src)).toEqual([]);

    // 反证（可执行）：实际写进 yaml 的 `family:` 值一个都不能是"无生产者"的规格意图值。
    // 今天 B016/B019 用的是兜底 `other`（不是 `mcp`/`delegate`）——若谁把 yaml 改成 `family: mcp`，
    // 这条与 ⑮ 的主断言会同时点名它。
    const legal = new Set([...src.families, src.fallback]);
    const scenarioIds = fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''))
      .sort();
    expect(scenarioIds.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const id of scenarioIds) {
      for (const p of loadManifest(REPO_ROOT, id).pass) {
        const f = (p as { family?: unknown }).family;
        if (typeof f === 'string') used.add(f);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((f) => !legal.has(f)).sort()).toEqual([]);
    // B016（Subagent 场景）与 B019（mcp__demo__add 调用）确实声明了 family —— 用兜底而不是 mcp/delegate
    for (const id of ['B016', 'B019']) {
      const fams = loadManifest(REPO_ROOT, id)
        .pass.map((p) => (p as { family?: unknown }).family)
        .filter((f): f is string => typeof f === 'string');
      expect(fams.length, `${id} 必须真的声明 family`).toBeGreaterThan(0);
      expect(fams.every((f) => legal.has(f)), `${id} 的 family 只能来自产出集 ∪ 兜底`).toBe(true);
    }
  });

  it('⑯ 判别性（合成输入）：§7.3 六类分叉各有红点；合规名单零 violations（负对照）', () => {
    const src = { families: ['exec', 'file_read', 'file_write', 'search'], fallback: 'other' };
    const good: DocFamilyLists = { produced: ['file_read', 'file_write', 'search', 'exec'], fallback: 'other', unproduced: ['delegate', 'mcp', 'approve'] };
    expect(familyViolations(good, src)).toEqual([]); // 负对照

    const v = (doc: DocFamilyLists): string => familyViolations(doc, src).join(' | ');

    // ① 产出集漏列源码 family
    expect(v({ ...good, produced: ['file_read', 'search', 'exec'] })).toMatch(/漏了源码 TOOL_FAMILY 里的 family：file_write/);
    // ① 旧文的形状：把 `write` 写成产出集成员（源码里没有这个 family）
    expect(v({ ...good, produced: [...good.produced, 'write'] })).toMatch(/列了源码 TOOL_FAMILY 里没有的 family：write/);
    // ② 旧文的形状：兜底写 `unknown`
    expect(v({ ...good, fallback: 'unknown' })).toMatch(/兜底写的是 "unknown"/);
    // ③ 把无生产者项挪进产出集（`delegate` 挪进去 ⇒ 两条红：多列 + 交集）
    expect(v({ ...good, produced: [...good.produced, 'delegate'] })).toMatch(/没有的 family：delegate/);
    // ④ 「无生产者」名单被清空
    expect(v({ ...good, unproduced: [] })).toMatch(/名单是空的/);
    // ④ 豁免过期：源码里已经有 `mcp` 了，文档还把它当"无生产者"
    expect(familyViolations({ ...good, unproduced: ['mcp'] }, { families: [...src.families, 'mcp'], fallback: 'other' }).join()).toMatch(/豁免已过期/);
    // ④ 把兜底也列进无生产者
    expect(v({ ...good, unproduced: [...good.unproduced, 'other'] })).toMatch(/把兜底 other 也列进/);
    // ⑤ 同一 family 同时在两处
    expect(v({ ...good, unproduced: [...good.unproduced, 'exec'] })).toMatch(/同时出现在产出集与无生产者名单里/);
    // 标记行消失 ⇒ markedLine 抛错
    expect(() => markedLine('没有这行\n', FAMILY_PRODUCED_MARKER)).toThrow(/找不到标记行/);
  });
});

// ---------------------------------------------------------------------------
// §0 / §1.1 / §8.3：门槛计分口径 ⇄ benchmarks/scenarios/ 的真实文件数
//
// 为什么要有这一条：§0 曾长期写着"B001–B015 全部逐一定义…另补 B016–B019 四个新增场景，总 19 ≥ 15"，
// §1.1/§8.3 又各写一套数字（"19 scenario manifest + fixtures"、"B001–B019 = 19 ✔"）——三处口径互相打架，
// 而"19"是**卡片数**、不是**有判据的场景数**（Round 170 裁决以"有 manifest 的场景数"为准）。
// 期望值不写常量：**真实值 = `benchmarks/scenarios/*.yaml` 的文件数**，文档只是被断言的对象。
// ---------------------------------------------------------------------------

/**
 * 正文里「有 manifest 的 …N…」门槛口径的数字（每节只看**第一处** `有 manifest`）。
 *
 * 只取该处之后 40 字符窗口里的第一个**独立整数**，并先把 `§3.1` / `行 201` / `Round 170` 这类
 * **引用编号**洗掉；前后紧邻字母的整数（`B001`、`S008` 里的 `001`/`008`）一律不认。
 * 之所以限定"第一处"：同一节里后面还会出现"9 张有 manifest（B001–B005…）"这样的举例，
 * 那里的数字是**场景清单**、不是门槛口径。
 */
function manifestCountClaims(text: string): string[] {
  const first = /有 manifest/.exec(text);
  if (!first) return [];
  const at = first.index;
  const window = text
    .slice(at, at + 40)
    .replace(/§\s*\d+(?:\.\d+)?/g, '')
    .replace(/行\s*\d+/g, '')
    .replace(/Round\s*\d+/g, '');
  const n = /(?:^|[^A-Za-z\d.])(\d+)(?![\d.])/.exec(window);
  return n ? [n[1] ?? ''] : [];
}

describe('BENCHMARK-SPEC §0/§1.1/§8.3 门槛口径 ⇄ benchmarks/scenarios/ 的真实场景数', () => {
  it('⑰ 三节都必须写明「有 manifest 的场景数」，且写的数字 == 目录里的 yaml 数', () => {
    const real = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.yaml')).length;
    expect(real).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const heading of ['## 0. 摘要', '### 1.1 目标公式', '### 8.3 验收对照']) {
      const claims = manifestCountClaims(subsection(SPEC, heading));
      if (claims.length === 0) {
        wrong.push(`${heading} 没有写出「有 manifest 的场景数」这一门槛口径（旧写法只写卡片数「19」时正是这样）`);
        continue;
      }
      for (const n of claims) if (Number(n) !== real) wrong.push(`${heading} 写的是 ${n}，实际有 manifest 的场景数是 ${real}`);
    }
    expect(wrong).toEqual([]);

    // 判别性（合成输入）：旧写法（只报卡片数「19 ≥ 15」）解析不出任何口径声明 ⇒ 会被 ⑰ 点名
    expect(manifestCountClaims('另补 B016–B019 四个新增场景，总 19 ≥ 15。')).toEqual([]);
    expect(manifestCountClaims('按「有 manifest 的场景数」= 25')).toEqual(['25']);
    expect(manifestCountClaims('有 manifest 的 25 个 scenario')).toEqual(['25']);
    // 引用编号（`Round 170`）与真实口径混排时，只认口径那一个数字
    expect(manifestCountClaims('有 manifest 的场景数 = 25（Round 170 裁决）')).toEqual(['25']);
  });
});

// ---------------------------------------------------------------------------
// §4.4 的 M09 口径 ⇄ scenarios/*.yaml 的 `measured` 声明
//
// 为什么要有这一条：§4.4 曾写着"只测量不判 pass（**B010 已声明**）"——而 `B010.yaml` **不存在**
// （B010 是 §3.1 里逐字带「未实现（无 manifest）」的规格意图卡），那句"已声明"没有任何载体；
// 附录 A 的 M09 行如实写 `（无）`。这条守卫把"点名了谁"变成可断言的事实。
// ---------------------------------------------------------------------------

/** §4.4 的 M09 条目：点名的场景必须有 manifest 且真的声明了 M09；没有 manifest 的必须逐字带豁免标记。 */
function m09BulletViolations(bullet: string): string[] {
  const out: string[] = [];
  for (const id of [...new Set(bullet.match(/[BS]\d{3}/g) ?? [])]) {
    if (hasManifest(id)) {
      if (!loadManifest(REPO_ROOT, id).measured.map(String).includes('M09')) {
        out.push(`§4.4 的 M09 条目暗示 ${id} 声明了 M09，但 benchmarks/scenarios/${id}.yaml 的 measured 里没有 M09`);
      }
    } else if (!bullet.includes(CARD_EXEMPT_MARKER)) {
      out.push(`§4.4 的 M09 条目点名了没有 manifest 的 ${id}，却没有逐字写出「${CARD_EXEMPT_MARKER}」`);
    }
  }
  return out;
}

describe('BENCHMARK-SPEC §4.4 的 M09 口径 ⇄ scenarios/*.yaml 的 measured 声明', () => {
  it('⑱ M09 条目点名的场景必须真的声明 M09；无 manifest 的必须带「未实现（无 manifest）」', () => {
    const bullet = subsection(SPEC, '### 4.4 跨 harness 可比性与口径局限')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('- M09'));
    expect(bullet, '§4.4 必须保留 M09 那条口径说明（删掉整条即红）').toBeTruthy();

    expect(m09BulletViolations(bullet ?? '')).toEqual([]); // 负对照：改准后零 violations

    // 判别性：旧写法「只测量不判 pass（B010 已声明）」——B010 没有 manifest 又没有豁免标记 ⇒ 红
    const legacy = '- M09 压缩触发阈值各家差异大（HARNESS-ANATOMY 行 201），只测量不判 pass（B010 已声明）。';
    expect(m09BulletViolations(legacy).join()).toMatch(/B010/);
    // 判别性：点名一个**有** manifest 但没声明 M09 的场景（如 B001）⇒ 也红
    expect(m09BulletViolations('- M09 只测量不判 pass（B001 已声明）。').join()).toMatch(/B001/);
  });
});
