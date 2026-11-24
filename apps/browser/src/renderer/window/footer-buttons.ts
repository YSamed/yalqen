import { t } from '../../shared/i18n';
import type { SidebarFooterItem, SidebarMenuKind, UiAction } from '../../shared/types';
import type { IconName } from '../ui/Icon.svelte';
import { anchorRect } from './anchor';

export interface FooterButton {
  icon: IconName;
  label: string;
  popup?: boolean;
  run: (button: HTMLElement) => void;
}

export function footerButton(
  item: SidebarFooterItem,
  send: (action: UiAction) => void,
  openMenu: (kind: SidebarMenuKind, button: HTMLElement) => void,
): FooterButton {
  switch (item) {
    case 'history':
      return { icon: 'history', label: t('toolbar.history'), run: () => send({ type: 'open-history' }) };
    case 'bookmarks':
      return {
        icon: 'bookmarks',
        label: t('toolbar.bookmarks'),
        run: () => send({ type: 'toggle-bookmarks-panel' }),
      };
    case 'spaces':
      return {
        icon: 'sidebar',
        label: t('spaces.switcher'),
        popup: true,
        run: (button) => openMenu('spaces', button),
      };
    case 'downloads':
      return {
        icon: 'download',
        label: t('toolbar.downloads'),
        popup: true,
        run: (button) => openMenu('downloads', button),
      };
    case 'extensions':
      return {
        icon: 'extensions',
        label: t('toolbar.extensions'),
        popup: true,
        run: (button) => send({ type: 'open-extensions-menu', anchor: anchorRect(button) }),
      };
    case 'screenshot':
      return {
        icon: 'screenshot',
        label: t('toolbar.fullPageScreenshot'),
        run: () => send({ type: 'dev-command', id: 'full-page-screenshot' }),
      };
    case 'settings':
      return { icon: 'settings', label: t('toolbar.settings'), run: () => send({ type: 'open-settings' }) };
    case 'profile':
      return {
        icon: 'profile',
        label: t('toolbar.profile'),
        popup: true,
        run: () => send({ type: 'open-profile-menu' }),
      };
  }
}
