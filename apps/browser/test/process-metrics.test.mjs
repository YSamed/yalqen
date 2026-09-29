import assert from 'node:assert/strict';
import { test } from 'node:test';
import processMetrics from '../dist/main/process-metrics.js';

const { contentsKind, summarizeProcesses } = processMetrics;

const MB = 1024;

test('web contents are grouped by what they show', () => {
  assert.equal(contentsKind('file:///app/dist/renderer/index.html'), 'interface');
  assert.equal(contentsKind('chrome-extension://abc/popup.html'), 'extensions');
  assert.equal(contentsKind('devtools://devtools/bundled/inspector.html'), 'other');
  assert.equal(contentsKind('https://example.com/'), 'pages');
  assert.equal(contentsKind('yalqen://newtab/'), 'pages');
});

test('processes are totalled per group in a fixed order', () => {
  const usage = summarizeProcesses(
    [
      { pid: 1, type: 'Browser', workingSetKB: 200 * MB },
      { pid: 2, type: 'GPU', workingSetKB: 100 * MB },
      { pid: 3, type: 'Utility', workingSetKB: 30 * MB },
      { pid: 4, type: 'Tab', workingSetKB: 60 * MB },
      { pid: 5, type: 'Tab', workingSetKB: 150 * MB },
      { pid: 6, type: 'Tab', workingSetKB: 40 * MB },
      { pid: 7, type: 'Zygote', workingSetKB: 5 * MB },
    ],
    [
      { pid: 4, url: 'file:///app/index.html', title: 'Yalqen' },
      { pid: 5, url: 'https://example.com/', title: 'Example' },
    ],
  );
  assert.equal(usage.totalMB, 585);
  assert.deepEqual(usage.groups, [
    { kind: 'pages', count: 2, memoryMB: 190 },
    { kind: 'interface', count: 1, memoryMB: 60 },
    { kind: 'browser', count: 1, memoryMB: 200 },
    { kind: 'gpu', count: 1, memoryMB: 100 },
    { kind: 'utility', count: 1, memoryMB: 30 },
    { kind: 'other', count: 1, memoryMB: 5 },
  ]);
});

test('tabs sharing a renderer are listed together, largest first', () => {
  const usage = summarizeProcesses(
    [
      { pid: 10, type: 'Tab', workingSetKB: 80 * MB },
      { pid: 11, type: 'Tab', workingSetKB: 300 * MB },
      { pid: 12, type: 'Tab', workingSetKB: 120 * MB },
    ],
    [
      { pid: 10, url: 'https://a.example/', title: 'A' },
      { pid: 11, url: 'https://b.example/', title: '' },
      { pid: 11, url: 'https://b.example/two', title: 'B two' },
      { pid: 12, url: 'https://c.example/', title: 'C' },
      { pid: 99, url: 'https://gone.example/', title: 'Gone' },
    ],
    2,
  );
  assert.deepEqual(usage.pages, [
    { pid: 11, titles: ['https://b.example/', 'B two'], memoryMB: 300 },
    { pid: 12, titles: ['C'], memoryMB: 120 },
  ]);
});

test('a renderer hosting a page counts as a page even if it also hosts the interface', () => {
  const usage = summarizeProcesses(
    [{ pid: 20, type: 'Tab', workingSetKB: 50 * MB }],
    [
      { pid: 20, url: 'https://example.com/', title: 'Example' },
      { pid: 20, url: 'file:///app/command.html', title: 'Ara' },
    ],
  );
  assert.deepEqual(usage.groups, [{ kind: 'pages', count: 1, memoryMB: 50 }]);
});
