<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../shared/i18n';
  import { EMPTY_AGENT_CHAT } from '../../shared/agent-panel';
  import type { AgentChatPermission, AgentChatSnapshot, TabSnapshot } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import AgentMarkdown from './AgentMarkdown.svelte';

  let {
    open,
    directory,
    activeTab,
    onchoose,
  }: { open: boolean; directory: string | null; activeTab: TabSnapshot | null; onchoose(): void } = $props();
  let snapshot: AgentChatSnapshot = $state.raw({
    state: { ...EMPTY_AGENT_CHAT },
    revision: -1,
    messages: [],
    permissions: [],
  });
  let draft = $state('');
  let attachment: TabSnapshot | null = $state.raw(null);
  let failed = $state(false);
  let sending = $state(false);
  let cancelling = $state(false);
  let loading = $state(true);
  let answers: Record<string, Record<string, string>> = $state({});
  let scroller: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let follow = $state(true);
  let destroyed = false;
  const busy = $derived(['starting', 'thinking', 'approval'].includes(snapshot.state.status));
  const canSend = $derived(Boolean(directory && draft.trim() && !busy && !sending && !loading));
  const prompts = [
    { icon: 'code' as const, title: t('agentChat.suggestionProject'), prompt: t('agentChat.promptProject') },
    { icon: 'warning' as const, title: t('agentChat.suggestionErrors'), prompt: t('agentChat.promptErrors') },
    { icon: 'appearance' as const, title: t('agentChat.suggestionDesign'), prompt: t('agentChat.promptDesign') },
  ];
  const errors = {
    'claude-not-found': t('agentPanel.claudeNotFound'),
    'invalid-directory': t('agentPanel.invalidDirectory'),
    'connection-failed': t('agentPanel.connectionFailed'),
    'authentication-required': t('agentChat.authenticationRequired'),
    'start-failed': t('agentPanel.startFailed'),
    'request-failed': t('agentChat.requestFailed'),
  };

  function receive(next: AgentChatSnapshot): void {
    if (destroyed || next.revision <= snapshot.revision) return;
    if (next.state.id !== snapshot.state.id) answers = {};
    snapshot = next;
    loading = false;
  }

  async function load(): Promise<void> {
    try {
      const next = await window.yalqen.getAgentChat();
      if (!next) throw new Error('Unavailable');
      receive(next);
      failed = false;
    } catch {
      if (!destroyed) {
        failed = true;
        loading = false;
      }
    }
  }

  async function send(): Promise<void> {
    if (!canSend) return;
    sending = true;
    const text = draft;
    try {
      if (!(await window.yalqen.sendAgentChat(snapshot.state.id, text, attachment?.id ?? null)))
        throw new Error('Unavailable');
      if (draft === text) {
        draft = '';
        attachment = null;
      }
      failed = false;
      follow = true;
    } catch {
      failed = true;
    } finally {
      sending = false;
      textarea?.focus();
    }
  }

  async function interrupt(): Promise<void> {
    if (!snapshot.state.id || cancelling) return;
    cancelling = true;
    try {
      await window.yalqen.interruptAgentChat(snapshot.state.id);
    } catch {
      failed = true;
    } finally {
      cancelling = false;
    }
  }

  async function respond(request: AgentChatPermission, allow: boolean): Promise<void> {
    if (!snapshot.state.id) return;
    try {
      const selected = answers[request.id] ? { ...answers[request.id] } : undefined;
      await window.yalqen.respondAgentChat(snapshot.state.id, request.id, allow, selected);
    } catch {
      failed = true;
    }
  }

  function selectAnswer(requestId: string, question: string, value: string, multiple: boolean): void {
    const current = answers[requestId]?.[question] ?? '';
    const selected = current.split(', ').filter(Boolean);
    const next = multiple
      ? (selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]).join(', ')
      : value;
    answers = { ...answers, [requestId]: { ...answers[requestId], [question]: next } };
  }

  function composeKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function suggest(prompt: string): void {
    draft = prompt;
    if (activeTab?.agentObserved) attachment = activeTab;
    textarea?.focus();
  }

  $effect(() => {
    void snapshot.revision;
    if (!open || !follow) return;
    void tick().then(() => {
      if (!destroyed && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  $effect(() => {
    if (open && directory && !loading)
      void tick().then(() => {
        if (!destroyed && open && !document.activeElement?.closest('.view-switch')) textarea?.focus();
      });
  });

  onMount(() => {
    const off = window.yalqen.onAgentChat((serialized) => {
      try {
        receive(JSON.parse(serialized) as AgentChatSnapshot);
      } catch {}
    });
    void load();
    return () => {
      destroyed = true;
      off();
    };
  });
</script>

<div class="chat">
  <div
    class="conversation"
    bind:this={scroller}
    onscroll={() => (follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64)}
  >
    {#if snapshot.messages.length === 0}
      <div class="welcome">
        <div class="welcome-mark" aria-hidden="true"><img src="./newtab-mark.png" alt="" /><span></span></div>
        <p class="eyebrow">{t('agentChat.eyebrow')}</p>
        <h2>{t('agentChat.welcome')}</h2>
        <p class="intro">{t('agentChat.intro')}</p>
        {#if !directory}
          <Button variant="primary" icon="folder" size="lg" onclick={onchoose}>{t('agentPanel.chooseProject')}</Button>
        {/if}
        <div class="suggestions">
          {#each prompts as prompt (prompt.title)}
            <button class="suggestion" onclick={() => suggest(prompt.prompt)}>
              <Icon name={prompt.icon} size={15} /><span>{prompt.title}</span><Icon name="forward" size={12} />
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="messages" role="log" aria-label={t('agentChat.conversation')} aria-live="off">
        {#each snapshot.messages as message (message.id)}
          <article class="message" class:user={message.role === 'user'}>
            <div class="message-label">
              {#if message.role === 'assistant'}<img src="./newtab-mark.png" alt="" />{/if}
              <span>{message.role === 'user' ? t('agentChat.you') : 'Claude'}</span>
            </div>
            <div class="message-content">
              {#if message.context}<div class="message-context" title={message.context.url}>
                  <Icon name="globe" size={11} /><span>{message.context.title}</span>
                </div>{/if}
              {#each message.parts as part, index (index)}
                {#if part.type === 'text'}
                  {#if message.role === 'user'}<p class="user-text">{part.text}</p>{:else}<AgentMarkdown
                      text={part.text}
                    />{/if}
                {:else}
                  <details class="tool" class:error={part.status === 'error'}>
                    <summary>
                      <span class="tool-icon"
                        ><Icon
                          name={part.status === 'done' ? 'check' : part.status === 'error' ? 'warning' : 'code'}
                          size={12}
                        /></span
                      >
                      <span class="tool-name">{part.name.replace(/^mcp__yalqen__/, 'Yalqen · ')}</span>
                      <span class="tool-status"
                        >{t(
                          part.status === 'done'
                            ? 'agentChat.toolDone'
                            : part.status === 'error'
                              ? 'agentChat.toolError'
                              : part.status === 'stopped'
                                ? 'agentChat.toolStopped'
                                : 'agentChat.toolRunning',
                        )}</span
                      >
                      <Icon name="down" size={10} />
                    </summary>
                    <pre>{part.input}</pre>
                    {#if part.output}<pre class="tool-output">{part.output}</pre>{/if}
                  </details>
                {/if}
              {/each}
            </div>
          </article>
        {/each}
      </div>
    {/if}
    {#each snapshot.permissions as request (request.id)}
      <div class="approval">
        <div class="approval-heading">
          <Icon name={request.questions.length ? 'info' : 'lock'} size={14} /><strong
            >{t(request.questions.length ? 'agentChat.question' : 'agentChat.approval')}</strong
          >
        </div>
        {#if request.questions.length}
          {#each request.questions as question (question.question)}
            <fieldset>
              <legend>{question.question}</legend>
              {#each question.options as option (option.label)}
                <label class="answer-option">
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={`${request.id}-${question.question}`}
                    checked={(answers[request.id]?.[question.question] ?? '').split(', ').includes(option.label)}
                    onchange={() => selectAnswer(request.id, question.question, option.label, question.multiSelect)}
                  />
                  <span
                    ><strong>{option.label}</strong>{#if option.description}<small>{option.description}</small
                      >{/if}</span
                  >
                </label>
              {/each}
              <input
                class="free-answer"
                aria-label={question.question}
                placeholder={t('agentChat.otherAnswer')}
                value={answers[request.id]?.[question.question] ?? ''}
                oninput={(event) =>
                  (answers = {
                    ...answers,
                    [request.id]: { ...answers[request.id], [question.question]: event.currentTarget.value },
                  })}
              />
            </fieldset>
          {/each}
        {:else}
          <p>{request.title}</p>
          <pre>{request.input}</pre>
        {/if}
        <div class="approval-actions">
          <Button size="sm" onclick={() => respond(request, false)}>{t('agentChat.deny')}</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={request.questions.some((question) => !answers[request.id]?.[question.question]?.trim())}
            onclick={() => respond(request, true)}
            >{t(request.questions.length ? 'agentChat.answer' : 'agentChat.allow')}</Button
          >
        </div>
      </div>
    {/each}
    {#if busy && snapshot.state.status !== 'approval'}
      <div class="working" role="status">
        <span class="working-dot"></span>{t(
          snapshot.state.status === 'starting' ? 'agentPanel.starting' : 'agentChat.thinking',
        )}
      </div>
    {/if}
  </div>
  {#if !follow && snapshot.messages.length}
    <button class="latest" onclick={() => (follow = true)}><Icon name="down" size={12} />{t('agentChat.latest')}</button
    >
  {/if}
  {#if snapshot.state.error || failed}
    <div class="chat-error" role="status">
      <Icon name="warning" size={13} />
      <p>{snapshot.state.error ? errors[snapshot.state.error] : t('agentChat.sendFailed')}</p>
      {#if snapshot.state.error === 'claude-not-found' || snapshot.state.error === 'authentication-required'}
        <Button
          size="sm"
          onclick={() => window.yalqen.send({ type: 'new-tab', url: 'https://code.claude.com/docs/en/setup' })}
          >{t('agentPanel.installGuide')}</Button
        >
      {:else if failed && !snapshot.state.error}<IconButton
          icon="reload"
          size="sm"
          label={t('agentPanel.retry')}
          onclick={load}
        />{/if}
    </div>
  {/if}
  <form
    class="composer"
    class:disabled={!directory}
    onsubmit={(event) => {
      event.preventDefault();
      void send();
    }}
  >
    {#if attachment}
      <div class="attachment" title={attachment.url}>
        <Icon name="globe" size={12} /><span>{attachment.title}</span><IconButton
          size="sm"
          icon="close"
          label={t('agentChat.removeTab')}
          onclick={() => (attachment = null)}
        />
      </div>
    {/if}
    <textarea
      bind:this={textarea}
      bind:value={draft}
      rows="2"
      maxlength="65536"
      aria-label={t('agentChat.message')}
      placeholder={t(directory ? 'agentChat.placeholder' : 'agentChat.chooseFirst')}
      disabled={!directory || loading}
      onkeydown={composeKey}></textarea>
    <div class="composer-controls">
      <button
        type="button"
        class="attach-tab"
        disabled={!activeTab?.agentObserved || !directory}
        aria-pressed={Boolean(attachment)}
        title={activeTab?.agentObserved ? activeTab.url : t('agentChat.localTabHint')}
        onclick={() => (attachment = attachment ? null : activeTab)}
        ><Icon name="globe" size={12} />{t('agentPanel.addTab')}</button
      >
      {#if busy}<IconButton
          class="send-button"
          icon="stop"
          size="md"
          variant="tonal"
          label={t('agentChat.interrupt')}
          disabled={cancelling}
          onclick={interrupt}
        />
      {:else}<IconButton
          class="send-button"
          type="submit"
          icon="up"
          size="md"
          variant="accent"
          label={t('agentChat.send')}
          disabled={!canSend}
        />{/if}
    </div>
  </form>
  <div class="composer-note">
    <span>Claude Code</span><span
      ><kbd>↵</kbd>
      {t('agentChat.sendHint')} <span class="separator">·</span> <kbd>⇧↵</kbd>
      {t('agentChat.newlineHint')}</span
    >
  </div>
</div>

<style>
  .chat {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
  .conversation {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 18px 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .welcome {
    padding: 36px 2px 24px;
  }
  .welcome-mark {
    position: relative;
    width: 48px;
    height: 48px;
    margin: 0 0 26px 2px;
  }
  .welcome-mark img {
    position: relative;
    z-index: 1;
    width: 44px;
    height: 44px;
  }
  .welcome-mark span {
    position: absolute;
    inset: 8px 4px -4px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    filter: blur(14px);
  }
  .eyebrow {
    margin: 0 0 10px;
    color: var(--agent-ink);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  h2 {
    max-width: 280px;
    margin: 0;
    font-size: 23px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.7px;
    text-wrap: balance;
  }
  .intro {
    max-width: 280px;
    margin: 12px 0 22px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.7;
  }
  .suggestions {
    display: grid;
    gap: 7px;
    margin-top: 28px;
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 43px;
    padding: 9px 12px;
    border: 1px solid var(--page-divider);
    border-radius: 10px;
    background: var(--page);
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition:
      background 120ms ease-out,
      border-color 120ms ease-out,
      transform 160ms ease-out;
  }
  .suggestion span {
    flex: 1;
    color: var(--text);
  }
  .suggestion:hover {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--page-divider));
    background: var(--agent-tint);
  }
  .suggestion:active,
  .attach-tab:active,
  .latest:active {
    transform: scale(0.98);
  }
  .messages {
    display: grid;
    gap: 24px;
    padding-top: 12px;
  }
  .message {
    min-width: 0;
  }
  .message-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 9px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .message-label img {
    width: 14px;
    height: 14px;
  }
  .message.user .message-label {
    justify-content: flex-end;
    padding-right: 3px;
  }
  .message.user .message-content {
    margin-left: 24px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 12%, var(--page-divider));
    border-radius: 12px 12px 3px 12px;
    background: var(--agent-tint);
  }
  .user-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
  }
  .message-context,
  .attachment {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: var(--agent-ink);
    font-size: 10px;
  }
  .message-context {
    margin-bottom: 6px;
  }
  .message-context span,
  .attachment > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool {
    margin: 10px 0;
    overflow: hidden;
    border: 1px solid var(--page-divider);
    border-radius: 9px;
    background: var(--page);
  }
  .tool summary {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 34px;
    padding: 0 10px;
    color: var(--text-muted);
    font-size: 10px;
    cursor: pointer;
    list-style: none;
  }
  .tool summary::-webkit-details-marker {
    display: none;
  }
  .tool summary:hover {
    background: var(--surface-hover);
  }
  .tool-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--surface-hover);
    color: var(--agent-ink);
  }
  .tool.error .tool-icon {
    color: var(--warn);
  }
  .tool-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .tool-status {
    flex: none;
    font-size: 9px;
  }
  pre {
    max-height: 180px;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border-top: 1px solid var(--page-divider);
    background: var(--surface-strong);
    color: var(--text-muted);
    font:
      10px/1.7 'SF Mono',
      Menlo,
      monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .tool-output {
    color: var(--text);
  }
  .approval {
    margin: 16px 0 4px;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    border-radius: 12px;
    background: var(--page);
  }
  .approval-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--agent-ink);
    font-size: 11px;
  }
  .approval > p {
    margin: 10px 0;
    font-size: 11px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }
  .approval pre {
    max-height: 150px;
    border: 1px solid var(--page-divider);
    border-radius: 7px;
  }
  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }
  fieldset {
    min-width: 0;
    margin: 12px 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 8px;
    font-size: 11px;
    line-height: 1.6;
  }
  .answer-option {
    display: flex;
    gap: 8px;
    padding: 8px 0;
    font-size: 11px;
  }
  .answer-option input {
    flex: none;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  .answer-option strong {
    font-weight: 500;
  }
  .answer-option small {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.5;
  }
  .free-answer {
    box-sizing: border-box;
    width: 100%;
    margin-top: 5px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-strong);
    color: var(--text);
    font: inherit;
    font-size: 11px;
  }
  .working {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 18px 0 4px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .working-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--agent-tint);
  }
  .latest {
    position: absolute;
    right: 20px;
    bottom: 150px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--page);
    color: var(--text);
    box-shadow: var(--shadow);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .chat-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 14px 10px;
    padding: 10px;
    border-radius: 8px;
    background: var(--agent-tint);
    color: var(--warn);
  }
  .chat-error > :global(svg) {
    flex: none;
  }
  .chat-error p {
    flex: 1;
    margin: 0;
    font-size: 10px;
    line-height: 1.5;
  }
  .composer {
    flex: none;
    margin: 0 14px;
    padding: 10px 10px 8px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--page);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.025);
    transition:
      border-color 120ms ease-out,
      box-shadow 120ms ease-out;
  }
  .composer:focus-within {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    box-shadow: 0 0 0 2px var(--agent-tint);
  }
  .composer.disabled {
    box-shadow: none;
  }
  textarea {
    box-sizing: border-box;
    display: block;
    width: 100%;
    min-height: 45px;
    max-height: 150px;
    padding: 2px;
    border: 0;
    outline: 0;
    resize: none;
    field-sizing: content;
    background: none;
    color: var(--text);
    font: 12px/1.65 var(--font);
  }
  textarea::placeholder {
    color: var(--text-muted);
  }
  textarea:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .composer-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
  }
  .attach-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 25px;
    padding: 3px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    transition:
      background 120ms ease-out,
      transform 160ms ease-out;
  }
  .attach-tab:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .attach-tab[aria-pressed='true'] {
    background: var(--agent-tint);
    color: var(--agent-ink);
  }
  .attach-tab:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .attachment {
    width: fit-content;
    max-width: 100%;
    margin-bottom: 7px;
    padding: 0 2px 0 7px;
    border-radius: 6px;
    background: var(--agent-tint);
  }
  .attachment > :global(svg) {
    flex: none;
  }
  .composer :global(.send-button) {
    border-radius: 8px;
  }
  .composer-note {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    flex: none;
    padding: 9px 17px 13px;
    color: var(--text-muted);
    font-size: 9px;
  }
  kbd {
    font-family: inherit;
    font-size: 10px;
  }
  .separator {
    padding: 0 3px;
  }
  button:focus-visible,
  summary:focus-visible,
  .free-answer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .suggestion,
    .attach-tab,
    .composer {
      transition: none;
    }
  }
</style>
