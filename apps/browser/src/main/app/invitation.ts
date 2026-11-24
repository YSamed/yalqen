import fs from 'node:fs';
import path from 'node:path';
import type { ImportSource } from '../library/browser-import.js';
import { isFirefoxPlaces } from '../library/browser-import.js';
import type { SettingsValues, WelcomeAction, WelcomeImportSource } from '../../shared/types.js';

const MAX_SOURCES = 4;

export interface InvitationSource extends WelcomeImportSource {
  bookmarks: string;
  history: string | null;
}

export function invitationSources(
  sources: readonly ImportSource[],
  exists: (file: string) => boolean = fs.existsSync,
): InvitationSource[] {
  return sources.slice(0, MAX_SOURCES).map((source, id) => {
    const [browser, ...profile] = source.label.split(' — ');
    const history = isFirefoxPlaces(source.file) ? source.file : path.join(path.dirname(source.file), 'History');
    return {
      id,
      browser,
      profile: profile.join(' — '),
      bookmarks: source.file,
      history: exists(history) ? history : null,
    };
  });
}

export function appearancePatch(action: Extract<WelcomeAction, { type: 'appearance' }>): Partial<SettingsValues> {
  const patch: Partial<SettingsValues> = {};
  if (action.accent !== undefined) patch.accentColor = action.accent;
  if (action.theme !== undefined) patch.theme = action.theme;
  return patch;
}
