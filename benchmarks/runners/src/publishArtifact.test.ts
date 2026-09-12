/**
 * 「发布物形状」治具单测 —— `run-release-gates.ts` 的 §发布物形状门禁 段落（约 :146-493）。
 *
 * 为什么必须补（AGENTS.md §7）：该判据此前**零单测**（benchmarks/runners 216 例覆盖不到），
 * 一旦将来重构把判据改坏，packaging gate 会**静默放行**一个装不起来的包 —— 即"门禁自身无人看守"。
 *
 * 期望值来源（实机实测，不靠推断）：EVALUATION-REPORT-24 P2 用真实
 * `npm pack --dry-run --offline --no-color --loglevel=notice`（cwd=`apps/cli`）测得：
 * stderr 上 `parsed=true`、**62 条**、含 `dist/cli.js` 与 4 个 `dist/configs/*`、零 `*.test.*` / 零 `*.map`
 * / 零 `*.tsbuildinfo`；
 * 清单只出现在 **stderr**（`npm notice` 前缀）；`[copy-configs]` 现为**stdout 零输出**（横幅与逐文件清单
 * 全走 `console.error` → stderr），stdout 上只剩 npm 自己的 prepack 生命周期横幅。
 * 实测的逐字文件名单未落盘，故下方 62 条是"形状等价重建"：**条数 / 必需文件 / 违禁文件**三类事实与实测一致。
 *
 * 隔离纪律：**纯函数 + 注入的假 exec**，不执行任何真实命令、不联网、不写盘、不需要 mkdtemp；
 * 静态 import `./run-release-gates.js` 是安全的（该模块有 ESM entry 判定，被 import 时不跑 main()；
 * 若该判定被删，本文件会在 import 阶段真跑 8 道门禁而爆红 —— 该判定自带判别力）。
 *
 * 判别性：每条断言都对应一个"退步杀手"，注释里逐条标注。
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  PACK_LIFECYCLE_SCRIPTS,
  PUBLISH_ARTIFACT_CRITERION,
  PUBLISH_ARTIFACT_FORBIDDEN_RE,
  PUBLISH_ARTIFACT_REQUIRED,
  PUBLISH_PACKAGE_NAME,
  buildPublishArtifactExecutor,
  judgePublishArtifact,
  normalizePackEntry,
  packScriptsBuildDist,
  parsePackListing,
  type PublishArtifactFacts,
} from './run-release-gates.js';
import type { GateVerdict, RunCommand } from './release-gates/index.js';

// ---------------------------------------------------------------------------
// 实测形状的样本构造（本文件自带，不读实现常量，避免"用实现证实现"）
// ---------------------------------------------------------------------------

/** 4 个必须入包的 configs（字面量镜像实测，故意不引 PUBLISH_ARTIFACT_REQUIRED）。 */
const CONFIG_ENTRIES: string[] = [
  'dist/configs/policy.default.yaml',
  'dist/configs/behavior.default.yaml',
  'dist/configs/pricing.json',
  'dist/configs/model-catalog.json',
];

/** 实测条数：真实 tarball 清单 62 条。 */
const REAL_PACK_FILE_COUNT = 62;

/** 固定头部（含入口 dist/cli.js 与 npm 恒含的 package.json）。 */
const FIXED_HEAD: string[] = ['package.json', 'dist/cli.js', 'dist/index.js', 'dist/compose.js'];

/** 补齐到 62 条（长度由构造式保证，不靠手数）。 */
const PAD_ENTRIES: string[] = Array.from(
  { length: REAL_PACK_FILE_COUNT - FIXED_HEAD.length - CONFIG_ENTRIES.length },
  (_, i) => `dist/commands/cmd-${String(i).padStart(2, '0')}.js`,
);

/** 与实测**形状等价**的 62 条清单（必需齐、4 个 configs、零 test/map）。 */
const REAL_SHAPE_ENTRIES: string[] = [...FIXED_HEAD, ...CONFIG_ENTRIES, ...PAD_ENTRIES];

/** `npm notice` 行（npm 11 的 logTar 把每行都加该前缀；尺寸 token 形如 `270B` / `1.2kB`）。 */
function notice(line = ''): string {
  return line === '' ? 'npm notice' : `npm notice ${line}`;
}

/** 尺寸 token：`\d+B` 与 `\d+.\d+kB` 两种形态都覆盖。 */
function sizeToken(i: number): string {
  return i % 3 === 0 ? `${(i + 1) * 137}B` : `${1 + (i % 7)}.${i % 10}kB`;
}

/** 造一段与实测同形的 npm pack **stderr**（Tarball Contents … Tarball Details 两段标记）。 */
function buildPackStderr(
  entries: readonly string[],
  options: { packedName?: string; injectAfterContents?: readonly string[] } = {},
): string {
  const name = options.packedName ?? PUBLISH_PACKAGE_NAME;
  const lines: string[] = [
    '> @vessel/cli@0.10.0 prepack',
    '> npm run build',
    '',
    notice(`📦  ${name}@0.10.0`),
    notice('Tarball Contents'),
    ...(options.injectAfterContents ?? []),
  ];
  entries.forEach((entry, i) => lines.push(notice(`${sizeToken(i)} ${entry}`)));
  lines.push(
    notice('Tarball Details'),
    notice(`name: ${name}`),
    notice('version: 0.10.0'),
    notice('filename: vessel-cli-0.10.0.tgz'),
    notice('package size: 123.4 kB'),
    notice('unpacked size: 456.7 kB'),
    notice('shasum: 0000000000000000000000000000000000000000'),
    notice(`total files:   ${entries.length}`),
    'npm notice',
  );
  return lines.join('\n');
}

/**
 * 只有 **stdout** 形状（无任何 `npm notice` 行）—— 「packing gate 只读 stdout」的反例。
 *
 * 形状来源（如实）：终评实测时 `[copy-configs]` 的横幅与逐文件清单确实打在这条路上；该脚本现已改为
 * **stdout 零输出**（全走 stderr），故下方 `[copy-configs]` 行属**保留的历史形状**（合成夹具，已不再
 * 等于当前真实的 stdout 内容）。保留它反而更严：`npm notice` 行只在 stderr 出现，任何"只读一路输出"
 * 的实现在此必然栽跟头。prepack 横幅 + tsc 横幅 + 4 条 copy-configs 输出，全部不带 `<size>` 前缀。
 */
const STDOUT_ONLY_SHAPE: string = [
  '> @vessel/cli@0.10.0 prepack',
  '> npm run build',
  '',
  '> @vessel/cli@0.10.0 build',
  '> tsc -b && node scripts/copy-configs.mjs',
  '',
  '[copy-configs] 已复制 4 个文件:',
  ...CONFIG_ENTRIES.map((e) => `[copy-configs]   ${e}`),
].join('\n');

/** 判据事实的默认值 = 「真实产物 + prepack 构建」全绿，仅按用例覆盖单个字段。 */
function facts(overrides: Partial<PublishArtifactFacts> = {}): PublishArtifactFacts {
  return {
    packScriptsBuild: true,
    packScriptLines: ['prepack: npm run build'],
    packOk: true,
    packRan: true,
    entries: REAL_SHAPE_ENTRIES,
    listingParsed: true,
    packedName: PUBLISH_PACKAGE_NAME,
    ...overrides,
  };
}

/** `detail` 是可选字段，统一取值便于断言。 */
function detailOf(v: GateVerdict): string[] {
  return v.evidence.detail ?? [];
}

/** 仓库根（与实现同式：src → runners → benchmarks → 根）。 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE_DIR = path.join(REPO_ROOT, 'apps', 'cli');

// ---------------------------------------------------------------------------

describe('normalizePackEntry — npm 清单条目归一化', () => {
  it('去 package/ 前缀、反斜杠转 /、去 ./ 前缀、去首尾空白', () => {
    expect(normalizePackEntry('package/dist/cli.js')).toBe('dist/cli.js');
    expect(normalizePackEntry('package\\dist\\configs\\pricing.json')).toBe('dist/configs/pricing.json');
    expect(normalizePackEntry('  package/dist/index.js  ')).toBe('dist/index.js');
    // `./` 先剥、`package/` 后剥 → 组合形态也能落到包内相对路径
    expect(normalizePackEntry('./package/dist/a.js')).toBe('dist/a.js');
    // 没有前缀时原样（判别性：误加 `.replace(/^dist\//,'')` 之类的"清理"会在此变红）
    expect(normalizePackEntry('dist/cli.js')).toBe('dist/cli.js');
  });

  it('实现语义：它是**纯归一化器**，不过滤非文件行；过滤由 parsePackListing 的 size-token 正则承担', () => {
    // 读实现后锁定：非文件行原样返回（不是空串）→ 安全边界在解析层，不在归一化层。
    expect(normalizePackEntry('total files: 62')).toBe('total files: 62');
    expect(normalizePackEntry('npm notice')).toBe('npm notice');
    // 空白/空行才是空串
    expect(normalizePackEntry('   ')).toBe('');
    expect(normalizePackEntry('')).toBe('');
    // 判别性：若有人把过滤强行塞进归一化器（改成返回空串），本条变红；
    // 真正的兜底是下面 parsePackListing 的「非文件行不得成为条目」用例。
  });
});

describe('parsePackListing — 只认 stderr 上的 `npm notice <size> <path>` 清单段', () => {
  it('真实形状（62 条 + Tarball Contents/Details 两段标记）→ parsed=true 且条目逐一相符', () => {
    const listing = parsePackListing(buildPackStderr(REAL_SHAPE_ENTRIES));

    expect(listing.parsed).toBe(true);
    // 逐条 + 顺序 + 无多无少（判别性：漏解析/多解析/重复解析都会在此变红）
    expect(listing.entries).toEqual(REAL_SHAPE_ENTRIES);
    expect(listing.entries).toHaveLength(REAL_PACK_FILE_COUNT);
    expect(listing.entries).toContain('dist/cli.js');
    expect(listing.entries.filter((e) => e.startsWith('dist/configs/'))).toEqual(CONFIG_ENTRIES);
    expect(listing.entries.filter((e) => PUBLISH_ARTIFACT_FORBIDDEN_RE.test(e))).toEqual([]);
    expect(listing.packedName).toBe(PUBLISH_PACKAGE_NAME);
    // 段标记本身不是条目
    expect(listing.entries).not.toContain('Tarball Contents');
    expect(listing.entries).not.toContain('Tarball Details');
  });

  it('负对照：只有 stdout 形状（零 `npm notice` 行）→ parsed=false 且零条目（不得"解析成功但 0 条"）', () => {
    const listing = parsePackListing(STDOUT_ONLY_SHAPE);

    // 实测结论（读实现得出）：实现返回 { entries: [], parsed: false }，
    // 因为 parsed 直接由 entries.length > 0 推出 —— 不存在"parsed=true 但 0 条"的含糊态。
    expect(listing.parsed).toBe(false);
    expect(listing.entries).toEqual([]);
    expect(listing.packedName).toBeUndefined();
    // 判别性：把 `parsed` 改成"找到了段标记就算解析"或"恒 true"，本条立即变红。
    expect(STDOUT_ONLY_SHAPE).not.toContain('npm notice');
  });

  it('缺 Tarball Contents 段时 parsed=false —— 即便输出里确有其它 `npm notice` 行（含 📦 包名行）', () => {
    const noContents = `${notice(`📦  ${PUBLISH_PACKAGE_NAME}@0.10.0`)}\n${notice('total files:   0')}\n`;
    const listing = parsePackListing(noContents);

    expect(listing.parsed).toBe(false);
    expect(listing.entries).toEqual([]);
    // 包名识别与清单识别相互独立（包名拿到了也必须 parsed=false → 判据走 pending 而不是 pass）
    expect(listing.packedName).toBe(PUBLISH_PACKAGE_NAME);
  });

  it('注入防护：prepack 横幅 / 伪造的"像条目但不是 npm notice 尺寸行"混入清单段 → 一条都不得被采信', () => {
    const injected = [
      '[copy-configs] 已复制 4 个文件', // 裸横幅（无 npm notice 前缀）
      'dist/evil.js', // 裸路径行（无 npm notice 前缀）
      '1.2kB dist/evil3.js', // 有尺寸但无 npm notice 前缀
      notice('[copy-configs] 已复制 4 个文件 dist/evil2.js'), // 有 npm notice 但无尺寸 token
      notice('total files:   62'), // 幻觉的总数行混进段内
    ];
    const listing = parsePackListing(buildPackStderr(REAL_SHAPE_ENTRIES, { injectAfterContents: injected }));

    expect(listing.parsed).toBe(true);
    expect(listing.entries).toEqual(REAL_SHAPE_ENTRIES); // 注入零增删（判别性：任何一个被采信都变红）
    expect(listing.entries.some((e) => e.includes('copy-configs'))).toBe(false);
    expect(listing.entries).not.toContain('dist/evil.js');
    expect(listing.entries).not.toContain('dist/evil2.js');
    expect(listing.entries).not.toContain('dist/evil3.js');
    expect(listing.entries).not.toContain('total files:   62');
  });

  it('尺寸 token 形态（B/kB/MB）+ 去重 + Windows 反斜杠条目归一化', () => {
    const text = [
      notice('Tarball Contents'),
      notice('270B dist/a.js'),
      notice('1.2kB dist/b.js'),
      notice('4.0MB dist/c.js'),
      notice('270B dist/a.js'), // 重复条目 → 去重
      notice('1.5kB package\\dist\\cli.js'), // Windows 口径 + package/ 前缀
      notice('Tarball Details'),
    ].join('\n');
    const listing = parsePackListing(text);

    expect(listing.parsed).toBe(true);
    expect(listing.entries).toEqual(['dist/a.js', 'dist/b.js', 'dist/c.js', 'dist/cli.js']);
  });

  it('清单段以 Tarball Details 为界：其后的 shasum/name/总数字段不得混入条目', () => {
    const listing = parsePackListing(buildPackStderr(REAL_SHAPE_ENTRIES));

    expect(listing.entries).toHaveLength(REAL_PACK_FILE_COUNT);
    expect(listing.entries.some((e) => e.startsWith('shasum') || e.startsWith('name:') || e.includes('vessel-cli-0.10.0.tgz'))).toBe(false);
  });
});

describe('packScriptsBuildDist — 干净检出下 pack 期能否产出 dist', () => {
  it('P1 变红依据：prepack 只复制 configs（不构建）→ builds=false', () => {
    const r = packScriptsBuildDist({ scripts: { prepack: 'node scripts/copy-configs.mjs' } });
    expect(r.builds).toBe(false);
    expect(r.scripts).toEqual(['prepack: node scripts/copy-configs.mjs']);
  });

  it('P1 变红依据（陷阱版）：manifest 里**存在** tsc 构建脚本，但 prepack 没调它 → 仍是 false', () => {
    // 判别性：把判据写成"manifest 里有 tsc 就算过"会在此变红 —— 干净检出时 build 不会被自动执行。
    const r = packScriptsBuildDist({
      scripts: {
        prepack: 'node scripts/copy-configs.mjs',
        build: 'tsc -b && node scripts/copy-configs.mjs',
      },
    });
    expect(r.builds).toBe(false);
  });

  it('真实 manifest（prepack=npm run build → build=tsc -b && copy-configs）→ builds=true', () => {
    const r = packScriptsBuildDist({
      scripts: {
        build: 'tsc -b && node scripts/copy-configs.mjs',
        prepack: 'npm run build',
        test: 'vitest run',
      },
    });
    expect(r.builds).toBe(true);
    expect(r.scripts).toEqual(['prepack: npm run build']);
  });

  it('直接 tsc / prepare 期 / 间接 npm run 链 三个正向分支都成立', () => {
    expect(packScriptsBuildDist({ scripts: { prepack: 'tsc -b' } }).builds).toBe(true);
    // 判别性：把 prepare 从 PACK_LIFECYCLE_SCRIPTS 里删掉 → 本条变红
    expect(packScriptsBuildDist({ scripts: { prepare: 'tsc -b' } }).builds).toBe(true);
    expect(packScriptsBuildDist({ scripts: { prepack: 'npm run compile', compile: 'tsc -b' } }).builds).toBe(true);
    expect(
      packScriptsBuildDist({ scripts: { prepare: 'npm run build', build: 'tsc -b && node scripts/copy-configs.mjs' } }).builds,
    ).toBe(true);
  });

  it('无 pack 期脚本 / 空 scripts / 非字符串值 / 只在 test 期用 tsc → builds=false 且给出证据行', () => {
    const emptyLine = [`(manifest 无 ${PACK_LIFECYCLE_SCRIPTS.join(' / ')} 脚本)`];
    expect(packScriptsBuildDist({})).toEqual({ builds: false, scripts: emptyLine });
    expect(packScriptsBuildDist({ scripts: {} })).toEqual({ builds: false, scripts: emptyLine });
    expect(packScriptsBuildDist(undefined)).toEqual({ builds: false, scripts: emptyLine });
    expect(packScriptsBuildDist(null)).toEqual({ builds: false, scripts: emptyLine });
    // 非字符串值不被当作脚本
    expect(packScriptsBuildDist({ scripts: { prepack: 42 } })).toEqual({ builds: false, scripts: emptyLine });
    // 判别性：把"任意脚本含 tsc"当通过条件 → 本条变红（test 期的 tsc 与 pack 期无关）
    expect(packScriptsBuildDist({ scripts: { test: 'tsc -b' } }).builds).toBe(false);
  });

  it('文档明示的保守方向：构建藏在自定义脚本里 → builds=false（宁可红得显眼，不放过坏包）', () => {
    // 实现注释已声明该局限（静态断言只认字面 tsc / npm run 链）。本条把它固化为契约：
    // 谁将来把判据"放宽"成"有 build 脚本就算过"，本条变红并要求显式讨论。
    expect(packScriptsBuildDist({ scripts: { prepack: 'node scripts/build.mjs' } }).builds).toBe(false);
  });

  it('间接引用成环不挂死且保持 false', () => {
    expect(packScriptsBuildDist({ scripts: { prepack: 'npm run a', a: 'npm run prepack' } }).builds).toBe(false);
    expect(packScriptsBuildDist({ scripts: { prepack: 'npm run prepack' } }).builds).toBe(false);
  });
});

describe('judgePublishArtifact — 三态方向 + 分支优先级 + 证据', () => {
  it('pass：真实 62 条形状 + prepack 构建 → pass，且 summary 复述判据口径', () => {
    const v = judgePublishArtifact(facts());

    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect(v.evidence.summary).toContain('62 个文件');
    expect(v.evidence.summary).toContain('dist/cli.js');
    expect(v.evidence.summary).toContain('零 *.map / 零 *.tsbuildinfo');
    expect(detailOf(v)).toContain('实测 tarball 文件数=62');
    expect(detailOf(v)).toContain('实测清单：必需文件齐全、零 *.test.* / 零 *.map / 零 *.tsbuildinfo');
    expect(detailOf(v)).toContain('pack 期脚本: prepack: npm run build');
  });

  it('fail ①：pack 期脚本不构建 dist → fail（**即便**实测清单 62 条齐全 —— 本地 dist 存在不算数）', () => {
    const v = judgePublishArtifact(facts({ packScriptsBuild: false }));

    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('干净检出');
    expect(v.evidence.summary).toContain('dist/cli.js');
    expect(v.evidence.summary).toContain('坏包');
    expect(detailOf(v)).toContain('判据：干净检出时包内不会出现 dist/cli.js → 本 gate 必须变红');
    expect(detailOf(v)).toContain('当前工作区实测仅供对照（本地 dist 恰好存在，不代表干净检出）');
  });

  it('分支优先级：① 压过 ②③（packOk=false 也不能把它降级成 pending）', () => {
    const v = judgePublishArtifact(facts({ packScriptsBuild: false, packOk: false, packRan: false, listingParsed: false }));

    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('干净检出');
    expect(detailOf(v)).toContain('npm pack 未产出可解析清单，无可对照的实测清单');
  });

  it('fail ⑤：缺 dist/cli.js → fail，summary/detail 明确点出缺哪个文件', () => {
    const v = judgePublishArtifact(facts({ entries: REAL_SHAPE_ENTRIES.filter((e) => e !== 'dist/cli.js') }));

    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('缺 1 个必需文件');
    expect(v.evidence.summary).toContain('dist/cli.js');
    expect(detailOf(v)).toContain('缺: dist/cli.js');
  });

  it('fail ⑤：含违禁文件（*.test.js / *.test.d.ts / *.map，各自独立）→ fail 且列出违禁项', () => {
    const testJs = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, 'dist/cli.test.js'] }));
    expect(testJs.status).toBe('fail');
    expect(testJs.evidence.summary).toContain('含 1 个 *.test.*/*.map/*.tsbuildinfo 文件（应为 0）');
    expect(detailOf(testJs)).toContain('多(违禁): dist/cli.test.js');

    const testDts = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, 'dist/cli.test.d.ts'] }));
    expect(testDts.status).toBe('fail');
    expect(detailOf(testDts)).toContain('多(违禁): dist/cli.test.d.ts');

    const map = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, 'dist/index.js.map'] }));
    expect(map.status).toBe('fail');
    expect(detailOf(map)).toContain('多(违禁): dist/index.js.map');
  });

  it('fail ⑤（新增）：含 `dist/.tsbuildinfo` → fail，并把它列在「多(违禁)」那行（tsc 实际产出的名字）', () => {
    // `apps/cli/tsconfig.json:6` = `tsBuildInfoFile: "dist/.tsbuildinfo"` → 这就是 tsc -b 真实落盘的名字；
    // `apps/cli/package.json:17-18` 用两条否定 glob（`!dist/**/.tsbuildinfo` 管点开头名 +
    // `!dist/**/*.tsbuildinfo` 管非点开头名）排除，本条把该排除固化成**红灯契约**。
    const v = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, 'dist/.tsbuildinfo'] }));

    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('发布物形状不符');
    expect(v.evidence.summary).toContain('含 1 个');
    // 违禁项出现在 detail 的专属行上（不是"缺文件"、也不是静默 pass）
    expect(detailOf(v)).toContain('实测 tarball 文件数=63');
    expect(detailOf(v)).toContain('多(违禁): dist/.tsbuildinfo');
    expect(v.evidence.summary).not.toContain('符合预期');
    // 判别性：把 PUBLISH_ARTIFACT_FORBIDDEN_RE 回退成不含 tsbuildinfo 的版本 → 本条整块变红
    // （回退后 forbidden=[]、missing=[] → 判 pass，`status` 与 `多(违禁)` 两处同时失败）。
  });

  it('fail ⑤（新增）：非隐藏名 `dist/foo.tsbuildinfo` → 也 fail（判据是**后缀锚定**，不是字面名匹配）', () => {
    const v = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, 'dist/foo.tsbuildinfo'] }));

    expect(v.status).toBe('fail');
    expect(detailOf(v)).toContain('多(违禁): dist/foo.tsbuildinfo');

    // 正则语义**如实**断言：`\.tsbuildinfo$` 只锚定结尾，故凡 basename 以 `.tsbuildinfo` 结尾者皆违禁 ——
    //   `dist/.tsbuildinfo`（本仓真实名字）✓、`dist/foo.tsbuildinfo`（非隐藏名）✓、`dist/tsconfig.tsbuildinfo`
    //   （tsc 默认名）✓；而 `dist/tsbuildinfo`（不带点）✗、`dist/.tsbuildinfo.bak`（不以它结尾）✗。
    //   这是刻意的取舍而非疏漏：tsc 产出的名字恒带点（默认 `tsconfig.tsbuildinfo`，本仓显式指定
    //   `apps/cli/tsconfig.json:6` = `dist/.tsbuildinfo`），故后缀锚定足以覆盖真实产物；
    //   若将来 `tsBuildInfoFile` 被改成无点名，本用例末尾 `dist/foo.tsbuildinfo === true` 与常量块里
    //   `dist/tsbuildinfo === false` 两条断言会一起变红 —— 那就是"必须显式讨论后扩展判据"的信号。
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/foo.tsbuildinfo')).toBe(true);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/tsconfig.tsbuildinfo')).toBe(true);
    // 判别性：回退正则 → 本条两条 fail 断言 + 两条 test() 断言共四处同时变红。
  });

  it('负对照（新增）：合法最小清单（dist/cli.js + 4 个 dist/configs/*，零违禁）→ 仍 pass（判据扩展不得"一律 fail"）', () => {
    const minimal = ['dist/cli.js', ...CONFIG_ENTRIES];
    const v = judgePublishArtifact(facts({ entries: minimal }));

    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect(v.evidence.summary).toContain('5 个文件');
    expect(detailOf(v)).toContain('实测 tarball 文件数=5');
    expect(detailOf(v)).toContain('实测清单：必需文件齐全、零 *.test.* / 零 *.map / 零 *.tsbuildinfo');
    expect(minimal.some((e) => PUBLISH_ARTIFACT_FORBIDDEN_RE.test(e))).toBe(false);
    // 判别性：本条**不**是回退杀手（回退正则后它照样绿）—— 它的职责相反：防止"加了 tsbuildinfo 之后
    // 把任何清单都判 fail"这类过度扩展（例如误写成 `/tsbuildinfo|\.js$/` 或漏掉必需的 5 项匹配）。
  });

  it('pending ③：清单不可解析（stdout 形状）→ 显式 pending，不静默通过', () => {
    const listing = parsePackListing(STDOUT_ONLY_SHAPE);
    const v = judgePublishArtifact(facts({ entries: listing.entries, listingParsed: listing.parsed }));

    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.evidence.summary).toContain('Tarball Contents');
    expect(v.note).toContain('不静默通过');
    expect(detailOf(v)).toContain('npm pack 成功但清单段缺失');
    // 判别性：把 ③ 放宽成"清单空 = pass"或"清单空 = fail"，本条立即变红。
  });

  it('pending ③ 压过 ④⑤：清单不可解析时，不拿空的 entries 去报"缺 5 个文件"', () => {
    const v = judgePublishArtifact(facts({ entries: [], listingParsed: false, packedName: 'other-pkg' }));

    expect(v.status).toBe('pending');
    expect(v.evidence.summary).toContain('清单不可解析');
    expect(v.evidence.summary).not.toContain('缺');
  });

  it('pending ④：实测打的不是 @vessel/cli → 探测错位，pending 且文案含实际包名与作用域提示', () => {
    const v = judgePublishArtifact(facts({ packedName: 'other-cli' }));

    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.evidence.summary).toContain('other-cli');
    expect(v.evidence.summary).toContain(PUBLISH_PACKAGE_NAME);
    expect(v.evidence.summary).toContain('探测错位');
    expect(v.note).toContain('apps/cli');
  });

  it('②：npm 真跑了但失败 → fail；spawn 级失败（无 npm 日志）→ pending（工具缺失不静默通过）', () => {
    const npmFailed = judgePublishArtifact(facts({ packOk: false, packRan: true, packOutputTail: ['npm error code ELIFECYCLE'] }));
    expect(npmFailed.status).toBe('fail');
    expect(npmFailed.evidence.summary).toContain('非 0 退出');
    expect(detailOf(npmFailed)).toContain('npm pack 输出: npm error code ELIFECYCLE');

    const toolMissing = judgePublishArtifact(facts({ packOk: false, packRan: false, packOutputTail: ['spawn npm ENOENT'] }));
    expect(toolMissing.status).toBe('pending');
    expect(toolMissing.pending).toBe(true);
    expect(toolMissing.evidence.summary).toContain('spawn 级失败');
    expect(toolMissing.note).toContain('跑不了 npm pack');
    expect(toolMissing.note).toContain('不静默通过');
  });

  it('证据行：违禁项只列前 5 个并给总数，整段 detail 封顶 10 行', () => {
    const manyForbidden = Array.from({ length: 12 }, (_, i) => `dist/forbidden-${i}.test.js`);
    const truncated = judgePublishArtifact(facts({ entries: [...REAL_SHAPE_ENTRIES, ...manyForbidden] }));

    expect(truncated.status).toBe('fail');
    expect(truncated.evidence.summary).toContain('含 12 个 *.test.*/*.map/*.tsbuildinfo 文件（应为 0）');
    expect(detailOf(truncated)).toContain('多(违禁): dist/forbidden-0.test.js, dist/forbidden-1.test.js, dist/forbidden-2.test.js, dist/forbidden-3.test.js, dist/forbidden-4.test.js … 共 12 个');

    const longScripts = judgePublishArtifact(
      facts({
        packScriptsBuild: false,
        packScriptLines: Array.from({ length: 20 }, (_, i) => `line-${i}`),
      }),
    );
    expect(detailOf(longScripts)).toHaveLength(10);
  });
});

describe('buildPublishArtifactExecutor — 并入 Gate 8 packaging（不新增门禁 id）', () => {
  it('gate 元数据：id/position 仍是注册表里的 packaging(8)，criterion 换成发布物形状判据', () => {
    const executor = buildPublishArtifactExecutor();

    expect(executor.gate.id).toBe('packaging');
    expect(executor.gate.position).toBe(8);
    expect(executor.gate.criterion).toBe(PUBLISH_ARTIFACT_CRITERION);
    expect(executor.gate.name).toContain('Packaging');
  });

  it('注入假 exec（**不发真实命令**）：stderr 清单 → pass；只回 stdout 形状 → pending', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const exec: RunCommand = async (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd });
      return { code: 0, stdout: '', stderr: buildPackStderr(REAL_SHAPE_ENTRIES) };
    };

    const executor = buildPublishArtifactExecutor();
    const verdict = await executor.run({ repoRoot: REPO_ROOT, reportsDir: path.join(REPO_ROOT, 'benchmarks', 'reports'), exec });

    expect(verdict.status).toBe('pass');
    // 命令行口径（离线/无 ANSI/清单必输出）与作用域被锁死
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('npm');
    expect(calls[0]?.args).toEqual(['pack', '--dry-run', '--offline', '--no-color', '--loglevel=notice']);
    expect(calls[0]?.cwd).toBe(PACKAGE_DIR);

    // 反向：executor 只拿到 stdout（无 npm notice）时不得判 pass —— 判据必须走到 pending。
    const stdoutOnlyExec: RunCommand = async () => ({ code: 0, stdout: STDOUT_ONLY_SHAPE, stderr: '' });
    const stdoutVerdict = await executor.run({
      repoRoot: REPO_ROOT,
      reportsDir: path.join(REPO_ROOT, 'benchmarks', 'reports'),
      exec: stdoutOnlyExec,
    });
    expect(stdoutVerdict.status).toBe('pending');
    expect(stdoutVerdict.evidence.summary).toContain('Tarball Contents');
  });
});

describe('判据常量 — 锁定口径，防止静默改写', () => {
  it('PACK_LIFECYCLE_SCRIPTS / 必需 5 项 / 违禁 4 类（含 tsbuildinfo）/ criterion 文案', () => {
    expect([...PACK_LIFECYCLE_SCRIPTS]).toEqual(['prepack', 'prepare']);
    expect([...PUBLISH_ARTIFACT_REQUIRED]).toEqual([
      'dist/cli.js',
      'dist/configs/policy.default.yaml',
      'dist/configs/behavior.default.yaml',
      'dist/configs/pricing.json',
      'dist/configs/model-catalog.json',
    ]);

    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/cli.test.js')).toBe(true);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/cli.test.d.ts')).toBe(true);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/cli.js.map')).toBe(true);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/cli.js')).toBe(false);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/attest.js')).toBe(false);

    // 违禁第 4 类：tsc 增量构建元数据（`apps/cli/tsconfig.json:6` 产出 `dist/.tsbuildinfo`，
    // `apps/cli/package.json:17-18` 的两条否定 glob（点开头名 / 非点开头名各一条）负责不收录，
    // 本条负责"收录了就红灯"）。
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/.tsbuildinfo')).toBe(true);
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/foo.tsbuildinfo')).toBe(true); // 非隐藏名：后缀锚定，非字面名
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/tsconfig.tsbuildinfo')).toBe(true); // tsc 默认名
    // 边界如实记录：本正则**不**匹配无点的 `dist/tsbuildinfo`（tsc 不会产出这种名字；若哪天产出，
    // 这条断言变红即为"必须显式扩展判据"的信号，而不是静默放行）。
    expect(PUBLISH_ARTIFACT_FORBIDDEN_RE.test('dist/tsbuildinfo')).toBe(false);

    // 扩展后四类必须**齐**（判别性：谁把正则改成"只认 tsbuildinfo"，上面三条旧类断言与下面这条一起变红）
    const forbiddenSamples = ['dist/cli.test.js', 'dist/cli.test.d.ts', 'dist/cli.js.map', 'dist/.tsbuildinfo'];
    expect(forbiddenSamples.filter((e) => PUBLISH_ARTIFACT_FORBIDDEN_RE.test(e))).toEqual(forbiddenSamples);

    expect(PUBLISH_ARTIFACT_CRITERION).toContain('dist/cli.js');
    expect(PUBLISH_ARTIFACT_CRITERION).toContain('dist/configs/');
    expect(PUBLISH_ARTIFACT_CRITERION).toContain('不静默通过');
    // 文案与判据必须同步（"说的与做的一致"）：criterion 必须点名第 4 类，否则又是一次"说的漏了做的"。
    expect(PUBLISH_ARTIFACT_CRITERION).toContain('*.tsbuildinfo');
  });
});
