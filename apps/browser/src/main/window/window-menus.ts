import type { MenuItemConstructorOptions, Session } from 'electron';
import { t } from '../../shared/i18n.js';
import type { TabSnapshot } from '../../shared/types.js';
import { bookmarksMenuTemplate, type BookmarkStore } from '../library/bookmarks.js';
import { chromiumProfiles, firefoxProfiles, historyImportMenu } from '../library/browser-import.js';
import type { CertificateExceptions } from '../privacy/certificates.js';
import { permissionOrigin, type PermissionStore } from '../privacy/permissions.js';
import { cookieUrl, cookiesForHost } from '../privacy/site-data.js';
import { siteInfoTemplate } from '../privacy/site-info.js';
import type { TabManager } from '../tabs/tabs.js';
import type { SiteProtections } from '../privacy/site-protections.js';
import type { SettingsValues } from '../../shared/types.js';

interface TabMenuActions {
  togglePin(): void;
  toggleMute(): void;
  discard(): void;
  close(): void;
}

export function tabMenuTemplate(
  tab: TabSnapshot,
  isActive: boolean,
  actions: TabMenuActions,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (tab.pinned || (!tab.isPrivate && /^https?:/.test(tab.url))) {
    template.push({ label: tab.pinned ? t('window.unpinTab') : t('window.pinTab'), click: actions.togglePin });
  }
  if (tab.audible || tab.muted) {
    template.push({ label: tab.muted ? t('window.unmuteTab') : t('window.muteTab'), click: actions.toggleMute });
  }
  if (tab.live && !isActive) template.push({ label: t('window.unloadTab'), click: actions.discard });
  if (template.length > 0) template.push({ type: 'separator' });
  template.push({ label: t('window.closeTab'), click: actions.close });
  return template;
}

interface ProfileMenuActions {
  newWindow(): void;
  newPrivateWindow(): void;
  newPrivateTab(): void;
  newDeveloperWindow(): void;
  openSettings(): void;
}

export function profileMenuTemplate(actions: ProfileMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: t('window.profileMenuTitle'), enabled: false },
    { type: 'separator' },
    { label: t('window.newWindow'), click: actions.newWindow },
    { label: t('window.newPrivateWindow'), click: actions.newPrivateWindow },
    { label: t('window.newPrivateTab'), click: actions.newPrivateTab },
    { label: t('window.newDeveloperWindow'), click: actions.newDeveloperWindow },
    { type: 'separator' },
    { label: t('window.settings'), click: actions.openSettings },
  ];
}

interface LibraryMenuActions {
  open(url: string): void;
  showAll(): void;
  importBookmarks(file?: string): void;
  importHistory(file?: string): void;
}

// Bookmarks with an import submenu for every browser profile found on this Mac.
export function libraryMenuTemplate(
  bookmarks: BookmarkStore,
  actions: LibraryMenuActions,
): MenuItemConstructorOptions[] {
  const firefox = firefoxProfiles();
  const template = bookmarksMenuTemplate(
    bookmarks.folders(),
    bookmarks.bookmarks(),
    { open: actions.open, showAll: actions.showAll, importFrom: actions.importBookmarks },
    [...chromiumProfiles('Bookmarks'), ...firefox],
  );
  template.push(historyImportMenu([...chromiumProfiles('History'), ...firefox], actions.importHistory));
  return template;
}

interface SiteInfoHost {
  tabs: TabManager;
  permissions(isPrivate: boolean): PermissionStore;
  session(isPrivate: boolean): Session;
  certificates: CertificateExceptions;
  clearSiteData(): void;
  protections?: { preferences: SiteProtections; settings(): SettingsValues };
}

// Null when the active tab changed while cookies and storage were being measured.
export async function siteInfoMenu(host: SiteInfoHost): Promise<MenuItemConstructorOptions[] | null> {
  const { tabs } = host;
  const tab = tabs.snapshotFor();
  if (!tab) return null;
  const origin = permissionOrigin(tab.url);
  const store = host.permissions(tab.isPrivate);
  const browsing = host.session(tab.isPrivate);
  const [cookies, storage] = origin
    ? await Promise.all([
        browsing.cookies.get({}).then(
          (all) => cookiesForHost(all, new URL(origin).hostname),
          () => [],
        ),
        tabs.measureActiveStorage(),
      ])
    : [[], null];
  if (tabs.activeTabId !== tab.id) return null;
  return siteInfoTemplate(
    {
      url: tab.url,
      security: tab.security,
      protections:
        origin && host.protections
          ? {
              adBlocking:
                host.protections.settings().adBlocking &&
                !host.protections.preferences.isAllowed('adBlocking', tab.url, tab.isPrivate),
              blockThirdPartyCookies:
                host.protections.settings().blockThirdPartyCookies &&
                !host.protections.preferences.isAllowed('blockThirdPartyCookies', tab.url, tab.isPrivate),
              adBlockingEnabled: host.protections.settings().adBlocking,
              cookieBlockingEnabled: host.protections.settings().blockThirdPartyCookies,
            }
          : undefined,
      permissions: origin ? store.list(origin) : [],
      data: origin ? { cookies: cookies.length, storage } : undefined,
    },
    {
      setProtection: (kind, blocked) => {
        if (!host.protections || tabs.activeTabId !== tab.id || tabs.snapshotFor()?.url !== tab.url) return;
        host.protections.preferences.setAllowed(kind, tab.url, tab.isPrivate, !blocked);
        tabs.reload();
      },
      setPermission: (kind, decision) => {
        if (origin) store.set(origin, [kind], decision);
      },
      revokeCertificateException: () => {
        host.certificates.revoke(tab.url);
        void browsing.closeAllConnections().then(() => tabs.reload());
      },
      clearCookies: () => {
        void Promise.allSettled(cookies.map((cookie) => browsing.cookies.remove(cookieUrl(cookie), cookie.name))).then(
          () => tabs.reloadIgnoringCache(),
        );
      },
      clearSiteData: host.clearSiteData,
    },
  );
}
