import assert from 'node:assert/strict';
import { test } from 'node:test';
import filesModule from '../../../dist/main/agent-bridge/project-files.js';

const { ProjectFiles, matchFiles } = filesModule;
const FILES = ['README.md', 'src/app.ts', 'src/components/AppShell.svelte', 'src/lib/apply.ts', 'test/app.test.ts'];

test('matchFiles ranks file name prefixes before path matches and fuzzy matches', () => {
  assert.deepEqual(matchFiles(FILES, 'app'), [
    'src/app.ts',
    'src/lib/apply.ts',
    'test/app.test.ts',
    'src/components/AppShell.svelte',
  ]);
  assert.deepEqual(matchFiles(FILES, 'shell'), ['src/components/AppShell.svelte']);
  assert.deepEqual(matchFiles(FILES, 'lib/ap'), ['src/lib/apply.ts']);
  assert.deepEqual(matchFiles(FILES, 'sapts'), ['src/app.ts', 'src/lib/apply.ts', 'test/app.test.ts']);
  assert.deepEqual(matchFiles(FILES, ''), FILES);
  assert.deepEqual(matchFiles(FILES, 'zzz'), []);
});

test('ProjectFiles lists a project once and reuses the list for later searches', async () => {
  const listed = [];
  const files = new ProjectFiles(async (directory) => {
    listed.push(directory);
    return FILES;
  });
  assert.deepEqual(await files.search('/p', 'readme'), ['README.md']);
  await files.search('/p', 'app');
  assert.deepEqual(listed, ['/p']);
  await files.search('/q', 'app');
  assert.deepEqual(listed, ['/p', '/q']);
});

test('ProjectFiles returns nothing when listing fails', async () => {
  const files = new ProjectFiles(async () => {
    throw new Error('no access');
  });
  assert.deepEqual(await files.search('/p', 'app'), []);
});
