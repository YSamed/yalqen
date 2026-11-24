import type { WindowMaterial } from './chrome-types.js';
import type { ThemeSource } from './tab-types.js';

export interface WelcomeImportSource {
  id: number;
  browser: string;
  profile: string;
}

export interface WelcomeOpen {
  name: string;
  accent: import('./accent').AccentColorId;
  theme: ThemeSource;
  material: WindowMaterial;
  sources: WelcomeImportSource[];
}

export type WelcomeAction =
  | { type: 'appearance'; accent?: import('./accent').AccentColorId; theme?: ThemeSource }
  | { type: 'name'; name: string }
  | { type: 'finish' };

export interface WelcomeImportRequest {
  source: number;
  bookmarks: boolean;
  history: boolean;
}

export interface WelcomeImportResult {
  ok: boolean;
  bookmarks: number;
  visits: number;
}

export const WelcomeChannel = {
  open: 'yalqen-welcome:open',
  action: 'yalqen-welcome:action',
  import: 'yalqen-welcome:import',
} as const;

export interface WelcomeApi {
  onOpen(listener: (open: WelcomeOpen) => void): () => void;
  send(action: WelcomeAction): void;
  importFrom(request: WelcomeImportRequest): Promise<WelcomeImportResult>;
}

export interface ConfirmRequest {
  icon: 'extensions' | 'trash';
  title: string;
  message?: string;
  items: string[];
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

export interface ConfirmOpen extends ConfirmRequest {
  accent: string;
}

export const ConfirmChannel = {
  open: 'yalqen-confirm:open',
  answer: 'yalqen-confirm:answer',
} as const;

export interface ConfirmApi {
  onOpen(listener: (open: ConfirmOpen) => void): () => void;
  answer(confirmed: boolean): void;
}

export interface FindResult {
  active: number;
  matches: number;
}

export type FindBarAction = { type: 'find'; text: string; forward: boolean; next: boolean } | { type: 'close' };

export const FindBarChannel = {
  open: 'yalqen-find:open',
  result: 'yalqen-find:result',
  action: 'yalqen-find:action',
} as const;

export interface FindBarApi {
  onOpen(listener: () => void): () => void;
  onResult(listener: (result: FindResult) => void): () => void;
  send(action: FindBarAction): void;
}

export const PeekChannel = {
  update: 'yalqen-peek:update',
  action: 'yalqen-peek:action',
} as const;

export interface PeekState {
  title: string;
  url: string;
}

export type PeekAction = 'close' | 'promote';

export interface PeekApi {
  onUpdate(listener: (state: PeekState) => void): () => void;
  send(action: PeekAction): void;
}
