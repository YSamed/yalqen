import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { t } from '../../shared/i18n.js';
import type { SavedLoginChoice } from '../../shared/types.js';

export function loginMenuTemplate(
  choices: readonly SavedLoginChoice[],
  select: (id: string) => void,
): MenuItemConstructorOptions[] {
  return choices.map((choice) => ({
    label: choice.username || t('passwordsPanel.noUsername'),
    click: () => select(choice.id),
  }));
}

export function chooseLogin(parent: BaseWindow, choices: readonly SavedLoginChoice[]): Promise<string | null> {
  return new Promise((resolve) => {
    let selected: string | null = null;
    const menu = Menu.buildFromTemplate(
      loginMenuTemplate(choices, (id) => {
        selected = id;
      }),
    );
    menu.popup({ window: parent, callback: () => setTimeout(() => resolve(selected)) });
  });
}
