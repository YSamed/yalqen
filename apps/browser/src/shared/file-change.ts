export interface DiffLine {
  kind: 'add' | 'remove' | 'same';
  text: string;
}

export interface FileChange {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
}

const MAX_LINES = 400;
// Above this many cells the table costs more than the readable diff is worth; fall back to remove-then-add.
const MAX_CELLS = 160_000;

export const FILE_EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: 'remove' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i * width + j] =
        a[i] === b[j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (common[(i + 1) * width + j] >= common[i * width + j + 1]) lines.push({ kind: 'remove', text: a[i++] });
    else lines.push({ kind: 'add', text: b[j++] });
  }
  while (i < a.length) lines.push({ kind: 'remove', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'add', text: b[j++] });
  return lines;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function changedLines(tool: string, input: Record<string, unknown>): DiffLine[] | null {
  if (tool === 'Write') {
    const content = text(input.content);
    return content === null ? null : lineDiff('', content);
  }
  if (tool === 'Edit') {
    const before = text(input.old_string);
    const after = text(input.new_string);
    return before === null || after === null ? null : lineDiff(before, after);
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    const lines: DiffLine[] = [];
    for (const edit of input.edits) {
      const before = text(edit?.old_string);
      const after = text(edit?.new_string);
      if (before === null || after === null) return null;
      if (lines.length) lines.push({ kind: 'same', text: '⋯' });
      lines.push(...lineDiff(before, after));
    }
    return lines;
  }
  if (tool === 'NotebookEdit') {
    const source = text(input.new_source);
    return source === null ? null : lineDiff('', source);
  }
  return null;
}

export function fileChange(tool: string, input: string): FileChange | null {
  if (!FILE_EDIT_TOOLS.includes(tool)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const values = parsed as Record<string, unknown>;
  const path = text(values.file_path) ?? text(values.notebook_path);
  const lines = path ? changedLines(tool, values) : null;
  if (!path || !lines) return null;
  return {
    path,
    lines: lines.slice(0, MAX_LINES),
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'remove').length,
    truncated: lines.length > MAX_LINES,
  };
}

export function relativePath(path: string, directory: string | null): string {
  if (!directory) return path;
  const base = directory.endsWith('/') ? directory : `${directory}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}
