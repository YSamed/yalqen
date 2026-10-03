const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map([...BASE64].map((char, index) => [char, index]));

export interface RawSourceMap {
  sources: string[];
  sourceRoot?: string;
  mappings: string;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
}

function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) return [];
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

// Lines and columns in and out are one-based, as in stack traces; source maps count from zero.
export function originalPosition(map: RawSourceMap, line: number, column: number): OriginalPosition | null {
  const lines = map.mappings.split(';');
  if (line < 1 || line > lines.length) return null;
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let best: OriginalPosition | null = null;
  // Source fields are deltas across the whole mapping, so earlier lines still have to be walked.
  for (let index = 0; index < line; index++) {
    let generatedColumn = 0;
    for (const segment of lines[index].split(',')) {
      if (!segment) continue;
      const fields = decodeSegment(segment);
      generatedColumn += fields[0] ?? 0;
      if (fields.length < 4) continue;
      sourceIndex += fields[1];
      sourceLine += fields[2];
      sourceColumn += fields[3];
      if (index === line - 1 && generatedColumn <= column - 1) {
        const source = `${map.sourceRoot ?? ''}${map.sources[sourceIndex] ?? ''}`;
        best = { source, line: sourceLine + 1, column: sourceColumn + 1 };
      }
    }
  }
  return best;
}

export function inlineSourceMap(url: string): RawSourceMap | null {
  const match = /^data:application\/json[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  try {
    const text = match[1] ? Buffer.from(match[2], 'base64').toString('utf8') : decodeURIComponent(match[2]);
    const map = JSON.parse(text) as Partial<RawSourceMap>;
    return Array.isArray(map.sources) && typeof map.mappings === 'string' ? (map as RawSourceMap) : null;
  } catch {
    return null;
  }
}
