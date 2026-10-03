export type SourceConfidence = 'exact' | 'component' | 'dom';

export interface RawLocation {
  file: string;
  line: number | null;
  column: number | null;
}

export interface InspectedSource extends RawLocation {
  mapped: boolean;
  raw: RawLocation | null;
}

export interface ComponentNode {
  name: string;
  children: ComponentNode[];
}

// What the page-side inspector (src/page-scripts/component-inspector.ts) returns.
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

export interface SourceLocation {
  file: string;
  line: number | null;
  column: number | null;
}

export interface ComponentInfo {
  framework: Framework | null;
  component: string | null;
  confidence: SourceConfidence;
  source: SourceLocation | null;
  usedAt: SourceLocation | null;
  ownerChain: string[];
  props: Record<string, string>;
  children: ComponentNode[];
}

export const NO_COMPONENT: ComponentInfo = {
  framework: null,
  component: null,
  confidence: 'dom',
  source: null,
  usedAt: null,
  ownerChain: [],
  props: {},
  children: [],
};

const BUNDLER_PREFIXES = [
  /^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/,
  /^webpack:\/\/[^/]*\//,
  /^turbopack:\/\/\[project\]\//,
  // Next.js names its webpack layers, such as (rsc) or (app-pages-browser), in front of the path.
  /^\/?\([a-z-]+\)\//,
];

// Turns the many spellings bundlers use into a path an agent can open: absolute paths stay
// absolute, everything else becomes relative to the project root.
export function projectPath(file: string): string {
  let path = file.trim();
  for (const prefix of BUNDLER_PREFIXES) path = path.replace(prefix, '');
  if (path.startsWith('file://')) path = decodeURIComponent(new URL(path).pathname);
  if (/^https?:\/\//.test(path)) path = decodeURIComponent(new URL(path).pathname);
  path = path.replace(/[?#].*$/, '');
  if (path.startsWith('/@fs/')) return path.slice('/@fs'.length);
  if (path.startsWith('./')) return path.slice(2);
  // Dev servers such as Vite serve project files from the root, so /src/x.tsx means <project>/src/x.tsx.
  if (path.startsWith('/') && !/^\/(Users|home|private|var|tmp|opt|Volumes|mnt|srv)\//.test(path)) return path.slice(1);
  return path;
}

const SERVER_FRAME = /^(about:\/\/React\/Server\/|rsc:\/\/)/;

export function isServerFrame(source: InspectedSource): boolean {
  return SERVER_FRAME.test(source.raw?.file ?? '');
}

// Webpack evaluates each module with its source map inline, which the page cannot fetch, so
// such a location is still the compiled one until the main process maps it.
export function needsInlineMap(source: InspectedSource | null): source is InspectedSource & { raw: RawLocation } {
  return (
    !!source?.raw?.file.startsWith('webpack-internal:') &&
    source.raw.line === source.line &&
    source.raw.column === source.column
  );
}

function location(source: InspectedSource | null): SourceLocation | null {
  if (!source?.mapped || !source.file) return null;
  // Server component code never reaches the browser, so only the file name is trustworthy.
  if (isServerFrame(source)) return { file: projectPath(source.file), line: null, column: null };
  if (needsInlineMap(source)) return null;
  return { file: projectPath(source.file), line: source.line, column: source.column };
}

const MINIFIED_NAME = /^[A-Za-z_$][\w$]{0,2}$/;

export function componentInfo(inspection: ComponentInspection | null): ComponentInfo {
  if (!inspection?.framework) return NO_COMPONENT;
  // A minifier's two-letter names would send the agent looking for components that do not exist.
  if (!inspection.development && (!inspection.component || MINIFIED_NAME.test(inspection.component))) {
    return NO_COMPONENT;
  }
  const source = location(inspection.source);
  return {
    framework: inspection.framework,
    component: inspection.component,
    confidence: source?.line ? 'exact' : inspection.component ? 'component' : 'dom',
    source,
    usedAt: location(inspection.componentSource),
    ownerChain: [...inspection.owners].reverse(),
    props: inspection.props,
    children: inspection.children,
  };
}

export function formatLocation(location: SourceLocation): string {
  return location.line ? `${location.file}:${location.line}` : location.file;
}
