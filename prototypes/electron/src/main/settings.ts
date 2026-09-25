import fs from 'node:fs';
import path from 'node:path';
import type { SettingsValues, ThemeSource } from '../shared/types.js';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from './search.js';

export interface Settings extends SettingsValues {
  version: 1;
}

const DEFAULTS: Settings = {
  version: 1,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  customSearchTemplate: null,
  theme: 'light',
  panelCollapsed: false,
  freezeBackgroundTabs: true,
  adBlocking: true,
};

const ENGINE_IDS = new Set<string>([...SEARCH_ENGINES.map((engine) => engine.id), 'custom']);
const THEMES = new Set<string>(['system', 'light', 'dark'] satisfies ThemeSource[]);

/** Keeps known, well-typed fields and takes the rest from `base`. */
export function sanitizeSettings(data: unknown, base: Settings = DEFAULTS): Settings {
  const input = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const { searchEngine, customSearchTemplate, theme, panelCollapsed, freezeBackgroundTabs, adBlocking } = input;
  return {
    version: 1,
    searchEngine:
      typeof searchEngine === 'string' && ENGINE_IDS.has(searchEngine)
        ? (searchEngine as Settings['searchEngine'])
        : base.searchEngine,
    customSearchTemplate:
      customSearchTemplate === null || typeof customSearchTemplate === 'string'
        ? customSearchTemplate?.trim() || null
        : base.customSearchTemplate,
    theme: typeof theme === 'string' && THEMES.has(theme) ? (theme as ThemeSource) : base.theme,
    panelCollapsed: typeof panelCollapsed === 'boolean' ? panelCollapsed : base.panelCollapsed,
    freezeBackgroundTabs:
      typeof freezeBackgroundTabs === 'boolean' ? freezeBackgroundTabs : base.freezeBackgroundTabs,
    adBlocking: typeof adBlocking === 'boolean' ? adBlocking : base.adBlocking,
  };
}

export class SettingsStore {
  readonly file: string;
  private current: Settings;

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json');
    this.current = this.load();
  }

  get(): Settings {
    return this.current;
  }

  /** Applies a patch from any source; invalid fields keep their current value. */
  update(patch: unknown): Settings {
    this.current = sanitizeSettings({ ...this.current, ...(patch as object) }, this.current);
    const temp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(this.current, null, 2));
    fs.renameSync(temp, this.file);
    return this.current;
  }

  private load(): Settings {
    try {
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULTS };
    }
  }
}
