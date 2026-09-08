import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

  constructor(opts: ProjectRegistryOptions = {}) {
    const home = opts.vesselHome ?? path.join(os.homedir(), '.vessel');
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, PROJECTS_FILE);
    this.load();
  }

  /** Load persisted projects (missing/corrupt file → empty set). */
  private load(): void {
    if (!fs.existsSync(this.file)) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as { projects: Project[] };
      for (const p of data.projects ?? []) {
        const root = path.resolve(p.root);
        this.projects.set(root, { root, openedAt: p.openedAt });
      }
    } catch {
      // corrupt index: start fresh rather than crash the control plane
      this.projects.clear();
    }
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
    const payload = JSON.stringify({ projects: [...this.projects.values()] }, null, 2);
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${PROJECTS_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, this.file);
  }
}