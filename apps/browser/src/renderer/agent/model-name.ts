export function modelName(id: string): string {
  const match = /^claude-([a-z]+)((?:-\d{1,2})*)(?:-\d{8})?(?:\[.*\])?$/.exec(id);
  if (!match) return id;
  const family = match[1][0].toUpperCase() + match[1].slice(1);
  const version = match[2].slice(1).replaceAll('-', '.');
  return version ? `${family} ${version}` : family;
}
