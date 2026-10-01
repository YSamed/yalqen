import assert from 'node:assert/strict';
import { test } from 'node:test';
import suggestions from '../dist/main/suggestions.js';

const { MAX_SUGGESTIONS, indexHistory, suggest: suggestFrom } = suggestions;

const suggest = (input, { history, ...rest }) => suggestFrom(input, { ...rest, history: indexHistory(history) });

const sources = {
  tabs: [{ id: 't1', title: 'GitHub', url: 'https://github.com/' }],
  bookmarks: [
    { title: 'GitHub', url: 'https://github.com/' },
    { title: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/' },
  ],
  history: [
    { title: 'Hacker News', url: 'https://news.ycombinator.com/', visitedAt: 30 },
    { title: 'GitLab', url: 'https://gitlab.com/', visitedAt: 20 },
    { title: 'Hacker News', url: 'https://news.ycombinator.com/', visitedAt: 10 },
    { title: 'Git kitabı', url: 'https://git-scm.com/book/tr', visitedAt: 5 },
    { title: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/', visitedAt: 1 },
  ],
};

test('suggestions carry the latest favicon seen for their host', () => {
  const list = suggest('git', {
    ...sources,
    history: [
      {
        title: 'GitHub repo',
        url: 'https://github.com/org/repo',
        visitedAt: 40,
        faviconUrl: 'https://github.com/new.ico',
      },
      { title: 'GitHub', url: 'https://github.com/', visitedAt: 35, faviconUrl: 'https://github.com/old.ico' },
      ...sources.history,
    ],
  });
  assert.equal(list.find((item) => item.url === 'https://github.com/').faviconUrl, 'https://github.com/new.ico');
  assert.equal(list.find((item) => item.url === 'https://gitlab.com/').faviconUrl, undefined);
});

test('nothing is suggested for empty input', () => {
  assert.deepEqual(suggest('  ', sources), []);
});

test('open tabs come first and each address appears once', () => {
  const list = suggest('git', sources);
  assert.deepEqual(
    list.map((item) => [item.kind, item.url]),
    [
      ['tab', 'https://github.com/'],
      ['history', 'https://gitlab.com/'],
      ['history', 'https://git-scm.com/book/tr'],
    ],
  );
  assert.equal(list[0].tabId, 't1');
});

test('addresses match without scheme or www, titles match by word', () => {
  assert.deepEqual(
    suggest('resmi', sources).map((item) => item.kind),
    ['bookmark'],
  );
  assert.deepEqual(
    suggest('news', sources).map((item) => item.title),
    ['Hacker News'],
  );
  assert.deepEqual(
    suggest('KİTAB', sources).map((item) => item.title),
    ['Git kitabı'],
  );
});

test('frequently visited pages rank higher among equal matches', () => {
  const list = suggest('h', {
    tabs: [],
    bookmarks: [],
    history: [
      { title: 'Once', url: 'https://h1.com/', visitedAt: 100 },
      { title: 'Often', url: 'https://h2.com/', visitedAt: 50 },
      { title: 'Often', url: 'https://h2.com/', visitedAt: 40 },
    ],
  });
  assert.deepEqual(
    list.map((item) => item.title),
    ['Often', 'Once'],
  );
});

test('the list is limited', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    title: `Sayfa ${i}`,
    url: `https://a.com/${i}`,
    visitedAt: i,
  }));
  assert.equal(suggest('a.com', { tabs: [], bookmarks: [], history }).length, MAX_SUGGESTIONS);
});

test('rebuilding an index reuses visits while reflecting title, address, and icon changes', () => {
  const visit = { title: 'İlk', url: 'https://old.example/', visitedAt: 20 };
  const older = { title: 'Older', url: visit.url, visitedAt: 10 };
  assert.equal(indexHistory([visit, older]).pages[0].visits, 2);
  visit.title = 'Yeni Başlık';
  visit.url = 'https://new.example/';
  visit.faviconUrl = 'https://new.example/new.ico';
  const history = indexHistory([visit, older]);
  assert.equal(history.pages.length, 2);
  assert.equal(history.pages[0].name, 'yeni başlık');
  assert.equal(history.pages[0].address, 'new.example/');
  assert.equal(history.pages[0].visits, 1);
  assert.equal(history.favicons.get('new.example'), visit.faviconUrl);
  visit.faviconUrl = 'https://new.example/latest.ico';
  assert.equal(indexHistory([visit]).favicons.get('new.example'), visit.faviconUrl);
});

test('suggestion text follows tab and bookmark title and address changes', () => {
  const tab = { id: 'tab', title: 'İstanbul', url: 'https://old.example/' };
  const bookmark = { title: 'Isparta', url: 'https://saved.example/' };
  const sources = { tabs: [tab], bookmarks: [bookmark], history: indexHistory([]) };
  assert.equal(suggestFrom('İSTANBUL', sources)[0].tabId, 'tab');
  assert.equal(suggestFrom('ISPARTA', sources)[0].kind, 'bookmark');
  tab.title = 'İzmir';
  tab.url = 'https://new.example/';
  bookmark.title = 'Ankara';
  bookmark.url = 'https://next.example/';
  assert.deepEqual(suggestFrom('istanbul', sources), []);
  assert.deepEqual(suggestFrom('ısparta', sources), []);
  assert.deepEqual(suggestFrom('old.example', sources), []);
  assert.deepEqual(suggestFrom('saved.example', sources), []);
  assert.equal(suggestFrom('İZMİR', sources)[0].url, tab.url);
  assert.equal(suggestFrom('next.example', sources)[0].title, 'Ankara');
});

test('bounded ranking matches the full ordering across sources, frequencies, and ties', () => {
  const history = indexHistory(
    Array.from({ length: 1000 }, (_, index) => ({
      title: `Match ${index % 137}`,
      url: `https://site${index % 137}.example/`,
      visitedAt: 2000 - index,
    })),
  );
  const tabs = [
    { id: 'tab-a', title: 'Match tab', url: 'https://site70.example/' },
    { id: 'tab-b', title: 'Match tab', url: 'https://site80.example/' },
    { id: 'duplicate', title: 'Match duplicate', url: 'https://site70.example/' },
  ];
  const bookmarks = [
    { title: 'Match duplicate', url: tabs[0].url },
    { title: 'Match bookmark', url: 'https://site120.example/' },
  ];
  const kinds = { tab: 0, bookmark: 1, history: 2 };
  const expected = history.pages
    .map((page) => {
      const tab = tabs.find(({ url }) => url === page.url);
      const bookmark = bookmarks.find(({ url }) => url === page.url);
      return {
        kind: tab ? 'tab' : bookmark ? 'bookmark' : 'history',
        title: tab?.title ?? bookmark?.title ?? page.title,
        url: page.url,
        ...(tab && { tabId: tab.id }),
        visits: page.visits,
        lastVisit: page.lastVisit,
      };
    })
    .sort((a, b) => kinds[a.kind] - kinds[b.kind] || b.visits - a.visits || b.lastVisit - a.lastVisit)
    .map(({ visits: _visits, lastVisit: _lastVisit, ...item }) => item);
  for (const limit of [0, 1, 6, 20, 200]) {
    assert.deepEqual(suggestFrom('match', { tabs, bookmarks, history }, limit), expected.slice(0, limit));
  }
});

test('match quality ranks ahead of source priority and equal history ties stay stable', () => {
  const history = indexHistory([
    { title: 'Other', url: 'https://match.example/', visitedAt: 1 },
    { title: 'Match first', url: 'https://first.example/', visitedAt: 1 },
    { title: 'Match second', url: 'https://second.example/', visitedAt: 1 },
  ]);
  const tabs = [{ id: 'tab', title: 'A match inside', url: 'https://tab.example/' }];
  const list = suggestFrom('match', { tabs, bookmarks: [], history }, 3);
  assert.deepEqual(
    list.map(({ url }) => url),
    ['https://match.example/', tabs[0].url, 'https://first.example/'],
  );
});
