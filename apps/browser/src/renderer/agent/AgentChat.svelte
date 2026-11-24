<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../shared/i18n';
  import { EMPTY_AGENT_CHAT, SIGN_IN_PROVIDERS } from '../../shared/agent-panel';
  import type { AgentChatComposer } from '../../shared/agent-panel';
  import type { TabSnapshot } from '../../shared/types';
  import type {
    AgentChatMessage,
    AgentChatPermission,
    AgentChatSnapshot,
    AgentElementRef,
    AgentWorkMode,
  } from '../../shared/agent';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import AgentMarkdown from './AgentMarkdown.svelte';
  import AgentRewind from './AgentRewind.svelte';
  import PermissionRequest from './PermissionRequest.svelte';
  import AgentToolCard from './AgentToolCard.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import { reuseChatSnapshot } from '../../shared/chat-snapshot';
  import { FILE_EDIT_TOOLS } from '../../shared/file-change';
  import ElementChip from './ElementChip.svelte';
  import ProviderMark from './ProviderMark.svelte';
  import VisualComparison from './VisualComparison.svelte';
  import BrowserChecks from './BrowserChecks.svelte';
  import type { VisualComparisonReview } from '../../shared/visual-comparison';

  let {
    initialDraft,
    conversationId,
    projectId,
    open,
    directory,
    activeTab,
    tabs,
    developer,
    elements,
    floating = false,
    onchoose,
  }: {
    initialDraft: AgentChatComposer;
    conversationId: string;
    projectId: string;
    open: boolean;
    directory: string | null;
    activeTab: TabSnapshot | null;
    tabs: TabSnapshot[];
    developer: boolean;
    elements: AgentElementRef[];
    floating?: boolean;
    onchoose(): void;
  } = $props();

  let snapshot: AgentChatSnapshot = $state.raw({
    state: { ...EMPTY_AGENT_CHAT },
    revision: -1,
    messages: [],
    queue: [],
    permissions: [],
  });
  const AGENT_NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' } as const;
  const SETUP_GUIDES = {
    claude: 'https://code.claude.com/docs/en/setup',
    codex: 'https://github.com/zed-industries/codex-acp',
    gemini: 'https://github.com/google-gemini/gemini-cli',
  } as const;
  let chatComposer: ReturnType<typeof ChatComposer> | undefined;
  let comparisonOpen = $state(false);
  let checksOpen = $state(false);
  let dismissed: string[] = $state([]);
  let failed = $state(false);
  let sending = $state(false);
  let signingIn = $state(false);
  let signInFailed = $state(false);
  let loading = $state(true);
  let scroller: HTMLDivElement;
  let follow = $state(true);
  let destroyed = false;
  const busy = $derived(['starting', 'thinking', 'approval'].includes(snapshot.state.status));
  const workModeLabels: Record<AgentWorkMode, string> = {
    normal: t('agentChat.workNormal'),
    verify: t('agentChat.workVerify'),
    review: t('agentChat.workReview'),
    design: t('agentChat.workDesign'),
  };

  function contextsOf(message: AgentChatMessage) {
    return message.contexts ?? (message.context ? [message.context] : []);
  }
  const agentName = $derived(AGENT_NAMES[snapshot.state.provider]);
  const editedAfter = $derived.by(() => {
    const edited: string[] = [];
    let seen = false;
    for (let index = snapshot.messages.length - 1; index >= 0; index--) {
      const message = snapshot.messages[index];
      if (message.role === 'user') {
        if (seen || message.reverted) edited.push(message.id);
      } else if (
        message.parts.some(
          (part) => part.type === 'tool' && FILE_EDIT_TOOLS.includes(part.name) && part.status === 'done',
        )
      )
        seen = true;
    }
    return edited;
  });
  const episode = $derived.by(() => {
    const candidate = activeTab?.agentObserved ? activeTab.agentEpisode : null;
    if (!candidate || dismissed.includes(candidate.id)) return null;
    const handled = [...snapshot.messages, ...snapshot.queue].some((message) => message.episode?.id === candidate.id);
    return handled ? null : candidate;
  });
  const prompts = [
    { title: t('agentChat.suggestionProject'), prompt: t('agentChat.promptProject'), icon: 'folder' as const },
    { title: t('agentChat.suggestionErrors'), prompt: t('agentChat.promptErrors'), icon: 'warning' as const },
    { title: t('agentChat.suggestionDesign'), prompt: t('agentChat.promptDesign'), icon: 'sparkle' as const },
  ];
  const errors = {
    'claude-not-found': '',
    'invalid-directory': t('agentPanel.invalidDirectory'),
    'connection-failed': t('agentPanel.connectionFailed'),
    'authentication-required': '',
    'start-failed': t('agentPanel.startFailed'),
    'request-failed': t('agentChat.requestFailed'),
  };

  function receive(next: AgentChatSnapshot): void {
    if (destroyed || (next.revision <= snapshot.revision && next.state.provider === snapshot.state.provider)) return;
    snapshot = reuseChatSnapshot(snapshot, next);
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

  async function signIn(): Promise<void> {
    signingIn = true;
    signInFailed = false;
    try {
      const signedIn = await window.yalqen.signInAgent();
      signInFailed = !signedIn;
      if (signedIn) chatComposer?.fillIfEmpty(lastPrompt());
    } catch {
      signInFailed = true;
    } finally {
      signingIn = false;
    }
  }

  function lastPrompt(): string {
    const message = snapshot.messages.findLast((entry) => entry.role === 'user');
    return (message?.parts ?? [])
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  async function fixEpisode(): Promise<void> {
    if (!activeTab || !episode) return;
    try {
      if (!(await window.yalqen.fixAgentEpisode(activeTab.id))) throw new Error('Unavailable');
      follow = true;
    } catch {
      failed = true;
    }
  }

  async function reviewComparison(review: VisualComparisonReview): Promise<boolean> {
    if (loading || sending || snapshot.state.status === 'starting' || snapshot.queue.length >= 5) return false;
    sending = true;
    try {
      const accepted = await window.yalqen.sendAgentChat(snapshot.state.id, review.text, [review.tabId], review.images);
      if (accepted) {
        failed = false;
        follow = true;
      }
      return accepted;
    } catch {
      return false;
    } finally {
      sending = false;
    }
  }

  async function respond(
    request: AgentChatPermission,
    allow: boolean,
    always: boolean,
    selected: Record<string, string> | undefined,
  ): Promise<void> {
    if (!snapshot.state.id) return;
    try {
      await window.yalqen.respondAgentChat(snapshot.state.id, request.id, allow, selected, always);
    } catch {
      failed = true;
    }
  }

  function toggleComparison(): void {
    comparisonOpen = !comparisonOpen;
    if (comparisonOpen) checksOpen = false;
  }

  function toggleChecks(): void {
    checksOpen = !checksOpen;
    if (checksOpen) comparisonOpen = false;
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
        if (!destroyed && open && !document.activeElement?.closest('.segmented')) chatComposer?.focus();
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
        <span class="welcome-mark"><ProviderMark mark={snapshot.state.provider} activity="idle" /></span>
        <h2>{t('agentChat.welcome')}</h2>
        <p class="intro">{t('agentChat.intro')}</p>
        {#if !directory}
          <Button variant="primary" icon="folder" onclick={onchoose}>{t('agentPanel.chooseProject')}</Button>
          <p class="hint">{t('agentChat.noProjectHint')}</p>
        {:else}
          <div class="suggestions">
            {#each prompts as prompt (prompt.title)}
              <button class="suggestion" onclick={() => chatComposer?.suggest(prompt.prompt)}>
                <Icon name={prompt.icon} size={14} /><span>{prompt.title}</span><Icon name="forward" size={12} />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="messages" role="log" aria-label={t('agentChat.conversation')} aria-live="off">
        {#each snapshot.messages as message (message.id)}
          <article
            class="message"
            class:user={message.role === 'user'}
            aria-label={message.role === 'user' ? t('agentChat.you') : agentName}
          >
            <div class="message-content">
              {#each contextsOf(message) as context (context.id)}
                <div class="message-context" title={context.url}>
                  <Icon name="globe" size={12} /><span>{context.title}</span>
                </div>
              {/each}
              {#if message.workMode !== 'normal'}<div class="message-context work-mode">
                  <Icon name="sparkle" size={12} /><span>{workModeLabels[message.workMode]}</span>
                </div>{/if}
              {#if message.episode}<div class="message-context episode-ref">
                  <Icon name="warning" size={12} /><span>{message.episode.id}</span>
                </div>{/if}
              {#if message.elements.length}<div class="chips">
                  {#each message.elements as element (element.id)}<ElementChip {element} />{/each}
                </div>{/if}
              {#if message.images.length}<div class="thumbnails">
                  {#each message.images as image, index (index)}<img src={image} alt="" />{/each}
                </div>{/if}
              {#each message.parts as part, index (index)}
                {#if part.type === 'text'}
                  {#if message.role === 'user'}<p class="user-text">{part.text}</p>{:else}<AgentMarkdown
                      text={part.text}
                    />{/if}
                {:else}
                  <AgentToolCard {part} {directory} />
                {/if}
              {/each}
              {#if message.role === 'user' && snapshot.state.id && editedAfter.includes(message.id)}
                <AgentRewind
                  sessionId={snapshot.state.id}
                  messageId={message.id}
                  reverted={message.reverted}
                  disabled={snapshot.state.status !== 'ready'}
                />
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
    {#each snapshot.permissions as request (request.id)}
      <PermissionRequest {request} onrespond={(allow, always, answers) => respond(request, allow, always, answers)} />
    {/each}
    {#if busy && snapshot.state.status !== 'approval'}
      <div class="working" role="status">
        <span class="working-dot"></span>{t(
          snapshot.state.status === 'starting' ? 'agentPanel.starting' : 'agentChat.thinking',
        )}
      </div>
    {/if}
    {#if !follow && snapshot.messages.length}
      <Button class="latest" variant="surface" icon="down" onclick={() => (follow = true)}>
        {t('agentChat.latest')}
      </Button>
    {/if}
  </div>
  {#if snapshot.state.error || failed}
    <div class="chat-error" role="status">
      <Icon name="warning" size={14} />
      <p>
        {snapshot.state.error === 'claude-not-found'
          ? snapshot.state.provider === 'claude'
            ? t('agentPanel.claudeNotFound')
            : t('agentChat.agentNotFound', { agent: agentName })
          : snapshot.state.error === 'authentication-required'
            ? signingIn
              ? t('agentChat.signingIn')
              : signInFailed
                ? t('agentChat.signInFailed')
                : t('agentChat.authenticationRequired', { agent: agentName })
            : snapshot.state.error
              ? errors[snapshot.state.error]
              : t('agentChat.sendFailed')}
      </p>
      {#if snapshot.state.error === 'authentication-required' && SIGN_IN_PROVIDERS.includes(snapshot.state.provider)}
        <Button variant="primary" disabled={signingIn} onclick={signIn}>{t('agentChat.signIn')}</Button>
      {:else if snapshot.state.error === 'claude-not-found' || snapshot.state.error === 'authentication-required'}
        <Button onclick={() => window.yalqen.send({ type: 'new-tab', url: SETUP_GUIDES[snapshot.state.provider] })}>
          {t('agentPanel.installGuide')}
        </Button>
      {:else if failed && !snapshot.state.error}<IconButton
          icon="reload"
          size="sm"
          label={t('agentPanel.retry')}
          onclick={load}
        />{/if}
    </div>
  {/if}
  {#if directory && episode && activeTab}
    <div class="episode" role="status">
      <Icon name="warning" size={14} />
      <div class="episode-text">
        <strong>{t('agentChat.fixTitle')}</strong>
        <span title={episode.lines.join('\n')}>{episode.lines.at(-1) ?? episode.id}</span>
      </div>
      <Button variant="primary" onclick={fixEpisode}>{t('agentChat.fixWithClaude')}</Button>
      <IconButton
        size="sm"
        icon="close"
        label={t('agentChat.dismissError')}
        onclick={() => (dismissed = [...dismissed, episode.id])}
      />
    </div>
  {/if}
  {#if comparisonOpen}
    {#key directory}<VisualComparison
        {activeTab}
        {developer}
        disabled={loading || sending || snapshot.state.status === 'starting' || snapshot.queue.length >= 5}
        onreview={reviewComparison}
        onclose={() => (comparisonOpen = false)}
      />{/key}
  {/if}
  {#if checksOpen}
    {#key directory}<BrowserChecks
        {activeTab}
        {developer}
        disabled={loading || sending || busy || snapshot.queue.length >= 5}
        flowDisabled={snapshot.state.workMode === 'review'}
        onrequest={reviewComparison}
        onclose={() => (checksOpen = false)}
      />{/key}
  {/if}
  <ChatComposer
    bind:this={chatComposer}
    {initialDraft}
    {projectId}
    {conversationId}
    {snapshot}
    {agentName}
    {loading}
    {sending}
    {busy}
    {activeTab}
    {tabs}
    {developer}
    {elements}
    {floating}
    {comparisonOpen}
    {checksOpen}
    {workModeLabels}
    onsending={(value) => (sending = value)}
    onsent={() => {
      failed = false;
      follow = true;
    }}
    onfailed={() => (failed = true)}
    ontogglecomparison={toggleComparison}
    ontogglechecks={toggleChecks}
  />
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
    padding: 4px var(--ai-gutter) 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    min-height: 100%;
    padding: 16px 0 32px;
  }
  .welcome-mark {
    display: grid;
    width: 32px;
    height: 32px;
    margin: 0 0 14px -2px;
  }
  .welcome-mark :global(.glyph) {
    width: 28px;
    height: 28px;
    opacity: 1;
  }
  .hint {
    max-width: 320px;
    margin: 14px 0 0;
    color: var(--text-muted);
    font-size: var(--ai-small);
    line-height: 1.5;
    opacity: 0.8;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.4px;
    text-wrap: balance;
  }
  .intro {
    max-width: 320px;
    margin: 8px 0 20px;
    color: var(--text-muted);
    font-size: var(--ai-text);
    line-height: 1.55;
  }
  .suggestions {
    display: grid;
    gap: 6px;
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--ai-radius);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--ai-text);
    text-align: left;
    cursor: pointer;
    transition:
      background var(--transition),
      border-color var(--transition);
  }
  .suggestion > :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .suggestion > :global(svg:first-child) {
    color: var(--accent);
  }
  .suggestion span {
    flex: 1;
    min-width: 0;
  }
  .suggestion:hover {
    border-color: transparent;
    background: var(--surface-hover);
  }
  .messages {
    display: grid;
    gap: 20px;
    padding-top: 8px;
  }
  .message {
    min-width: 0;
  }
  .message.user {
    display: flex;
    justify-content: flex-end;
  }
  .message.user .message-content {
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 16px;
    background: var(--surface-hover);
  }
  .user-text {
    margin: 0;
    font-size: var(--ai-text);
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
  }
  .message-context {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--accent);
    font-size: var(--ai-meta);
  }
  .message-context {
    margin-bottom: 4px;
  }
  .message-context span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .working {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 0 4px;
    color: var(--text-muted);
    font-size: var(--ai-small);
  }
  .working-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .conversation :global(.latest) {
    position: sticky;
    bottom: 0;
    display: flex;
    width: fit-content;
    margin: 12px 0 0 auto;
  }
  .chat-error,
  .episode {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 12px 8px;
    padding: 8px 8px 8px 12px;
    border-radius: var(--ai-radius);
    background: var(--surface-hover);
    color: var(--warn);
  }
  .chat-error > :global(svg),
  .episode > :global(svg) {
    flex: none;
  }
  .chat-error p {
    flex: 1;
    margin: 0;
    font-size: var(--ai-small);
    line-height: 1.45;
  }
  .episode-text {
    display: grid;
    flex: 1;
    min-width: 0;
    color: var(--text);
    font-size: var(--ai-small);
    line-height: 1.4;
  }
  .episode-text strong {
    font-weight: 600;
  }
  .episode-text span {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .episode-ref {
    color: var(--warn);
  }
  .work-mode {
    color: var(--accent);
  }
  .thumbnails {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .thumbnails img {
    display: block;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    object-fit: cover;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .message-content > .chips {
    margin: 0 0 6px;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  :global([data-style='card']) .welcome {
    align-items: center;
    text-align: center;
  }
  :global([data-style='card']) .welcome-mark {
    margin: 0 0 14px;
  }
  :global([data-style='card']) h2 {
    font-size: 15px;
    letter-spacing: -0.1px;
  }
  :global([data-style='card']) .intro {
    margin: 6px auto 18px;
  }
  :global([data-style='card']) .hint {
    margin-inline: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .suggestion {
      transition: none;
    }
    .working-dot {
      animation: none;
    }
  }
</style>
