import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createOverridePriceSource,
  type OverridePriceSource,
  type TokenPrice,
} from '../providers/pricing.js';
import { defaultUsageRoot } from './UsageStore.js';

/**
 * apps/cli/usage — 用户价目覆盖（task 092）。
 *
 * 文件：`~/.vessel/pricing.override.json`
 *
 * 设计（学 cc-switch「覆盖文件与内置表分离 + 删除墓碑」的思路，实现为本仓库自有代码）：
 *   1. 该文件**只存用户覆盖 + 删除墓碑**，内置 `configs/pricing.json` 仍由版本维护；
 *      两边互不覆盖——内置更新不会冲掉用户手改，用户覆盖也不必 fork 内置文件。
 *   2. 删除墓碑：显式删除内置条目后，查价按 0 计价且**不回退**目录/协议/兜底
 *      （否则「删了还在算钱」）。
 *   3. 值守卫式修复（`repair`）：只改「现值仍等于旧值」的覆盖行，
 *      用户手改过的行绝不覆盖（升级友好）。
 *
 * 键格式（两种，同一模型同时存在时 `provider::model` 胜）：
 *   - `model`            对所有 provider 生效
 *   - `provider::model`  只对该 provider 生效（与 usage.json 的条目键同格式）
 *
 * 查价规则（归一 + 精确/前缀 + 优先级）在 `@vessel/shared/pricing` 里，本文件只负责
 * 读盘 / 写盘 / 值守卫，禁止再写第二套匹配实现。
 */

export const PRICING_OVERRIDE_FILENAME = 'pricing.override.json';

export interface PricingOverrideFile {
  version: 1;
  /** 用户覆盖单价（键 = `model` 或 `provider::model`） */
  models: Record<string, TokenPrice>;
  /** 删除墓碑：显式删除的内置条目键 */
  deleted: string[];
}

/** 值守卫式修复的一条：`from` 是「旧值」，`to` 是新值；仅当现值 === 旧值才改。 */
export interface PricingRepair {
  key: string;
  from: TokenPrice;
  to: TokenPrice;
}

export type PricingRepairStatus = 'applied' | 'skipped-absent' | 'skipped-user-modified';

export interface PricingRepairOutcome {
  key: string;
  status: PricingRepairStatus;
  /** 修复前的现值（skipped-absent 时为 undefined） */
  current?: TokenPrice;
}

/** 价格字段级相等（`undefined` 与缺失等价；`cacheRead`/`cacheWrite` 缺省不算差异）。 */
export function sameTokenPrice(a: TokenPrice | undefined, b: TokenPrice | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite
  );
}

/** 覆盖单价的合法性：input/output 必填且 >= 0；cache 两项可选且 >= 0。 */
export function isValidTokenPrice(price: Partial<TokenPrice> | undefined): price is TokenPrice {
  if (!price || typeof price !== 'object') return false;
  const ok = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!ok(price.input) || !ok(price.output)) return false;
  if (price.cacheRead !== undefined && !ok(price.cacheRead)) return false;
  if (price.cacheWrite !== undefined && !ok(price.cacheWrite)) return false;
  return true;
}

function emptyFile(): PricingOverrideFile {
  return { version: 1, models: {}, deleted: [] };
}

/**
 * 用户覆盖文件读写 + 值守卫修复。
 *
 * 读盘容错：文件缺失 / JSON 损坏 / 字段类型不对 → 按空覆盖处理（不抛错、不猜价）。
 * 写盘：原子 tmp + rename（与 ProviderStore / UsageStore 同策略，Windows 上有界重试）。
 */
export class PricingOverrideStore {
  readonly rootDir: string;
  readonly file: string;

  constructor(opts: { rootDir?: string } = {}) {
    this.rootDir = opts.rootDir ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
    this.file = path.join(this.rootDir, PRICING_OVERRIDE_FILENAME);
  }

  /** 读盘（缺失/损坏 → 空覆盖）。 */
  read(): PricingOverrideFile {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return emptyFile();
    }
    try {
      const parsed = JSON.parse(text) as Partial<PricingOverrideFile>;
      const models: Record<string, TokenPrice> = {};
      if (parsed.models && typeof parsed.models === 'object') {
        for (const [key, value] of Object.entries(parsed.models)) {
          if (key.trim() === '') continue;
          if (!isValidTokenPrice(value)) continue; // 坏行忽略，不污染整张覆盖表
          const price: TokenPrice = { input: value.input, output: value.output };
          if (value.cacheRead !== undefined) price.cacheRead = value.cacheRead;
          if (value.cacheWrite !== undefined) price.cacheWrite = value.cacheWrite;
          models[key] = price;
        }
      }
      const deleted = Array.isArray(parsed.deleted)
        ? parsed.deleted.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
        : [];
      return { version: 1, models, deleted };
    } catch {
      return emptyFile();
    }
  }

  /** 原子写盘（tmp + rename；目标目录按需创建）。 */
  write(file: PricingOverrideFile): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt === 0 ? 5 : 15);
      }
    }
    throw lastError;
  }

  /** 当前覆盖条目（键 → 价）。 */
  entries(): { key: string; price: TokenPrice }[] {
    const file = this.read();
    return Object.entries(file.models).map(([key, price]) => ({ key, price }));
  }

  /** 当前删除墓碑键。 */
  tombstones(): string[] {
    return this.read().deleted;
  }

  get(key: string): TokenPrice | undefined {
    return this.read().models[key];
  }

  /** 写入/更新一条覆盖（非法价抛 RangeError，不落盘半成品）。 */
  set(key: string, price: Partial<TokenPrice>): PricingOverrideFile {
    const trimmed = key.trim();
    if (trimmed === '') throw new RangeError('override key 不能为空');
    if (!isValidTokenPrice(price)) {
      throw new RangeError(`override 单价非法（input/output 必填且 >= 0；cache 两项可选且 >= 0）：${trimmed}`);
    }
    const file = this.read();
    const next: TokenPrice = { input: price.input, output: price.output };
    if (price.cacheRead !== undefined) next.cacheRead = price.cacheRead;
    if (price.cacheWrite !== undefined) next.cacheWrite = price.cacheWrite;
    file.models[trimmed] = next;
    // 同一键的墓碑与覆盖互斥：设了价就不再是「删除」状态。
    file.deleted = file.deleted.filter((k) => k !== trimmed);
    this.write(file);
    return file;
  }

  /** 删除墓碑：显式删除内置条目（命中即按 0 计价、不回退）。 */
  tombstone(key: string): PricingOverrideFile {
    const trimmed = key.trim();
    if (trimmed === '') throw new RangeError('墓碑 key 不能为空');
    const file = this.read();
    delete file.models[trimmed];
    if (!file.deleted.includes(trimmed)) file.deleted.push(trimmed);
    this.write(file);
    return file;
  }

  /** 撤销墓碑（回到内置/目录价）。返回是否确有该墓碑。 */
  restore(key: string): boolean {
    const trimmed = key.trim();
    const file = this.read();
    const before = file.deleted.length;
    file.deleted = file.deleted.filter((k) => k !== trimmed);
    if (file.deleted.length === before) return false;
    this.write(file);
    return true;
  }

  /**
   * 值守卫式修复：对每条 `from → to`，**仅当现值等于 `from`** 才写入 `to`。
   *
   * - 键不存在 → `skipped-absent`（修复不新建条目，与「内置 seed 不覆盖用户行」同一思路）
   * - 现值已被用户改成别的 → `skipped-user-modified`（绝不冲掉手改）
   * - 现值 === from → `applied`
   *
   * 只有至少一条 applied 才落盘（无变更不写文件 → 幂等）。
   */
  repair(repairs: readonly PricingRepair[]): PricingRepairOutcome[] {
    const file = this.read();
    const outcomes: PricingRepairOutcome[] = [];
    let applied = 0;
    for (const repair of repairs) {
      const current = file.models[repair.key];
      if (current === undefined) {
        outcomes.push({ key: repair.key, status: 'skipped-absent' });
        continue;
      }
      if (!sameTokenPrice(current, repair.from)) {
        outcomes.push({ key: repair.key, status: 'skipped-user-modified', current });
        continue;
      }
      file.models[repair.key] = { ...repair.to };
      applied += 1;
      outcomes.push({ key: repair.key, status: 'applied', current });
    }
    if (applied > 0) this.write(file);
    return outcomes;
  }

  /** 适配成 `resolvePrice` 用的覆盖价源（纯数据，无 I/O 副作用）。 */
  source(): OverridePriceSource {
    const file = this.read();
    return createOverridePriceSource({ models: file.models, deleted: file.deleted });
  }
}
