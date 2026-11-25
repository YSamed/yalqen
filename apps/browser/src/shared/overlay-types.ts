export interface ConfirmRequest {
  icon: 'extensions' | 'trash';
  image?: string;
  title: string;
  message?: string;
  items: string[];
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

export interface ConfirmOpen extends ConfirmRequest {
  accent: string;
  tint: string | null;
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
