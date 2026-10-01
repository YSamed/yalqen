import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import type { AddressFormat } from './page-export.js';
import { t } from '../shared/i18n.js';

const SNIPPET_LENGTH = 30;

export type PageContext = Pick<
  ContextMenuParams,
  | 'linkURL'
  | 'srcURL'
  | 'mediaType'
  | 'selectionText'
  | 'isEditable'
  | 'editFlags'
  | 'misspelledWord'
  | 'dictionarySuggestions'
>;

const MAX_SPELLING_SUGGESTIONS = 5;

export interface ContextMenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  canViewSource: boolean;
  openInNewTab(url: string): void;
  openInNewWindow(url: string): void;
  copyText(text: string): void;
  copyImage(): void;
  download(url: string): void;
  search(text: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  inspect(): void;
  print(): void;
  viewSource(): void;
  copyAddress(format: AddressFormat): void;
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  translation?: { label: string; run(): void };
  translateSelection?: () => void;
}

export function snippet(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > SNIPPET_LENGTH ? `${line.slice(0, SNIPPET_LENGTH - 1)}…` : line;
}

function canOpen(url: string): boolean {
  return /^https?:/i.test(url) || (/^data:/i.test(url) && !/^data:text\/html/i.test(url));
}

export function contextMenuTemplate(context: PageContext, actions: ContextMenuActions): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];
  const link = context.linkURL;
  const image = context.mediaType === 'image' ? context.srcURL : '';
  const selection = context.selectionText.trim();

  if (link) {
    groups.push([
      ...(canOpen(link)
        ? [
            { label: t('contextMenu.openLinkInNewTab'), click: () => actions.openInNewTab(link) },
            { label: t('contextMenu.openLinkInNewWindow'), click: () => actions.openInNewWindow(link) },
            { label: t('contextMenu.downloadLink'), click: () => actions.download(link) },
          ]
        : []),
      { label: t('contextMenu.copyLinkAddress'), click: () => actions.copyText(link) },
    ]);
  }
  if (image) {
    groups.push([
      ...(canOpen(image)
        ? [
            { label: t('contextMenu.openImageInNewTab'), click: () => actions.openInNewTab(image) },
            { label: t('contextMenu.downloadImage'), click: () => actions.download(image) },
          ]
        : []),
      { label: t('contextMenu.copyImage'), click: actions.copyImage },
      { label: t('contextMenu.copyImageAddress'), click: () => actions.copyText(image) },
    ]);
  }
  if (context.isEditable && context.misspelledWord) {
    const word = context.misspelledWord;
    const suggestions = context.dictionarySuggestions.slice(0, MAX_SPELLING_SUGGESTIONS);
    groups.push([
      ...(suggestions.length > 0
        ? suggestions.map((suggestion) => ({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) }))
        : [{ label: t('contextMenu.noSpellingSuggestions'), enabled: false }]),
      { label: t('contextMenu.addToDictionary', { word: snippet(word) }), click: () => actions.addToDictionary(word) },
    ]);
  }
  if (context.isEditable) {
    const flags = context.editFlags;
    groups.push(
      [
        { label: t('contextMenu.undo'), role: 'undo', enabled: flags.canUndo },
        { label: t('contextMenu.redo'), role: 'redo', enabled: flags.canRedo },
      ],
      [
        { label: t('contextMenu.cut'), role: 'cut', enabled: flags.canCut },
        { label: t('contextMenu.copy'), role: 'copy', enabled: flags.canCopy },
        { label: t('contextMenu.paste'), role: 'paste', enabled: flags.canPaste },
        { label: t('contextMenu.selectAll'), role: 'selectAll', enabled: flags.canSelectAll },
      ],
    );
  } else if (selection) {
    groups.push([{ label: t('contextMenu.copy'), role: 'copy' }]);
  }
  if (selection) {
    groups.push([
      { label: t('contextMenu.searchFor', { text: snippet(selection) }), click: () => actions.search(selection) },
      ...(actions.translateSelection && !context.isEditable
        ? [{ label: t('contextMenu.translateSelection'), click: actions.translateSelection }]
        : []),
    ]);
  }
  if (groups.length === 0) {
    groups.push([
      { label: t('contextMenu.back'), enabled: actions.canGoBack, click: actions.goBack },
      { label: t('contextMenu.forward'), enabled: actions.canGoForward, click: actions.goForward },
      { label: t('contextMenu.reload'), click: actions.reload },
    ]);
    groups.push([
      ...(actions.translation ? [{ label: actions.translation.label, click: actions.translation.run }] : []),
      { label: t('contextMenu.print'), click: actions.print },
      ...(actions.canViewSource
        ? [
            { label: t('contextMenu.viewSource'), click: actions.viewSource },
            {
              label: t('contextMenu.copyPageAddress'),
              submenu: [
                { label: t('contextMenu.address'), click: () => actions.copyAddress('url') },
                { label: t('contextMenu.markdownLink'), click: () => actions.copyAddress('markdown') },
                { label: t('contextMenu.curlCommand'), click: () => actions.copyAddress('curl') },
              ],
            },
          ]
        : []),
    ]);
  }
  groups.push([{ label: t('contextMenu.inspect'), click: actions.inspect }]);

  return groups.flatMap((group, index) => (index === 0 ? group : [{ type: 'separator' as const }, ...group]));
}
