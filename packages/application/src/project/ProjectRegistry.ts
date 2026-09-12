import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';

/** A project workspace opened on the control plane. */
export interface Project {
  /** absolute workspace root */
  root: string;
  /** ISO timestamp when the project was first opened */
  openedAt: string;
}

export interface ProjectRegistryOptions {
  /**
   * Directory where the persisted project index lives (sessions.json lives in
   * the same vessel home). Defaults to `~/.vessel`. Tests inject a tmp dir to
   * avoid touching the real home.
   */
  vesselHome?: string;
}

const PROJECTS_FILE = 'projects.json';

/**
 * ProjectRegistry — the stable, persisted list of workspace projects known to
 * the application control plane. `open` validates the directory, de-duplicates
 * by resolved root, and records the first-open timestamp. Data is persisted to
 * `<vesselHome>/projects.json` via an atomic tmp+rename write so a crash never
 * leaves a half-written index.
 */
export class ProjectRegistry {
  private readonly file: string;
  private readonly projects = new Map<string, Project>();
  /**
   * true = 本次进程内**不再写** `projects.json`（安全侧）。
   *
   * 置位场景只有一个：`quarantineCorrupted()` 的留档**改名失败**——原文件仍躺在原路径上
   * （可能仍可手工抢救），此时若继续 `persist()`，新索引会**确定性地覆盖**它。
   * 语义与 `apps/cli/src/usage/UsageStore.ts` 的 `suppressWrite` 完全同款：
   * 宁可不写，也不覆盖「存在但没被安全留档」的唯一数据源。
   *
   * 留档**成功**、文件不存在（ENOENT，首次运行）都**不**置位——正常路径照常落盘。
   */
  private suppressPersist = false;

  constructor(opts: ProjectRegistryOptions = {}) {
    const home = opts.vesselHome ?? path.join(os.homedir(), '.vessel');
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, PROJECTS_FILE);
    this.load();
  }

  /**
   * Load persisted projects (missing file → empty set).
   *
   * 文件存在但读不到/解析不了时：**先留档再以空索引继续**（见 `quarantineCorrupted`）。
   * 不能静默回退空索引——下一次 `open()` 的 `persist()` 会用空索引覆盖唯一数据源。
   */
  private load(): void {
    if (!fs.existsSync(this.file)) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      // 文件确实存在（existsSync 已过）却读不到（EACCES/EBUSY…）：同「损坏」处理。
      this.quarantineCorrupted(`read failed (${(err as Error).message})`);
      return;
    }
    let data: { projects?: Project[] };
    try {
      data = JSON.parse(raw) as { projects?: Project[] };
    } catch (err) {
      this.projects.clear();
      this.quarantineCorrupted(`invalid JSON (${(err as Error).message})`);
      return;
    }
    try {
      for (const p of data.projects ?? []) {
        const root = path.resolve(p.root);
        this.projects.set(root, { root, openedAt: p.openedAt });
      }
    } catch (err) {
      // 合法 JSON 但某条结构非法（projects 非数组 / root 非法）：同样属「部分可恢复」。
      this.projects.clear();
      this.quarantineCorrupted(`invalid index entry (${(err as Error).message})`);
    }
  }

  /**
   * 损坏索引留档（改名，不删除）+ 告警，随后以空索引继续。
   *
   * 动机：`load()` 失败后若静默以空索引继续，下一次 `open()` 的 `persist()` 会用空索引
   * **覆盖唯一数据源** → 任何「部分可恢复」的索引（合法 JSON 但结构非法、尾部被截断）都被
   * 静默且不可恢复地丢弃。这里在覆盖发生之前把原文件改名为
   * `<file>.corrupted-<epochMs>[-N]`（与 UsageStore/CredentialStore 同款留档命名；内容原样
   * 保留，符合删除纪律），并打一句含原路径 / 留档路径 / 恢复提示的 `console.warn`。
   *
   * 留档改名失败（权限、占用）**不得**让 `open()` 失败：退化为一条「留档失败」告警，
   * 并且**置 `suppressPersist`——本次持久化被抑制**（原文件仍在原路径，绝不用新索引覆盖它）。
   * 文件不存在（首次运行）不走这里。
   */
  private quarantineCorrupted(why: string): void {
    // 同毫秒内二次损坏：循环取唯一名，避免覆盖上一份留档（与 UsageStore 同款约定）。
    let bak = `${this.file}.corrupted-${Date.now()}`;
    try {
      let n = 0;
      while (fs.existsSync(bak)) bak = `${this.file}.corrupted-${Date.now()}-${++n}`;
      fs.renameSync(this.file, bak);
    } catch (err) {
      // 留档失败 → 原文仍留在原路径（可能只是被占用/读不到）：必须抑制本次写入，
      // 否则 `persist()` 会把它确定性覆盖掉（与 UsageStore.suppressWrite 同款）。
      this.suppressPersist = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[vessel] projects.json 损坏（${why}）：留档改名失败（${(err as Error).message}）；` +
          `已抑制本次写入，原文件 "${this.file}" 保持不变，请尽快手工备份该文件后手工修复或移除它。`,
      );
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[vessel] projects.json 损坏（${why}）：已将原索引留档为 "${bak}"（内容保留，未删除）；` +
        `本次改用空索引继续，核对后可从该留档文件手工恢复（原路径 "${this.file}"）。`,
    );
  }

  /**
   * Open a workspace project. Throws when the directory does not exist.
   * Re-opening an already-open root keeps the original openedAt (de-dup).
   */
  open(workspaceRoot: string): Project {
    const root = path.resolve(workspaceRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`workspace does not exist: ${root}`);
    }
    const existing = this.projects.get(root);
    const project: Project =
      existing ?? { root, openedAt: new Date().toISOString() };
    this.projects.set(root, project);
    this.persist();
    return project;
  }

  /** All currently opened projects, in first-open order. */
  list(): Project[] {
    return [...this.projects.values()];
  }

  /** Look up a single project by resolved root, or undefined when unknown. */
  get(workspaceRoot: string): Project | undefined {
    return this.projects.get(path.resolve(workspaceRoot));
  }

  private persist(): void {
    // 留档失败（原文件仍在原路径、可能仍可抢救）→ 本次**不写盘**：宁可不写，也不覆盖它。
    // 注意这不改变 `open()` 的语义：仍返回 Project，内存索引仍可用；只是重启后重新读该文件。
    if (this.suppressPersist) {
      // eslint-disable-next-line no-console
      console.warn(
        `[vessel] projects.json 本次未持久化：留档失败后已抑制写入（原文件 "${this.file}" 保持不变）；` +
          `内存索引本次仍可用，重启后会重新读取该文件。`,
      );
      return;
    }
    const payload = JSON.stringify({ projects: [...this.projects.values()] }, null, 2);
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${PROJECTS_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, payload, 'utf8');
    // task 113: 共享有界重试（EPERM/EBUSY/EACCES，3 次 5/15ms），原子语义不变。
    renameWithRetry(tmp, this.file);
  }
}