import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mainModule } from './main-module.mjs';

const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: fileURLToPath(new URL('../dist/main/', import.meta.url)) },
    out: { type: 'string' },
  },
});
const load = async (file, fallback) => {
  const nested = path.resolve(values['module-dir'], file);
  const target = fs.existsSync(nested) ? nested : mainModule(values['module-dir'], fallback);
  return (await import(pathToFileURL(target))).default;
};
// Renderers moved from the stores into pages/; older builds still export them from their previous modules.
const { renderHistory } = await load('pages/history-page.js', 'internal-pages.js');
const { renderBookmarks } = await load('pages/bookmarks-page.js', 'bookmarks.js');
const { renderDownloads } = await load('pages/downloads-page.js', 'downloads.js');

const DAY = 24 * 60 * 60 * 1000;
const visits = Array.from({ length: 5000 }, (_, index) => ({
  id: `visit-${index}`,
  url: `https://www.site${index % 400}.example/articles/${index}?ref=feed`,
  title: `Article ${index} – Site ${index % 400}`,
  visitedAt: 1_760_000_000_000 - index * (DAY / 40),
}));
const folders = Array.from({ length: 250 }, (_, index) => ({
  id: `folder-${index}`,
  title: `Folder ${index}`,
  createdAt: index,
}));
const bookmarks = visits.map(({ id, url, title, visitedAt }, index) => ({
  id,
  url,
  title,
  folderId: index % 100 === 0 ? null : `folder-${index % folders.length}`,
  createdAt: visitedAt,
}));
const downloads = Array.from({ length: 200 }, (_, index) => ({
  id: `download-${index}`,
  url: `https://cdn${index % 20}.example/file-${index}.zip`,
  filename: `file-${index}.zip`,
  savePath: `/tmp/file-${index}.zip`,
  state: index < 2 ? 'progressing' : 'completed',
  receivedBytes: 1024 * 1024 * index,
  totalBytes: 1024 * 1024 * (index + 1),
  startedAt: index,
}));

function measure(render, iterations) {
  for (let index = 0; index < 3; index++) render();
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) render();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: Number(samples[3].toFixed(3)), htmlKiB: Math.round(render().length / 1024) };
}

const record = {
  node: process.versions.node,
  history5000: measure(() => renderHistory(visits, ''), 20),
  bookmarks5000x250: measure(() => renderBookmarks(folders, bookmarks, ''), 3),
  bookmarks5000x250Search: measure(() => renderBookmarks(folders, bookmarks.slice(0, 500), 'article'), 10),
  downloads200: measure(() => renderDownloads(downloads), 50),
};
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
