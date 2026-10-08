export interface TabGroup {
  name: string;
  collapsed: boolean;
  count: number;
}
export function tabGroupName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= 80 && [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    ? name
    : null;
}
