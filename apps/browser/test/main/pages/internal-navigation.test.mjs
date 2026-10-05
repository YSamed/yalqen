import assert from 'node:assert/strict';
import { test } from 'node:test';
import navigation from '../../../dist/main/pages/internal-navigation.js';

const { internalNavigation, isAllowedFrom } = navigation;

test('web and plain internal addresses are left to load', () => {
  assert.equal(internalNavigation('https://example.com/'), null);
  assert.equal(internalNavigation('yalqen://history/?q=x'), null);
  assert.equal(internalNavigation('yalqen://bookmarks/'), null);
  assert.equal(internalNavigation('yalqen://newtab/'), null);
});

test('command addresses are recognised with their arguments', () => {
  assert.deepEqual(internalNavigation('yalqen://proceed-http/abc'), { type: 'proceed-http', token: 'abc' });
  assert.deepEqual(internalNavigation('yalqen://proceed/abc'), { type: 'proceed-certificate', token: 'abc' });
  assert.deepEqual(internalNavigation('yalqen://history/delete?id=7'), { type: 'history-delete', id: '7' });
  assert.deepEqual(internalNavigation('yalqen://history/clear'), { type: 'history-clear' });
  assert.deepEqual(internalNavigation('yalqen://newtab/search?q=%C3%A7ay'), { type: 'new-tab-search', query: 'çay' });
  assert.deepEqual(internalNavigation('yalqen://newtab/search'), { type: 'new-tab-search', query: '' });
  assert.equal(internalNavigation('yalqen://newtab/forget?url=https%3A%2F%2Fa.com%2F'), null);
  assert.deepEqual(internalNavigation('yalqen://newtab/repo?action=star'), { type: 'new-tab-repo', action: 'star' });
  assert.equal(internalNavigation('yalqen://newtab/repo?action=bogus'), null);
  assert.deepEqual(internalNavigation('yalqen://newtab/announcement?action=try'), {
    type: 'new-tab-announcement',
    action: 'try',
  });
  assert.deepEqual(internalNavigation('yalqen://newtab/feedback?action=open'), {
    type: 'new-tab-feedback',
    action: 'open',
  });
  assert.equal(internalNavigation('yalqen://newtab/feedback?action=bogus'), null);
  assert.equal(internalNavigation('yalqen://newtab/announcement?action=bogus'), null);
  const command = internalNavigation('yalqen://bookmarks/rename?id=1&title=A');
  assert.equal(command.type, 'page-command');
  assert.equal(command.page, 'bookmarks');
  assert.equal(command.name, 'rename');
  assert.equal(command.params.get('title'), 'A');
});

test('commands only run from the page that offers them', () => {
  const remove = internalNavigation('yalqen://bookmarks/remove?id=1');
  assert.equal(isAllowedFrom(remove, 'yalqen://bookmarks/'), true);
  assert.equal(isAllowedFrom(remove, 'yalqen://downloads/'), false);
  assert.equal(isAllowedFrom(remove, 'https://evil.example/'), false);
  const clear = internalNavigation('yalqen://history/clear');
  assert.equal(isAllowedFrom(clear, 'yalqen://history/confirm-clear'), true);
  assert.equal(isAllowedFrom(clear, 'https://evil.example/'), false);
  const search = internalNavigation('yalqen://newtab/search?q=x');
  assert.equal(isAllowedFrom(search, 'yalqen://newtab/'), true);
  assert.equal(isAllowedFrom(search, 'yalqen://history/'), false);
  assert.equal(isAllowedFrom(internalNavigation('yalqen://proceed/t'), 'https://expired.example/'), true);
});
