import fs from 'node:fs';
import path from 'node:path';
import { JsonFile } from '../storage/json-file.js';

// package.json is three levels above dist/main/app, both in the repository and inside the packaged app.
export const REPO_URL: string = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'),
).repository;
export const FEEDBACK_URL = `${REPO_URL}/discussions`;
export type RepoPromptAction = 'star' | 'later' | 'close';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_VISITS = 1;
export const SHOW_INTERVAL_MS = 14 * DAY_MS;
export const LATER_DELAY_MS = 30 * DAY_MS;
export const CLOSE_DELAY_MS = 60 * DAY_MS;
export const MAX_SHOWS = 4;

interface SavedRepoPrompt {
  version: 1;
  visits: number;
  shown: number;
  nextAt: number;
  done: boolean;
}

const count = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;

export class RepoPrompt {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private state: SavedRepoPrompt = { version: 1, visits: 0, shown: 0, nextAt: 0, done: false };

  constructor(directory: string | null) {
    this.file = directory === null ? null : path.join(directory, 'repo-prompt.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'repo-prompt');
    this.load();
  }

  take(now = Date.now()): boolean {
    const state = this.state;
    if (state.done) return false;
    state.visits++;
    const due = state.visits > MIN_VISITS && now >= state.nextAt;
    if (due) {
      state.shown++;
      state.nextAt = now + SHOW_INTERVAL_MS;
      state.done = state.shown >= MAX_SHOWS;
    }
    this.save();
    return due;
  }

  respond(action: RepoPromptAction, now = Date.now()): void {
    if (action === 'star') this.state.done = true;
    else this.state.nextAt = now + (action === 'later' ? LATER_DELAY_MS : CLOSE_DELAY_MS);
    this.save();
  }

  saveNow(): void {
    this.json?.flush(() => this.state);
  }

  private load(): void {
    if (this.file === null) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SavedRepoPrompt>;
      if (data.version !== 1) return;
      this.state = {
        version: 1,
        visits: count(data.visits, 0),
        shown: count(data.shown, 0),
        nextAt: count(data.nextAt, 0),
        done: data.done === true,
      };
    } catch {}
  }

  private save(): void {
    this.json?.schedule(() => this.state);
  }
}
