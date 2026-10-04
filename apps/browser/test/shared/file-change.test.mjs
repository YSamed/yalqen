import assert from 'node:assert/strict';
import { test } from 'node:test';
import fileChangeModule from '../../dist/shared/file-change.js';

const { fileChange, lineDiff, relativePath } = fileChangeModule;

test('lineDiff keeps shared lines and marks only what changed', () => {
  assert.deepEqual(lineDiff('a\nb\nc\n', 'a\nB\nc\nd'), [
    { kind: 'same', text: 'a' },
    { kind: 'remove', text: 'b' },
    { kind: 'add', text: 'B' },
    { kind: 'same', text: 'c' },
    { kind: 'add', text: 'd' },
  ]);
  assert.deepEqual(lineDiff('', ''), []);
});

test('lineDiff falls back to remove-then-add for very large inputs', () => {
  const before = Array.from({ length: 500 }, (_, index) => `old ${index}`).join('\n');
  const after = Array.from({ length: 500 }, (_, index) => `new ${index}`).join('\n');
  const lines = lineDiff(before, after);
  assert.equal(lines.length, 1000);
  assert.equal(lines[0].kind, 'remove');
  assert.equal(lines[999].kind, 'add');
});

test('fileChange reads Edit, MultiEdit and Write inputs', () => {
  const edit = fileChange('Edit', JSON.stringify({ file_path: '/p/a.ts', old_string: 'x = 1', new_string: 'x = 2' }));
  assert.equal(edit.path, '/p/a.ts');
  assert.equal(edit.added, 1);
  assert.equal(edit.removed, 1);
  const multi = fileChange(
    'MultiEdit',
    JSON.stringify({
      file_path: '/p/b.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'c\nd' },
      ],
    }),
  );
  assert.deepEqual(
    multi.lines.map((line) => line.kind),
    ['remove', 'add', 'same', 'same', 'add'],
  );
  const write = fileChange('Write', JSON.stringify({ file_path: '/p/c.ts', content: 'one\ntwo\n' }));
  assert.equal(write.added, 2);
  assert.equal(write.removed, 0);
});

test('fileChange ignores other tools, partial JSON and missing fields', () => {
  assert.equal(fileChange('Read', JSON.stringify({ file_path: '/p/a.ts' })), null);
  assert.equal(fileChange('Edit', '{"file_path": "/p/a.ts", "old_str'), null);
  assert.equal(fileChange('Edit', JSON.stringify({ file_path: '/p/a.ts' })), null);
  assert.equal(fileChange('Write', 'null'), null);
});

test('fileChange caps the lines it returns', () => {
  const content = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join('\n');
  const write = fileChange('Write', JSON.stringify({ file_path: '/p/big.ts', content }));
  assert.equal(write.lines.length, 400);
  assert.equal(write.added, 1000);
  assert.equal(write.truncated, true);
});

test('relativePath shortens paths inside the project only', () => {
  assert.equal(relativePath('/p/src/a.ts', '/p'), 'src/a.ts');
  assert.equal(relativePath('/p/src/a.ts', '/p/'), 'src/a.ts');
  assert.equal(relativePath('/pp/a.ts', '/p'), '/pp/a.ts');
  assert.equal(relativePath('/p/a.ts', null), '/p/a.ts');
});
