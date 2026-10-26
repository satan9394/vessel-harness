# T310 — CLI i18n 骨架：`--lang` 预扫描与 `t()` 三级回退

- Status: 已完成（2026-10-26；PDW 任务 `20261026090840-c004c3` `accepted_local`；未提交、未推送）
- PDW task: none
- Mode: standard（机制骨架，不做全量文案抽取）
- Source: HARNESS² 评估 P2-3（只搬机制）
- Risk: low（只覆盖 USAGE 的几个键，其余文案不动）

## Goal

让 CLI 具备可用的本地化**机制**：参数解析前预扫描 `--lang`，`--help` 也能按语言输出；`t()` 走「当前 locale → en → key 原样」三级回退。本卡只做骨架与三个键，不搬 Web 的 catalog、不做全量抽取。

## Not Doing

- 不合并 Web（`apps/web/src/i18n.ts`）与 CLI 的 catalog（node vs browser、`settings.json` vs `localStorage`，合并必炸）。
- 不做全量文案抽取与双语校对（那是后续卡，3–5 人日）。
- 不改 `vessel guide --locale` 的既有行为（它继续独立工作）。
- 不加依赖、不动 `packages/core`、不 commit/push、不跑 `--live`。

## 设计

1. 新增 `apps/cli/src/i18n.ts`：

```ts
export type Locale = 'zh' | 'en';
/** 预扫描：--lang <v> 优先，其次 VESSEL_LANG，最后默认 'zh'；未知值回落 'en'。 */
export function resolveLocale(argv: readonly string[]): Locale;
export function setLocale(locale: Locale): void;
export function currentLocale(): Locale;
/** 三级回退：当前 locale → en → key 原样。支持 {name} 占位替换。 */
export function t(key: string, params?: Record<string, string | number>): string;
```

- 字典内置两个小对象 `zh` / `en`，先只放三个键：`usage.header`、`usage.commandsHint`、`usage.footer`。
- `t()` 查不到就逐级回落，最终返回 key 本身（**不抛错**）。
- `setLocale` 只改模块级变量，不写文件、不读环境。

2. `apps/cli/src/cli.ts`：
   - `main(argv)` 第一行（在 `parseArgs` 之前）调 `setLocale(resolveLocale(argv))`。
   - `parseArgs` 接受 `--lang <zh|en>`（存入 `flags`），不得再把它当未知 flag 报错。
   - `USAGE` 常量改为由 `t('usage.header')` + 事件细节 + `t('usage.footer')` 拼装；**其余帮助正文照旧**（本卡不翻译逐条命令）。
   - `vessel --lang en --help` 与 `vessel --help --lang en` 都要生效（预扫描不依赖位置）。

## Acceptance

- AC1：`resolveLocale(['--lang','en'])` → `'en'`；`['--lang','zh']` → `'zh'`；`['--lang','zz']` → `'en'`（未知回落 en）；`[]` 且无 `VESSEL_LANG` → `'zh'`；`VESSEL_LANG=en` 时 → `'en'`；`--lang` 覆盖环境变量。
- AC2：`t('usage.header')` 在 zh/en 下返回不同文案；`t('nope.key')` 返回 `'nope.key'`；`t('usage.header', {x: 1})` 不因多余参数抛错。
- AC3：`vessel --lang en --help` 与 `vessel --help --lang en` 的 header 都是英文；不带 `--lang` 时 header 仍是中文（既有默认行为不变）；两种位置的退出码都是 0。
- AC4：`--lang` 出现在任意位置都不会被 `parseArgs` 判为未知 flag（补一条测试：`vessel --lang en status` 不报 unknown flag）。
- AC5：定向 vitest、`tsc -b`、`typecheck:tests` exit 0。

## Blast Radius

`apps/cli/src/i18n.ts`（新）、`apps/cli/src/i18n.test.ts`（新）、`apps/cli/src/cli.ts`、`apps/cli/src/cli.test.ts`。回滚 `git checkout -- <上述文件>` 并回收新增文件。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、`node apps/cli/dist/cli.js --lang en --help` 与不带参数两条真实输出（各贴首行）、PDW review 结论；协调者另跑全量。

## Result

已完成骨架。`apps/cli/src/i18n.ts` 导出 `Locale` / `resolveLocale` / `setLocale` / `currentLocale` / `t`：`--lang <zh|en>` 优先，其次 `VESSEL_LANG`，默认 `zh`，未知值回落 `en`；`t()` 三级回退（当前 → en → key 原样）并支持 `{name}` 占位；字典只有 `usage.header` / `usage.commandsHint` / `usage.footer` 三个键。`cli.ts` 在 `main` 的 `parseArgs` 之前设 locale，`parseArgs` 接受 `--lang` 不再当未知 flag，`USAGE` 的 header/footer 走 `t()`，帮助正文其余部分未动。

真实 CLI 验证（`spawnSync` 读输出，避开控制台解码）：

| 参数 | exit | header |
|---|---|---|
| `--lang en --help` | 0 | `Vessel CLI v0.10.0 — Composable Agent Harness (Vessel)` |
| `--help --lang en` | 0 | 同上（预扫描不依赖位置） |
| `--help` | 0 | `Vessel CLI v0.10.0 — 可组合 Agent Harness（品牌 Vessel）` |
| `--lang en nope` | 2 | 未知命令 `nope`（不是未知 flag，说明 `--lang` 已被接受） |

**更正一处卡内笔误**：AC4 原本写 `vessel --lang en status`，但 `status` 不是 CLI 命令（`vessel status` 不存在），改用 `nope` 验证同一语义；这不是实现问题。

验收：定向 **129 passed**（`i18n.test` + `cli.test`）；`tsc -b`、`typecheck:tests` exit 0；全量根 **317 文件 / 3388 passed + 6 skipped**、web **58 / 494**。文件字节核查：`i18n.ts` 零个 U+FFFD，中文为正常码点（控制台里的乱码只是显示问题）。

未做：全量文案抽取与双语校对（评估报告估 3–5 人日）、Web 与 CLI catalog 合并（明确不做）、`vessel guide --locale` 的行为保持不变。
