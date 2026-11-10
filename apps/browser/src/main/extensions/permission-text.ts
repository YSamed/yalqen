import { t, type MessageKey } from '../../shared/i18n.js';

const MAX_LISTED_SITES = 3;

// Chrome shows no install warning for these, so listing them would only add noise.
const SILENT = new Set([
  'activeTab',
  'alarms',
  'contextMenus',
  'cookies',
  'declarativeNetRequestWithHostAccess',
  'dns',
  'fontSettings',
  'gcm',
  'identity',
  'idle',
  'offscreen',
  'power',
  'runtime',
  'scripting',
  'sidePanel',
  'storage',
  'unlimitedStorage',
  'webRequest',
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
  tabCapture: 'permissionText.tabCapture',
  tabs: 'permissionText.history',
  topSites: 'permissionText.topSites',
  webNavigation: 'permissionText.history',
};

// Unknown names come from an untrusted manifest, so anything sentence-like is dropped.
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
