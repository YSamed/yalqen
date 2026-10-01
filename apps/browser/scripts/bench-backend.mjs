import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: path.resolve(fileURLToPath(new URL('../dist/main/', import.meta.url))) },
    out: { type: 'string' },
  },
});
const load = async (name) => (await import(pathToFileURL(path.join(values['module-dir'], `${name}.js`)))).default;
const { HistoryStore } = await load('history');
const { indexHistory, suggest } = await load('suggestions');
const { matchRequestRule } = await load('request-rules');
const { tabListOrder } = await load('tab-shortcuts');
const { setThirdPartyCookieBlocking } = await load('third-party-cookies');

const visits = Array.from({ length: 5000 }, (_, index) => ({
  id: String(index),
  url: `https://site${index % 400}.example/articles/${index}`,
  title: `Article ${index} – Site ${index % 400}`,
  visitedAt: 1_000_000 - index * 100,
  faviconUrl: `https://site${index % 400}.example/favicon.ico`,
}));
const sources = { tabs: [], bookmarks: [], history: indexHistory(visits) };
const rules = Array.from({ length: 100 }, (_, index) => ({
  id: String(index),
  enabled: true,
  pattern: `https://api${index}.example/v1/*`,
  action: 'block',
}));
const tabs = Array.from({ length: 500 }, (_, index) => ({
  id: String(index),
  pinnedUrl: index < 250 ? `https://site${index}.example/` : null,
}));
const opened = new Map(tabs.slice(0, 250).map(({ id }) => [id, '250']));
let checksum = 0;
const cookieListeners = {};
const cookieSession = {
  webRequest: Object.fromEntries(
    ['onBeforeSendHeaders', 'onCompleted', 'onErrorOccurred'].map((name) => [
      name,
      (listener) => {
        cookieListeners[name] = listener;
      },
    ]),
  ),
  cookies: { remove: async () => {} },
};
setThirdPartyCookieBlocking(cookieSession, true);
const cookiePage = { getURL: () => 'https://www.example.co.uk/articles/123', isDestroyed: () => false };
const cookieRequests = Array.from({ length: 16 }, (_, index) => ({
  id: index,
  url: `https://cdn${index % 8}.${index < 8 ? 'example.co.uk' : 'tracker.net'}/resource/${index}`,
  resourceType: 'script',
  webContents: cookiePage,
  requestHeaders: { Cookie: 'existing=1', Accept: '*/*' },
}));

function measure(name, iterations, run) {
  for (let index = 0; index < Math.min(iterations, 100); index++) run(index);
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) run(index);
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { name, iterations, medianMs: Number(samples[3].toFixed(6)) };
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-backend-bench-'));
let results;
try {
  fs.writeFileSync(path.join(directory, 'history.json'), JSON.stringify(visits));
  const store = new HistoryStore(directory);
  results = [
    measure('history search, 5000 visits', 500, (index) => {
      checksum += store.list(['article', 'site12', 'missing'][index % 3]).length;
    }),
    measure('history index rebuild, 5000 visits', 100, () => {
      checksum += indexHistory(visits).pages.length;
    }),
    measure('suggestions, broad match, 5000 pages', 1000, () => {
      checksum += suggest('article', sources).length;
    }),
    measure('request rules, last of 100 matches', 5000, () => {
      checksum += Number(matchRequestRule(rules, 'https://api99.example/v1/users').id);
    }),
    measure('tab ordering, 500 tabs, 250 opened pins', 2000, () => {
      checksum += tabListOrder(tabs, opened).length;
    }),
    measure('cookie classification, repeated page and 16 hosts', 20000, (index) => {
      const details = cookieRequests[index % cookieRequests.length];
      cookieListeners.onBeforeSendHeaders(details, (result) => {
        checksum += Number(result.requestHeaders !== undefined);
      });
      cookieListeners.onCompleted(details);
    }),
  ];
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

const record = { node: process.version, visits: visits.length, checksum, results };
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.table(results);
