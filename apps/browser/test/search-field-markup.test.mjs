import assert from 'node:assert/strict';
import { test } from 'node:test';
import searchFieldModule from '../dist/main/pages/search-field-markup.js';

const { searchFieldMarkup } = searchFieldModule;

const base = { action: 'yalqen://history/', label: 'Geçmişte ara', valueHtml: '' };

test('the form uses the given action, GET and the search role', () => {
  const html = searchFieldMarkup(base);
  assert.match(html, /^<form [^>]*action="yalqen:\/\/history\/"/);
  assert.ok(html.includes('method="get"'));
  assert.ok(html.includes('role="search"'));
});

test('the label is both the placeholder and the aria-label', () => {
  const html = searchFieldMarkup(base);
  assert.ok(html.includes('placeholder="Geçmişte ara"'));
  assert.ok(html.includes('aria-label="Geçmişte ara"'));
});

test('valueHtml goes into the value attribute as given, unescaped', () => {
  assert.ok(searchFieldMarkup({ ...base, valueHtml: 'kedi' }).includes('value="kedi"'));
  assert.ok(searchFieldMarkup({ ...base, valueHtml: '&amp;' }).includes('value="&amp;"'));
  assert.ok(searchFieldMarkup({ ...base, valueHtml: '"><b>' }).includes('value=""><b>"'));
});

test('autofocus is added only when requested', () => {
  assert.ok(!searchFieldMarkup(base).includes('autofocus'));
  assert.ok(!searchFieldMarkup({ ...base, autofocus: false }).includes('autofocus'));
  assert.ok(searchFieldMarkup({ ...base, autofocus: true }).includes(' autofocus />'));
});
