import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
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
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC_PATH = path.join(REPO_ROOT, 'docs', 'BENCHMARK-SPEC.md');
const SCENARIOS_DIR = path.join(REPO_ROOT, 'benchmarks', 'scenarios');

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

/** 场景列 → 每个 id 以及它的"（未实现）"标记（标记只认**紧跟**在 id 后的那一段）。 */
function parseScenarioCell(cell: string): { id: string; exempt: boolean }[] {
  const matches = [...cell.matchAll(/B\d{3}/g)];
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
