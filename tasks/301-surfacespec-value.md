# T301 — SurfaceSpec 值化（HARNESS² P1-4 最小版）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：把「改的是 harness 的哪一部分」变成有类型可依的值，而不是散落在代码与文档里的隐含假设。

## 0. 先读这些（只读）

1. `packages/behavior/src/index.ts` — 现有导出面与命名风格。
2. `packages/behavior/src/ir/` 与 `packages/behavior/src/compiler/` — `BehaviorIR` 的字段与校验写法（`BehaviorCompileError` 的形状）。
3. `docs/BEHAVIOR-IR-SPEC.md` — 现有 IR 文档结构，最后加一节时可沿用其口吻。
4. `packages/application/src/compose.ts` — 找 `composeHarness` 里 always-on / system prompt 的来源（本卡**只读**，不改它）。

## 1. 新增 `packages/behavior/src/surface/SurfaceSpec.ts`

```ts
export type InstallMode = 'self-hosted';

export interface SurfaceCaps {
  /** 常驻文本是否随每轮注入 */
  alwaysOn: boolean;
  /** 常驻文本的字符上限（超出即校验失败） */
  maxAlwaysOnChars: number;
}

export interface SurfaceSpec {
  /** 唯一标识，如 'vessel.self-hosted' */
  name: string;
  /** 常驻注入文本（当前就是 composeHarness 组装的 stable system 摘要） */
  alwaysOn: string;
  /** 当前只有一种：自托管。不要扩其它值。 */
  installMode: InstallMode;
  caps: SurfaceCaps;
}

/** 返回问题列表；空数组 = 合法。不抛错。 */
export function validateSurfaceSpec(spec: SurfaceSpec): string[];

/** 当前实现的唯一 surface（值，不是类）。 */
export const SELF_HOSTED_SURFACE: SurfaceSpec;
```

校验规则（写死）：

- `name` 非空、只含 `[a-z0-9._-]`。
- `installMode === 'self-hosted'`（其它值直接报问题，不新增枚举）。
- `alwaysOn` 非空、长度 ≤ `caps.maxAlwaysOnChars`。
- `caps.alwaysOn` 必须是 boolean，`maxAlwaysOnChars` 是正整数。
- 不校验 `alwaysOn` 的**内容**（不审措辞、不做词表扫描）。

`packages/behavior/src/index.ts` 导出这四个符号。

## 2. 文档

`docs/BEHAVIOR-IR-SPEC.md` 末尾加一节「SurfaceSpec（当前只有一种安装方式）」，8–15 行：说明 `name/alwaysOn/installMode/caps` 的用途、为什么只有 `self-hosted`（没有对应 benchmark 支撑的模式一律不做）、以及它**不是**运行时开关（改它不改变 composeHarness 的行为）。

## 3. 测试（新增 `packages/behavior/src/surface/SurfaceSpec.test.ts`）

1. `SELF_HOSTED_SURFACE` 通过 `validateSurfaceSpec`。
2. 空 `name`、非法字符 `name` → 报问题。
3. `installMode` 传 `'home_dir'`（用 `as any` 绕过类型）→ 报问题。
4. `alwaysOn` 超过 `maxAlwaysOnChars` → 报问题。
5. `caps.alwaysOn` 非 boolean / `maxAlwaysOnChars` 为 0 或负数 → 报问题。

## 4. 不许做

- 不接 composeHarness、不改任何运行时行为、不改 IR/Compiler。
- 不实现多种 `installMode`、不做 prompt 词表扫描。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`；不跑 `--live`。

## 5. 允许修改

```
packages/behavior/src/surface/SurfaceSpec.ts        (新增)
packages/behavior/src/surface/SurfaceSpec.test.ts   (新增)
packages/behavior/src/index.ts
docs/BEHAVIOR-IR-SPEC.md
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/behavior/src/surface/SurfaceSpec.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
类型：<最终字段>
校验：<五类规则 + 是否抛错>
导出：<index.ts 加了什么>
文档：<节标题 + 行数>
检查：<三条命令退出码>
未做：<如实写>
```
