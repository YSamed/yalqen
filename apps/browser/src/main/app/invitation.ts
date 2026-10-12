import fs from 'node:fs';
import path from 'node:path';
import type { ImportSource } from '../library/browser-import.js';
import { isFirefoxPlaces } from '../library/browser-import.js';
import type { SettingsValues, WelcomeAction, WelcomeImportSource, WelcomeTabs } from '../../shared/types.js';

const MAX_SOURCES = 4;

export interface InvitationSource extends WelcomeImportSource {
  bookmarks: string;
  history: string | null;
}

// Bookmark sources come labelled "Chrome — Person 1"; the card shows the browser and the profile apart.
// Chromium keeps history beside the bookmarks file, Firefox keeps both in places.sqlite.
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

export function invitationTabs(values: Pick<SettingsValues, 'sidebarVisible'>): WelcomeTabs {
  return values.sidebarVisible ? 'left' : 'top';
}

export function appearancePatch(action: Extract<WelcomeAction, { type: 'appearance' }>): Partial<SettingsValues> {
  const patch: Partial<SettingsValues> = {};
  if (action.accent !== undefined) patch.accentColor = action.accent;
  if (action.theme !== undefined) patch.theme = action.theme;
  if (action.tabs === 'left') Object.assign(patch, { sidebarVisible: true, panelSide: 'left' });
  if (action.tabs === 'top') Object.assign(patch, { sidebarVisible: false, toolbarVisible: true, toolbarTabs: true });
  return patch;
}
