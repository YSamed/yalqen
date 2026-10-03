// Runs inside a local development page, on the element the user picked, to find the React, Vue
// or Svelte component that rendered it. Bundled into one function body by scripts/build-preload.mjs.
// Only bippy/source is used: bippy's main entry installs a DevTools hook and pulls in React.
import type { Fiber } from 'bippy';
import { getRawSource, getSource, isSourceFile, normalizeFileName } from 'bippy/source';

const MAX_OWNERS = 12;
const MAX_PROPS = 12;
const MAX_STRING = 80;
const TREE_DEPTH = 3;
const TREE_NODES = 40;
const TREE_VISITS = 2000;

export interface RawLocation {
  file: string;
  line: number | null;
  column: number | null;
}

export interface InspectedSource extends RawLocation {
  mapped: boolean;
  // The location before source maps, for maps the page itself cannot fetch.
  raw: RawLocation | null;
}

export interface ComponentNode {
  name: string;
  children: ComponentNode[];
}

export type Framework = 'react' | 'vue' | 'svelte';

export interface ComponentInspection {
  framework: Framework | null;
  development: boolean;
  component: string | null;
  source: InspectedSource | null;
  componentSource: InspectedSource | null;
  owners: string[];
  props: Record<string, string>;
  children: ComponentNode[];
}

// React work tags for function, class, forwardRef, memo and simple memo components.
const COMPOSITE_TAGS = new Set([0, 1, 11, 14, 15]);

function getFiberFromHostInstance(element: Element): Fiber | null {
  const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
  return key ? ((element as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

function isCompositeFiber(fiber: Fiber): boolean {
  return COMPOSITE_TAGS.has(fiber.tag);
}

export function getDisplayName(type: unknown): string | null {
  if (typeof type === 'function') {
    const component = type as { displayName?: string; name?: string };
    return component.displayName || component.name || null;
  }
  if (typeof type !== 'object' || type === null) return null;
  const wrapper = type as { displayName?: string; render?: unknown; type?: unknown };
  return wrapper.displayName || getDisplayName(wrapper.render) || getDisplayName(wrapper.type);
}

interface OwnerLike {
  name?: string;
  _debugOwner?: OwnerLike | null;
  owner?: OwnerLike | null;
}

function ownerOf(node: Fiber | OwnerLike): Fiber | OwnerLike | null {
  return (node as Fiber)._debugOwner ?? (node as OwnerLike).owner ?? null;
}

function nameOf(node: Fiber | OwnerLike): string | null {
  if ('tag' in node && typeof node.tag === 'number') return getDisplayName((node as Fiber).type);
  return (node as OwnerLike).name ?? null;
}

function nearestComposite(fiber: Fiber): Fiber | null {
  for (let node: Fiber | null = fiber; node; node = node.return) {
    if (isCompositeFiber(node)) return node;
  }
  return null;
}

// React 19 records who rendered each element; older versions only have the parent chain.
function ownerNames(fiber: Fiber): string[] {
  const names: string[] = [];
  for (let node = ownerOf(fiber); node && names.length < MAX_OWNERS; node = ownerOf(node)) {
    const name = nameOf(node);
    if (name) names.push(name);
  }
  if (names.length > 0) return names;
  for (let node = fiber.return; node && names.length < MAX_OWNERS; node = node.return) {
    if (isCompositeFiber(node)) {
      const name = getDisplayName(node.type);
      if (name) names.push(name);
    }
  }
  return names;
}

export function describeValue(value: unknown): string {
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'string')
    return JSON.stringify(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if ('$$typeof' in value) return '[React element]';
  return '[Object]';
}

function describeProps(props: unknown): Record<string, string> {
  const described: Record<string, string> = {};
  if (typeof props !== 'object' || props === null) return described;
  for (const [key, value] of Object.entries(props).slice(0, MAX_PROPS)) {
    if (key !== 'children') described[key] = describeValue(value);
  }
  return described;
}

// Vite source maps name only the file, relative to the module URL the browser loaded.
function withDirectory(file: string, fiber: Fiber): string {
  if (file.includes('/')) return file;
  const raw = getRawSource(fiber)?.fileName;
  if (!raw || !/^https?:/.test(raw)) return file;
  return decodeURIComponent(new URL(file, raw).pathname);
}

async function sourceOf(fiber: Fiber | null): Promise<InspectedSource | null> {
  if (!fiber) return null;
  const source = await getSource(fiber).catch(() => null);
  if (!source?.fileName) return null;
  const file = withDirectory(normalizeFileName(source.fileName), fiber);
  const raw = getRawSource(fiber);
  return {
    file,
    line: source.lineNumber ?? null,
    column: source.columnNumber ?? null,
    mapped: isSourceFile(file),
    raw: raw?.fileName ? { file: raw.fileName, line: raw.lineNumber ?? null, column: raw.columnNumber ?? null } : null,
  };
}

// The components rendered below the selected one, so the agent sees what a change there affects.
function componentChildren(
  fiber: Fiber | null,
  depth = TREE_DEPTH,
  budget = { nodes: TREE_NODES, visits: TREE_VISITS },
): ComponentNode[] {
  const nodes: ComponentNode[] = [];
  for (let child = fiber?.child ?? null; child && budget.nodes > 0 && budget.visits-- > 0; child = child.sibling) {
    const name = isCompositeFiber(child) ? getDisplayName(child.type) : null;
    if (!name) {
      nodes.push(...componentChildren(child, depth, budget));
      continue;
    }
    budget.nodes--;
    nodes.push({ name, children: depth > 1 ? componentChildren(child, depth - 1, budget) : [] });
  }
  return nodes;
}

const HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

async function inspectFiber(fiber: Fiber): Promise<ComponentInspection> {
  const owners = ownerNames(fiber);
  const nearest = nearestComposite(fiber);
  // Server components have no fiber, so the owner name is the reliable one; the nearest
  // client fiber may be a framework wrapper.
  const component = owners[0] ?? (nearest && getDisplayName(nearest.type));
  const componentFiber = nearest && getDisplayName(nearest.type) === component ? nearest : null;
  const [source, componentSource] = await Promise.all([sourceOf(fiber), sourceOf(componentFiber)]);
  return {
    framework: 'react',
    // Production builds strip the _debug fields, and with them owners and source locations.
    development: '_debugOwner' in fiber || '_debugSource' in fiber || '_debugStack' in fiber,
    component: component ?? null,
    source,
    componentSource,
    owners,
    props: describeProps(componentFiber?.memoizedProps),
    children: componentChildren(componentFiber),
  };
}

const NOTHING: ComponentInspection = {
  framework: null,
  development: false,
  component: null,
  source: null,
  componentSource: null,
  owners: [],
  props: {},
  children: [],
};

interface VueInstance {
  type: { name?: string; __name?: string; __file?: string };
  parent: VueInstance | null;
  props?: Record<string, unknown>;
  subTree?: VueVNode;
}

interface VueVNode {
  component?: VueInstance | null;
  children?: unknown;
}

interface Vue2Instance {
  $options: { name?: string; _componentTag?: string; __file?: string; propsData?: Record<string, unknown> };
  $parent: Vue2Instance | null;
  $children?: Vue2Instance[];
}

function closest<T>(element: Element, read: (node: Element) => T | undefined): T | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = read(node);
    if (value) return value;
  }
  return undefined;
}

function fileName(file: string | undefined): string | null {
  return (
    file
      ?.split('/')
      .pop()
      ?.replace(/\.(vue|svelte)$/, '') ?? null
  );
}

function vueName(instance: VueInstance): string | null {
  return instance.type.name ?? instance.type.__name ?? fileName(instance.type.__file);
}

function vueChildren(vnode: VueVNode | undefined, depth = TREE_DEPTH, budget = { nodes: TREE_NODES }): ComponentNode[] {
  if (!vnode || budget.nodes <= 0) return [];
  const component = vnode.component;
  if (component) {
    const name = vueName(component);
    budget.nodes--;
    return name
      ? [{ name, children: depth > 1 ? vueChildren(component.subTree, depth - 1, budget) : [] }]
      : vueChildren(component.subTree, depth, budget);
  }
  return Array.isArray(vnode.children)
    ? vnode.children.flatMap((child) => vueChildren(child as VueVNode, depth, budget))
    : [];
}

// Vue keeps no element line, only the component's file, so the result is at best "component".
function inspectVue(element: Element): ComponentInspection | null {
  const instance = closest(
    element,
    (node) => (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent,
  );
  if (instance) {
    const owners: string[] = [];
    for (let node: VueInstance | null = instance; node && owners.length < MAX_OWNERS; node = node.parent) {
      const name = vueName(node);
      if (name) owners.push(name);
    }
    const file = instance.type.__file;
    return {
      ...NOTHING,
      framework: 'vue',
      development: Boolean(file),
      component: vueName(instance),
      source: file ? { file, line: null, column: null, mapped: true, raw: null } : null,
      owners,
      props: describeProps(instance.props),
      children: vueChildren(instance.subTree),
    };
  }
  const legacy = closest(element, (node) => (node as unknown as { __vue__?: Vue2Instance }).__vue__);
  if (!legacy) return null;
  const name = (vm: Vue2Instance) => vm.$options.name ?? vm.$options._componentTag ?? fileName(vm.$options.__file);
  const owners: string[] = [];
  for (let vm: Vue2Instance | null = legacy; vm && owners.length < MAX_OWNERS; vm = vm.$parent) {
    const label = name(vm);
    if (label) owners.push(label);
  }
  const file = legacy.$options.__file;
  return {
    ...NOTHING,
    framework: 'vue',
    development: Boolean(file),
    component: name(legacy),
    source: file ? { file, line: null, column: null, mapped: true, raw: null } : null,
    owners,
    props: describeProps(legacy.$options.propsData),
  };
}

interface SvelteLocation {
  file: string;
  line: number;
  column: number;
}

interface SvelteParent extends SvelteLocation {
  componentTag?: string;
  parent: SvelteParent | null;
}

interface SvelteMeta {
  loc?: SvelteLocation;
  parent?: SvelteParent | null;
}

// Svelte 5 dev builds record each element's location and the chain of component usages above it;
// Svelte 4 records only the location, with zero-based lines.
function inspectSvelte(element: Element): ComponentInspection | null {
  const meta = closest(element, (node) => (node as unknown as { __svelte_meta?: SvelteMeta }).__svelte_meta);
  if (!meta?.loc) return null;
  const svelte5 = 'parent' in meta;
  const location = (loc: SvelteLocation): InspectedSource => ({
    file: loc.file,
    line: svelte5 ? loc.line : loc.line + 1,
    column: loc.column + 1,
    mapped: true,
    raw: null,
  });
  const owners: string[] = [];
  let outermost: SvelteParent | null = null;
  for (let node = meta.parent ?? null; node && owners.length < MAX_OWNERS; node = node.parent) {
    if (node.componentTag) owners.push(node.componentTag);
    outermost = node;
  }
  const root = fileName(outermost?.file ?? (owners.length === 0 ? meta.loc.file : undefined));
  if (root) owners.push(root);
  const usage = meta.parent;
  return {
    ...NOTHING,
    framework: 'svelte',
    development: true,
    component: usage?.componentTag ?? fileName(meta.loc.file),
    source: location(meta.loc),
    componentSource: usage ? location(usage) : null,
    owners,
  };
}

export async function inspect(element: Element): Promise<ComponentInspection> {
  const fiber = getFiberFromHostInstance(element);
  if (!fiber) return inspectVue(element) ?? inspectSvelte(element) ?? NOTHING;
  // bippy installs a DevTools hook while resolving sources; the page should not keep one it never had.
  const hadHook = Object.hasOwn(globalThis, HOOK);
  try {
    return await inspectFiber(fiber);
  } finally {
    if (!hadHook) Reflect.deleteProperty(globalThis, HOOK);
  }
}
