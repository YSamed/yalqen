import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from './search.js';

export interface Settings {
  version: 1;
  searchEngine: SearchEngineId;
  /** Used when `searchEngine` is `custom`; `%s` marks the query. Edited in settings.json for now. */
  customSearchTemplate: string | null;
}

const DEFAULTS: Settings = {
  version: 1,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  customSearchTemplate: null,
};

const ENGINE_IDS = new Set<string>([...SEARCH_ENGINES.map((engine) => engine.id), 'custom']);

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

  update(patch: Partial<Omit<Settings, 'version'>>): Settings {
    this.current = { ...this.current, ...patch };
    const temp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(this.current, null, 2));
    fs.renameSync(temp, this.file);
    return this.current;
  }

  private load(): Settings {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Settings>;
      return {
        version: 1,
        searchEngine:
          typeof data.searchEngine === 'string' && ENGINE_IDS.has(data.searchEngine)
            ? data.searchEngine
            : DEFAULTS.searchEngine,
        customSearchTemplate:
          typeof data.customSearchTemplate === 'string' ? data.customSearchTemplate : null,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
}
