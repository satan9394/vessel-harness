# 任务卡 351: Packaging release gate 实跑一次

- Status: 已验收（2026-10-28，协调者独立复跑）：判据已按 T2 收紧为「探针正常 + 两个路径存在」，第五波 V1 修好 Windows npm 执行层（仅在 `win32` 且命令为 `npm` 时加 shell），默认 gate 实跑 `status=pass`（npm exit 0 / stdout 1130 字节 / stderr 0）。本卡仍只证明探针可用与 `dist`/入口存在，不构成完整打包/安装/发布证据
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T9，`gpt-6.1-terra`/low，无复核）
- 来源：交接单终版 T9；`docs/V1.6-STABLE-CHECKLIST.md` 记录该门「需要 dist」而未跑

## 1. Goal

`benchmarks/runners/src/release-gates/gates.ts` 里的 packaging 门此前因为「需要 dist」一直没跑过。现在
`apps/cli/dist/cli.js` 与 `apps/web/dist/index.html` 都在，用**现有入口**跑一次，把真实结果记下来——
通过就通过，不通过就写清为什么，不许改判据凑绿。

## 2. 要做的事

1. 在 `benchmarks/runners/src/release-gates/` 里找 packaging 门的现有入口（`index.ts` / `runner.ts` /
   `gates.ts`），**不要**新建入口，**不要**加 npm script。
2. 用现有 dist 跑一次，记录 exit code 与完整输出（输出写 `%TEMP%`，不写仓库）。
3. 若 dist 缺失或过期：先 `node node_modules/typescript/bin/tsc -b tsconfig.json` 重建，再跑一次，
   把两次结果都记下。
4. 结论写进本卡 §7：入口命令、exit、失败原因（哪一条断言/哪个文件缺失）、下一步建议。

## 3. Not Doing

- 不改 gate 判据、不放宽断言、不改 `gates.ts`。
- 不新增 npm script、不改 CI（Actions 已停用）。
- 不重新发布、不生成 release 产物入库。

## 4. Acceptance

1. 入口命令是从现有代码里找到的（报告里给出文件路径与行号）。
2. exit code 与输出原文入卡；失败时能指出具体是哪一项判据没过。
3. 仓库内只多一个文件：本卡。

## 5. Blast Radius

只读代码 + 运行现有入口；产物写 `%TEMP%`。仓库改动仅本卡。

## 6. Expected Evidence

入口的 `path:line`、两次运行（重建前/后）的 exit 与关键输出、下一步建议。

## 7. Result

2026-10-27：默认 packaging executor **pass**，但 npm 探测进程返回 **1**；这不代表打包成功。`gates.ts:1024` 构造执行器，`:1209-1222` 调用默认命令并检查仓库根 `dist` 和 `dist/index.js`；`:822-843` 的 `gateDefaultRunCommand` 将命令错误转换为返回值，不抛出。判据 `:277-287` 仅把抛异常视为探测失败，忽略返回码和输出。

路由：`gpt-6.1-terra` / `medium`，Fast 关闭；依据交接单 §1 的既有入口实跑取证，覆盖本卡旧 low 记录。改动文件仅本卡 Result；本卡在起点已是未跟踪文件，`git diff --stat -- tasks/351-packaging-gate-run.md` 不含该文件。被拒命令：无。未改判据、未跑全量门禁、未调用本机其他 Agent CLI、未提交/推送/建分支。

执行命令（PowerShell，仓库根；包装器仅保存默认 RunCommand 的原始结果，不改变它）：

```powershell
node --import tsx -e 'const fs = require("node:fs"); import("./benchmarks/runners/src/release-gates/gates.ts").then(async m => { const dir = "C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs"; const exec = async (...args) => { const o = await m.gateDefaultRunCommand(...args); fs.writeFileSync(dir + "/packaging-npm-stdout.log", o.stdout); fs.writeFileSync(dir + "/packaging-npm-stderr.log", o.stderr); fs.writeFileSync(dir + "/packaging-npm-exit.txt", String(o.code)); return o; }; const gate = m.buildReleaseGateExecutors().find(x => x.gate.id === "packaging"); console.log(JSON.stringify(await gate.run({repoRoot: process.cwd(), reportsDir: dir, exec}), null, 2)); }).catch(e => { console.error(e); process.exitCode = 1; });' *> C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs/packaging-gate.log
```

入口进程 exit 0；完整 gate 输出：

```json
{
  "status": "pass",
  "evidence": {
    "summary": "build 产物在位（dist 与入口均存在）——本 gate 只探测这两个路径存在，未校验产物完整性/内容",
    "detail": [
      "dist=true",
      "entry=true"
    ]
  }
}
```

实际探测为 `npm pack --dry-run --json`，默认 RunCommand 返回 exit 1，stdout 0 字节、stderr 0 字节；无法从输出确定失败原因。原始结果分别在 `%TEMP%/vessel-wave2-x0Tnhs/packaging-npm-{stdout,stderr}.log`、`packaging-npm-exit.txt`，gate 输出在同目录 `packaging-gate.log`。根 `dist/index.js` 时间为 2026-09-10 05:53:13，不能由存在性判据证明其新鲜；CLI 和 web dist 并非此默认门探测路径。协调者在本次执行前已运行 `node node_modules/typescript/bin/tsc -b tsconfig.json`，exit 0、无诊断，记录在同目录 `tsc-build.log`；根入口时间仍为上述日期。按照协调者指令只执行该 gate 一次，未跑重建前版本或其他 release gates。

下一步：另行检查 Windows 下 npm 探测 exit 1 的原因与根 dist 的来源和时效；若需要发布物完整性证据，应单独运行发布驱动的相应产物检查，不能将本次 pass 当作该证据。

#### 协调者验收（2026-10-27，独立核对）

- 判据我读过源码确认：`judgePackagingProbe`（`benchmarks/runners/src/release-gates/gates.ts`）只在 `probeFailed || !rootHasDist` 时返回 `pending`，否则按 `entryExists` 给 pass/fail；`detail` 就是 `dist=` 与 `entry=` 两个布尔。**它确实只做存在性探测**，卡里那句「未校验产物完整性/内容」是准确的，不是谦辞。
- 因此本卡的结论我同意：**门返回 pass 不等于打包成功**；`npm pack --dry-run --json` exit 1 且 stdout/stderr 全空这件事没有被判据吸收，是判据本身的缺口（`probeFailed` 只在命令抛异常时置真，返回码被忽略）。
- 我没有重跑该 gate（按维护者要求不再重复执行取证）；全量门禁 17 步全绿与本卡无关（本卡只写卡，未改产品/判据）。
- 遗留：`dist/index.js` 的时间戳是 2026-09-10，存在性无法证明新鲜度；要发布级证据需另立「产物完整性」任务，本轮不做。

#### W4 T1 诊断（2026-10-27）

路由：交接单 §1 指定 `gpt-6.1-terra` / medium，Fast 关闭，不用 Ultra；原生子代理辅助，未调用本机 agent CLI。仓库允许文件仅本卡，末尾追加；未提交、推送、建分支或跑全量门禁。

**原因已复现**：Windows 上默认 `gateDefaultRunCommand` 使用无 shell 的 `execFile('npm', ...)`，实测 `execFile('npm', ['--version'])` 回调 `ENOENT`，stdout/stderr 均空；独立直接调用 `execFile('npm.cmd', ...)` 同步抛 `EINVAL`。默认 runner 将字符串错误码映射为 1，而空字符串 stderr 优先于错误 message，因此返回 code 1、双空输出。实际 `gateDefaultRunCommand('npm', ['pack','--dry-run','--json'], {cwd: process.cwd()})` 复现 code 1 / 0 / 0。PowerShell 可找到 `npm.ps1` 与 `npm.cmd`；经 shell 执行 `npm.cmd` 可成功运行，说明这是当前调用方式的 Windows 命令解析问题，而非已证明的 npm 打包内容故障。

直接 shell 探测（Node `spawnSync('npm.cmd', ['pack','--dry-run','--json'], {cwd, encoding:'utf8', shell:true})`，三次分别在根、`apps/cli`、`apps/web`）：依次 exit 0/0/0，stdout 1130/10956/19915 字节，stderr 0/416/0 字节；完整原文在 `%TEMP%/vessel-w4-pack-8ax1NS/{root,cli,web}.{stdout,stderr}`。npm 12.2.1；输出 JSON 为按包名键控对象，文件数分别 7/101/174。根包 `files` 为 dist、README、LICENSE，无 bin；CLI `bin.vessel=dist/cli.js`、files 为 dist 加测试/map 等排除项，清单含该入口；web 无显式 files/bin。根 workspaces 为 apps/*、packages/*、benchmarks/runners；各目录正常取得各自包清单，未测试 `--workspaces` 全量模式。根与 web 无 prepare/prepack；CLI `prepack: npm run build`，实测 stderr 记录 `tsc -b && node scripts/copy-configs.mjs`，复制 6 个配置。该必需探测触发了额外 CLI 构建及 ignored dist 配置复制，已告知协调者；未再重复此探测。三个目录与根入口读取权限检查通过；不代表对所有权限场景作了穷举。

根 `dist/index.js` 构建前卡内记录 2026-09-10 05:53:13，构建后实测 2026-09-10T12:53:13.630Z（同一时刻），`git check-ignore -v` 返回 `.gitignore:2:dist/`。根 `tsconfig.json` 的 files 为空，仅 references 子项目；各项目 `outDir` 为自身 dist，未覆盖根 dist。故此构建不能刷新根入口；是否需要及如何重建根包入口须另查其源码和发布设计，不能以时间戳或该 build 宣称新鲜。

命令记录：`npx tsc -b tsconfig.json` exit 0（完成时间 2026-10-27T20:26:09.8513270-07:00，无诊断）；`npm --version` exit 0；上述三次 pack 均 exit 0；包装的 gate 探测进程 exit 0、返回 code 1；`git check-ignore -v dist/index.js` exit 0；读取 package/tsconfig、输出 JSON 与权限的 Node 检查 exit 0。首次 JSON 分析误按数组调用 `map`，exit 1，随后按对象修正检查 exit 0；带 Windows 不支持的通配路径的 `rg` exit 1，改用 `rg -g tsconfig.json` exit 0。无 shell `execFile('npm',...)` 最初未捕获同步异常的对照命令 exit 1（`spawn EINVAL`，发生于 `npm.cmd`）；后续单独捕获验证。未单独执行交接单写法 `node node_modules/typescript/bin/tsc -b tsconfig.json`，因为已执行等价的 npx 构建且协调者要求不再重复构建。

被 PreToolUse 拒绝且未执行的原命令：`$t = Get-Date -Format o; Write-Output "START=$t"; npx tsc -b tsconfig.json; $e = $LASTEXITCODE; Write-Output "END=$(Get-Date -Format o) EXIT=$e"; exit $e`（hook 判定命令子展开）。随后单独执行了上述 build。**本次仍不构成打包成功证据**：dry-run 清单不是实际安装或发布验收，根 dist 新鲜度也未证明。

#### W4 T2 判据硬化（2026-10-28）

路由：交接单 §1 的 `gpt-6.1-sol` / medium，Fast 关闭、不用 Ultra；原生子代理辅助，未调用本机其他 Agent CLI。仅改 `benchmarks/runners/src/release-gates/gates.ts`、对应 `release-gates.test.ts`，并在本卡末尾追加。其它 gate 和 `gateDefaultRunCommand` 的签名、行为未改；保留已有工作树改动，无 git 写操作、无新卡。

packaging executor 现在把命令抛出、返回非零退出码、或 stdout/stderr 同时为空白判为探针失败，返回 `pending`，summary 与 note 明确写「探针失败，未取得可判定结果」。探针正常时 dist 缺失仍 pending，dist/entry 齐全仍 pass，dist 在但 entry 缺失仍 fail；判据只收紧。`PACKAGING_GATE_CRITERION` 已同步，不再声称输出不参与判定。证据保留 dist、entry、probeFailed、退出码、双输出字节数。未新增产物完整性或 tarball 清单校验。

测试与实跑原文保存在 `%TEMP%/vessel-w4-t2-zyHDxV/`，命令/退出码/计数索引 `commands.json`：

- `node node_modules/vitest/vitest.mjs run benchmarks/runners/src/release-gates`：exit 0，1 文件、61 tests passed（`release-gates.log`）。
- `node node_modules/vitest/vitest.mjs run benchmarks/runners`：exit 0，35 文件、535 tests passed，295.90s（`runners.log`）。
- `git diff --check -- benchmarks/runners/src/release-gates/gates.ts benchmarks/runners/src/release-gates/release-gates.test.ts`：exit 0。
- 新增 8 个 executor 用例：非零退出、正常探针+双路径、dist 缺失、entry 缺失、exit 0 双空输出、双空白输出、探针抛出、stderr 单边非空；均断言 status 与关键 evidence，失败探针另断言明确 note。

真实 packaging gate 只运行一次，使用现有默认 executor 与默认 RunCommand，命令如下（输出重定向到该 TEMP 目录的 `real-gate.log`）：

```powershell
node --import tsx -e 'const fs=require("node:fs"); import("./benchmarks/runners/src/release-gates/gates.ts").then(async m=>{ const dir="C:/work/AppData/Local/Temp/vessel-w4-t2-zyHDxV"; const exec=async (...args)=>{const result=await m.gateDefaultRunCommand(...args); fs.writeFileSync(dir+"/probe.json",JSON.stringify(result,null,2)); return result;}; const gate=m.buildReleaseGateExecutors().find(e=>e.gate.id==="packaging"); console.log(JSON.stringify(await gate.run({repoRoot:process.cwd(),reportsDir:dir,exec}),null,2)); }).catch(e=>{console.error(e);process.exitCode=1;});'
```

入口进程 exit 0；**gate status=pending**，`pending=true`；证据为 `dist=true`、`entry=true`、`probeFailed=true`、`npm pack exit=1`、`stdoutBytes=0`、`stderrBytes=0`。summary 为「探针失败，未取得可判定结果」，note 要求修复 npm 探针后重跑。`probe.json` 保留默认 RunCommand 的返回值。该结果与 T1 已查明的 Windows 无 shell `execFile('npm', ...)` 命令解析问题一致；本次没有修改该执行层、没有用 shell 的成功 dry-run 替换判定，**本次仍不构成打包成功证据**。

按协调者串行安排，未运行 `node node_modules/typescript/bin/tsc -b tsconfig.json` 或 `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`；已发送 `READY_FOR_TYPES`，由协调者在 T2/T3 源码稳定后补充最终类型证据。未跑全量门禁；独立 `gpt-6.1-terra` / medium 复核由协调者安排。被拒命令：无。一次辅助只读 `rg` 使用 Windows 不支持的通配路径，exit 1（os error 123），不影响上述测试结果。

#### W4 协调者补充核验（2026-10-28）

- T1 根入口来源已继续查明：`index.ts:5`、`tsconfig.release.json`、`package.json` 的 `build:release` 与卡 112 均指向 `tsc -p tsconfig.release.json`，而不是 references 型 `tsc -b tsconfig.json`。源码 `index.ts` 的最后提交为 `91b83e3`（2026-09-10），本地 mtime 为 `2026-09-10T12:47:38.254Z`，早于根 `dist/index.js` 的 `2026-09-10T12:53:13.630Z`；本轮该源码未改。因此未发现仅因源码更新而必须重建根入口的证据，不能仅凭旧日期判定过期；若要取得本次根发布物的新鲜度证据，应另跑其 release 编译。本轮允许的 `tsc -b` 不覆盖根入口，未额外执行 release 编译，也不声称根产物已刷新。本次仍不构成打包成功证据。
- T1 原始 JSON 与日志已读回核对：root/CLI/web 清单分别为 7/101/174 个文件，CLI stderr 明确记录 prepack 的 `tsc -b && node scripts/copy-configs.mjs` 与 6 个配置复制。辅助只读检查曾把 npm 12 的对象输出误当数组而 exit 1，改用 `Object.values` 后 exit 0；一次尝试 TypeScript JS API 的内存检查因当前包不暴露 `ts.sys` 而 exit 1，未写产物、未据此得出新鲜度结论；Windows 通配路径的只读 rg exit 1，改用 `-g` 后 exit 0。
- T2 独立复核：`gpt-6.1-terra` / medium、Fast 关闭，包装专属差异、判据文字、四类状态及 evidence 逐项 PASS；独立 `node node_modules/vitest/vitest.mjs run benchmarks/runners/src/release-gates` exit 0，1 文件 / 61 passed。复核读取 `real-gate.log` 与 `probe.json` 确认为 pending，没有把 shell dry-run 成功代替默认 gate。
- 最终源码稳定后的统一检查：`node node_modules/typescript/bin/tsc -b tsconfig.json` exit 0；`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` exit 0，均无诊断。日志 `%TEMP%/vessel-wave4-baseline-0JOEe1/repair-tsc-build.log`、`repair-tsc-tests.log`。此前统一测试类型检查 exit 1 的两处 TS7006 属 T3 测试，已在其允许范围修复；原失败保留为 `final-tsc-tests.log`，不充作通过证据。
- 未做全量门禁、提交、推送、分支操作、执行层修复或产物安装验收；本地默认 packaging 门仍 pending，Windows npm 调用方式未改。除 T1 已逐字记录的 hook 拒绝外，无新增被拒命令。

#### 协调者验收（2026-10-28，独立复跑）

- T1 的结论我接受：Windows 无 shell 的 `execFile('npm')` 返回 ENOENT；直接 `npm pack` 三处都 exit 0（清单 7/101/174）。根入口的真实构建入口是 `tsc -p tsconfig.release.json`（`package.json` 的 `build:release`），`tsc -b` 不覆盖它，所以「旧时间戳 = 过期」不成立——这条纠正了我上一轮的推断。
- T2 的判据我读代码确认：`probeFailed ||= outcome.code !== 0 || (stdout 与 stderr 同时空白)`，`detail` 里带 `npm pack exit=` 与两路字节数；四态（pending/pass/fail + 探针失败）都有用例。**只收紧，没有放宽**。
- 我自己的复跑：`vitest run benchmarks/runners/src/release-gates` **61/61**；`vitest run benchmarks/runners` **35 文件 / 535 passed**；两处 tsc exit 0。
- 仍未解决的是**执行层**：npm 探针在 Windows 拿不到结果，所以默认 gate 恒为 `pending`。这条不在本轮授权范围内（T1 只诊断、T2 只改判据），已交给第五波 V1。
- 卡状态：**已执行、未通过**（判据已硬化，但打包成功仍无证据）。

#### W5 V1 Windows npm 执行层修复与自验（2026-10-28，待独立复核）

路由：第五波 §1 指定 `gpt-6.1-sol` / medium，依据「改执行层命令构造，牵动 gate 判据」；Fast 关闭，不用 Ultra。原生子代理辅助，由协调者安排独立 `gpt-6.1-terra` / medium 复核；本节仅报告实现与自验，不作最终验收。本轮不新建卡、不改 `.pdw/`，不调用本机其它 Agent CLI，无 Git add/commit/push/branch 操作；保留已有脏工作树。

改动文件仅 `benchmarks/runners/src/release-gates/gates.ts`、`benchmarks/runners/src/release-gates/release-gates.test.ts`、本卡（末尾追加）。选择仅在 `platform === 'win32' && command === 'npm'` 时设置 `shell: true`，保留命令名 `npm` 与参数数组；理由是 W4 T1 已实测无 shell 的 `npm` 为 ENOENT、直接 `npm.cmd` 为 EINVAL，单改后缀不能解决本机调用问题。其它平台及 Windows 非 npm 命令仍无 shell。新增 `createGateRunCommand` 注入 seam，生产默认仍使用 promisified `execFile`；cwd/env/timeout/windowsHide、成功输出转换、错误退出码与 stdout/stderr 映射逐字保留。packaging criterion、judge 与 `probeFailed ||= outcome.code !== 0 || (!outcome.stdout.trim() && !outcome.stderr.trim())` 均未改。

新增六个用例：Windows npm shell 路由、Linux/macOS npm 无 shell、Windows node 无 shell，以及经 Windows fake-exec 的正常双路径 pass / 非零退出 pending；断言实际命令名、参数、所有执行选项、输出字节与退出码。既有空输出/空白/抛出/缺路径等八例继续保留。

原始日志在 `%TEMP%/vessel-w5-v1-IUjlww/`，四条命令的退出码索引为 `commands.json`（均在本轮最后一次源码编辑之后）：

| 命令 | exit | 计数 / 诊断 | 原始日志 |
|---|---:|---|---|
| `node node_modules/vitest/vitest.mjs run benchmarks/runners/src/release-gates` | 0 | 1 文件 / 67 passed | `release-gates.log` |
| `node node_modules/vitest/vitest.mjs run benchmarks/runners` | 0 | 35 文件 / 541 passed，97.45s | `runners.log` |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 无诊断 | `tsc-build.log` |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 无诊断 | `tsc-tests.log` |

`git diff --check -- benchmarks/runners/src/release-gates/gates.ts benchmarks/runners/src/release-gates/release-gates.test.ts`：exit 0。测试命令由 Node spawnSync 原样执行参数并把 stdout/stderr 保存到上述日志；没有运行全量 gate-batched。

真实默认 packaging executor 只运行一次；以下包装器仅保存默认 runner 原始返回，不改变命令/参数/判据：

```powershell
node --import tsx -e 'const fs=require("node:fs"),path=require("node:path"),os=require("node:os"); import("./benchmarks/runners/src/release-gates/gates.ts").then(async m=>{const dir=path.join(os.tmpdir(),"vessel-w5-v1-IUjlww");const exec=async (...args)=>{const result=await m.gateDefaultRunCommand(...args);fs.writeFileSync(path.join(dir,"probe.json"),JSON.stringify(result,null,2));fs.writeFileSync(path.join(dir,"npm-stdout.log"),result.stdout);fs.writeFileSync(path.join(dir,"npm-stderr.log"),result.stderr);return result;};const gate=m.buildReleaseGateExecutors().find(e=>e.gate.id==="packaging");const verdict=await gate.run({repoRoot:process.cwd(),reportsDir:dir,exec});const output=JSON.stringify(verdict,null,2);fs.writeFileSync(path.join(dir,"real-gate.log"),output+"\n");console.log(output);}).catch(e=>{console.error(e);process.exitCode=1;});'
```

入口进程 exit 0；实际 gate 返回 `status=pass`，summary 为「npm 探针正常，build 产物在位（dist 与入口均存在）——未校验产物完整性/内容」。`evidence.detail` 原文：

```text
dist=true
entry=true
probeFailed=false
npm pack exit=0
stdoutBytes=1130
stderrBytes=0
```

`real-gate.log` 保存 verdict，`probe.json` 保存原始 code/stdout/stderr，`npm-stdout.log` / `npm-stderr.log` 保存两路 npm 输出。默认执行已取得真实 npm 结果，本次未出现 ENOENT/EINVAL。父 Node 进程另在控制台发出 `(node:9004) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.`；这是执行层 shell API 警告，不在 npm 子进程 stderr 中。本 gate 参数为固定的 `pack --dry-run --json`，本轮按 V1 允许方案使用 shell，未增加用户输入命令构造。

未做：其它 release gates、全量门禁（留给 V4）、产物完整性/安装/发布验收、根 release 入口重建（本轮只要求现有默认门与 tsc -b，后者不覆盖根入口）、HANDOFF/看板更新（不在 V1 允许文件内）。本次默认门 pass 仍只证明 npm 探针正常与两个路径存在；不扩大成发布物完整性或安装成功结论。最终验收待独立复核。

本轮被拒命令原文：无。失败命令：无；观察到的额外警告为上方 DEP0190。既往 W4 的失败与被拒命令保留原文，不覆盖历史记录。

#### W5 V1 独立复核（2026-10-28）

复核者为另起只读宿主子代理 `gpt-6.1-terra` / medium，Fast 关闭，按第五波 §1 路由。复核结论原文：**V1 review: PASS for the requested acceptance criteria.** Windows npm 独有 shell 路由，非 Windows 与 Windows 非 npm 参数保持；exit/stdout/stderr 映射和 probeFailed 规则未改。实跑原始 probe 与卡内 pass 一致（exit 0 / stdout 1130 字节 / stderr 0 字节），原卡字节前缀保持。复核者独立执行 `npx vitest run benchmarks/runners/src/release-gates/release-gates.test.ts`：exit 0，1 文件 / 67 passed。复核提示 DEP0190：当前 packaging 参数固定，泛用 npm 调用不得传入不可信参数。复核者未改文件、未跑全量门禁；被拒命令：无。

#### W5 V1 协调者验收（2026-10-28，独立复跑）

- 代码我读了一遍：`createGateRunCommand` 把 `execFile` 抽成可注入 seam，只有 `platform === 'win32' && command === 'npm'` 时加 `{ shell: true }`，命令名与参数数组不变；`probeFailed ||= outcome.code !== 0 || (两路输出同时空白)` 这条判据**没有放宽**，`verdict.evidence.detail` 追加 `npm pack exit=` / `stdoutBytes` / `stderrBytes`。改动只在交接单允许的三个文件内。
- 我自己的复跑（日志 `%TEMP%\opencode\wave5\`）：`vitest run benchmarks/runners/src/release-gates` **1 文件 / 67 passed**（exit 0，5.6s）；`tsc -b tsconfig.json` 与 `tsc -p tsconfig.test.json --noEmit` 均 **exit 0**；`benchmarks` 整段由全量门禁复跑覆盖为 **35 文件 / 541 passed**。
- 真实默认 gate 我自己又跑了一次（临时包装器只保存原始返回，不改命令与判据；`%TEMP%\opencode\wave5\v1-gate\verdict.json`）：`status=pass`，`dist=true`、`entry=true`、`probeFailed=false`、`npm pack exit=0`、`stdoutBytes=1130`、`stderrBytes=0`，与 V1 自验逐字一致；父进程同样出现 DEP0190（shell 拼接参数警告），属卡内已记录的边界。
- 结论：**V1 验收通过**。边界照原口径：只证明 npm 探针能取得结果、且 `dist` 与 `dist/index.js` 两个路径存在；不校验产物完整性/内容，也不证明安装或发布。

