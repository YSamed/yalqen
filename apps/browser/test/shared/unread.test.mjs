import assert from 'node:assert/strict';
import { test } from 'node:test';
import unread from '../../dist/shared/unread.js';

const { unreadCount } = unread;
const INBOX = 'https://mail.google.com/mail/u/0/#inbox';
const CONVERSATION = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQjgqNpSrLPXvXsSKRMWdBtxvrW';

test('gmail folders read the unread count from the title', () => {
  assert.equal(unreadCount(INBOX, 'Inbox (3) - someone@gmail.com - Gmail', null), 3);
  assert.equal(unreadCount(INBOX, 'Inbox (1,234) - someone@gmail.com - Gmail', null), 1234);
  assert.equal(unreadCount(INBOX, 'Boîte de réception (12) - someone@gmail.com - Gmail', null), 12);
  assert.equal(unreadCount(INBOX, 'Gelen Kutusu (1.024) - someone@gmail.com - Gmail', null), 1024);
  assert.equal(unreadCount(INBOX, 'Posteingang (2 048) - someone@gmail.com - Gmail', null), 2048);
});

test('a gmail folder without a count has nothing unread', () => {
  assert.equal(unreadCount(INBOX, 'Inbox - someone@gmail.com - Gmail', 5), 0);
  assert.equal(unreadCount('https://mail.google.com/mail/u/1/#sent', 'Sent Mail - other@gmail.com - Gmail', 5), 0);
});

test('an open gmail conversation keeps the last folder count, whatever its subject says', () => {
  assert.equal(unreadCount(CONVERSATION, 'Lunch on Friday? - someone@gmail.com - Gmail', 3), 3);
  assert.equal(unreadCount(CONVERSATION, 'Invoice (2) - someone@gmail.com - Gmail', 3), 3);
  assert.equal(unreadCount(CONVERSATION, 'Lunch on Friday? - someone@gmail.com - Gmail', null), 0);
});

test('a number in the account or app part of the title is not a count', () => {
  assert.equal(unreadCount(INBOX, 'Inbox - team (2)@example.com - Gmail', null), 0);
});

test('chat and social sites read the count in front of the title', () => {
  const cases = [
    ['https://web.whatsapp.com/', '(3) WhatsApp', 3],
    ['https://www.messenger.com/t/123', '(2) Messenger', 2],
    ['https://www.facebook.com/', '(14) Facebook', 14],
    ['https://www.instagram.com/direct/inbox/', '(1) Instagram', 1],
    ['https://www.linkedin.com/feed/', '(12) Feed | LinkedIn', 12],
    ['https://x.com/home', '(5) Home / X', 5],
    ['https://twitter.com/home', '(99+) Home / X', 99],
    ['https://discord.com/channels/@me', '(1,204) Discord | Friends', 1204],
    ['https://mail.proton.me/u/0/inbox', '(7) Inbox | someone@proton.me | Proton Mail', 7],
  ];
  for (const [url, title, count] of cases) assert.equal(unreadCount(url, title, null), count, title);
});

test('a supported site with no count in front has nothing unread', () => {
  assert.equal(unreadCount('https://web.whatsapp.com/', 'WhatsApp', 3), 0);
  assert.equal(unreadCount('https://www.linkedin.com/feed/', 'Feed (beta) | LinkedIn', null), 0);
  assert.equal(unreadCount('https://x.com/someone', 'Someone (@someone) / X', null), 0);
});

test('other sites and look-alike hosts have no unread count', () => {
  assert.equal(unreadCount('https://shop.example/', '(2) Coffee mugs', null), null);
  assert.equal(unreadCount('https://notwhatsapp.com/', '(3) WhatsApp', null), null);
  assert.equal(unreadCount('https://web.whatsapp.com.evil.example/', '(3) WhatsApp', null), null);
  assert.equal(unreadCount('https://mail.google.com.evil.example/mail/', 'Inbox (3) - Gmail', null), null);
  assert.equal(unreadCount('http://mail.google.com/mail/u/0/', 'Inbox (3) - Gmail', null), null);
  assert.equal(unreadCount('https://mail.google.com/chat/u/0/', 'Chat (3) - Gmail', null), 0);
  assert.equal(unreadCount('not a url', 'Inbox (3)', null), null);
});
