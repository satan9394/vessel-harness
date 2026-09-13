import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * 任务卡 W1（R1/R2）—— 把「**成功收尾 + 两条来源**」这套**条件**从"上一轮写对了、但没有任何
 * 测试守着"变成可执行事实（来源：`.dsh-mission/evidence/C8-review-verdict.md` §6.2 的 R1/R2）。
 *
 * 守的是什么（条件，不是散文）：`AgentLoop.ts:636` 的
 * `const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);` 为假**有两条来源** ——
 * ① 错误类别不可重试（`MODEL_RETRYABLE` 之外）**或**② **错误类别可重试但重试预算耗尽**
 * （`attempt > maxRetries`）；两者都经 `AgentLoop.ts:649-651` 的 `throw` ⇒ `:462-463` 的
 * `else { throw err; }` ⇒ `:528` 的 `turn/end` **永不落盘**（而 `:208-212` 的 `before_turn` 已发）。
 * 于是 §4.11 / M02 / M03 那类"记录条数 = 回合数 = `before_turn` 事件数"的依据**只在「成功收尾的
 * 回合」上成立**。谁把条件改回窄口径（删「预算耗尽」）或删掉 M03 特有的第三条反例（「重叠」）
 * ⇒ 本文件**指名**变红（失败信息逐条列出缺了哪个词）。
 *
 * 写法（纪律 23/24：不把实现选择当契约；判别性优先）：
 *  - **按锚点定位**：每个锚点先用**唯一前缀**取到那一行 / 那段注释（`anchorLine` /
 *    `anchorCommentBlock`），再在这段文本上断言关键短语；**不**对整文件做 `includes`
 *    （否则同一个词出现在别的段落会让守卫假绿）；
 *  - **不钉行号**：锚点按内容定位 —— 行号会因上文增删而漂移（纪律 25 的同一条道理）。
 *    匹配**以物理行为单位**（`anchorLine` 只看前缀命中的那一行，`anchorCommentBlock` 只看注释块那几行），
 *    故"在某锚点上方插入一行空白 / 在注释块里插一行 / 改标点"**不该**变红（负面对照 N1–N4）；
 *    **但把锚点行里的关键短语折到第二行会变红**（前缀仍留在第一行、短语落到续行 ⇒ 该行两词皆无）——
 *    这是本守卫**已知的脆弱点**（W3b 实测；见 `tasks/121` §6.8）：纯排版折行会被判成"条件被删"，
 *    复核者遇到 R1-* 变红应**先排除折行**，再判断文档是否真的删了条件；
 *  - **不镜像**（纪律 22）：直接读真实文件（`Telemetry.ts`、四份 docs、本包测试文件自身），
 *    不把注释复制进测试再断言副本；
 *  - 每个锚点**只**断言关键短语的存在与归属，不逐字钉死整段散文。
 *
 * R2 的形态仿既有 ⑤（§4.11 ⇄ `finalizeRecord` 的 `case` 集合）、⑨（M14）、⑫（M13）：
 * `BENCHMARK-SPEC.md` 的 M02/M03 行点名的机制必须在代码里**真实存在**（`case 'turn/end':`
 * 分支、`stats.toolCalls`、按 `turnId` 去重）；反过来，那个分支**真正消费**的字段若没被这两行
 * 点名 ⇒ 也红（下面第二条用例的分支集合断言 = "多一个未点名的消费项就红"）。
 */

const TELEMETRY_SRC = fileURLToPath(new URL('./Telemetry.ts', import.meta.url));
const TELEMETRY_TEST_SRC = fileURLToPath(new URL('./telemetry.test.ts', import.meta.url));
const ARCHITECTURE_MD = fileURLToPath(new URL('../../../docs/ARCHITECTURE.md', import.meta.url));
const BENCHMARK_SPEC_MD = fileURLToPath(new URL('../../../docs/BENCHMARK-SPEC.md', import.meta.url));
const EVENT_SPEC_MD = fileURLToPath(new URL('../../../docs/EVENT-SPEC.md', import.meta.url));
const PRODUCT_STATE_MD = fileURLToPath(new URL('../../../docs/product-evolution/PRODUCT-STATE.md', import.meta.url));

/**
 * 被守卫的**两个关键短语**（R1 的判据本体）。文档里的措辞是「重试预算耗尽」，
 * 故按子串 `预算耗尽` 命中（`includes`）；「成功收尾」在 EVENT-SPEC 那一处以它的补集形式
 * 「非成功收尾」出现 —— 同一条件，锚点仍是那一行。
 */
const CONDITION = ['成功收尾', '预算耗尽'] as const;

function lines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n');
}

/** 按**唯一前缀**定位锚点行（逐行定位；0 行 = 锚点被删/改写，>1 行 = 锚点不唯一，都算红）。 */
function anchorLine(file: string, prefix: string): string {
  const hits = lines(file).filter((l) => l.startsWith(prefix));
  expect(hits.length).toBe(1);
  return hits[0]!;
}

/** 按**唯一前缀**定位一段注释块：从该行起、到其后第一个注释结束行为止（含两端）。 */
function anchorCommentBlock(file: string, prefix: string): string {
  const all = lines(file);
  const start = all.findIndex((l) => l.startsWith(prefix));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = all.findIndex((l, i) => i > start && l.trim() === '*/');
  expect(end).toBeGreaterThan(start);
  return all.slice(start, end + 1).join('\n');
}

/** 关键短语缺席 ⇒ 失败信息**逐条点名**缺了哪个词（而不是回吐整段散文）。 */
function expectCondition(text: string, extra: readonly string[] = []): void {
  const missing = [...CONDITION, ...extra].filter((phrase) => !text.includes(phrase));
  expect(missing).toEqual([]);
}

describe('W1/R1 —— 「成功收尾 + 预算耗尽」条件守卫（8 个锚点）', () => {
  it('R1-1 Telemetry.ts 类注释「B09 `turn/end` 记录的接线」段：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorCommentBlock(TELEMETRY_SRC, ' * B09 `turn/end` 记录的接线'));
  });

  it('R1-2 telemetry.test.ts 文件头 BRIEF 段：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorCommentBlock(TELEMETRY_TEST_SRC, ' * BRIEF —— 新造的三类持久记录'));
  });

  it('R1-3 docs/ARCHITECTURE.md:176 不变式行：同时含「成功收尾」与「预算耗尽」', () => {
    // 定位前缀是该行开头的 `不变式（贯穿全图，D5 §8）`（不是行号 176 —— 行号会漂）。
    expectCondition(anchorLine(ARCHITECTURE_MD, '不变式（贯穿全图，D5 §8）'));
  });

  it('R1-4 docs/ARCHITECTURE.md:372 §4.11 telemetry 行：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorLine(ARCHITECTURE_MD, '| telemetry/（会话生命周期'));
  });

  it('R1-5 docs/BENCHMARK-SPEC.md:575 M02 行：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorLine(BENCHMARK_SPEC_MD, '| M02 |'));
  });

  it('R1-6 docs/BENCHMARK-SPEC.md:576 M03 行：另含 M03 特有的第三条反例「重叠」', () => {
    // M03 与 M02 的唯一差别：它的反例**多一条**（回合重叠时旧回合落盘读到新回合计数器），
    // 故该行除两个关键短语外还必须有「重叠」这个词 —— 少了它就是条件被改窄。
    // 该行的「重叠」有**两处、角色不同**，所以只断言"存在这个词"是名不副实的（W3b 修）：
    //   ① 作用域限定语「**在"成功收尾且未被另一个 `runTurn` 重叠"的回合上**」—— 陈述等式成立的边界；
    //   ② 第三条并列反例本体「③ 回合重叠时旧回合落盘读到的是新回合计数器…」—— M03 比 M02 多出的那一条。
    // 只钉词时删掉 ② 仍绿（限定语里还留着一处「重叠」）⇒ 改断言**出现次数 ≥2**，
    // 于是删掉 ②（连同把"三条并列反例"改回"两条"）就会指名变红。
    // 刻意**不**把 ③ 从句整句逐字钉死（纪律 23：散文措辞不是契约，否则改标点/同义改写即红）。
    const m03 = anchorLine(BENCHMARK_SPEC_MD, '| M03 |');
    expectCondition(m03, ['重叠']);
    expect([...m03.matchAll(/重叠/g)].length).toBeGreaterThanOrEqual(2);
  });

  it('R1-7 docs/EVENT-SPEC.md:605 不变式行（已登记例外清单）：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorLine(EVENT_SPEC_MD, '不变式（贯穿全图）：'));
  });

  it('R1-8 docs/product-evolution/PRODUCT-STATE.md:823 欠账行：同时含「成功收尾」与「预算耗尽」', () => {
    expectCondition(anchorLine(PRODUCT_STATE_MD, '`request/header` 与 `turn/end.stats`'));
  });
});

describe('W1/R2 —— BENCHMARK-SPEC M02/M03 行 ⇄ 代码的双向守卫', () => {
  /** 代码事实：`finalizeRecord` 的 `case 'turn/end':` 分支体（剔掉行注释后的可执行部分）。 */
  function turnEndBranchCode(): string {
    const all = lines(TELEMETRY_SRC);
    const start = all.findIndex((l) => l.trim() === "case 'turn/end':");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = all.findIndex((l, i) => i > start && l.trim() === 'default:');
    expect(end).toBeGreaterThan(start);
    return all.slice(start, end).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  }

  it('R2-文档→代码：M02/M03 行点名的 `case \'turn/end\':`、`turnId` 去重、`stats.toolCalls` 在代码里真实存在', () => {
    const src = fs.readFileSync(TELEMETRY_SRC, 'utf8');
    const m02 = anchorLine(BENCHMARK_SPEC_MD, '| M02 |');
    const m03 = anchorLine(BENCHMARK_SPEC_MD, '| M03 |');

    // 文档点名 ⇒ 代码必须有分支与机制（只改文字不动代码 ⇒ 本用例红）
    expect(m02).toContain("case 'turn/end':");
    expect(src).toContain("case 'turn/end':");
    expect(m03).toContain('turn/end.stats.toolCalls');
    expect(src).toContain('this.counters.toolCalls += r.stats.toolCalls;');
    // 两行都点名的 `turnId` 去重（M02 是身份面、M03 同一去重）：代码里必须真有那一判据
    expect(m02).toContain('turnId');
    expect(m03).toContain('turnId');
    expect(src).toContain('this.liveTurnIds.has(r.turnId)');
  });

  it('R2-代码→文档：`case \'turn/end\':` 分支真正消费的字段/计数器都被 M02/M03 行点名（多一个未点名的消费项 ⇒ 红）', () => {
    const branch = turnEndBranchCode();
    // 分支读的记录字段与它自增的计数器（从**可执行文本**里抽，不是从注释里抄）
    const reads = [...branch.matchAll(/\br\.([A-Za-z][A-Za-z0-9_.]*)/g)].map((m) => m[1]!);
    const counters = [...branch.matchAll(/this\.counters\.([A-Za-z]+)\s*\+=/g)].map((m) => m[1]!);

    // 代码事实：这条记录**只**消费这两项（`stats.steps`/`tokensUsed`/`costEstimate` 刻意不取，
    // 理由见 `Telemetry.ts` 类注释）。将来多读一个字段 ⇒ 这里先红，逼作者同时更新文档与本表。
    expect(new Set(reads)).toEqual(new Set(['turnId', 'stats.toolCalls']));
    expect(new Set(counters)).toEqual(new Set(['turns', 'toolCalls']));

    // 映射即契约：回合身份 → M02 行；`stats.toolCalls` → M03 行。代码有、文档没点名 ⇒ 红。
    const m02 = anchorLine(BENCHMARK_SPEC_MD, '| M02 |');
    const m03 = anchorLine(BENCHMARK_SPEC_MD, '| M03 |');
    expect(m02).toContain('turnId');
    expect(m03).toContain('stats.toolCalls');
  });
});
