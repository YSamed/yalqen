import { t, type MessageKey } from '../../shared/i18n.js';

const MAX_LISTED_SITES = 3;

const SILENT = new Set([
  'activeTab',
  'alarms',
  'contextMenus',
  'cookies',
  'declarativeNetRequestWithHostAccess',
  'dns',
  'favicon',
  'fontSettings',
  'gcm',
  'identity',
  'idle',
  'offscreen',
  'power',
  'runtime',
  'scripting',
  'search',
  'sidePanel',
  'storage',
  'system.cpu',
  'system.display',
  'system.memory',
  'tts',
  'unlimitedStorage',
  'userScripts',
  'webRequest',
  'webRequestAuthProvider',
  'webRequestBlocking',
]);

const DESCRIBED: Record<string, MessageKey> = {
  bookmarks: 'permissionText.bookmarks',
  clipboardRead: 'permissionText.clipboardRead',
  clipboardWrite: 'permissionText.clipboardWrite',
  contentSettings: 'permissionText.contentSettings',
  debugger: 'permissionText.debugger',
  declarativeNetRequest: 'permissionText.blockContent',
  declarativeNetRequestFeedback: 'permissionText.history',
  desktopCapture: 'permissionText.desktopCapture',
  downloads: 'permissionText.downloads',
  geolocation: 'permissionText.geolocation',
  history: 'permissionText.history',
  management: 'permissionText.management',
  nativeMessaging: 'permissionText.nativeMessaging',
  notifications: 'permissionText.notifications',
  privacy: 'permissionText.privacy',
  proxy: 'permissionText.allSites',
  readingList: 'permissionText.readingList',
  sessions: 'permissionText.history',
  tabCapture: 'permissionText.tabCapture',
  tabGroups: 'permissionText.tabGroups',
  tabs: 'permissionText.history',
  topSites: 'permissionText.topSites',
  webNavigation: 'permissionText.history',
};

const PERMISSION_NAME = /^[a-z][A-Za-z.]{0,40}$/;
const HOST_PATTERN = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)\//;

function patternHost(permission: string): string | null {
  if (permission === '<all_urls>') return '*';
  const match = HOST_PATTERN.exec(permission);
  if (!match) return null;
  return match[1] === 'file' ? '*' : match[2].replace(/^\*\./, '');
}

export function permissionLines(permissions: string[]): string[] {
  const lines = new Set<string>();
  const sites = new Set<string>();
  let allSites = false;
  for (const permission of permissions) {
    const host = patternHost(permission);
    if (host === '*' || host === '') allSites = true;
    else if (host) sites.add(host);
    else if (DESCRIBED[permission]) lines.add(t(DESCRIBED[permission]));
    else if (!SILENT.has(permission) && PERMISSION_NAME.test(permission)) lines.add(permission);
  }
  const siteLines: string[] = [];
  if (allSites || lines.has(t('permissionText.allSites'))) {
    lines.delete(t('permissionText.allSites'));
    siteLines.push(t('permissionText.allSites'));
  } else if (sites.size > 0) {
    const listed = [...sites].slice(0, MAX_LISTED_SITES).join(', ');
    const more = sites.size - MAX_LISTED_SITES;
    siteLines.push(
      more > 0
        ? t('permissionText.someSitesMore', { sites: listed, count: more })
        : t('permissionText.someSites', { sites: listed }),
    );
  }
  return [...siteLines, ...lines];
}
