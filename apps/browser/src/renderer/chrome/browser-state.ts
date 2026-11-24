import type { BrowserState } from '../../shared/types';

export function onBrowserState(listener: (next: BrowserState) => void): () => void {
  void window.yalqen.getState().then(listener);
  return window.yalqen.onState((serialized) => listener(JSON.parse(serialized) as BrowserState));
}
