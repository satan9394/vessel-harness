import * as fs from 'node:fs';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';
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
 *   4. 读盘可见性：文件**不可读 / 损坏**时绝不静默当成「没有覆盖」——`readWithStatus()`
 *      给出三态（`missing` / `unreadable` / `corrupt`）并打一条含「路径 + 原因 + 后果 + 恢复」
 *      的 warn（详见 `PricingOverrideReadStatus`）；ENOENT 仍静默（首次运行是正常状态）。
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

/**
 * 落盘结果（本卡修复 C）——`write()` 的返回，四个 mutator **原样透传**。
 *
 * 为什么需要它：旧 `write()` 返回 `void`，于是「内容变了」与「内容真的落盘了」在类型上不可
 * 区分。留档失败被**抑制写入**、或写盘 I/O 失败（ENOSPC / EPERM / 文件被占用…）时，CLI 仍然
 * 无条件打印「✔ 已写入覆盖」并 exit 0 —— 脚本据此误判已落盘。
 */
export interface PricingOverrideWriteResult {
  /** 新内容是否确已原子落盘（tmp + rename 成功）。 */
  persisted: boolean;
  /** 内容是否真的变了：`false` = 这次压根不需要写盘（如 repair 无一条 applied），**不算失败**。 */
  changed: boolean;
  /** `changed && !persisted` 时的原因（含 errno）；其余情况缺省。 */
  reason?: string;
}

/** `set()` / `tombstone()` 的返回：内存视角的变更后内容 + 落盘结果。 */
export interface PricingOverrideMutationResult extends PricingOverrideWriteResult {
  /** `persisted === false` 时，这份内容**没有**落盘（磁盘上是原内容或其留档）。 */
  file: PricingOverrideFile;
}

/**
 * `restore()` 的返回：**拆开**「内存里有没有墓碑」与「有没有真落盘」（本卡修复 C 的核心）。
 *
 * 旧签名返回单个 `boolean`，它只是 `found`；抑制写入时它仍为 `true` ⇒ CLI 退出码 0，
 * 脚本误以为墓碑已撤销并已落盘。
 */
export interface PricingRestoreResult {
  /** 内存里确实有该墓碑（= 撤销动作成立）；`false` 时压根不写盘。 */
  found: boolean;
  /** 新内容是否真的落盘；`found === false` 时恒为 `false`。 */
  persisted: boolean;
  /** `found && !persisted` 时的原因。 */
  reason?: string;
}

/** `repair()` 的返回：逐条判定结果 + 落盘结果（`changed` = 有 `applied`，否则压根不写盘）。 */
export interface PricingRepairResult extends PricingOverrideWriteResult {
  outcomes: PricingRepairOutcome[];
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

/** JSON 值的种类描述（只进告警文案：`null` / `数组` / `对象` / `typeof` 名）。 */
function describeJsonKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  if (typeof value === 'object') return '对象';
  return typeof value;
}

/**
 * 读盘状态位——把几种「读不到」区分开（与 `modelCatalog.ts` 的 `readModelCatalogFile` 同思路；
 * 那边把后两者并称 `invalid`，这里再分出 `unreadable`，因为**恢复动作不同**：改路径/权限 vs 修 JSON）。
 *
 *   - `ok`          文件存在、可读、JSON 顶层是对象，且 `models`（若出现）是对象、`deleted`（若出现）是数组；
 *   - `missing`     文件不存在（ENOENT）→ **首次运行是正常状态**：等价于「无覆盖」，**不告警、无副作用**；
 *   - `unreadable`  读盘失败但原因不是 ENOENT（EACCES / EISDIR / EPERM …）→ 异常，**告警**；
 *   - `corrupt`     JSON 解析失败 / 顶层不是对象 / `models`、`deleted` 出现但结构非法 → 损坏，**告警**。
 *
 * **行级**非法条目（`models` 里单价缺项、键为空白、`deleted` 里混入非字符串）不在上表内：
 * 仍按 task 092 既有语义逐条忽略，**不算** `corrupt`（既有断言锁定该行为）。
 */
export type PricingOverrideReadStatus = 'ok' | 'missing' | 'unreadable' | 'corrupt';

/** `readWithStatus()` 的返回：原 `PricingOverrideFile` 三字段 + 状态位（`read()` 仍只返回三字段）。 */
export interface PricingOverrideRead extends PricingOverrideFile {
  status: PricingOverrideReadStatus;
  /** 非 `ok` / `missing` 时的原因（供调用方拼文案；本层只报告，绝不抛错）。 */
  error?: string;
  /** 实际读取的绝对路径（告警文案里给出，便于用户直接定位与备份）。 */
  file: string;
}

/**
 * 用户覆盖文件读写 + 值守卫修复。
 *
 * 读盘容错（本卡修复）：**「读不到」与「文件就是空覆盖」必须分开**。旧实现在文件不可读 /
 * JSON 损坏时静默返回空覆盖，于是两件花钱的事同时发生且**零提示**：
 *   ① 用户自定义单价全部失效（回落内置 / 目录 / 协议 / 兜底）；
 *   ② **删除墓碑一并丢失** → 被用户显式删掉的模型按原价**重新计费**。
 * 现在异常 / 损坏路径由 `readWithStatus()` 给状态位，并且**一定**打一条含
 * 「文件路径 + 失败原因 + 后果 + 恢复指引」的 warn（缺失仍静默：首次运行不该吵）。
 *
 * 写盘：原子 tmp + rename（与 ProviderStore / UsageStore 同策略，Windows 上有界重试）。
 * **且写盘前必留档**（本卡修复）：损坏 / 读不到的覆盖文件在**任何覆盖写之前**先改名留档为
 * `<file>.corrupted-<epochMs>[-N]`（与 UsageStore / ProjectRegistry / CredentialStore 同款命名，
 * 只改名不删除）；留档失败则**抑制本次写入**（原文保持不变）并 warn，绝不抛错。
 *
 * 留档与写失败的可见性（B2）：「留档成功 → 写失败」曾是一个**静默窗口**——留档把原路径搬走后，
 * mkdir / 写 tmp / rename 任一步失败，原路径就不存在了，而 `readWithStatus()` 的 `missing`
 * 分支是设计上静默的，于是用户既看不到留档路径也看不到「文件损坏」。现在：①留档成功**立刻**
 * warn（含留档路径 + 原路径 + 「即将写入新内容」）；②写失败时**先尝试回滚**（把留档改回原名，
 * 磁盘状态与写入前逐字一致），回滚不了才兜底告警给出留档路径。
 *
 * 落盘结果（C）：`write()` 返回 `PricingOverrideWriteResult` 而不是 `void`，**且不再因 I/O
 * 失败抛错**（失败一律经 `persisted: false` + `reason` 上抛，同时打 warn）——四个 mutator 把它
 * 透传给 CLI，CLI 才能在「内容变了但没落盘」时收回报错而不是宣称成功。
 */
export class PricingOverrideStore {
  readonly rootDir: string;
  readonly file: string;

  /** 本实例已告警过的「状态签名」——避免同一次损坏被 entries()/tombstones()/get()/source() 反复刷屏。 */
  private warnedSignature: string | undefined;

  constructor(opts: { rootDir?: string } = {}) {
    this.rootDir = opts.rootDir ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
    this.file = path.join(this.rootDir, PRICING_OVERRIDE_FILENAME);
  }

  /**
   * 损坏 / 不可读的告警（本卡的核心可见性）。
   *
   * **策略取 (b)：告警 + 明确「本次忽略覆盖」+ 恢复指引**（而不是 (a)「让调用方拒绝按覆盖计价」）。
   * 理由：① (a) 要改的调用方是 `UsageStore` / `cli.ts`，不在本卡文件范围（本卡只动本文件与其测试）；
   * ② 更要紧的是 **(a) 并不能更安全**——没有缓存就取不回墓碑，即便调用方「拒绝按覆盖计价」，
   *    被删模型照样回落内置价计费；(a) 与 (b) 在数据上完全相同，区别只是调用方怎么标注成本，
   *    而那是 UsageStore 的成本语义决定（标 estimated / 延后计费），不是本文件能定的。
   * 所以这里保持「绝不抛错、命令照跑、写语义不变」，只把损失讲清楚；同时导出
   * `readWithStatus()`，让将来真要接线 (a) 时不必再动本文件。
   *
   * 文案四要素：**文件路径**（用户可直接去备份）+ **失败原因**（可直接修）+
   * **后果**（覆盖失效 + 墓碑丢失 → 重新计费）+ **恢复指引**。
   */
  private warnBroken(status: 'unreadable' | 'corrupt', reason: string): void {
    const signature = `${status}|${reason}`;
    if (this.warnedSignature === signature) return;
    this.warnedSignature = signature;
    const how = status === 'unreadable' ? '读不到' : '损坏';
    console.warn(
      `[vessel] pricing.override.json ${how}（${reason}）：${this.file}\n` +
        '  本次忽略整份覆盖（按「无覆盖」继续，命令照常运行）：用户自定义单价失效，且删除墓碑一并丢失' +
        '——被显式删除过的模型会回落内置/目录/协议/兜底价重新计费。\n' +
        `  恢复：先备份该文件（复制为 ${this.file}.bak），再修正 JSON 或用 \`vessel pricing override set/delete\` 重建覆盖；` +
        `下一次写盘前会先把原文件留档为 ${this.file}.corrupted-<时间戳>，再写入新内容（留档失败则抑制本次写入，原文不动）。`,
    );
  }

  /**
   * 带状态位的读盘（三态判据见 `PricingOverrideReadStatus`）——**任何输入都不抛错**。
   *
   * 损坏 / 不可读时仍返回空覆盖（数据拿不回来：本卡不引入缓存），但**一定**先打 warn。
   */
  readWithStatus(): PricingOverrideRead {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') {
        // 首次运行是正常状态：不告警、不产生任何副作用（负对照的判别点）。
        this.warnedSignature = undefined;
        return { ...emptyFile(), status: 'missing', file: this.file };
      }
      const reason = `${code ?? '未知错误'}：${(error as Error).message}`;
      this.warnBroken('unreadable', reason);
      return { ...emptyFile(), status: 'unreadable', error: reason, file: this.file };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const reason = `JSON 解析失败：${(error as Error).message}`;
      this.warnBroken('corrupt', reason);
      return { ...emptyFile(), status: 'corrupt', error: reason, file: this.file };
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      const reason = '顶层不是 JSON 对象';
      this.warnBroken('corrupt', reason);
      return { ...emptyFile(), status: 'corrupt', error: reason, file: this.file };
    }

    const parsed = raw as { models?: unknown; deleted?: unknown };
    const rawModels = parsed.models;
    if (rawModels !== undefined && (rawModels === null || typeof rawModels !== 'object' || Array.isArray(rawModels))) {
      const reason = `字段 models 结构非法（应为「键 → 单价」的对象，实际是 ${describeJsonKind(rawModels)}）`;
      this.warnBroken('corrupt', reason);
      return { ...emptyFile(), status: 'corrupt', error: reason, file: this.file };
    }
    const rawDeleted = parsed.deleted;
    if (rawDeleted !== undefined && !Array.isArray(rawDeleted)) {
      const reason = `字段 deleted 结构非法（应为字符串数组，实际是 ${describeJsonKind(rawDeleted)}）`;
      this.warnBroken('corrupt', reason);
      return { ...emptyFile(), status: 'corrupt', error: reason, file: this.file };
    }

    // —— 到这里是 `ok`：行级非法条目沿用既有语义逐条忽略（见类型注释）——
    this.warnedSignature = undefined;
    const models: Record<string, TokenPrice> = {};
    if (rawModels && typeof rawModels === 'object') {
      for (const [key, value] of Object.entries(rawModels as Record<string, unknown>)) {
        if (key.trim() === '') continue;
        const candidate = value as Partial<TokenPrice> | undefined;
        if (!isValidTokenPrice(candidate)) continue; // 坏行忽略，不污染整张覆盖表
        const price: TokenPrice = { input: candidate.input, output: candidate.output };
        if (candidate.cacheRead !== undefined) price.cacheRead = candidate.cacheRead;
        if (candidate.cacheWrite !== undefined) price.cacheWrite = candidate.cacheWrite;
        models[key] = price;
      }
    }
    const deleted = Array.isArray(rawDeleted)
      ? rawDeleted.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      : [];
    return { version: 1, models, deleted, status: 'ok', file: this.file };
  }

  /**
   * 读盘（**签名与返回形状逐字不变**：只有 `{ version, models, deleted }`，既有 `toEqual` 断言依赖它）。
   *
   * 缺失 / 损坏 / 不可读一律返回空覆盖且**不抛错**（命令照跑）；区别在
   * `readWithStatus()` 的状态位，以及损坏 / 不可读时这里会先打一条 warn。
   */
  read(): PricingOverrideFile {
    const { version, models, deleted } = this.readWithStatus();
    return { version, models, deleted };
  }

  /**
   * 落盘前的留档（本卡修复）——**唯一的写入口 `write()` 在任何覆盖写之前调用它**。
   *
   * 缺陷（修复前）：`readWithStatus()` 只保证「读不到时不静默」，**不保证「读不到时不覆盖」**。
   * 损坏文件里往往仍有可手工抢救的内容（半截 JSON 里合法的前缀条目、用户手改过的行），一旦
   * `set/delete/restore/repair` 用「空覆盖 + 新条目」重写，这部分内容就被**确定性销毁**且无副本。
   * 与 `ProjectRegistry` 的缺陷同源，修法同款：**先改名留档，再写**（符合删除纪律：只改名不删除）。
   *
   * 判定复用 `readWithStatus()` 的同一套三态判据（**不新增第二套判断**，不打扰三态语义）：
   *   - `ok`      → 正常写，不留档（判别点：合法文件不得产生留档 / 告警）；
   *   - `missing` → 正常写，不留档（ENOENT = 首次运行，不该产生噪音与垃圾文件）；
   *   - `corrupt` / `unreadable`（且文件确实存在）→ 先 `renameSync` 到
   *     `<file>.corrupted-<epochMs>`（同毫秒退化为 `-1`/`-2`），成功后再允许写入。
   *
   * 时序：本方法**独立于**原子写执行（不塞进 tmp + rename 流程内）：留档必须发生在
   * 「mkdir / 写 tmp / rename 覆盖目标」全部之前。
   *
   * 留档失败（EPERM/EBUSY/占用…）：与 `ProjectRegistry` 的最终决策一致——**抑制本次写入**
   * （不落盘，原文保持不变）并 warn 提示尽快手工备份；**绝不抛错**（命令仍能跑完）。
   *
   * 留档成功（B2 修复）：**立刻**打一条含「留档路径 + 原路径 + 即将写入新内容」的 warn。
   * 理由：留档一旦成功，原路径上就没有文件了；若随后的写盘失败（而这里一声不吭），用户面对的是
   * 「原路径不存在 + 没有任何告警」——下一次 `readWithStatus()` 只会给出设计上静默的 `missing`。
   * 与 `ProjectRegistry.quarantineCorrupted()`（`ProjectRegistry.ts:122`）同款：留档成功就报出路径。
   *
   * 为什么在写盘时重新探一次状态而不是缓存 `read()` 的结论：读与写之间文件可能被外部改动；
   * 「覆盖前一刻」的真实状态才是留档判据（代价是健康路径多一次读盘 + 解析，换取不误覆盖）。
   *
   * @returns `proceed: true` = 可以继续落盘（`archivePath` 为本次留档路径，没留档时缺省）；
   *          `proceed: false` = 已抑制本次写入（`reason` 为抑制原因）。
   */
  private archiveBrokenBeforeWrite(): { proceed: boolean; archivePath?: string; reason?: string } {
    const current = this.readWithStatus();
    if (current.status !== 'corrupt' && current.status !== 'unreadable') return { proceed: true };
    // 极端竞态：虽判为「读不到」，但此刻文件已不在（如刚被外部删除）→ 无内容可留档，正常写。
    if (!fs.existsSync(this.file)) return { proceed: true };

    // 同毫秒二次留档：循环取唯一名，形态仍为 `<file>.corrupted-<ts>[-N]`（与 UsageStore 同款约定）。
    let bak = `${this.file}.corrupted-${Date.now()}`;
    let n = 0;
    while (fs.existsSync(bak)) bak = `${this.file}.corrupted-${Date.now()}-${++n}`;
    const how = current.status === 'unreadable' ? '读不到' : '损坏';
    try {
      fs.renameSync(this.file, bak);
    } catch (error) {
      console.warn(
        `[vessel] pricing.override.json ${how}（${current.error ?? '未知原因'}）留档改名失败（${(error as Error).message}）：${this.file}\n` +
          '  已抑制本次写入，原文件保持不变（未被覆盖）；请尽快手工备份该文件，再修正 JSON 或删除它以重建覆盖。',
      );
      return { proceed: false, reason: `留档改名失败（${(error as Error).message}）` };
    }
    // ↓↓↓ B2 判别点：删掉这条 warn，「留档成功 + 随后写失败」就重新变成静默的 missing ↓↓↓
    console.warn(
      `[vessel] pricing.override.json ${how}（${current.error ?? '未知原因'}）：已留档为 ${bak}\n` +
        `  原内容完整保留在该留档文件（只改名不删除）；即将向 ${this.file} 写入新内容（覆盖/墓碑）。\n` +
        `  若本次写入失败，可把 ${bak} 复制回 ${this.file} 恢复原状（B2：这条告警专门用于写失败时的定位）。`,
    );
    return { proceed: true, archivePath: bak };
  }

  /**
   * 写盘失败（B2 的另一半）：**必须留下可见痕迹**，绝不让「原路径不存在 + 无告警」出现。
   *
   * 处置顺序：
   *   1. 本次确实留档过、原路径仍不存在（= 新内容没落上去）→ 把留档**改回原名**（回滚）；
   *      回滚成功则磁盘状态与写入前逐字一致（损坏文件还在原处，下次读仍会照常告警）；
   *   2. 回滚本身失败 → 告警里给出留档路径，明确「原内容在哪、怎么取回」；
   *   3. 本次没留档过（`ok` / `missing` 起步）→ 原文件压根没被动过，如实说明。
   *
   * 绝不抛错：结果经 `PricingOverrideWriteResult.persisted === false` + `reason` 上抛给调用方。
   */
  private warnWriteFailed(reason: string, archivePath: string | undefined): void {
    let whereabouts: string;
    if (archivePath !== undefined && !fs.existsSync(this.file) && fs.existsSync(archivePath)) {
      try {
        fs.renameSync(archivePath, this.file);
        whereabouts = `已回滚：把留档改回原路径，原内容与写入前逐字一致：${this.file}`;
      } catch (rollbackError) {
        whereabouts =
          `回滚失败（${(rollbackError as Error).message}）：原内容仍完整保留在留档文件 ${archivePath}，` +
          `原路径 ${this.file} 当前不存在——请从留档处复制回来`;
      }
    } else if (archivePath !== undefined) {
      whereabouts = `原内容已留档到 ${archivePath}（原路径 ${this.file}）`;
    } else {
      whereabouts = `原文件未被改写（内容保持不变）：${this.file}`;
    }
    console.warn(
      `[vessel] pricing.override.json 写入失败（${reason}）：${this.file}\n` +
        `  ${whereabouts}\n` +
        '  新内容**未落盘**：本次覆盖/墓碑未生效（后续记录与 recompute 仍按原价目）。',
    );
  }

  /**
   * 原子写盘（tmp + rename；目标目录按需创建；task 113 起走共享有界重试）。
   *
   * **写前留档**（本卡）：任何覆盖写之前先做 `archiveBrokenBeforeWrite()`；它返回
   * `proceed: false`（留档失败）时**直接返回、不落盘**——原损坏文件保持不变，用户仍可手工抢救。
   * `set/tombstone/restore/repair` 全部经由本方法落盘，没有第二个落盘点。
   *
   * **落盘结果（C）**：返回 `{ persisted, changed, reason? }`；恒 `changed: true`（本方法只在
   * 「内容已变、需要落盘」时被调用）。I/O 失败**不再向上抛错**，而是回滚/告警后返回
   * `persisted: false` + `reason`，让调用方（CLI）能按「未生效」处理，而不是照打「✔ 已写入」。
   */
  write(file: PricingOverrideFile): PricingOverrideWriteResult {
    const archive = this.archiveBrokenBeforeWrite();
    if (!archive.proceed) {
      return { persisted: false, changed: true, reason: archive.reason ?? '留档失败，已抑制本次写入' };
    }
    try {
      fs.mkdirSync(this.rootDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      renameWithRetry(tmp, this.file);
      return { persisted: true, changed: true };
    } catch (error) {
      const reason = `${(error as NodeJS.ErrnoException).code ?? '未知错误'}：${(error as Error).message}`;
      this.warnWriteFailed(reason, archive.archivePath);
      return { persisted: false, changed: true, reason };
    }
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

  /**
   * 写入/更新一条覆盖（非法价抛 RangeError，不落盘半成品）。
   *
   * 返回 `PricingOverrideMutationResult`：`file` 是内存视角的新内容，`persisted` 才是「真落盘了吗」。
   */
  set(key: string, price: Partial<TokenPrice>): PricingOverrideMutationResult {
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
    return { file, ...this.write(file) };
  }

  /** 删除墓碑：显式删除内置条目（命中即按 0 计价、不回退）。落盘结果同 `set()`。 */
  tombstone(key: string): PricingOverrideMutationResult {
    const trimmed = key.trim();
    if (trimmed === '') throw new RangeError('墓碑 key 不能为空');
    const file = this.read();
    delete file.models[trimmed];
    if (!file.deleted.includes(trimmed)) file.deleted.push(trimmed);
    return { file, ...this.write(file) };
  }

  /**
   * 撤销墓碑（回到内置/目录价）。返回 `{ found, persisted }`（**拆开**，本卡修复 C）：
   *   - `found`     内存里是否确有该墓碑（旧签名的 `boolean`，即旧语义）；
   *   - `persisted` 新内容是否**真的落盘**（`found && !persisted` = 内容变了但没落盘，不得报成功）。
   */
  restore(key: string): PricingRestoreResult {
    const trimmed = key.trim();
    const file = this.read();
    const before = file.deleted.length;
    file.deleted = file.deleted.filter((k) => k !== trimmed);
    if (file.deleted.length === before) return { found: false, persisted: false };
    const result = this.write(file);
    return { found: true, persisted: result.persisted, reason: result.reason };
  }

  /**
   * 值守卫式修复：对每条 `from → to`，**仅当现值等于 `from`** 才写入 `to`。
   *
   * - 键不存在 → `skipped-absent`（修复不新建条目，与「内置 seed 不覆盖用户行」同一思路）
   * - 现值已被用户改成别的 → `skipped-user-modified`（绝不冲掉手改）
   * - 现值 === from → `applied`
   *
   * 只有至少一条 applied 才落盘（无变更不写文件 → 幂等）；此时 `changed` 恒为 true。
   * 返回里 `outcomes` 是逐条判定，`persisted` 是「这批修改真的落盘了吗」——两者**必须分开看**：
   * 有 `applied` 但 `persisted === false` = 内存里改了、磁盘上没改。
   */
  repair(repairs: readonly PricingRepair[]): PricingRepairResult {
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
    // 无一条 applied：压根不写盘（幂等），`changed: false` 表示「没落盘是正常的」，不是失败。
    if (applied === 0) return { persisted: false, changed: false, outcomes };
    return { ...this.write(file), outcomes };
  }

  /** 适配成 `resolvePrice` 用的覆盖价源（纯数据，无 I/O 副作用）。 */
  source(): OverridePriceSource {
    const file = this.read();
    return createOverridePriceSource({ models: file.models, deleted: file.deleted });
  }
}
