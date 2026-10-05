import assert from 'node:assert/strict';
import { test } from 'node:test';
import projectModule from '../../../dist/main/window/agent-project.js';

const { AgentProject } = projectModule;

function fixture(t) {
  const updates = [];
  const project = new AgentProject({
    connect: async () => ({ url: 'http://127.0.0.1:47823/mcp', token: 'secret' }),
    onState: () => {},
    onOutput: () => {},
    onChatUpdate: (_project, snapshot) => updates.push(snapshot),
    onUrl: () => {},
  });
  t.after(() => project.dispose());
  return { project, updates };
}

test('each tab keeps its own conversation and switching back restores it', (t) => {
  const { project } = fixture(t);
  assert.equal(project.focusTab('tab-1'), true);
  const first = project.chat;
  const firstId = project.conversationId;
  assert.equal(project.focusTab('tab-1'), false);
  assert.equal(project.focusTab('tab-2'), true);
  assert.notEqual(project.chat, first);
  assert.notEqual(project.conversationId, firstId);
  project.focusTab('tab-1');
  assert.equal(project.chat, first);
  assert.equal(project.conversationId, firstId);
});

test('the provider is chosen per tab', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  assert.equal(project.selectProvider('codex'), true);
  assert.equal(project.providerId, 'codex');
  project.focusTab('tab-2');
  assert.equal(project.providerId, 'claude');
});

test('a tab the agent opens shares the conversation it was opened from', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const chat = project.chat;
  project.shareConversation('tab-2');
  assert.equal(project.focusTab('tab-2'), false);
  assert.equal(project.chat, chat);
});

test('closing a tab disposes its conversation unless another tab still shares it', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const shared = project.chat;
  project.shareConversation('tab-2');
  project.focusTab('tab-3');
  const own = project.chat;
  let disposed = [];
  for (const chat of [shared, own]) {
    const dispose = chat.dispose.bind(chat);
    chat.dispose = () => {
      disposed.push(chat);
      dispose();
    };
  }
  project.retainTabs(new Set(['tab-2']));
  assert.deepEqual(disposed, [own]);
  project.focusTab('tab-2');
  assert.equal(project.chat, shared);
  disposed = [];
  project.retainTabs(new Set());
  assert.deepEqual(disposed, [shared]);
});

test('only the shown conversation streams to the panel', (t) => {
  const { project, updates } = fixture(t);
  project.focusTab('tab-1');
  const background = project.chat;
  project.focusTab('tab-2');
  void project.chat;
  updates.length = 0;
  background.reset(background.state().id);
  assert.equal(updates.length, 0);
  project.chat.reset(project.chat.state().id);
  assert.ok(updates.length > 0);
});

let chats = 0;
function working(chat, status = 'thinking') {
  const state = chat.state();
  const id = state.id ?? `chat-${++chats}`;
  chat.state = () => ({ ...state, id, status });
  return id;
}

test('a new chat sets a working one aside, and it keeps streaming only once shown again', (t) => {
  const { project, updates } = fixture(t);
  project.focusTab('tab-1');
  const first = project.chat;
  assert.equal(project.setAsideChat(), false);
  const id = working(first);
  const view = project.conversationId;
  assert.equal(project.setAsideChat(), true);
  assert.notEqual(project.chat, first);
  assert.notEqual(project.conversationId, view);
  assert.deepEqual(
    project.backgroundChats().map((chat) => [chat.id, chat.status]),
    [[id, 'thinking']],
  );
  updates.length = 0;
  first.reset(first.state().id);
  assert.equal(updates.length, 0);
  assert.equal(project.showBackgroundChat(id), true);
  assert.equal(project.chat, first);
  assert.deepEqual(project.backgroundChats(), []);
});

test('only finished background chats can be dismissed', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const chat = project.chat;
  const id = working(chat);
  project.setAsideChat();
  assert.equal(project.dismissBackgroundChat(id), false);
  working(chat, 'ready');
  assert.equal(project.dismissBackgroundChat(id), true);
  assert.deepEqual(project.backgroundChats(), []);
});

test('a background chat moves into a new tab of its own', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const chat = project.chat;
  const id = working(chat);
  project.setAsideChat();
  assert.equal(project.moveBackgroundChat(id, 'tab-1'), false);
  assert.equal(project.moveBackgroundChat(id, 'tab-2'), true);
  assert.deepEqual(project.backgroundChats(), []);
  project.focusTab('tab-2');
  assert.equal(project.chat, chat);
});

function withMessages(chat) {
  const snapshot = chat.snapshot();
  chat.snapshot = () => ({ ...snapshot, messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }] });
}

test('finished chats with messages are kept, and a full list makes room by dropping the oldest finished one', (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const kept = [];
  for (let index = 0; index < 5; index++) {
    const chat = project.chat;
    withMessages(chat);
    kept.push(working(chat, index === 0 ? 'thinking' : 'ready'));
    assert.equal(project.setAsideChat(), true);
  }
  const sixth = project.chat;
  withMessages(sixth);
  working(sixth, 'ready');
  assert.equal(project.setAsideChat(), true);
  const ids = project.backgroundChats().map((chat) => chat.id);
  assert.equal(ids.length, 5);
  assert.ok(ids.includes(kept[0]), 'the working chat stays');
  assert.ok(!ids.includes(kept[1]), 'the oldest finished chat makes room');
});

test('a chat can start in a tab before that tab is shown', async (t) => {
  const { project } = fixture(t);
  project.focusTab('tab-1');
  const shown = project.chat;
  assert.equal(await project.startChat('tab-1', 'Hello'), false);
  const started = project.startChat('tab-2', 'Continue here');
  assert.equal(project.chat, shown);
  await started.catch(() => false);
  project.focusTab('tab-2');
  assert.notEqual(project.chat, shown);
  assert.notEqual(project.chat.state().status, 'idle');
});
