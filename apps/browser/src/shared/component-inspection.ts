export interface SourceLocation {
  file: string;
  line: number | null;
  column: number | null;
}

export interface InspectedSource extends SourceLocation {
  mapped: boolean;
  raw: SourceLocation | null;
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
