import fs from 'node:fs';
import path from 'node:path';
import type { AgentChatModel, AgentEffort } from '../../shared/types.js';
import { JsonFile } from '../storage/json-file.js';

export const EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MAX_MODELS = 20;
const MAX_NAME = 200;

export interface ChatPreferences {
  modelChoice: string | null;
  effort: AgentEffort | null;
  models: AgentChatModel[];
}

interface SavedChatPreferences extends ChatPreferences {
  version: 1;
}

// Claude only lists its models once a session is running, so the panel shows these until the first reply.
export const FALLBACK_MODELS: AgentChatModel[] = [
  { value: 'default', label: 'Default', efforts: [...EFFORTS] },
  { value: 'opus', label: 'Opus', efforts: [...EFFORTS] },
  { value: 'sonnet', label: 'Sonnet', efforts: [...EFFORTS] },
  { value: 'haiku', label: 'Haiku', efforts: [] },
];

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME;

export function isEffort(value: unknown): value is AgentEffort {
  return EFFORTS.includes(value as AgentEffort);
}

function modelsOf(value: unknown): AgentChatModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((model): model is AgentChatModel => isName(model?.value) && isName(model?.label))
    .slice(0, MAX_MODELS)
    .map((model) => ({
      value: model.value,
      label: model.label,
      efforts: Array.isArray(model.efforts) ? model.efforts.filter(isEffort) : [],
    }));
}

export class ChatPreferenceStore {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private state: SavedChatPreferences = { version: 1, modelChoice: null, effort: null, models: [] };

  constructor(directory: string | null) {
    this.file = directory === null ? null : path.join(directory, 'agent-chat.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'agent-chat');
    this.load();
  }

  get(): ChatPreferences {
    const { modelChoice, effort, models } = structuredClone(this.state);
    return { modelChoice, effort, models: models.length ? models : structuredClone(FALLBACK_MODELS) };
  }

  set(preferences: Partial<ChatPreferences>): void {
    const next = { ...this.state };
    if (preferences.modelChoice !== undefined)
      next.modelChoice = isName(preferences.modelChoice) ? preferences.modelChoice : null;
    if (preferences.effort !== undefined) next.effort = isEffort(preferences.effort) ? preferences.effort : null;
    if (preferences.models !== undefined) next.models = modelsOf(preferences.models);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.json?.schedule(() => this.state);
  }

  saveNow(): void {
    this.json?.flush(() => this.state);
  }

  private load(): void {
    if (this.file === null) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SavedChatPreferences>;
      if (data.version !== 1) return;
      this.state = {
        version: 1,
        modelChoice: isName(data.modelChoice) ? data.modelChoice : null,
        effort: isEffort(data.effort) ? data.effort : null,
        models: modelsOf(data.models),
      };
    } catch {}
  }
}
