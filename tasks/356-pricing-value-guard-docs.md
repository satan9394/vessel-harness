# 任务卡 356: 价目值守卫的文档诚实化（P2-1 已具备，不是缺功能）

- Status: 已验收（2026-10-27 验收：文档已改回事实，价目测试 40/40；协调者复跑 exit 0）
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T12，`gpt-6.1-terra`/low）
- 来源：`docs/MAGPIE-ABSORPTION.md` §5 与卡 323 的结论不一致

## 1. Goal

`docs/MAGPIE-ABSORPTION.md` §5 最后一行仍写「尚未实现：价目值守卫（P2-1）」，但实现早在卡 092 就落地，
卡 323 也已核实为「已具备」。这是**文档失真**，会让人以为模型管理还缺一块。把文档改成事实，
并把真正的缺口单独写清。

## 2. 已核实的事实（改写文档时照这个写）

- 落点：`apps/cli/src/usage/pricingOverride.ts` 的 `repair()`，值守卫三态
  `applied` / `skipped-absent` / `skipped-user-modified`（`PricingRepairStatus`）。
- 入口：`vessel pricing override repair --file <repairs.json>`（`apps/cli/src/cli.ts:2510-2557`）。
- 语义：只改「现值仍等于旧值」的行；用户手改过的行绝不覆盖（`skipped-user-modified`）。
- 单测：`apps/cli/src/usage/pricing-override.test.ts`（含值守卫、内置更新不冲用户手改）。
- 覆盖文件与内置表分离：`~/.vessel/pricing.override.json` 只存覆盖 + 删除墓碑，内置 `configs/pricing.json` 由版本维护。

## 3. 真正的缺口（只有一条）

没有「对比两版内置 `configs/pricing.json`、自动生成 `repairs.json`」的命令。现在要人工写 repairs 条目。
**默认不实现**；若实现，见 §5 的可选范围。

## 4. 要做的事

1. 改 `docs/MAGPIE-ABSORPTION.md`：P2-1 标为「已具备」，写落点、入口、验收信号，并保留 §3 的原始描述不删。
2. 在 §5 末尾把「尚未实现：价目值守卫（P2-1）」那一句改掉，只留「没有升级差分生成器」这一条真缺口。
3. 在 `tasks/323-pricing-value-guard.md` 末尾追加一行：真实缺口＝无差分生成器，不是无值守卫。
4. （可选，默认不做）补 `scripts/pricing-upgrade-diff.mjs --from <旧> --to <新> --out <repairs.json>`，
   并加 3 条单测：同值跳过、缺条目跳过、结构非法报错。

## 5. Not Doing

- 不改 `pricingOverride.ts` 的运行逻辑、不改 `configs/pricing.json` 的实际价格。
- 不声称「已有一键升级流程」——现在只有「人工给 repairs 文件」。
- 默认不写差分脚本（做了就按可选范围走，并在卡里写清）。

## 6. Acceptance

1. `docs/MAGPIE-ABSORPTION.md` 里不再出现「值守卫尚未实现」这类表述；P2-1 的状态与卡 323 一致。
2. 文档里的落点与行号能在当前代码里对上（`pricingOverride.ts` 的 `repair`、`cli.ts` 的 `pricing override repair`）。
3. 真缺口（无差分生成器）被明确写出，且没被写成「已有」。
4. `node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts` exit 0（证明没碰坏既有行为）。

## 7. Blast Radius

`docs/MAGPIE-ABSORPTION.md`、`tasks/323-pricing-value-guard.md`（末尾追加）、本卡 §7。
若做可选脚本，另加 `scripts/pricing-upgrade-diff.mjs` 与一份测试。

## 8. Expected Evidence

改动处的 diff、`pricingOverride.ts` 与 `cli.ts` 的行号核对、pricing-override 测试的 exit 与计数。

## 9. Result

- 2026-10-27：文档与卡 323 已按当前实现修正；§3 原始描述作为历史设想保留。`repair()` 位于 `apps/cli/src/usage/pricingOverride.ts:500`，CLI 位于 `apps/cli/src/cli.ts:2506`，三态测试位于 `apps/cli/src/usage/pricing-override.test.ts:132`。`applied` 与实际 `persisted` 分开报告。
- 路由：`gpt-6.1-terra` / `medium`，Fast 关闭；依据交接单 §1 的文档类 scoped work 配置（覆盖本卡旧的 low 记录）。
- `git diff --stat -- docs/MAGPIE-ABSORPTION.md tasks/323-pricing-value-guard.md`：exit 0；2 files changed, 14 insertions(+), 6 deletions(-)。
- `node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts`：exit 0；1 test file，40 tests passed。原始输出：`C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs/t12-pricing-test.log`。
- 未做：可选差分生成器及测试（默认不做）；未改产品代码、价格、看板，未运行全量门禁。
- 过程：首次 Node 编辑命令因 PowerShell 对反引号的解释导致 `SyntaxError`，exit 1，未写入；随后用补丁完成。一次补丁格式无效，未写入；重试成功。被拒命令：无。
- 独立复核：`gpt-6.1-terra` / `low`，逐条 AC PASS；协调者复跑同一价目定向命令 exit 0，1 文件 / 40 passed。原始复跑日志为同临时目录 `verify-t12-pricing.log`。

#### 协调者验收（2026-10-27，独立复跑）

- `vitest run apps/cli/src/usage/pricing-override.test.ts` exit 0、1 文件 / **40 passed**（与自述一致）；全量门禁 17 步全绿。
- 文档事实核对：`pricingOverride.ts` 的 `repair()` 三态与 CLI `pricing override repair --file`（`cli.ts:2506` 附近）确实存在；`docs/MAGPIE-ABSORPTION.md` 已把 P2-1 标为已具备，§5 只剩「无升级差分生成器」这一条真缺口，不再出现「值守卫尚未实现」。
- 可选项（差分脚本）未做，符合卡的默认口径；卡里也没把它写成已具备。

### T5 upgrade diff (2026-10-28)

- Routing: requested `gpt-6.1-terra` / `medium`, Fast off, no Ultra; wave 4 §1 T5 is a bounded script and three tests.
- Changed: `scripts/pricing-upgrade-diff.mjs` and `scripts/pricing-upgrade-diff.test.mjs`; this card appended. No dependencies or pricingOverride runtime changes.
- Usage: `node scripts/pricing-upgrade-diff.mjs --from old.json --to new.json --out repairs.json`, then `vessel pricing override repair --file repairs.json`. Removed models lack a new value; added models lack an old value guard, so both are skipped with reasons.
- `node scripts/pricing-upgrade-diff.test.mjs`: exit 0, 3/3 tests. `node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts`: exit 0, 40/40 tests. Logs: `%TEMP%/vessel-t5-pricing-checks.log`.
- `node scripts/pricing-upgrade-diff.mjs --from configs/pricing.json --to configs/pricing.json --out <TEMP file>`: exit 0, 0 repairs; JSON parsed and counted with Node, exit 0.
- `node node_modules/typescript/bin/tsc -b tsconfig.json`: deferred to coordinator for serialized build; not yet verified. Generated changed rows match the CLI array shape in a test; actual CLI consumption is not yet verified. Refused commands: none.
- Evidence append attempt via `node -e` failed exit 1 due to PowerShell interpreting backticks; no content was written. The append was then made with the patch tool.

#### T5 independent verification and shared build (2026-10-28)

- Independent reviewer: `gpt-6.1-terra` / low per wave 4 section 1, Fast off; all T5 acceptance checks PASS. No runtime or dependency change, no source edits during review.
- `node scripts/pricing-upgrade-diff.test.mjs`: exit 0, 3/3. `node scripts/pricing-upgrade-diff.mjs --from configs/pricing.json --to configs/pricing.json --out <TEMP>/self.json`: exit 0, parsed result `[]`, 0 repairs.
- An isolated real CLI fixture generated two changed repairs: `node scripts/pricing-upgrade-diff.mjs --from <TEMP>/old.json --to <TEMP>/new.json --out <TEMP>/repairs.json` exit 0. `node --import tsx apps/cli/src/cli.ts pricing override set changed --input 1 --output 2` and `... set custom --input 9 --output 8` each exit 0. `node --import tsx apps/cli/src/cli.ts pricing override repair --file <TEMP>/repairs.json` exit 0, 1/2 applied; persisted changed value 3/4 and retained user-modified value 9/8. USERPROFILE, HOME and VESSEL_USAGE_ROOT were isolated in TEMP; no real user override was used. Full argv, output and persisted assertions: `%TEMP%/vessel-t5-review-1a2e78ca991b4d5eab18cd8b60b7a81d/review.log` and `review.cjs`.
- Coordinator's final serialized `node node_modules/typescript/bin/tsc -b tsconfig.json`: exit 0, no diagnostics; `%TEMP%/vessel-wave4-baseline-0JOEe1/repair-tsc-build.log`. This completes the previously deferred T5 build check.
- No full gate, commit, push, branch, external agent CLI, or newly refused command. The earlier append failure remains recorded above.

#### 协调者验收（2026-10-28，独立复跑）

- 我复跑了 `node scripts/pricing-upgrade-diff.test.mjs`：**3/3 pass、exit 0**；`node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts` 40/40 仍绿；`tsc -b`、`tsc -p tsconfig.test.json` exit 0。
- 脚本与 `PricingRepair` 的形状一致（`{ key, from: TokenPrice, to: TokenPrice }`），原子写（temp + rename）、拒 output==input、非法目录/负价格非零退出，都对得上。它把「只在旧价目有的条目跳过、只在新价目有的条目跳过」分别打到 stderr，没静默丢。
- 它做的真实 CLI 消费验证我认：`pricing override repair --file` 对用户手改过的价保留原值、对未被手改的条目应用新值，正是值守卫该有的行为。
- 卡状态：**已验收**（文档 + 差分脚本 + 单测 + 真实 CLI 消费四点齐全）。
