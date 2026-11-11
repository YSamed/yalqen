export const WORKSPACES_URL = 'yalqen://workspaces/';
export const DEFAULT_SPACE_ID = '';
export const MAX_SPACES = 50;
export const SPACE_ICONS = ['🏠', '💼', '🎓', '🎮', '🛒', '🎵', '🔬', '✈️', '❤️', '⭐'] as const;
export const WorkspaceChannel = {
  list: 'yalqen-workspaces:list',
  save: 'yalqen-workspaces:save',
  open: 'yalqen-workspaces:open',
  rename: 'yalqen-workspaces:rename',
  remove: 'yalqen-workspaces:remove',
  changed: 'yalqen-workspaces:changed',
} as const;
export interface SpaceView {
  id: string;
  name: string;
  icon: string | null;
}
export interface WorkspaceSummary extends SpaceView {
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

export function workspaceIcon(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const icon = value.trim();
  return icon && [...icon].length <= 8 && [...icon].every((char) => char.charCodeAt(0) >= 32) ? icon : null;
}
