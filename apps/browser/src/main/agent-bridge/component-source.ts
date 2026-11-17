import type {
  ComponentInspection,
  ComponentNode,
  Framework,
  InspectedSource,
  SourceLocation,
} from '../../shared/component-inspection.js';

type SourceConfidence = 'exact' | 'component' | 'dom';

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
  /^\/?\([a-z-]+\)\//,
];

export function projectPath(file: string): string {
  let path = file.trim();
  for (const prefix of BUNDLER_PREFIXES) path = path.replace(prefix, '');
  if (path.startsWith('file://')) path = decodeURIComponent(new URL(path).pathname);
  if (/^https?:\/\//.test(path)) path = decodeURIComponent(new URL(path).pathname);
  path = path.replace(/[?#].*$/, '');
  if (path.startsWith('/@fs/')) return path.slice('/@fs'.length);
  if (path.startsWith('./')) return path.slice(2);
  if (path.startsWith('/') && !/^\/(Users|home|private|var|tmp|opt|Volumes|mnt|srv)\//.test(path)) return path.slice(1);
  return path;
}

const SERVER_FRAME = /^(about:\/\/React\/Server\/|rsc:\/\/)/;

function isServerFrame(source: InspectedSource): boolean {
  return SERVER_FRAME.test(source.raw?.file ?? '');
}

export function needsInlineMap(source: InspectedSource | null): source is InspectedSource & { raw: SourceLocation } {
  return (
    !!source?.raw?.file.startsWith('webpack-internal:') &&
    source.raw.line === source.line &&
    source.raw.column === source.column
  );
}

function location(source: InspectedSource | null): SourceLocation | null {
  if (!source?.mapped || !source.file) return null;
  if (isServerFrame(source)) return { file: projectPath(source.file), line: null, column: null };
  if (needsInlineMap(source)) return null;
  return { file: projectPath(source.file), line: source.line, column: source.column };
}

const MINIFIED_NAME = /^[A-Za-z_$][\w$]{0,2}$/;

export function componentInfo(inspection: ComponentInspection | null): ComponentInfo {
  if (!inspection?.framework) return NO_COMPONENT;
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
