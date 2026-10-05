import { originOf } from '../agent-bridge/tab-scope.js';

interface Project {
  id: string;
  origins: ReadonlySet<string>;
}

interface ProjectTab {
  id: string;
  url: string;
  isPrivate: boolean;
}

// Explicit tab assignments win over origin matching, including projects sharing a dev server.
export class AgentProjectTabs {
  private readonly assignments = new Map<string, string>();

  bind(tab: ProjectTab | null, projectId: string, developer = false): void {
    if (tab && (!tab.isPrivate || developer)) this.assignments.set(tab.id, projectId);
  }

  projectFor(tab: ProjectTab | null, projects: readonly Project[], developer = false): string | null {
    if (!tab || (tab.isPrivate && !developer)) return null;
    const assigned = this.assignments.get(tab.id);
    if (assigned && projects.some((project) => project.id === assigned)) return assigned;
    const origin = originOf(tab.url);
    if (!origin) return null;
    const owners = projects.filter((project) => project.origins.has(origin));
    if (owners.length !== 1) return null;
    this.bind(tab, owners[0].id, developer);
    return owners[0].id;
  }

  prune(tabIds: ReadonlySet<string>): void {
    for (const id of this.assignments.keys()) if (!tabIds.has(id)) this.assignments.delete(id);
  }

  removeProject(projectId: string): void {
    for (const [id, assigned] of this.assignments) if (assigned === projectId) this.assignments.delete(id);
  }
}
