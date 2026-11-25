import assert from 'node:assert/strict';
import agentPanel from '../../dist/shared/agent-panel.js';
import { browserState, finish, openInterface, tab } from '../helpers/interface-harness.mjs';

const { EMPTY_AGENT_CHAT, EMPTY_AGENT_SESSION } = agentPanel;
const chatState = {
  ...EMPTY_AGENT_CHAT,
  id: 'chat',
  directory: '/work/site',
  status: 'ready',
  model: 'claude-opus-5-5',
  commands: [{ name: 'review', description: 'Review the diff', argumentHint: '' }],
};
const message = (id, text) => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  context: null,
  elements: [],
  episode: null,
  images: [],
  reverted: false,
  workMode: 'normal',
});
const snapshot = {
  state: chatState,
  revision: 1,
  messages: [message('m1', 'Hello')],
  queue: [message('q1', 'Then the footer')],
  permissions: [
    {
      id: 'perm',
      tool: 'AskUserQuestion',
      title: 'Question',
      input: '{}',
      plan: null,
      canAlwaysAllow: false,
      questions: [
        {
          question: 'Which pages?',
          multiSelect: true,
          options: [
            { label: 'Home', description: 'Landing page' },
            { label: 'Docs', description: 'Guides' },
          ],
        },
      ],
    },
  ],
};

finish(
  (async () => {
    const ui = await openInterface('agent-composer', {
      state: browserState([tab('a'), tab('b')], {
        profile: 'developer',
        agentPanelOpen: true,
        agentProjectId: 'p',
        agentConversationId: 'c',
        agentSession: { ...EMPTY_AGENT_SESSION, directory: '/work/site' },
        agentChat: chatState,
      }),
      invoke: {
        agentDraft: () => ({ text: '', attachments: [], images: [] }),
        agentChatSnapshot: () => snapshot,
        agentChatSend: () => true,
        agentChatPermission: () => undefined,
        agentChatCancelQueued: () => undefined,
        agentChatFiles: () => ['src/app.ts', 'src/header.ts'],
      },
    });
    const sent = () => ui.calls.filter((call) => call.channel === 'agentChatSend').map((call) => call.args);
    const value = () => ui.run("document.querySelector('.composer-box textarea').value");

    await ui.click('.composer-box textarea');
    await ui.type('Fix the header');
    await ui.key('Return', ['shift']);
    await ui.type('and the footer');
    assert.equal(await value(), 'Fix the header\nand the footer');
    assert.deepEqual(sent(), [], 'Shift+Enter adds a line instead of sending');
    await ui.key('Return');
    await ui.eventually(`document.querySelector('.composer-box textarea').value === ''`);
    assert.deepEqual(sent(), [['chat', 'Fix the header\nand the footer', [], []]]);
    const drafts = ui.calls.filter((call) => call.channel === 'agentDraftUpdate' && 'text' in call.args[2]);
    assert.deepEqual(drafts.at(-1).args, ['p', 'c', { text: '' }], 'the stored draft is cleared too');
    console.log('PASS: Enter sends the draft and clears it; Shift+Enter keeps writing');

    await ui.type('/re');
    await ui.eventually("document.querySelector('.suggestions [role=option]')?.textContent.includes('/review')");
    await ui.key('Return');
    assert.equal(await value(), '/review ');
    assert.equal(sent().length, 1, 'Enter picks the suggestion instead of sending');
    await ui.run("document.querySelector('.composer-box textarea').select()");
    await ui.key('Backspace');
    console.log('PASS: a slash command suggestion completes with Enter');

    for (const part of ['see @', 'h', 'e', 'a']) await ui.type(part);
    await ui.eventually("document.querySelectorAll('.suggestions [role=option]').length === 2");
    assert.deepEqual(
      ui.calls.filter((call) => call.channel === 'agentChatFiles').map((call) => call.args[0]),
      ['hea'],
    );
    await ui.key('Down');
    await ui.key('Tab');
    assert.equal(await value(), 'see @src/header.ts ');
    console.log('PASS: an @ mention searches project files once typing pauses and inserts the chosen file');

    await ui.click('.queue button');
    assert.deepEqual(ui.calls.find((call) => call.channel === 'agentChatCancelQueued')?.args, ['chat', 'q1']);
    console.log('PASS: a queued prompt is cancelled by id');

    const answer = () => ui.run("[...document.querySelectorAll('.approval-actions button')].at(-1).disabled");
    assert.equal(await answer(), true, 'Answer waits for a choice');
    await ui.click('.answer-option input');
    await ui.run(
      "[...document.querySelectorAll('.answer-option')].at(-1).querySelector('input').scrollIntoView({ block: 'center' })",
    );
    await ui.click('.answer-option:last-of-type input');
    assert.equal(await answer(), false);
    await ui.click('.approval-actions button:last-child');
    assert.deepEqual(ui.calls.find((call) => call.channel === 'agentChatPermission')?.args, [
      'chat',
      'perm',
      true,
      { 'Which pages?': 'Home, Docs' },
      false,
    ]);
    console.log('PASS: a multi-choice question answers with every picked option');
  })(),
);
