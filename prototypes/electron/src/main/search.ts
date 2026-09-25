import type { SearchEngineId } from '../shared/types.js';

export type { SearchEngineId };

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  /** Address bar placeholder, with the Turkish locative suffix for the name. */
  placeholder: string;
  /** `%s` is replaced with the encoded query. */
  template: string;
}

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google';

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'google', label: 'Google', placeholder: "Google'da ara veya adres yaz", template: 'https://www.google.com/search?q=%s' },
  { id: 'yandex', label: 'Yandex', placeholder: "Yandex'te ara veya adres yaz", template: 'https://yandex.com.tr/search/?text=%s' },
  { id: 'duckduckgo', label: 'DuckDuckGo', placeholder: "DuckDuckGo'da ara veya adres yaz", template: 'https://duckduckgo.com/?q=%s' },
  { id: 'bing', label: 'Bing', placeholder: "Bing'de ara veya adres yaz", template: 'https://www.bing.com/search?q=%s' },
  { id: 'brave', label: 'Brave Search', placeholder: "Brave Search'te ara veya adres yaz", template: 'https://search.brave.com/search?q=%s' },
  { id: 'ecosia', label: 'Ecosia', placeholder: "Ecosia'da ara veya adres yaz", template: 'https://www.ecosia.org/search?q=%s' },
];

const CUSTOM_PLACEHOLDER = 'Ara veya adres yaz';

/** A custom template must be an http(s) URL containing `%s`. */
export function isValidSearchTemplate(template: string | null | undefined): template is string {
  if (!template || !template.includes('%s')) return false;
  try {
    const url = new URL(template.replace('%s', 'test'));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Resolves the selected engine; an unusable custom template falls back to the default. */
export function resolveSearchEngine(id: SearchEngineId, customTemplate: string | null): SearchEngine {
  if (id === 'custom' && isValidSearchTemplate(customTemplate)) {
    return { id: 'custom', label: 'Özel', placeholder: CUSTOM_PLACEHOLDER, template: customTemplate };
  }
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? defaultEngine();
}

export function buildSearchUrl(engine: SearchEngine, query: string): string {
  return engine.template.replace('%s', encodeURIComponent(query));
}

function defaultEngine(): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE)!;
}
