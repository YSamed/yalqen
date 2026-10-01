import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: fileURLToPath(new URL('../dist/main/', import.meta.url)) },
    out: { type: 'string' },
  },
});
const { importChromiumHistory, parseChromiumHistory } = (
  await import(pathToFileURL(path.join(values['module-dir'], 'browser-import.js')))
).default;
const epoch = 13_348_540_800_000_000n;
const counts = [5000, 250_000];
const row = (index, count) => ({
  url: `${index % 17 === 0 ? 'chrome:' : 'https:'}//site.example/${index}`,
  title: `Visit ${index}`,
  last_visit_time: epoch + BigInt((index * 7919) % count) * 1000n,
});
const digest = (visits) => createHash('sha256').update(JSON.stringify(visits)).digest('hex');
const median = (samples) => Number([...samples].sort((a, b) => a - b)[3].toFixed(6));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-history-import-bench-'));
const results = [];

try {
  for (const count of counts) {
    const fixture = path.join(directory, `history-${count}.sqlite`);
    const db = new DatabaseSync(fixture);
    try {
      db.exec(
        'CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER, hidden INTEGER DEFAULT 0); BEGIN',
      );
      const insert = db.prepare('INSERT INTO urls(url, title, last_visit_time) VALUES (?, ?, ?)');
      for (let index = 0; index < count; index++) {
        const { url, title, last_visit_time } = row(index, count);
        insert.run(url, title, last_visit_time);
      }
      db.exec('COMMIT');
    } finally {
      db.close();
    }

    let retained;
    const store = {
      importVisits(visits) {
        retained = visits;
        return visits.length;
      },
    };
    const samples = [];
    let expected;
    for (let repeat = 0; repeat < 8; repeat++) {
      global.gc?.();
      const started = performance.now();
      await importChromiumHistory(store, fixture);
      const elapsed = performance.now() - started;
      const checksum = digest(retained);
      expected ??= checksum;
      assert.equal(checksum, expected);
      if (repeat > 0) samples.push(elapsed);
    }
    results.push({
      name: 'SQLite history import including temporary copy',
      rows: count,
      retained: retained.length,
      medianMs: median(samples),
      checksum: expected,
    });
  }

  const rows = Array.from({ length: 5000 }, (_, index) => row(index, 5000));
  for (let index = 0; index < 20; index++) parseChromiumHistory(rows);
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const started = performance.now();
    for (let index = 0; index < 25; index++) parseChromiumHistory(rows);
    samples.push((performance.now() - started) / 25);
  }
  results.push({
    name: 'Small history parser',
    rows: rows.length,
    medianMs: median(samples),
    checksum: digest(parseChromiumHistory(rows)),
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

const report = {
  node: process.version,
  results,
  // Node reports maxRSS in KiB on all platforms. This is the benchmark process
  // peak, including synthetic fixture preparation, rather than browser memory.
  maxRSSMB: Number((process.resourceUsage().maxRSS / 1024).toFixed(3)),
};
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
