import { randomBytes } from 'node:crypto';
import { formatLocation, type ComponentInfo } from './component-source.js';
import type { AgentElementRef } from '../../shared/types.js';
import type { Truncated } from './redact.js';

export const SELECTION_LIMIT = 10;
export const OUTER_HTML_LIMIT = 4 * 1024;
const LABEL_TEXT_LENGTH = 40;
const LABEL_CLASSES = 2;

const LAYOUT_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'overflow-x',
  'overflow-y',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column-start',
  'grid-column-end',
  'grid-row-start',
  'grid-row-end',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'white-space',
  'color',
  'background-color',
  'border-top-width',
  'border-top-left-radius',
  'opacity',
  'visibility',
] as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementSelection {
  id: string;
  tabId: string;
  url: string;
  time: number;
  label: string;
  tag: string;
  attributes: Record<string, string>;
  text: string;
  role: string | null;
  name: string | null;
  selector: string;
  ancestors: string[];
  html: Truncated;
  styles: Record<string, string>;
  box: Box | null;
  // Base64 PNG of the element's box, kept for get_selected_element.
  screenshot: string | null;
  component: ComponentInfo;
}

export function newSelectionId(): string {
  return `yk_${randomBytes(3).toString('hex')}`;
}

export function attributeMap(flat: readonly string[] | undefined): Record<string, string> {
  const list = flat ?? [];
  const attributes: Record<string, string> = {};
  for (let index = 0; index + 1 < list.length; index += 2) attributes[list[index]] = list[index + 1];
  return attributes;
}

const UNREMARKABLE_VALUES = new Set(['', 'auto', 'none', 'normal', '0px']);
const ALWAYS_SHOWN = new Set<string>(['display', 'position', 'width', 'height']);

// Values that are almost always the default only cost the agent tokens, so they are left out.
export function layoutStyles(computed: readonly { name: string; value: string }[]): Record<string, string> {
  const byName = new Map(computed.map(({ name, value }) => [name, value]));
  const styles: Record<string, string> = {};
  for (const name of LAYOUT_PROPERTIES) {
    const value = byName.get(name);
    if (value === undefined || (UNREMARKABLE_VALUES.has(value) && !ALWAYS_SHOWN.has(name))) continue;
    styles[name] = value;
  }
  return styles;
}

// CDP quads list the four corners clockwise as x1, y1, ..., x4, y4.
export function boxFromQuad(quad: readonly number[] | undefined): Box | null {
  if (!quad || quad.length < 8) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function shortText(text: string, length = LABEL_TEXT_LENGTH): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > length ? `${collapsed.slice(0, length - 1)}…` : collapsed;
}

export function elementLabel(tag: string, attributes: Record<string, string>, text: string): string {
  const id = attributes.id ? `#${attributes.id}` : '';
  const classes = (attributes.class ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, LABEL_CLASSES)
    .map((name) => `.${name}`)
    .join('');
  const visible = shortText(text) || attributes['aria-label'] || attributes.placeholder || attributes.alt || '';
  return `${tag}${id}${classes}${visible ? ` "${shortText(visible)}"` : ''}`;
}

export function selectionRef(selection: ElementSelection): AgentElementRef {
  const { component } = selection;
  return {
    id: selection.id,
    tabId: selection.tabId,
    url: selection.url,
    label: selection.label,
    component: component.component,
    source: component.source ? formatLocation(component.source) : null,
  };
}

export function selectionSummary(selection: ElementSelection) {
  return {
    selection_id: selection.id,
    tab: selection.tabId,
    url: selection.url,
    label: selection.label,
    time: selection.time,
  };
}

export function selectionDetails(selection: ElementSelection) {
  const { component: react } = selection;
  return {
    ...selectionSummary(selection),
    framework: react.framework,
    component: react.component,
    source: react.source && { ...react.source, confidence: react.confidence },
    confidence: react.confidence,
    used_at: react.usedAt,
    owner_chain: react.ownerChain,
    props: react.props,
    tag: selection.tag,
    attributes: selection.attributes,
    text: selection.text,
    accessible_role: selection.role,
    accessible_name: selection.name,
    selector: selection.selector,
    ancestors: selection.ancestors,
    box: selection.box,
    styles: selection.styles,
    outer_html: selection.html,
  };
}
