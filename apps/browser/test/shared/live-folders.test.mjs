import assert from 'node:assert/strict';
import { test } from 'node:test';
import live from '../../dist/shared/live-folders.js';

const { parseFeed, liveFolderSource, feedSourceUrl } = live;
const BASE = 'https://example.com/feed.xml';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>Example &amp; News</title>
  <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
  <link>https://example.com/</link>
  <item>
    <title><![CDATA[First <b>post</b>]]></title>
    <link>https://example.com/first</link>
    <guid isPermaLink="false">post-1</guid>
  </item>
  <item>
    <title>Second &#8211; &lt;i&gt;post&lt;/i&gt;</title>
    <link>/second</link>
  </item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from yalqen</title>
  <link rel="self" href="https://github.com/o/r/releases.atom"/>
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.2.0</id>
    <link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/v1.2.0"/>
    <title>v1.2.0</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v1.1.0</id>
    <link href='https://github.com/o/r/releases/tag/v1.1.0'/>
    <title type="html">v1.1.0 &amp; fixes</title>
  </entry>
</feed>`;

test('parses RSS items, CDATA, entities and relative links', () => {
  const feed = parseFeed(RSS, BASE);
  assert.equal(feed.title, 'Example & News');
  assert.deepEqual(feed.items, [
    { id: 'post-1', title: 'First post', url: 'https://example.com/first' },
    { id: 'https://example.com/second', title: 'Second – post', url: 'https://example.com/second' },
  ]);
});

test('parses Atom entries and ignores self links', () => {
  const feed = parseFeed(ATOM, 'https://github.com/o/r/releases.atom');
  assert.equal(feed.title, 'Release notes from yalqen');
  assert.deepEqual(
    feed.items.map((item) => [item.title, item.url]),
    [
      ['v1.2.0', 'https://github.com/o/r/releases/tag/v1.2.0'],
      ['v1.1.0 & fixes', 'https://github.com/o/r/releases/tag/v1.1.0'],
    ],
  );
});

test('rejects text that is not a feed and survives malformed input', () => {
  assert.equal(parseFeed('<html><body><item><link>https://a.example/</link></item></body></html>', BASE), null);
  assert.equal(parseFeed('', BASE), null);
  assert.deepEqual(parseFeed('<rss><channel><title>Cut off', BASE), { title: '', items: [] });
  assert.deepEqual(parseFeed('<feed><entry><title>No close', BASE).items, []);
  const broken = parseFeed('<rss><item><title>a</title><link>https://a.example/x</link></item><item><title>b', BASE);
  assert.deepEqual(
    broken.items.map((item) => item.url),
    ['https://a.example/x'],
  );
});

test('drops items whose link is not a plain http or https address', () => {
  const links = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'https://user:secret@example.com/',
    '&#106;avascript:alert(1)',
  ];
  const items = links.map((link) => `<item><title>x</title><link>${link}</link></item>`).join('');
  assert.deepEqual(
    parseFeed(`<rss><channel>${items}<item><link>https://ok.example/</link></item></channel></rss>`, BASE).items,
    [{ id: 'https://ok.example/', title: 'https://ok.example/', url: 'https://ok.example/' }],
  );
  assert.deepEqual(
    parseFeed(`<feed><entry><link href="javascript:alert(1)"/><title>x</title></entry></feed>`, BASE).items,
    [],
  );
});

test('never keeps markup, ignores bad numeric entities and caps the item count', () => {
  const feed = parseFeed(
    `<rss><item><title>a&#x110000;b&#xD800;c &lt;script&gt;alert(1)&lt;/script&gt;</title><link>https://a.example/</link></item></rss>`,
    BASE,
  );
  assert.equal(feed.items[0].title, 'abc alert(1)');
  const many = Array.from({ length: 100 }, (_, i) => `<item><link>https://a.example/${i}</link></item>`).join('');
  assert.equal(parseFeed(`<rss>${many}</rss>`, BASE).items.length, 30);
});

test('maps GitHub shortcuts to Atom feeds and only accepts https feed addresses', () => {
  assert.deepEqual(liveFolderSource('releases', 'o/r'), {
    url: 'https://github.com/o/r/releases.atom',
    name: 'o/r',
  });
  assert.equal(liveFolderSource('tags', ' https://github.com/o/r/ ').url, 'https://github.com/o/r/tags.atom');
  assert.equal(liveFolderSource('commits', 'o/r').url, 'https://github.com/o/r/commits.atom');
  for (const input of [
    'o',
    'o/r/extra',
    '../r',
    'o/..',
    'o/r?x=1',
    'http://github.com/o/r',
    'https://evil.example/o/r',
    7,
  ])
    assert.equal(liveFolderSource('releases', input), null, String(input));
  assert.deepEqual(liveFolderSource('feed', 'https://example.com/a.xml'), {
    url: 'https://example.com/a.xml',
    name: '',
  });
  for (const input of [
    'http://example.com/a.xml',
    'javascript:alert(1)',
    'example.com/a.xml',
    'https://u:p@example.com/',
  ])
    assert.equal(liveFolderSource('feed', input), null, input);
  assert.equal(feedSourceUrl('ftp://example.com/'), null);
});
