import type { TaskTreeSnapshot, TaskTreeStatus } from '@vessel/shared';
import type { TaskTreeRegistry } from '@vessel/application';

export interface TaskTreeQuery {
  projectRoot?: string;
  rootInstanceId?: string;
  status?: TaskTreeStatus;
}

/**
 * UI-016 read side: expose the published team task trees (ARC-10) to the Web
 * Workbench. Reads only — the scheduler is the sole writer of the registry.
 */
export class TaskTreeRoutes {
  constructor(private readonly registry: TaskTreeRegistry) {}

  list(query: TaskTreeQuery = {}): { trees: TaskTreeSnapshot[]; updatedAt: number } {
    let trees = this.registry.list();
    if (query.rootInstanceId) trees = trees.filter((tree) => tree.rootInstanceId === query.rootInstanceId);
    if (query.projectRoot) trees = trees.filter((tree) => tree.projectRoot === query.projectRoot);
    if (query.status) trees = trees.map((tree) => ({ ...tree, nodes: tree.nodes.filter((node) => node.status === query.status) }));
    return { trees, updatedAt: Date.now() };
  }
}
