# T303 — benchmark 产物完整性清单（HARNESS² P2-2）

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：给 `benchmarks/fixtures/**` 与 `benchmarks/scenarios/*.yaml` 做一份可重算的 sha256 清单与比对工具。**不改既有 8 道 release gate**。

## 0. 先读这些（只读）

1. `benchmarks/runners/src/spec-manifest-parity.test.ts` — 现有的形状校验（它只校形状，本卡补内容指纹）。
2. `benchmarks/runners/src/release-gates/gates.ts` 的 gate 清单 — 确认**不要**往这里加门。
3. `packages/engine/src/fingerprint.ts` — 已有的哈希写法（排序 + NUL + 字节），复用同款风格，不要另造。
4. `configs/` — 现有 json 配置的字段风格（`version` 字段的用法）。

## 1. 新增 `benchmarks/runners/src/provenance.ts`

```ts
export interface ProvenanceEntry { path: string; sha256: string }   // path 相对 repoRoot，正斜杠
export interface ProvenanceManifest { version: 1; generatedAt: string; entries: ProvenanceEntry[] }

/** 收集 fixtures 与 scenarios 下所有普通文件（不含 setup 创建的链接目标）。 */
export function collectProvenance(repoRoot: string): ProvenanceEntry[];

/** 与清单比对：返回 missing / extra / changed 三类差异；无差异返回空对象。 */
export function diffProvenance(expected: ProvenanceEntry[], actual: ProvenanceEntry[]): {
  missing: string[]; extra: string[]; changed: string[];
};
```

要求：

- 收集范围**写死**：`benchmarks/fixtures/**`（所有普通文件）与 `benchmarks/scenarios/*.yaml`。
- 排除 `.git`、`node_modules`、`dist`；符号链接**跳过**（与 `copyFixtureTree` 的口径一致）。
- 路径按字典序排序；`sha256` 是文件字节的十六进制全串（不是前 16 位）。
- `diffProvenance` 只做集合比较，不抛错。

## 2. 新增清单文件 `configs/benchmark-provenance.json`

- 用一次性命令生成（`node --input-type=module -e` 或临时脚本，**不要**在仓库里留生成脚本）。
- 结构：`{ "version": 1, "generatedAt": "<ISO>", "entries": [...] }`。
- 生成后跑一次 `diffProvenance` 自证为空。

## 3. 测试（新增 `benchmarks/runners/src/provenance.test.ts`）

1. 在临时 repoRoot 造 2 个 fixture 文件 + 1 个 scenario yaml → `collectProvenance` 返回 3 条、路径有序、哈希与手工 sha256 一致。
2. 改其中一个文件内容 → `diffProvenance` 报 `changed` 一条。
3. 删除一个文件 → `missing`；新增一个 → `extra`。
4. 符号链接被跳过（Windows 用 junction 造，拿不到权限就 skip 该断言并写明）。
5. 对真实仓库跑一次 `diffProvenance(清单, collectProvenance(repoRoot))` → **空**（这条同时证明清单是新鲜的）。

## 4. 不许做

- 不改 `release-gates/gates.ts`、不加第 9 道门、不改 `spec-manifest-parity`。
- 不做"清单过期就让 CI 红"的强制守卫（本卡只提供工具 + 一条自证用例）。
- 不 commit / push / 删文件；不加依赖。

## 5. 允许修改

```
benchmarks/runners/src/provenance.ts        (新增)
benchmarks/runners/src/provenance.test.ts   (新增)
configs/benchmark-provenance.json           (新增)
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/provenance.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
范围：<收集到的文件数 + 是否含符号链接>
清单：<条目数 + 是否与磁盘一致>
工具：<diff 三类差异的语义>
测试：<五条用例结果>
检查：<三条命令退出码>
未做：<如实写>
```

## Result

已完成。`benchmarks/runners/src/provenance.ts` 提供 `collectProvenance(repoRoot)`（fixtures 下全部普通文件 + scenarios 顶层 yaml，跳过 `.git`/`node_modules`/`dist` 与符号链接，路径字典序）与 `diffProvenance(expected, actual)`（`missing` / `extra` / `changed` 三类）。`configs/benchmark-provenance.json` 收录 **111 条**，与磁盘一致。

5 个用例通过（临时树三条、符号链接一条、真实仓库自证一条），`tsc -b` 与 `typecheck:tests` exit 0。没有改既有 8 道 release gate，也没有做「清单过期即红」的强制守卫。
