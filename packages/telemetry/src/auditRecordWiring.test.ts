import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * 「声明了、却没有任何生产者（或没有任何消费者）」—— **可执行守卫**（BRIEF B + D）。
 *
 * 与 `packages/shared/src/unwiredRecords.test.ts` 同一套做法（先负对照证明扫描器真在读源码，
 * 再把"零产/零消"钉成可执行事实），对象是**审计记录族的两处对外声明**：
 *
 *  B) `docs/BENCHMARK-SPEC.md` §4.1 的 M12 行曾把 `tool/error SANDBOX_DENIAL` 写成**自家来源**。
 *     复核结论（本文件 ②③④ 是它的可执行版本）：
 *       - 生产侧 0 处：全仓没有任何 `errorClass: 'SANDBOX_DENIAL'` 的**铸造点**；
 *         现存字样只有三处**非生产者**：`packages/shared/src/events.ts` 的 errorClass 类型联合、
 *         `apps/cli/src/cli.ts` 与 `apps/cli/src/tui/chat.ts` 的**匹配用正则**。
 *       - 消费侧 0 处：`Telemetry.finalizeRecord` 只认 `tool/result` 的 `INVALID_ARGS` 与
 *         `audit/denial`；即使将来真有人铸出该 errorClass，也**不会**进 M12。
 *     ⇒ 规格按真话改：M12 行保留该词、但标为**保留未接线**，且**不再**把它列进"来源"列。
 *
 *  D) `configs/policy.default.yaml` 的 `audit.events` 列着 `decision` / `denial` / `approval`，
 *     而本仓**只产出 `denial`**：`audit/decision`(B19) 零产零消；`approval/asked`(B17) /
 *     `approval/decided`(B18) **连类型都不存在**。⇒ 未实现的两项在配置里被显式标注为**未接线**，
 *     且本文件的 ⑤ 把那句标注与实现**双向绑定**（谁接上 `audit/decision`，⑤ 的"生产侧 0 处"先红，
 *     逼他同时改配置注释与规格，而不是让配置继续撒谎）。
 *
 * 「删哪行会红」：
 *   - 铸出一条 `errorClass: 'SANDBOX_DENIAL'` ⇒ ② 红（须先把它接进 telemetry 与 M12 口径）；
 *   - 把 `SANDBOX_DENIAL` 写回 M12 的"来源"列（或删掉整行的该词）⇒ ④ 红；
 *   - 接上 `audit/decision` 的生产者 ⇒ ⑤ 红（配置注释与规格必须一起改）；
 *   - 把 `denial` 从 `audit.events` 里删掉（削弱对 denial 的要求）⇒ ⑤ 红；
 *   - 让扫描器不再读文件/读不到 `audit/denial` 这一已接线同族 ⇒ ① 红。
 *
 * 为什么这个守卫住在 telemetry：它是这些记录的**消费端**（`finalizeRecord`），
 * 且"文档⇄代码双向绑定"的既有守卫（`telemetry.test.ts` ⑤）也在这里。
 * `docs/ARCHITECTURE.md` 与 `docs/POLICY-SPEC.md` 里同族的表述不在本卡改动范围，见交付报告。
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EVENTS_TS = path.join(REPO_ROOT, 'packages', 'shared', 'src', 'events.ts');
const TELEMETRY_TS = path.join(REPO_ROOT, 'packages', 'telemetry', 'src', 'Telemetry.ts');
const POLICY_YAML = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BENCHMARK_SPEC_MD = path.join(REPO_ROOT, 'docs', 'BENCHMARK-SPEC.md');

/** 扫源码树（排除测试、node_modules、构建产物）——只读，不写盘（与 unwiredRecords.test.ts 同根）。 */
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

describe('审计记录族的对外声明 ⇄ 实现一致性（BRIEF B + D，可执行守卫）', () => {
  const sources = collectSources();
  /** 词表声明文件本身不算"生产者"（`type: 'audit/decision';` 这类接口成员声明住在那里）。 */
  const others = sources.filter((s) => s.file !== EVENTS_TS);
  /** 某个记录类型有没有 `type: '<record>'` 的写入点（appendSync/emit 都会带这个字面量）。 */
  const producersOf = (record: string): string[] =>
    others.filter((s) => s.text.includes(`type: '${record}'`)).map((s) => rel(s.file));

  it('① 负对照：扫描器确实读到了源码，且看得到**已接线**的同族记录（否则"0 处"是空断言）', () => {
    expect(sources.length).toBeGreaterThan(50);
    // 同族、已接线的 B20：生产端（AgentLoop）与消费端（Telemetry）都必须被扫到
    expect(producersOf('audit/denial').length).toBeGreaterThan(0);
    expect(sources.some((s) => s.file === TELEMETRY_TS && s.text.includes("case 'audit/denial':"))).toBe(true);
  });

  // ---------------------------------------------------------------- B: SANDBOX_DENIAL
  it("② `SANDBOX_DENIAL` 生产侧 0 处：全仓没有任何 `errorClass: 'SANDBOX_DENIAL'` 的铸造点", () => {
    const minters = others.filter((s) => /errorClass:\s*'SANDBOX_DENIAL'/.test(s.text)).map((s) => rel(s.file));
    expect(minters).toEqual([]);
    // 词表声明（类型联合）仍在 —— 删类型会让 `npx tsc -b` 先红，这里只钉"声明在、铸造点不在"
    expect(fs.readFileSync(EVENTS_TS, 'utf8')).toContain("'SANDBOX_DENIAL'");
  });

  it('③ `SANDBOX_DENIAL` 消费侧 0 处：telemetry 回放面不认它（就算铸出来也进不了 M12）', () => {
    const src = fs.readFileSync(TELEMETRY_TS, 'utf8');
    expect(src).not.toContain('SANDBOX_DENIAL');
    // M12 的实际取值面 = `denials`，只由 `audit/denial`（记录）与 policy_decision deny（事件）喂
    expect(src).toContain("case 'audit/denial':");
    expect(src).toContain("if (payload.verdict === 'deny')");
  });

  it('④ 规格按真话改：M12 行**保留**该词并标「未接线」，但不再把它列进"来源"列', () => {
    const row = fs.readFileSync(BENCHMARK_SPEC_MD, 'utf8').split('\n').find((l) => l.startsWith('| M12 |'))!;
    expect(row).toBeTruthy();
    expect(row).toContain('SANDBOX_DENIAL'); // 不得静默删词（保留在错误词表里）
    expect(row).toContain('未接线'); // 必须写明"本仓没有这条通路"
    // 表格列：| ID | 指标 | 定义 | 采集方式/事件源 | 单位 | ⇒ cells[4] = 来源列
    const cells = row.split('|');
    expect(cells[1]!.trim()).toBe('M12');
    expect(cells[4]).not.toContain('SANDBOX_DENIAL'); // 不再冒充"自家来源"
    expect(cells[4]).toContain('audit/denial'); // 真实来源仍在
  });

  // ------------------------------------------------------- D: configs/policy.default.yaml
  describe('D — `audit.events` 的声明与实现一致（本仓只产 denial）', () => {
    const yamlSrc = fs.readFileSync(POLICY_YAML, 'utf8');
    /** 读 `audit.events` 那一行的列表（负数对照见 ⑤a：解析不到就红，不做静默空值）。 */
    const declaredEvents = (): string[] => {
      const line = yamlSrc.split('\n').find((l) => l.trim().startsWith('events:'));
      expect(line, 'configs/policy.default.yaml 里找不到 audit.events 行').toBeTruthy();
      const inner = /\[([^\]]*)\]/.exec(line!)?.[1];
      expect(inner, `events 行不是内联列表：${line}`).toBeDefined();
      return inner!.split(',').map((s) => s.trim()).filter(Boolean);
    };

    it('⑤a 负对照 + 声明侧：解析得到真实列表，且 `denial` 仍在其中（不得削弱对 denial 的要求）', () => {
      const declared = declaredEvents();
      expect(declared.length).toBeGreaterThan(0);
      expect(declared).toContain('denial');
    });

    it('⑤b 实现侧：`audit/denial` 有真有生产者与消费者；`audit/decision` 生产侧 0 处', () => {
      expect(producersOf('audit/denial').length).toBeGreaterThan(0);
      expect(sources.some((s) => s.file === TELEMETRY_TS && s.text.includes("case 'audit/denial':"))).toBe(true);
      // B19：零产（词表声明文件除外；接线后本行先红 ⇒ 逼配置注释与规格一起更新）
      expect(producersOf('audit/decision')).toEqual([]);
      // B17/B18：`approval/*` **连类型都不存在**（不是"没接线"，是没声明）
      expect(fs.readFileSync(EVENTS_TS, 'utf8')).not.toContain("type: 'approval/");
    });

    it('⑤c 声明⇄实现双向绑定：未实现的项必须在配置**注释**里被逐项标注为「未接线」', () => {
      const declared = declaredEvents();
      const wired = new Set(['denial']); // 本仓唯一有生产者 + 消费者的审计记录族
      const unwired = declared.filter((e) => !wired.has(e));
      expect(unwired.sort()).toEqual(['approval', 'decision']);
      // 注释块是"给读配置的人看的真话"所在地：逐项点名 + 「未接线」必须都落在注释里
      // （只写在 events 列表里满足不了本断言 —— 那正是病灶：列表看不出有没有生产者）
      const comments = yamlSrc.split('\n').filter((l) => l.trim().startsWith('#')).join('\n');
      expect(comments).toContain('未接线');
      for (const e of unwired) expect(comments, `注释没点名未接线的 ${e}`).toContain(e);
      // 且必须写明本仓**实际产出**的那一项（否则"标注了未接线"仍可能让人以为一条都没有）
      expect(comments).toMatch(/只产出\s*`?denial`?|只产\s*`?denial`?/);
    });
  });
});
