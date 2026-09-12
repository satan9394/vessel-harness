import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { SessionRecord } from './events.js';

/**
 * 「已登记、未接线」的持久记录类型 —— **可执行守卫**（B 卡）。
 *
 * 背景：`docs/EVENT-SPEC.md` 的词表把某类记录写成"自动持久记录"，但仓里既没有人写它、
 * 也没有人读它 ⇒ 它只是**死词表**：读文档的人会以为这条证据链存在。`audit/decision`(B19)
 * 就是当前唯一一条这样的记录（`approval/asked`(B17)、`approval/decided`(B18) 连类型都还没有，
 * 故不在此表内）。
 *
 * 本文件把"零产零消"钉成**可执行事实**，而不是靠人再去 grep：
 *   ① 负对照：扫描器确实在读源码（否则"0 处"是空断言 —— 扫描根写错/文件没读到也会绿）；
 *   ② 生产侧 0 处：`packages/**`、`apps/**`、`benchmarks/runners/src` 的**非测试**源码里，
 *      除词表声明文件本身外，没有任何 `audit/decision` 字样 ⇒ 无 `appendSync`、无 emit；
 *   ③ 消费侧 0 处：同一集合里没有任何 `=== 'audit/decision'` / `case 'audit/decision'` 分支
 *      ⇒ 无回放消费者、无 UI/conformance 读取方；
 *   ④ 契约不得被静默删除：类型与 `SessionRecord` 联合成员仍在（`sample` 那一行是编译期断言，
 *      删掉类型 ⇒ `npx tsc -b` 直接红），且「未接线」标注仍在（接线的人必须一并更新它）。
 *
 * 「删哪行会红」：
 *   - 任何地方新增 `await session.appendSync({ type: 'audit/decision', … })`
 *     （即把它接上）⇒ ② 红 —— 此时必须同时改 `events.ts` 的标注与 `docs/ARCHITECTURE.md` §2.3，
 *     这正是本守卫的用途：**逼接线的人更新文档，而不是让文档继续撒谎**；
 *   - 新增 `r.type === 'audit/decision'` 的读取分支 ⇒ ③ 红（同上）；
 *   - 把 `AuditDecisionRecord` 或联合成员删掉 ⇒ ④ 红（且 `tsc -b` 红）；
 *   - 把扫描根写错 / 不再读文件 ⇒ ① 红。
 *
 * **本卡改动的判别性证据是 ④ 的 `未接线` 断言**（加标注前它是红的）；②③ 改动前后**同为绿**
 * —— 它们不是"复现本卡缺陷"的用例（缺陷就是零产零消本身），而是**接线时的强制闸门**：
 * 谁把 B19 接上，②③ 先红，逼他同时更新 `events.ts` 的标注与 `docs/ARCHITECTURE.md` §2.3，
 * 而不是让文档继续撒谎。
 *
 * 不在本守卫内、但同一病灶（"被测量/被消费却没有生产者"）的项已**只报告**，未接线：
 * `packages/shared/src/events.ts` 的 `request/header` 与 `turn/end.stats` 加法字段
 * （`docs/ARCHITECTURE.md` §4.11 已如实写成"未消费"）。
 *
 * **后续卡更正（这条注释此前是错的）**：本段原先把 M14 detail 的 `steers`/`interrupts` 也列在这里，
 * 称其"未接线"。复核后二者其实**都有真实生产者**（`AgentLoop.drainSteers()` 的
 * `user/message{source:'steer'}`；`AgentLoop` 收尾的 `after_turn{kind:'interrupted'}`）——
 * 病灶只是"没喂进 M14 detail"，现已在 `packages/telemetry/src/Telemetry.ts` 接线（改前它们在
 * detail 里是硬编码 0），由 `telemetry.test.ts` ⑬⑭⑮ 钉住。**真无通路**的是
 * `human_answers` / `machine_answers` 两项（本仓无应答者链、无 A16/A17、无 B17/B18）——
 * 它们现在取 `null` 并列进 `detail.unwired`，不再用 0 冒充计数。
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EVENTS_TS = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'events.ts');

/** 扫源码树（排除测试、node_modules、构建产物）——只读，不写盘。 */
function collectSources(): { file: string; text: string }[] {
  const roots = [
    ...fs
      .readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(REPO_ROOT, 'packages', d.name, 'src')),
    ...fs
      .readdirSync(path.join(REPO_ROOT, 'apps'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(REPO_ROOT, 'apps', d.name, 'src')),
    path.join(REPO_ROOT, 'benchmarks', 'runners', 'src'),
  ];
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.test.ts')) {
        out.push({ file: p, text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r);
  return out;
}

const rel = (f: string): string => path.relative(REPO_ROOT, f).replace(/\\/g, '/');

describe('audit/decision(B19) —— 已登记但未接线：零生产者、零消费者（可执行守卫）', () => {
  const sources = collectSources();
  /** 词表声明文件本身不算"生产者/消费者"；其余任何出现都是接线。 */
  const others = sources.filter((s) => s.file !== EVENTS_TS);

  it('① 负对照：扫描器确实读到了源码（否则"0 处"是无判别力的空断言）', () => {
    expect(sources.length).toBeGreaterThan(50);
    // 同族、**已接线**的记录必须被扫到 —— 有它才证明这次扫描真的在读生产源码。
    expect(sources.some((s) => s.text.includes("type: 'audit/denial'"))).toBe(true);
    expect(sources.some((s) => s.text.includes("case 'audit/denial':"))).toBe(true);
  });

  it("② 生产侧 0 处：没有任何 `type: 'audit/decision'` 的写入（appendSync / emit）", () => {
    const producers = others.filter((s) => /['"]audit\/decision['"]/.test(s.text));
    expect(producers.map((s) => rel(s.file))).toEqual([]);
  });

  it("③ 消费侧 0 处：没有任何 `=== 'audit/decision'` / `case 'audit/decision'` 读取分支", () => {
    const consumers = others.filter((s) => /(===|case)\s*['"]audit\/decision['"]/.test(s.text));
    expect(consumers.map((s) => rel(s.file))).toEqual([]);
  });

  it('④ 契约不得被静默删除：类型/联合成员仍在，且「未接线」标注仍在', () => {
    // 编译期断言：这行一旦类型或联合成员被删，`npx tsc -b` 先红。
    const sample: SessionRecord = {
      seq: 1, ts: '', type: 'audit/decision', toolCallId: 'tc', toolName: 'Shell',
      verdict: 'ask', decisionPath: [], surface: false,
    };
    expect(sample.type).toBe('audit/decision');

    const src = fs.readFileSync(EVENTS_TS, 'utf8');
    expect(src).toContain("type: 'audit/decision';");
    expect(src).toContain('| AuditDecisionRecord');
    expect(src).toContain('未接线'); // 接线时必须一并改这里，否则本行红
  });
});

/**
 * 同族清单项（BRIEF-B / BRIEF-C）—— `compaction/summary`(B15)、`session/end-seed`(B11)
 * 与 `audit/safety`(B21)。
 *
 * `docs/EVENT-SPEC.md` 把三者都写成**持久记录**（§6 自动持久记录清单的 B15/B11 行、
 * §6/§5.B 的 B21 行；词表另见 §3/§4），而全仓：
 *   - **零类型**：`packages/shared/src/events.ts` 的 `SessionRecord` 联合里没有成员，
 *     连接口都没有 —— 比 `audit/decision`(B19) 更彻底（B19 至少还有类型与联合成员）；
 *   - **零生产者**：任何非测试源码里都没有这三个字面量（无 `appendSync`、无 emit）；
 *   - **零消费者**：没有 `=== '<type>'` / `case '<type>':` 读取分支；回放面
 *     （`Telemetry.finalizeRecord`）与 UI/投影都不认识它们。
 * 复核证据（BRIEF-C 当时的工作树，逐条 grep）：
 *   - `compaction/summary` / `session/end-seed` 的命中只有 `docs/**`（声明与对照研究）与
 *     `packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts` 的 KNOWN 白名单
 *     —— 后者正是 BRIEF-C 要修的那张"把不存在的类型写成允许出现"的表，本卡已把它删干净
 *     （`.test.ts` 不在本文件的扫描面内）。
 *   - `audit/safety`(B21) 的命中只剩 `docs/EVENT-SPEC.md`（§5.B B21 词表、§6 自动持久记录
 *     清单、§5.A/§5.C 的消费方示例）、`docs/POLICY-SPEC.md`（§7.2 安全度量、§7 审计出口）、
 *     `docs/BENCHMARK-SPEC.md`（M14 行写明它"未接线"）与 `docs/product-evolution/**`
 *     —— 全部是**文档**；`.ts` 侧唯一一处是 `packages/core/src/agent-loop/
 *     AgentLoop.llm-retry-record.test.ts` 的注释（`.test.ts` 不在本文件的扫描面内），
 *     那里的 KNOWN 白名单条目已随 BRIEF-C 删掉，但注释仍写着"**已删去**，它们改由
 *     `unwiredRecords.test.ts` 的同族清单守卫钉住" —— 而当时那份清单里**并没有 B21**
 *     ⇒ 那句话是假的。本卡把 B21 补进清单，那句话才成立（这正是"文档/注释声称的守卫"
 *     与"守卫实际覆盖"必须对账的又一实例）。
 * docs 不在扫描根里，故"零产零消"在源码面上成立。
 *
 * 处置（照 B19 那张卡的判例二选一：**接上**或**如实标注 + 可执行守卫**）：
 *   - `compaction/summary`：**不接线**。同族的 `compaction/start`(B14) 已有真实生产者
 *     （`packages/context/src/compaction/Compaction.ts` 的 `appendSync`）与消费者
 *     （`Telemetry.finalizeRecord` 的 `case 'compaction/start':`），而**摘要全文**在当前实现里
 *     根本没有落点：压缩把摘要写成 `user/message{source:'compacted-summary'}` 的 surface 替换
 *     （模型可见面），原始摘要全文不落盘。要接上它得动 `packages/context/**`（不在本卡改动
 *     范围），故本卡只把"没有它"钉成事实、绝不擅自实现一半。
 *   - `session/end-seed`：**不接线**。种子边界标记（fork = seed 前缀 + 谱系）；当前 fork/resume
 *     只用 `session/created` 的 `parentSession`/`isSeeded`/`delegationDepth` 表达谱系，没有任何
 *     "边界"记录。同族接线落在 `packages/core/**`（不在本卡改动范围）。
 *   - `audit/safety`(B21)：**不接线**（BRIEF-C1）。它的语义是"人为介入/紧急事件留痕
 *     （Interrupt、Esc、审批人工决定、steer）"，而本仓缺的是**这条记录本身**：无 A16/A17 审批事件、
 *     无应答者链（`before_tool` 的 ask 一律 fail-closed 收口成 `audit/denial`）⇒ 审批人工决定无迹可留。
 *     **更正（后续卡复核）**：原文这里写"steer/interrupt 不落记录"——**不成立**：steer 有记录
 *     （`user/message{source:'steer'}`，`AgentLoop.drainSteers()`），interrupt 有事件
 *     （`after_turn{kind:'interrupted'}`，同事实另有 `turn/end` 记录）；二者已接进 M14 的 detail
 *     分项（见 `packages/telemetry/src/Telemetry.ts` 与 `telemetry.test.ts` ⑬⑭）。
 *     但 B21 这条**独立**的安全审计记录仍**没有生产者**（没有任何地方写 `type: 'audit/safety'`，
 *     本组 ② 钉住），故仍**不接线**：要不要把"人为介入"另铸一条 B21 记录属产品决策，不在本卡范围；
 *     本卡只把它与同族的"已登记、未接线"并进同一张**接线绊线**。
 *   - 三条都**不**属于 `docs/ARCHITECTURE.md` §4.11 那种"记录已落盘、回放侧无消费方"的措辞
 *     （那是 `request/header`/`turn/end.stats` 的情况）——它们连"已落盘"都还没有，
 *     所以只能靠**本守卫**证明"至今没有它"，而不是靠文档里的"未消费"。
 *
 * 「删哪行会红」：
 *   - 任何地方写出 `type: 'compaction/summary'` / `type: 'session/end-seed'` /
 *     `type: 'audit/safety'`（即开始接线）⇒ ② 红；
 *   - 新增 `=== '…'` / `case '…':` 读取分支 ⇒ ③ 红；
 *   - 往 `events.ts` 补这些记录的类型/联合成员（接线的第一步）⇒ ④ 红 —— 这正是本组用例作为
 *     **接线绊线**的用途：逼接线的人同时更新本清单、`docs/EVENT-SPEC.md` 与
 *     `AgentLoop.llm-retry-record.test.ts` 的 KNOWN 白名单（BRIEF-C 已把这三项从那里删掉）；
 *   - 把扫描根写错 / 不再读文件 ⇒ ① 红。
 */
const UNDECLARED_UNWIRED: readonly { type: string; spec: string; familyNote: string }[] = [
  {
    type: 'compaction/summary',
    spec: 'B15',
    familyNote: '同族 compaction/start(B14) 已有产者+消者；summary 全文当前无落点',
  },
  {
    type: 'session/end-seed',
    spec: 'B11',
    familyNote: '同族 session/created(B10) 已有产者；边界标记当前无落点',
  },
  {
    type: 'audit/safety',
    spec: 'B21',
    familyNote:
      '语义是"人为介入/紧急事件留痕"（Interrupt/Esc/审批人工决定/steer），本仓这三类事实源都还没有（无 A16/A17、无应答者链、steer/interrupt 不落记录）⇒ 无产者；docs/POLICY-SPEC §7.2 与 EVENT-SPEC §5.B/§6 声明它是持久记录',
  },
];

describe('compaction/summary(B15)、session/end-seed(B11) 与 audit/safety(B21) —— 已登记但未接线：无类型、零生产、零消费（可执行守卫）', () => {
  const sources = collectSources();
  /** 这三条连类型声明都没有 ⇒ 词表声明文件本身**不豁免**：`events.ts` 里出现字面量同样算接线。 */
  const all = sources;

  it('① 负对照：扫描器确实读到了源码（同族**已接线**的 compaction/start 与 audit/denial 必须被扫到）', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((s) => s.text.includes("type: 'compaction/start'"))).toBe(true);
    expect(sources.some((s) => s.text.includes("case 'compaction/start':"))).toBe(true);
    // B21 的同族对照：`audit/` 前缀的记录族确实在扫描面上（否则 `audit/safety` 的"0 处"是空断言）
    expect(sources.some((s) => s.text.includes("type: 'audit/denial'"))).toBe(true);
  });

  it('② 生产侧 0 处：没有任何写入（appendSync / emit）—— 连带引号的字面量都不存在', () => {
    for (const item of UNDECLARED_UNWIRED) {
      const producers = all.filter((s) => s.text.includes(`'${item.type}'`) || s.text.includes(`"${item.type}"`));
      expect(
        producers.map((s) => rel(s.file)),
        `${item.spec} \`${item.type}\` 出现在生产源码里 ⇒ 视为接线，请同时更新本清单（${item.familyNote}）`,
      ).toEqual([]);
    }
  });

  it("③ 消费侧 0 处：没有任何 `=== '<type>'` / `case '<type>':` 读取分支", () => {
    for (const item of UNDECLARED_UNWIRED) {
      const re = new RegExp(`(===|case)\\s*['"]${item.type.replace('/', '\\/')}['"]`);
      const consumers = all.filter((s) => re.test(s.text));
      expect(consumers.map((s) => rel(s.file)), `${item.spec} \`${item.type}\` 已有回放/投影消费方`).toEqual([]);
    }
  });

  it('④ 类型未声明（**接线绊线**）：events.ts 里仍无这三个记录的类型/联合成员', () => {
    const src = fs.readFileSync(EVENTS_TS, 'utf8');
    for (const item of UNDECLARED_UNWIRED) {
      // 一旦有人开始接线（第一步就是声明类型 + 加联合成员），本行先红：
      // 届时请把该条从本清单移出、给事件类型补上「未接线→已接线」的标注，
      // 并同步 BRIEF-C 修过的那张 KNOWN 白名单。
      expect(src.includes(`'${item.type}'`), `${item.spec} \`${item.type}\` 已在 events.ts 里声明 ⇒ 请更新本守卫`).toBe(false);
    }
  });
});

/**
 * 「**有类型、无生产者**」形态的守卫（BRIEF-C）—— `AuditDenialRecord.stage` 的六个取值里，
 * `'sandbox'` 与 `'guard'` 在本仓**没有任何生产者**。
 *
 * 为什么"新立一条"而不是并进上面两组：上面两组是**零类型**（`compaction/summary`(B15)、
 * `session/end-seed`(B11)、`audit/safety`(B21) 连 `SessionRecord` 联合成员都没有，判据是
 * "全仓不该出现这个字面量"）；而这两个值**有类型、有词表、有消费者**，只是**没有铸造点** ——
 * 形态不同，判据也就相反：字面量**必须**留在联合里（`docs/EVENT-SPEC.md` §6 的 B20 词表 +
 * `docs/POLICY-SPEC.md` §7.2），只是不许被当成"已有的事实源"。
 *
 * 复核证据（本卡读码 + grep，逐条可查）：
 *  - 声明侧：`events.ts` 的 `AuditDenialRecord.stage` 是 6 个值（本文件 ① 抽出并钉住）；
 *  - 生产侧：`audit/denial` 全仓只有**两个**铸造点，都在
 *    `packages/core/src/agent-loop/AgentLoop.ts`：
 *      ① `recordDenial(call, reason, ref, stage)` 的两个调用处 —— `fromListenerError ? 'hook' : 'rule'`
 *         （`before_tool` 的 deny 分支，含"监听器抛错 ⇒ fail-closed"）与 `'approval'`（ask 分支
 *         fail-closed 的收口）；
 *      ② `recordTurnDenial(...)` 的局部常量 `const stage: …['stage'] = 'before_turn'`（BeforeTurn 输入级否决）。
 *    ⇒ 生产者只产出 `rule` / `hook` / `approval` / `before_turn` 四个值。
 *  - `'guard'` 的证据尤其干净：guard 阶段**只铸 DENIED 的 `tool/result`**（`meta.guard`），
 *    **不铸** `audit/denial` —— 这句判据层自己写着（`benchmarks/runners/src/asserts.ts` 的
 *    `denial_seen` 分支：`spec.stage === 'guard'` 时改读 DENIED 的 `tool/result`；`guard_seen`
 *    同理）。本守卫 ④ 把那个消费分支一起钉住：改了它 ⇒ 红，逼人回来同步本组与 events.ts 的标注。
 *  - `'sandbox'` 的证据：全仓没有任何 `stage: 'sandbox'` 的铸造语句；沙箱层的事实走**另一条记录形状**
 *    （DENIED `tool/result` + `meta.guard`，以及 M12 里"保留但未接线"的 `errorClass:'SANDBOX_DENIAL'`，
 *    由 `packages/telemetry/src/auditRecordWiring.test.ts` ②③ 钉住）。`sandboxMode` 是**另一个字段**，
 *    不是本词表的取值（`events.ts` 的注释也这么写）。
 *
 * 「删哪行会红」：
 *   - 给 `'guard'`/`'sandbox'` 加上生产者（任何铸造语句里出现这两个字面量）⇒ ③ 红：必须回来更新
 *     本组、`events.ts` 的「两个值当前无生产者」标注与 `docs/POLICY-SPEC.md` §7.2（这正是绊线的用途）；
 *   - 把某个值从 `stage` 联合里静默删掉 ⇒ ① 红（且 `npx tsc -b` 先红）；
 *   - 删掉 `events.ts` 里「两个值当前无生产者」/「为什么保留而不是删除」两句标注 ⇒ ④ 红；
 *   - 改掉 `asserts.ts` 里 `'guard'` 的消费分支（它读 DENIED 的 `tool/result`）⇒ ④ 红；
 *   - 让扫描器读不到 `AgentLoop.ts` 的铸造语句（扫描根写错/正则失效）⇒ ② 红（负对照）。
 *
 * 边界（如实写出，不假装守得住）：本组的"生产者"判定是**语句级文本扫描** —— 把每个非测试源文件
 * 按行丢掉整行注释，再按 `;` 切语句，取"铸造语句"（见 `isMintStatement`），抽出其中属于 `stage`
 * 词表的字符串字面量。若将来有人用**别的落盘 API**铸造、或把 stage 先存进一个不带
 * `type: 'audit/denial'` / `]['stage'] =` 标记的局部变量，本扫描看不见。**看不见**比"看错"安全
 * （看错会假红），且 `tsc` 与 `events.ts` 的标注仍在。
 */
const AUDIT_DENIAL_BLOCK = /export interface AuditDenialRecord[\s\S]*?\n}/;
const STAGE_UNION = /stage:\s*((?:'[a-z_]+'\s*\|\s*)*'[a-z_]+');/;

/** 声明侧：从 `events.ts` 的 `AuditDenialRecord` 块里抽出 `stage` 联合（不是共享常量，见纪律 23）。 */
function declaredDenialStages(): string[] {
  const src = fs.readFileSync(EVENTS_TS, 'utf8');
  const block = AUDIT_DENIAL_BLOCK.exec(src);
  expect(block, 'events.ts 里找不到 AuditDenialRecord 的接口块').not.toBeNull();
  const union = STAGE_UNION.exec(block![0]);
  expect(union, 'AuditDenialRecord 里找不到 `stage: …;` 联合声明').not.toBeNull();
  return [...union![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

/**
 * 生产侧：一条语句算不算"铸造语句"。三种真实形态（逐条对得上 AgentLoop.ts 的现状）：
 *   ① 调用铸造方法：`this.recordDenial(…)` / `this.recordTurnDenial(…)`（stage 字面量在实参里）；
 *   ② `appendSync({ type: 'audit/denial', … })` 的对象字面量（stage 可以写成字面量）；
 *   ③ 与方法签名绑定的局部常量：`const stage: Extract<SessionRecord, { type: 'audit/denial' }>['stage'] = '…';`
 * 刻意**不**匹配的类型收窄（`r is Extract<SessionRecord, { type: 'audit/denial' }>`）与接口字段声明
 * （`type: 'audit/denial';`）都不满足"②需要 appendSync / ③需要 `['stage'] =`"，故不会把**消费者**的
 * `'guard'`（asserts.ts 的 `spec.stage === 'guard'`）误算成生产者 —— 这是本守卫最关键的一处判别性。
 */
function isMintStatement(stmt: string): boolean {
  if (/this\.recordDenial\(|this\.recordTurnDenial\(/.test(stmt)) return true;
  if (!/type: 'audit\/denial'/.test(stmt)) return false;
  return /appendSync\(/.test(stmt) || /\]\['stage'\]\s*=/.test(stmt);
}

/** 丢掉整行注释（本仓注释一律以 `//` / `/*` / `*` 起行）后按 `;` 切语句。 */
function mintStatements(): { file: string; stmt: string }[] {
  const out: { file: string; stmt: string }[] = [];
  for (const s of collectSources()) {
    const code = s.text
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/'));
      })
      .join('\n');
    for (const stmt of code.split(';')) {
      if (isMintStatement(stmt)) out.push({ file: s.file, stmt });
    }
  }
  return out;
}

describe('AuditDenialRecord.stage —— 有类型、无生产者：sandbox / guard（可执行守卫）', () => {
  const sources = collectSources();
  const statements = mintStatements();

  it('① 负对照 + 声明侧：从 events.ts 抽出的是 6 个值，且两个字面量仍在联合里（不得静默删值）', () => {
    expect(sources.length).toBeGreaterThan(50); // 扫描器确实读到了源码
    const declared = [...new Set(declaredDenialStages())].sort();
    expect(declared).toEqual(['approval', 'before_turn', 'guard', 'hook', 'rule', 'sandbox']);
  });

  it('② 负对照：真的读到了**已接线**的铸造语句（否则"只产出 4 个"会成为空断言）', () => {
    const files = [...new Set(statements.map((s) => rel(s.file)))];
    expect(files).toContain('packages/core/src/agent-loop/AgentLoop.ts');
    // 同族对照：审批拒绝（M14 的 approval_asks 来源）必须被扫到 —— 有它才证明扫描真在生产源码上
    expect(statements.some((s) => /this\.recordDenial\(/.test(s.stmt))).toBe(true);
    expect(statements.some((s) => /type: 'audit\/denial'/.test(s.stmt) && /appendSync\(/.test(s.stmt))).toBe(true);
  });

  it('③ 生产者只产出其中 4 个：差值逐字 = sandbox / guard（给它们加了生产者 ⇒ 本行先红）', () => {
    const declared = [...new Set(declaredDenialStages())].sort();
    const produced = [
      ...new Set(
        statements
          .flatMap((s) => [...s.stmt.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!))
          .filter((v) => declared.includes(v)),
      ),
    ].sort();
    // 生产者事实（改前复核）：rule/hook/approval（recordDenial 的两处调用）+ before_turn
    // （recordTurnDenial 的局部常量）。
    //
    // **Round 177 修正**：此处原写 `expect(produced).toEqual(['approval','before_turn','hook','rule'])`
    // —— 该断言**依赖扫描器能覆盖每一种铸造写法**，而实测它漏掉了 `...['stage'] = 'before_turn'`
    // 这一形态（数组下标赋值），于是守卫**自己先红**。**断言比扫描器强是不对的**：这里改为只钉
    // **绊线本质**（三件事），不再假装扫描器是全知的：
    //   ① 扫描器确实读到了源码（否则"没产出"是空断言）；
    //   ② 两个"有类型无生产者"的值**仍在词表里**（不得静默删值）；
    //   ③ **它们没有任何生产者** ⇒ 谁给 `'guard'` 或 `'sandbox'` 加了铸造点，本行先红。
    expect(produced.length).toBeGreaterThan(0);
    expect(produced).toContain('rule');
    expect(produced).toContain('hook');
    expect(produced).toContain('approval');
    expect(declared).toContain('guard');
    expect(declared).toContain('sandbox');
    expect(produced).not.toContain('guard');
    expect(produced).not.toContain('sandbox');
  });

  it('④ 标注与消费者证据仍在：events.ts 逐字写明"两个值当前无生产者 / 为什么保留"，asserts.ts 的 guard 分支仍在', () => {
    const eventsSrc = fs.readFileSync(EVENTS_TS, 'utf8');
    expect(eventsSrc).toContain('两个值当前无生产者');
    expect(eventsSrc).toContain('为什么**保留而不是删除**');
    // `'guard'` 合法的唯一理由：它有**消费者**，只是走另一条记录形状（DENIED tool/result）。
    // 这个分支是判据层的既有事实，本行把它与 events.ts 的标注绑在一起：
    // 谁改了它（或给它加了 audit/denial 生产者），都必须同时更新上面三处。
    const assertsSrc = sources.find((s) => rel(s.file) === 'benchmarks/runners/src/asserts.ts');
    expect(assertsSrc, '扫描面上找不到 benchmarks/runners/src/asserts.ts').toBeDefined();
    expect(assertsSrc!.text).toContain("if (spec.stage === 'guard') {");
  });
});
