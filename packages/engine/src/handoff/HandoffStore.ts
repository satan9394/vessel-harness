import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';
import { buildHandoff, newHandoffId, parseHandoff, serializeHandoff, type HandoffMaterial, type HandoffRecord } from './Handoff.js';
import { renderHandoffText } from './HandoffRender.js';

/**
 * engine/handoff/HandoffStore — Context Reset Handoff 的目录存储（task 067）。
 * 059 ReviewHandoffStore 同款模式：目录 / `<kind>_<ts>_<hex>` id 约定 / tmp+rename
 * 原子写 / env root 覆盖（`VESSEL_HANDOFFS_ROOT`，缺省 `~/.vessel/handoffs`），
 * 测试注入 tmp 根。
 *
 * 目录布局（每条记录一个目录，与 review 模式一致）：
 *   <root>/<handoff-id>/
 *     meta.json   —— 结构化记录（§12 九字段 + 元数据；JSON，可回读/续跑/校验）
 *     handoff.md  —— §12 yaml 对齐的文本投影（生成时快照，供阅读/复制）
 *
 * 并发安全同 IterationStore / ProjectTaskQueue：单进程同步 IO + 原子写；多写者需
 * 自行串行（本卡不引入锁）。读取容忍损坏条目（get 返回 undefined，list 跳过）。
 */

/** 缺省 handoffs 根目录：~/.vessel/handoffs（env VESSEL_HANDOFFS_ROOT 可覆盖）。 */
export function defaultHandoffRoot(home = os.homedir()): string {
  return process.env.VESSEL_HANDOFFS_ROOT ?? path.join(home, '.vessel', 'handoffs');
}

export interface HandoffStoreOptions {
  /** handoffs 根目录（缺省 defaultHandoffRoot()）；测试注入 tmp。 */
  handoffsRoot?: string;
}

/** 记录文件布局辅助。 */
const META_FILE = 'meta.json';
const HANDOFF_FILE = 'handoff.md';

/**
 * HandoffStore —— 目录式存储：create（构造 + 落盘 meta.json + handoff.md）/
 * get/list/latest（读 meta.json，容错损坏）。IO 同步（与 ReviewHandoffStore 同风格）。
 */
export class HandoffStore {
  readonly root: string;

  constructor(opts: HandoffStoreOptions = {}) {
    this.root = path.resolve(opts.handoffsRoot ?? defaultHandoffRoot());
  }

  /** 记录目录：<root>/<handoff-id>/ */
  dirFor(id: string): string {
    return path.join(this.root, id);
  }

  /** meta.json 完整路径。 */
  metaPath(id: string): string {
    return path.join(this.dirFor(id), META_FILE);
  }

  /** handoff.md 完整路径（§12 yaml 文本投影）。 */
  handoffPath(id: string): string {
    return path.join(this.dirFor(id), HANDOFF_FILE);
  }

  /**
   * 生成一次 handoff：buildHandoff（goal 空 fail loud）→ 落盘 meta.json（原子写）
   * + handoff.md（快照）→ 返回记录。
   */
  create(material: HandoffMaterial, opts: { now?: number; id?: string; continuationOf?: string } = {}): HandoffRecord {
    const record = buildHandoff(material, opts);
    this.writeRecord(record, { writeMarkdown: true });
    return record;
  }

  /** 按 id 读；不存在/损坏 → undefined（registry 同款容忍）。 */
  get(id: string): HandoffRecord | undefined {
    return this.readMeta(id);
  }

  /** 全部记录（按 createdAt 倒序 = 最新在前；目录损坏条目跳过）。 */
  list(): HandoffRecord[] {
    if (!fs.existsSync(this.root)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: HandoffRecord[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const rec = this.readMeta(e.name);
      if (rec) out.push(rec);
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    return out;
  }

  /** 最新一条 handoff（按 createdAt；无记录 → undefined）—— 长任务续跑入口。 */
  latest(): HandoffRecord | undefined {
    return this.list()[0];
  }

  // ------------------------------------------------------------------
  // internal
  // ------------------------------------------------------------------

  private readMeta(id: string): HandoffRecord | undefined {
    const file = this.metaPath(id);
    if (!fs.existsSync(file)) return undefined;
    try {
      return parseHandoff(fs.readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  /** meta.json —— tmp+rename 原子写（同 SessionRegistry.persist / ReviewHandoffStore.writeMeta）。 */
  private writeRecord(record: HandoffRecord, opts: { writeMarkdown: boolean }): void {
    const dir = this.dirFor(record.id);
    fs.mkdirSync(dir, { recursive: true });
    if (opts.writeMarkdown) {
      fs.writeFileSync(path.join(dir, HANDOFF_FILE), renderHandoffText(record), 'utf8');
    }
    const file = path.join(dir, META_FILE);
    const tmp = path.join(dir, `${META_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, serializeHandoff(record), 'utf8');
    renameWithRetry(tmp, file);
  }
}

export { newHandoffId };
