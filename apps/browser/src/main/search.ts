import type { SearchEngineId } from '../shared/types.js';
import { t } from '../shared/i18n.js';

export type { SearchEngineId };

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  placeholder: string;
  template: string;
}

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google';

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    id: 'google',
    label: 'Google',
    get placeholder() {
      return t('search.placeholderGoogle');
    },
    template: 'https://www.google.com/search?q=%s',
  },
  {
    id: 'yandex',
    label: 'Yandex',
    get placeholder() {
      return t('search.placeholderYandex');
    },
    template: 'https://yandex.com.tr/search/?text=%s',
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    get placeholder() {
      return t('search.placeholderDuckduckgo');
    },
    template: 'https://duckduckgo.com/?q=%s',
  },
  {
    id: 'bing',
    label: 'Bing',
    get placeholder() {
      return t('search.placeholderBing');
    },
    template: 'https://www.bing.com/search?q=%s',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    get placeholder() {
      return t('search.placeholderBrave');
    },
    template: 'https://search.brave.com/search?q=%s',
  },
  {
    id: 'ecosia',
    label: 'Ecosia',
    get placeholder() {
      return t('search.placeholderEcosia');
    },
    template: 'https://www.ecosia.org/search?q=%s',
  },
  {
    id: 'startpage',
    label: 'Startpage',
    get placeholder() {
      return t('search.placeholderStartpage');
    },
    template: 'https://www.startpage.com/do/search?q=%s',
  },
];

export function isValidSearchTemplate(template: string | null | undefined): template is string {
  if (!template || !template.includes('%s')) return false;
  try {
    const url = new URL(template.replace('%s', 'test'));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function resolveSearchEngine(id: SearchEngineId, customTemplate: string | null): SearchEngine {
  if (id === 'custom' && isValidSearchTemplate(customTemplate)) {
    return {
      id: 'custom',
      label: t('search.customLabel'),
      placeholder: t('search.placeholderCustom'),
      template: customTemplate,
    };
  }
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? defaultEngine();
}

export function buildSearchUrl(engine: SearchEngine, query: string): string {
  return engine.template.replace('%s', encodeURIComponent(query));
}

function defaultEngine(): SearchEngine {
  return SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE)!;
}
