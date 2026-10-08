export const WORKSPACES_URL = 'yalqen://workspaces/';
export const WorkspaceChannel = {
  list: 'yalqen-workspaces:list',
  save: 'yalqen-workspaces:save',
  open: 'yalqen-workspaces:open',
  rename: 'yalqen-workspaces:rename',
  remove: 'yalqen-workspaces:remove',
  changed: 'yalqen-workspaces:changed',
} as const;
export interface WorkspaceSummary {
  id: string;
  name: string;
  count: number;
  savedAt: number;
}
export interface WorkspaceView {
  entries: WorkspaceSummary[];
  writable: boolean;
}
export interface WorkspaceApi {
  list(): Promise<WorkspaceView | null>;
  save(name: string): Promise<boolean>;
  open(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  onChange(listener: () => void): () => void;
}
