<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../shared/i18n';
  import { EMPTY_AGENT_CHAT } from '../../shared/agent-panel';
  import type {
    AgentChatImage,
    AgentChatPermission,
    AgentChatSettings,
    AgentChatSnapshot,
    AgentEffort,
    AgentElementRef,
    AgentPermissionMode,
    TabSnapshot,
  } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import Select from '../ui/Select.svelte';
  import AgentMarkdown from './AgentMarkdown.svelte';
  import AgentRewind from './AgentRewind.svelte';
  import AgentToolCard from './AgentToolCard.svelte';
  import ComposerSuggestions, { type ComposerSuggestion } from './ComposerSuggestions.svelte';
  import { complete, findTrigger } from '../../shared/composer-trigger';
  import { FILE_EDIT_TOOLS } from '../../shared/file-change';
  import ElementChip from './ElementChip.svelte';

  let {
    open,
    directory,
    activeTab,
    elements,
    onchoose,
  }: {
    open: boolean;
    directory: string | null;
    activeTab: TabSnapshot | null;
    elements: AgentElementRef[];
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
  let draft = $state('');
  let attachment: TabSnapshot | null = $state.raw(null);
  let images: AgentChatImage[] = $state.raw([]);
  let imageRejected = $state(false);
  let dismissed: string[] = $state([]);
  let fileInput: HTMLInputElement | undefined = $state();
  let caret = $state(0);
  let suggestionIndex = $state(0);
  let dismissedTrigger: string | null = $state(null);
  let files: string[] = $state.raw([]);
  const suggestionsId = $props.id();
  let failed = $state(false);
  let sending = $state(false);
  let cancelling = $state(false);
  let loading = $state(true);
  let answers: Record<string, Record<string, string>> = $state({});
  let scroller: HTMLDivElement;
  let textarea: HTMLTextAreaElement | undefined = $state();
  let follow = $state(true);
  let destroyed = false;
  const busy = $derived(['starting', 'thinking', 'approval'].includes(snapshot.state.status));
  const canSend = $derived(
    Boolean(draft.trim() && snapshot.state.status !== 'starting' && snapshot.queue.length < 5 && !sending && !loading),
  );
  const modes: { value: AgentPermissionMode; label: string }[] = [
    { value: 'default', label: t('agentChat.modeDefault') },
    { value: 'acceptEdits', label: t('agentChat.modeAcceptEdits') },
    { value: 'plan', label: t('agentChat.modePlan') },
  ];
  const effortLabels: Record<AgentEffort, string> = {
    low: t('agentChat.effortLow'),
    medium: t('agentChat.effortMedium'),
    high: t('agentChat.effortHigh'),
    xhigh: t('agentChat.effortXhigh'),
    max: t('agentChat.effortMax'),
  };
  const models = $derived([
    { value: '', label: t('agentChat.modelDefault') },
    ...snapshot.state.models.filter((model) => model.value !== 'default'),
  ]);
  const efforts = $derived(
    snapshot.state.models.find((model) =>
      [snapshot.state.modelChoice ?? 'default', snapshot.state.model].includes(model.value),
    )?.efforts ?? [],
  );
  const usage = $derived(snapshot.state.usage);
  const trigger = $derived(findTrigger(draft, caret));
  const agentName = $derived(AGENT_NAMES[snapshot.state.provider]);
  const attachable = $derived(activeTab && !activeTab.isPrivate && /^https?:/.test(activeTab.url) ? activeTab : null);
  const mentionTab = $derived(attachable);
  const suggestions: (ComposerSuggestion & { insert: string | null })[] = $derived.by(() => {
    if (!trigger || dismissedTrigger === `${trigger.kind}:${trigger.start}`) return [];
    const query = trigger.query.toLowerCase();
    if (trigger.kind === 'command')
      return snapshot.state.commands
        .filter((command) => command.name.toLowerCase().startsWith(query))
        .slice(0, 8)
        .map((command) => ({
          key: `command:${command.name}`,
          label: `/${command.name}`,
          detail: command.argumentHint ? `${command.argumentHint} · ${command.description}` : command.description,
          icon: 'code' as const,
          insert: `/${command.name}`,
        }));
    const tab =
      mentionTab && (mentionTab.title.toLowerCase().includes(query) || mentionTab.url.toLowerCase().includes(query))
        ? [
            {
              key: `tab:${mentionTab.id}`,
              label: mentionTab.title,
              detail: mentionTab.url,
              icon: 'globe' as const,
              insert: null,
            },
          ]
        : [];
    return [
      ...tab,
      ...files.map((file) => ({
        key: `file:${file}`,
        label: file,
        detail: '',
        icon: 'folder' as const,
        insert: `@${file}`,
      })),
    ].slice(0, 8);
  });
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
  const numbers = new Intl.NumberFormat(undefined, { notation: 'compact' });
  const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const prompts = [
    { title: t('agentChat.suggestionProject'), prompt: t('agentChat.promptProject') },
    { title: t('agentChat.suggestionErrors'), prompt: t('agentChat.promptErrors') },
    { title: t('agentChat.suggestionDesign'), prompt: t('agentChat.promptDesign') },
  ];
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const errors = {
    'claude-not-found': '',
    'invalid-directory': t('agentPanel.invalidDirectory'),
    'connection-failed': t('agentPanel.connectionFailed'),
    'authentication-required': t('agentChat.authenticationRequired'),
    'start-failed': t('agentPanel.startFailed'),
    'request-failed': t('agentChat.requestFailed'),
  };

  function receive(next: AgentChatSnapshot): void {
    if (destroyed || (next.revision <= snapshot.revision && next.state.provider === snapshot.state.provider)) return;
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
      const sent = images;
      if (!(await window.yalqen.sendAgentChat(snapshot.state.id, text, attachment?.id ?? null, sent)))
        throw new Error('Unavailable');
      if (draft === text) {
        draft = '';
        attachment = null;
      }
      if (images === sent) images = [];
      failed = false;
      follow = true;
    } catch {
      failed = true;
    } finally {
      sending = false;
      textarea?.focus();
    }
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

  function base64Of(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function thumbnailOf(bitmap: ImageBitmap): string {
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  async function addImages(files: Iterable<File>): Promise<void> {
    imageRejected = false;
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES || images.length >= MAX_IMAGES) {
        imageRejected = true;
        continue;
      }
      try {
        const bitmap = await createImageBitmap(file);
        const thumbnail = thumbnailOf(bitmap);
        bitmap.close();
        const data = await base64Of(file);
        if (images.length >= MAX_IMAGES) continue;
        images = [...images, { mediaType: file.type as AgentChatImage['mediaType'], data, thumbnail }];
      } catch {
        imageRejected = true;
      }
    }
  }

  function pasteImages(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addImages(files);
  }

  function dropImages(event: DragEvent): void {
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void addImages(files);
  }

  async function configure(settings: AgentChatSettings): Promise<void> {
    try {
      await window.yalqen.configureAgentChat(snapshot.state.id, settings);
    } catch {
      failed = true;
    }
  }

  async function cancelQueued(messageId: string): Promise<void> {
    if (!snapshot.state.id) return;
    try {
      await window.yalqen.cancelQueuedAgentChat(snapshot.state.id, messageId);
    } catch {
      failed = true;
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

  async function respond(request: AgentChatPermission, allow: boolean, always = false): Promise<void> {
    if (!snapshot.state.id) return;
    try {
      const selected = answers[request.id] ? { ...answers[request.id] } : undefined;
      await window.yalqen.respondAgentChat(snapshot.state.id, request.id, allow, selected, always);
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

  async function pickSuggestion(index: number): Promise<void> {
    const item = suggestions[index];
    if (!item || !trigger) return;
    if (item.insert === null && mentionTab) attachment = mentionTab;
    const next = complete(draft, trigger, item.insert ?? '');
    draft = next.text;
    caret = next.caret;
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(next.caret, next.caret);
  }

  function trackCaret(): void {
    caret = textarea?.selectionStart ?? draft.length;
  }

  function composeKey(event: KeyboardEvent): void {
    if (suggestions.length && !event.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        suggestionIndex = (suggestionIndex + step + suggestions.length) % suggestions.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        void pickSuggestion(suggestionIndex);
        return;
      }
      if (event.key === 'Escape' && trigger) {
        event.preventDefault();
        dismissedTrigger = `${trigger.kind}:${trigger.start}`;
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  function suggest(prompt: string): void {
    draft = prompt;
    if (attachable?.agentObserved) attachment = attachable;
    textarea?.focus();
  }

  $effect(() => {
    void suggestions.length;
    suggestionIndex = 0;
  });

  $effect(() => {
    if (trigger?.kind !== 'mention') return;
    const query = trigger.query;
    const timer = setTimeout(() => {
      window.yalqen
        .searchAgentFiles(query)
        .then((found) => {
          if (!destroyed && trigger?.kind === 'mention' && trigger.query === query) files = found;
        })
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(timer);
  });

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
        if (!destroyed && open && !document.activeElement?.closest('.segmented')) textarea?.focus();
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
        <h2>{t('agentChat.welcome')}</h2>
        <p class="intro">{t('agentChat.intro')}</p>
        {#if !directory}
          <Button variant="primary" icon="folder" onclick={onchoose}>{t('agentPanel.chooseProject')}</Button>
          <p class="intro">{t('agentChat.noProjectHint')}</p>
        {:else}
          <div class="suggestions">
            {#each prompts as prompt (prompt.title)}
              <button class="suggestion" onclick={() => suggest(prompt.prompt)}>{prompt.title}</button>
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
              {#if message.context}<div class="message-context" title={message.context.url}>
                  <Icon name="globe" size={11} /><span>{message.context.title}</span>
                </div>{/if}
              {#if message.episode}<div class="message-context episode-ref">
                  <Icon name="warning" size={11} /><span>{message.episode.id}</span>
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
      <div class="approval">
        <div class="approval-heading">
          <Icon name={request.questions.length ? 'info' : 'lock'} size={14} /><strong
            >{t(
              request.questions.length
                ? 'agentChat.question'
                : request.plan !== null
                  ? 'agentChat.planReady'
                  : 'agentChat.approval',
            )}</strong
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
        {:else if request.plan !== null}
          <div class="plan"><AgentMarkdown text={request.plan} /></div>
        {:else}
          <p>{request.title}</p>
          <pre>{request.input}</pre>
        {/if}
        <div class="approval-actions">
          <Button size="sm" onclick={() => respond(request, false)}>{t('agentChat.deny')}</Button>
          {#if request.canAlwaysAllow}<Button size="sm" onclick={() => respond(request, true, true)}
              >{t('agentChat.alwaysAllow')}</Button
            >{/if}
          <Button
            size="sm"
            variant="primary"
            disabled={request.questions.some((question) => !answers[request.id]?.[question.question]?.trim())}
            onclick={() => respond(request, true)}
            >{t(
              request.questions.length
                ? 'agentChat.answer'
                : request.plan !== null
                  ? 'agentChat.approvePlan'
                  : 'agentChat.allow',
            )}</Button
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
    <Button class="latest" variant="surface" size="sm" icon="down" onclick={() => (follow = true)}
      >{t('agentChat.latest')}</Button
    >
  {/if}
  {#if snapshot.state.error || failed}
    <div class="chat-error" role="status">
      <Icon name="warning" size={13} />
      <p>
        {snapshot.state.error === 'claude-not-found'
          ? snapshot.state.provider === 'claude'
            ? t('agentPanel.claudeNotFound')
            : t('agentChat.agentNotFound', { agent: agentName })
          : snapshot.state.error
            ? errors[snapshot.state.error]
            : t('agentChat.sendFailed')}
      </p>
      {#if snapshot.state.error === 'claude-not-found' || snapshot.state.error === 'authentication-required'}
        <Button
          size="sm"
          onclick={() => window.yalqen.send({ type: 'new-tab', url: SETUP_GUIDES[snapshot.state.provider] })}
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
  {#if directory && episode && activeTab}
    <div class="episode" role="status">
      <Icon name="warning" size={13} />
      <div class="episode-text">
        <strong>{t('agentChat.fixTitle')}</strong>
        <span title={episode.lines.join('\n')}>{episode.lines.at(-1) ?? episode.id}</span>
      </div>
      <Button size="sm" variant="primary" onclick={fixEpisode}>{t('agentChat.fixWithClaude')}</Button>
      <IconButton
        size="sm"
        icon="close"
        label={t('agentChat.dismissError')}
        onclick={() => (dismissed = [...dismissed, episode.id])}
      />
    </div>
  {/if}
  <form
    class="composer"
    onsubmit={(event) => {
      event.preventDefault();
      void send();
    }}
    ondragover={(event) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    }}
    ondrop={dropImages}
  >
    {#if snapshot.queue.length}
      <ol class="queue" aria-label={t('agentChat.queued')}>
        {#each snapshot.queue as message (message.id)}
          <li>
            <span class="queue-label">{t('agentChat.queued')}</span>
            <span class="queue-text">{message.parts[0]?.type === 'text' ? message.parts[0].text : ''}</span>
            <IconButton
              size="sm"
              icon="close"
              label={t('agentChat.cancelQueued')}
              onclick={() => cancelQueued(message.id)}
            />
          </li>
        {/each}
      </ol>
    {/if}
    {#if images.length}
      <div class="thumbnails">
        {#each images as image, index (index)}
          <div class="thumbnail">
            <img src={image.thumbnail} alt="" />
            <IconButton
              size="sm"
              icon="close"
              label={t('agentChat.removeImage')}
              onclick={() => (images = images.filter((entry) => entry !== image))}
            />
          </div>
        {/each}
      </div>
    {/if}
    {#if imageRejected}<p class="image-hint" role="status">{t('agentChat.imageRejected')}</p>{/if}
    {#if attachment || elements.length}
      <div class="chips">
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
        {#each elements as element (element.id)}
          <ElementChip {element} onremove={() => void window.yalqen.removeAgentElement(element.id)} />
        {/each}
      </div>
    {/if}
    {#if suggestions.length}
      <ComposerSuggestions
        id={suggestionsId}
        label={t(trigger?.kind === 'command' ? 'agentChat.commands' : 'agentChat.mentions')}
        items={suggestions}
        active={suggestionIndex}
        onpick={(index) => void pickSuggestion(index)}
      />
    {/if}
    <textarea
      bind:this={textarea}
      bind:value={draft}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={suggestions.length > 0}
      aria-controls={suggestions.length ? suggestionsId : undefined}
      aria-activedescendant={suggestions.length ? `${suggestionsId}-${suggestionIndex}` : undefined}
      oninput={trackCaret}
      onclick={trackCaret}
      onkeyup={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) trackCaret();
      }}
      rows="1"
      maxlength="65536"
      aria-label={t('agentChat.messageAgent', { agent: agentName })}
      placeholder={t('agentChat.placeholderAgent', { agent: agentName })}
      disabled={loading}
      onpaste={pasteImages}
      onkeydown={composeKey}></textarea>
    <input
      bind:this={fileInput}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      hidden
      onchange={(event) => {
        void addImages([...(event.currentTarget.files ?? [])]);
        event.currentTarget.value = '';
      }}
    />
    <div class="composer-controls">
      <Button
        size="sm"
        icon="globe"
        disabled={!attachable}
        aria-pressed={Boolean(attachment)}
        title={!attachable
          ? t('agentChat.attachHint')
          : attachable.agentObserved
            ? attachable.url
            : t('agentChat.pageSendHint', { url: attachable.url })}
        onclick={() => (attachment = attachment ? null : attachable)}>{t('agentPanel.addTab')}</Button
      >
      <IconButton
        size="sm"
        icon="image"
        label={t('agentChat.addImage')}
        disabled={images.length >= MAX_IMAGES}
        onclick={() => fileInput?.click()}
      />
      {#if snapshot.state.provider === 'claude'}
        <Select
          variant="ghost"
          aria-label={t('agentChat.modeLabel')}
          title={t('agentChat.modeLabel')}
          value={snapshot.state.permissionMode}
          options={modes}
          onchange={(permissionMode) => configure({ permissionMode })}
        />
      {/if}
      <span class="spacer"></span>
      {#if busy && !draft.trim()}<IconButton
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
    {#if models.length > 1 || usage}
      <div class="composer-meta">
        {#if models.length > 1}
          <Select
            variant="ghost"
            aria-label={t('agentChat.modelLabel')}
            title={snapshot.state.model ?? t('agentChat.modelLabel')}
            value={snapshot.state.modelChoice ?? ''}
            options={models}
            onchange={(model) => configure({ model: model || null })}
          />
        {/if}
        {#if efforts.length}
          <Select
            variant="ghost"
            aria-label={t('agentChat.effortLabel')}
            title={t('agentChat.effortLabel')}
            value={snapshot.state.effort ?? ''}
            options={[
              { value: '', label: t('agentChat.effortDefault') },
              ...efforts.map((effort) => ({ value: effort, label: effortLabels[effort] })),
            ]}
            onchange={(effort) => configure({ effort: (effort || null) as AgentEffort | null })}
          />
        {/if}
        {#if usage}
          <span class="usage">
            {#if usage.contextTokens !== null && usage.contextLimit}<span
                title={t('agentChat.context', {
                  used: numbers.format(usage.contextTokens),
                  limit: numbers.format(usage.contextLimit),
                })}>{Math.round((usage.contextTokens / usage.contextLimit) * 100)}%</span
              >{/if}
            <span title={t('agentChat.cost')}>{currency.format(usage.cost)}</span>
          </span>
        {/if}
      </div>
    {/if}
  </form>
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
    padding: 32px 4px 16px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.4px;
    text-wrap: balance;
  }
  .intro {
    max-width: 280px;
    margin: 8px 0 20px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.65;
  }
  .suggestions {
    display: grid;
    gap: 2px;
    margin: 0 -8px;
  }
  .suggestion {
    padding: 8px 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition:
      background var(--transition),
      color var(--transition);
  }
  .suggestion:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .messages {
    display: grid;
    gap: 20px;
    padding-top: 8px;
  }
  .message {
    min-width: 0;
  }
  .message.user .message-content {
    margin-left: 32px;
    padding: 9px 12px;
    border-radius: 14px;
    background: var(--surface-hover);
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
    color: var(--accent);
    font-size: var(--font-size-small);
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
  .approval {
    margin: 16px 0 4px;
    padding: 12px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .approval-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--accent);
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
    font-size: var(--font-size-small);
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
  }
  .chat :global(.latest) {
    position: absolute;
    right: 20px;
    bottom: 120px;
  }
  .chat-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 14px 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface-hover);
    color: var(--warn);
  }
  .chat-error > :global(svg) {
    flex: none;
  }
  .chat-error p {
    flex: 1;
    margin: 0;
    font-size: var(--font-size-small);
    line-height: 1.5;
  }
  .composer {
    flex: none;
    margin: 0 14px;
    padding: 10px 10px 8px;
    border: 1px solid var(--border);
    margin-bottom: 14px;
    border-radius: 16px;
    background: var(--surface);
    transition: border-color var(--transition);
  }
  .composer:focus-within {
    border-color: var(--accent);
  }
  textarea {
    box-sizing: border-box;
    display: block;
    width: 100%;
    min-height: 40px;
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
  .spacer {
    flex: 1;
  }
  .episode {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 14px 8px;
    padding: 8px 6px 8px 12px;
    border-radius: 12px;
    background: var(--surface-hover);
    color: var(--warn);
  }
  .episode > :global(svg) {
    flex: none;
  }
  .episode-text {
    display: grid;
    flex: 1;
    min-width: 0;
    color: var(--text);
    font-size: 11px;
    line-height: 1.45;
  }
  .episode-text strong {
    font-weight: 600;
  }
  .episode-text span {
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .episode-ref {
    color: var(--warn);
  }
  .thumbnails {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  .thumbnail {
    position: relative;
  }
  .thumbnail :global(button) {
    position: absolute;
    top: -6px;
    right: -6px;
    background: var(--surface-strong);
  }
  .image-hint {
    margin: 0 0 7px;
    color: var(--warn);
    font-size: 11px;
  }
  .composer-controls :global(.send-button) {
    flex: none;
  }
  .composer-meta {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 6px -4px 0;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .usage {
    display: flex;
    gap: 8px;
    margin-left: auto;
    padding-right: 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .queue {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    margin: 0 0 7px;
    padding: 0;
    list-style: none;
  }
  .queue li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 2px 8px;
    border-radius: 8px;
    background: var(--surface-hover);
    font-size: 11px;
  }
  .queue-label {
    flex: none;
    color: var(--text-muted);
  }
  .queue-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plan {
    max-height: 320px;
    overflow-y: auto;
    margin: 4px 0 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 7px;
  }
  .message-content > .chips {
    margin: 0 0 8px;
  }
  .attachment {
    width: fit-content;
    max-width: 100%;
    padding: 0 2px 0 9px;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
  }
  .attachment > :global(svg) {
    flex: none;
  }
  button:focus-visible,
  .free-answer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .suggestion,
    .composer {
      transition: none;
    }
  }
</style>
