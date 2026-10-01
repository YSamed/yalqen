import fs from 'node:fs/promises';
import path from 'node:path';
import { ElectronBlocker, adsLists } from '@ghostery/adblocker-electron';

const FILTER_LISTS = adsLists.filter((url) => !url.includes('/peter-lowe/'));
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Scriptlets declare shared helpers (e.g. `proxyApplyFn`) as globals. Injected one by one, a later
// scriptlet redeclares them and wraps the earlier Function.prototype.toString proxy, which then
// recurses forever (seen on chatgpt.com). A function scope per scriptlet keeps their state apart.
class ScopedScriptletBlocker extends ElectronBlocker {
  override getCosmeticsFilters(...args: Parameters<ElectronBlocker['getCosmeticsFilters']>) {
    const filters = super.getCosmeticsFilters(...args);
    return { ...filters, scripts: filters.scripts.map((script) => `(function () {\n${script}\n})();`) };
  }
}

export async function loadEngine(cacheFile: string): Promise<{ blocker: ElectronBlocker; stale: boolean }> {
  try {
    const { mtimeMs } = await fs.stat(cacheFile);
    const blocker = ScopedScriptletBlocker.deserialize(await fs.readFile(cacheFile));
    return { blocker, stale: Date.now() - mtimeMs > CACHE_MAX_AGE_MS };
  } catch {
    return { blocker: await fetchEngine(cacheFile), stale: false };
  }
}

export async function fetchEngine(cacheFile: string): Promise<ElectronBlocker> {
  const blocker = await ScopedScriptletBlocker.fromLists(fetch, FILTER_LISTS);
  const temp = `${cacheFile}.tmp`;
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(temp, blocker.serialize());
  await fs.rename(temp, cacheFile);
  return blocker;
}
