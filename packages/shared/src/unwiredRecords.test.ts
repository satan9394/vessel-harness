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
 * （`docs/ARCHITECTURE.md` §4.11 已如实写成"未消费"），以及 M14 detail 里的
 * `steers`/`interrupts`/`human_answers`（见 `telemetry.test.ts` 与本卡报告）。
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
