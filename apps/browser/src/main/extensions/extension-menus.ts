import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { snippet } from '../window/context-menu.js';
import { hostPermitted } from './extension-cookies.js';

type MenuId = string | number;

interface MenuItem {
  id: MenuId;
  parentId?: MenuId;
  type: 'normal' | 'checkbox' | 'radio' | 'separator';
  title: string;
  contexts: string[];
  checked: boolean;
  enabled: boolean;
  visible: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
}

export type MenuContext = Pick<
  ContextMenuParams,
  'linkURL' | 'srcURL' | 'mediaType' | 'selectionText' | 'isEditable' | 'pageURL' | 'frameURL'
>;

export type MenuClickInfo = Record<string, unknown>;

const TYPES = new Set(['normal', 'checkbox', 'radio', 'separator']);

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

const isId = (value: unknown): value is MenuId => typeof value === 'string' || typeof value === 'number';

function applyProperties(item: MenuItem, properties: Record<string, unknown>): void {
  const { type, title, contexts, checked, enabled, visible, parentId, documentUrlPatterns, targetUrlPatterns } =
    properties;
  if (typeof type === 'string' && TYPES.has(type)) item.type = type as MenuItem['type'];
  if (typeof title === 'string') item.title = title;
  if (strings(contexts)) item.contexts = strings(contexts) ?? item.contexts;
  if (typeof checked === 'boolean') item.checked = checked;
  if (typeof enabled === 'boolean') item.enabled = enabled;
  if (typeof visible === 'boolean') item.visible = visible;
  if (isId(parentId)) item.parentId = parentId;
  if (documentUrlPatterns !== undefined) item.documentUrlPatterns = strings(documentUrlPatterns);
  if (targetUrlPatterns !== undefined) item.targetUrlPatterns = strings(targetUrlPatterns);
}

export class ExtensionMenus {
  private readonly items = new Map<string, MenuItem[]>();

  call(extensionId: string, method: unknown, args: unknown[]): void {
    const list = this.items.get(extensionId) ?? [];
    this.items.set(extensionId, list);
    const properties = (value: unknown) =>
      (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const find = (id: unknown) => {
      const item = list.find((entry) => entry.id === id);
      if (!item) throw new Error(`Cannot find menu item with id ${String(id)}`);
      return item;
    };
    if (method === 'create') {
      const options = properties(args[0]);
      if (!isId(options.id)) throw new Error('Menu item id is required');
      if (list.some((entry) => entry.id === options.id))
        throw new Error(`Cannot create item with duplicate id ${options.id}`);
      if (options.parentId !== undefined) find(options.parentId);
      const item: MenuItem = {
        id: options.id,
        type: 'normal',
        title: '',
        contexts: ['page'],
        checked: false,
        enabled: true,
        visible: true,
      };
      applyProperties(item, options);
      list.push(item);
    } else if (method === 'update') {
      const options = properties(args[1]);
      if (options.parentId !== undefined) find(options.parentId);
      applyProperties(find(args[0]), options);
    } else if (method === 'remove') {
      const removed = new Set<MenuId>([find(args[0]).id]);
      for (const entry of list) if (entry.parentId !== undefined && removed.has(entry.parentId)) removed.add(entry.id);
      this.items.set(
        extensionId,
        list.filter((entry) => !removed.has(entry.id)),
      );
    } else if (method === 'removeAll') {
      this.items.delete(extensionId);
    } else {
      throw new Error('Unsupported contextMenus method');
    }
  }

  template(
    extensionId: string,
    extensionName: string,
    context: MenuContext,
    onClick: (info: MenuClickInfo) => void,
  ): MenuItemConstructorOptions[] {
    const list = this.items.get(extensionId) ?? [];
    const present = presentContexts(context);
    const shown = (item: MenuItem) =>
      item.visible &&
      item.contexts.some((name) => present.has(name)) &&
      (!item.documentUrlPatterns || hostPermitted(item.documentUrlPatterns, context.pageURL)) &&
      (!item.targetUrlPatterns ||
        hostPermitted(item.targetUrlPatterns, context.linkURL) ||
        hostPermitted(item.targetUrlPatterns, context.srcURL));
    const build = (item: MenuItem): MenuItemConstructorOptions => {
      if (item.type === 'separator') return { type: 'separator' };
      const children = list.filter((child) => child.parentId === item.id && shown(child)).map(build);
      const label = item.title.replaceAll('%s', snippet(context.selectionText));
      if (children.length > 0) return { label, enabled: item.enabled, submenu: children };
      return {
        label,
        type: item.type,
        checked: item.checked,
        enabled: item.enabled,
        click: () => {
          const wasChecked = item.checked;
          if (item.type === 'checkbox') item.checked = !wasChecked;
          if (item.type === 'radio') item.checked = true;
          onClick({
            menuItemId: item.id,
            ...(item.parentId !== undefined ? { parentMenuItemId: item.parentId } : {}),
            editable: context.isEditable,
            pageUrl: context.pageURL,
            ...(context.frameURL ? { frameUrl: context.frameURL } : {}),
            ...(context.linkURL ? { linkUrl: context.linkURL } : {}),
            ...(context.srcURL ? { srcUrl: context.srcURL, mediaType: context.mediaType } : {}),
            ...(context.selectionText ? { selectionText: context.selectionText } : {}),
            ...(item.type === 'checkbox' || item.type === 'radio' ? { wasChecked, checked: item.checked } : {}),
          });
        },
      };
    };
    const top = list.filter((item) => item.parentId === undefined && shown(item)).map(build);
    return top.length > 1 ? [{ label: extensionName, submenu: top }] : top;
  }
}

function presentContexts(context: MenuContext): Set<string> {
  const present = new Set(['all']);
  if (context.linkURL) present.add('link');
  if (context.selectionText) present.add('selection');
  if (context.isEditable) present.add('editable');
  if (['image', 'video', 'audio'].includes(context.mediaType)) present.add(context.mediaType);
  if (context.frameURL) present.add('frame');
  if (present.size === (context.frameURL ? 2 : 1)) present.add('page');
  return present;
}
