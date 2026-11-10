export interface TabGroup {
  name: string;
  collapsed: boolean;
  count: number;
  parent: string | null;
}

export type GroupParents = ReadonlyMap<string, string>;

export function tabGroupName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= 80 && [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    ? name
    : null;
}

export function groupAncestors(parents: GroupParents, name: string): string[] {
  const chain: string[] = [];
  for (let next = parents.get(name); next && !chain.includes(next); next = parents.get(next)) chain.push(next);
  return chain;
}

export function canNestGroup(parents: GroupParents, name: string, parent: string | null): boolean {
  return parent === null || (parent !== name && !groupAncestors(parents, parent).includes(name));
}

export function pruneGroupParents(parents: GroupParents, used: Iterable<string>): Map<string, string> {
  const alive = new Set<string>();
  for (const name of used) for (const group of [name, ...groupAncestors(parents, name)]) alive.add(group);
  return new Map([...parents].filter(([name]) => alive.has(name)));
}

export function parseGroupParents(value: unknown): Map<string, string> {
  const parents = new Map<string, string>();
  if (typeof value !== 'object' || value === null) return parents;
  for (const [key, parent] of Object.entries(value).slice(0, 50)) {
    const name = tabGroupName(key),
      next = tabGroupName(parent);
    if (name && next && canNestGroup(parents, name, next)) parents.set(name, next);
  }
  return parents;
}

// Parents come before their children, so a depth-first walk matches the sidebar order.
export function groupOrder(used: Iterable<string>, parents: GroupParents): string[] {
  const names = new Set(used);
  for (const [name, parent] of parents) names.add(name).add(parent);
  const walk = (parent: string | null): string[] =>
    [...names].filter((name) => (parents.get(name) ?? null) === parent).flatMap((name) => [name, ...walk(name)]);
  return walk(null);
}
