const normalize = (text: string): string => text.toLowerCase().replace(/\s+/g, '');

export function matchSearchKeyword<T extends { id: string; label: string }>(
  text: string,
  engines: readonly T[],
): T | undefined {
  const key = normalize(text);
  return key === '' ? undefined : engines.find((engine) => engine.id === key || normalize(engine.label) === key);
}
