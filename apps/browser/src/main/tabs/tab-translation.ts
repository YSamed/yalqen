import { net, type WebContents } from 'electron';
import type { PageLanguage } from '../../shared/types.js';
import { liveContents, type Tab } from './tab.js';
import { detectLanguage, restorePage, translatePage, translateSelection, type FetchLike } from './translate.js';

const translationFetch: FetchLike = (endpoint, init) => net.fetch(endpoint, { ...init, credentials: 'omit' });

interface TranslationHost {
  settings(): { enabled: boolean; language: PageLanguage };
  changed(): void;
}

export class TabTranslation {
  constructor(private readonly host: TranslationHost) {}

  available(tab: Tab): boolean {
    const { enabled, language } = this.host.settings();
    if (!enabled || !tab.view || !/^https?:/i.test(tab.url) || tab.failed) return false;
    return tab.translation !== 'idle' || (tab.pageLanguage !== null && tab.pageLanguage !== language);
  }

  toggle(tab: Tab): void {
    const contents = liveContents(tab);
    if (!contents || tab.translation === 'translating') return;
    if (tab.translation === 'translated') {
      tab.translationRun++;
      tab.translation = 'idle';
      restorePage(contents).catch(() => undefined);
      this.host.changed();
      return;
    }
    if (!this.available(tab)) return;
    const run = ++tab.translationRun;
    const url = contents.getURL();
    const cancelled = () => tab.translationRun !== run || contents.isDestroyed() || contents.getURL() !== url;
    tab.translation = 'translating';
    this.host.changed();
    translatePage(contents, translationFetch, this.host.settings().language, { cancelled })
      .then((result) => {
        if (cancelled()) return;
        tab.translation = result ? 'translated' : 'failed';
        this.host.changed();
      })
      .catch((error: unknown) => {
        console.warn('[translate] could not translate page:', error);
        if (cancelled()) return;
        tab.translation = 'failed';
        this.host.changed();
      });
  }

  canTranslateSelection(): boolean {
    return this.host.settings().enabled;
  }

  translateSelection(contents: WebContents): void {
    if (!this.canTranslateSelection() || contents.isDestroyed()) return;
    translateSelection(contents, translationFetch, this.host.settings().language).catch((error: unknown) => {
      console.warn('[translate] could not translate selection:', error);
    });
  }

  reset(tab: Tab): void {
    tab.translationRun++;
    tab.translation = 'idle';
    tab.pageLanguage = null;
  }

  detectLanguage(tab: Tab, contents: WebContents): void {
    const run = tab.translationRun;
    detectLanguage(contents)
      .then((language) => {
        if (tab.translationRun !== run || tab.pageLanguage === language) return;
        tab.pageLanguage = language;
        this.host.changed();
      })
      .catch(() => undefined);
  }
}
