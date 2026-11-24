<script lang="ts">
  import { displayHost } from '../../shared/hosts';
  import { onDestroy, tick, untrack } from 'svelte';
  import { t } from '../../shared/i18n';
  import { MAX_CHAT_TABS } from '../../shared/agent-panel';
  import type { AgentChatComposer } from '../../shared/agent-panel';
  import type { TabSnapshot } from '../../shared/types';
  import type {
    AgentChatSettings,
    AgentChatSnapshot,
    AgentEffort,
    AgentElementRef,
    AgentPermissionMode,
    AgentWorkMode,
  } from '../../shared/agent';
  import IconButton from '../ui/IconButton.svelte';
  import Icon from '../ui/Icon.svelte';
  import Select from '../ui/Select.svelte';
  import ComposerSuggestions from './ComposerSuggestions.svelte';
  import { composerSuggestions } from './composer-suggestions';
  import { acceptsImage, MAX_IMAGES, readImage } from './images';
  import { complete, findTrigger } from '../../shared/composer-trigger';
  import ElementChip from './ElementChip.svelte';
  import { modelName } from './model-name';
  import ComposerSettings from './ComposerSettings.svelte';
  import TabAttachments from './TabAttachments.svelte';

  let {
    initialDraft,
    projectId,
    conversationId,
    snapshot,
    agentName,
    loading,
    sending,
    busy,
    activeTab,
    tabs,
    developer,
    elements,
    floating,
    comparisonOpen,
    checksOpen,
    workModeLabels,
    onsending,
    onsent,
    onfailed,
    ontogglecomparison,
    ontogglechecks,
  }: {
    initialDraft: AgentChatComposer;
    projectId: string;
    conversationId: string;
    snapshot: AgentChatSnapshot;
    agentName: string;
    loading: boolean;
    sending: boolean;
    busy: boolean;
    activeTab: TabSnapshot | null;
    tabs: TabSnapshot[];
    developer: boolean;
    elements: AgentElementRef[];
    floating: boolean;
    comparisonOpen: boolean;
    checksOpen: boolean;
    workModeLabels: Record<AgentWorkMode, string>;
    onsending(value: boolean): void;
    onsent(): void;
    onfailed(): void;
    ontogglecomparison(): void;
    ontogglechecks(): void;
  } = $props();

  let composer = $state.raw(untrack(() => initialDraft));
  const owner = untrack(() => ({ projectId, conversationId }));
  function updateDraft(patch: Partial<AgentChatComposer>): void {
    composer = { ...composer, ...patch };
    window.yalqen.updateAgentDraft(owner.projectId, owner.conversationId, $state.snapshot(patch));
  }

  let attachmentChanged = $state(false);
  let imageRejected = $state(false);
  let cancelling = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();
  let caret = $state(0);
  let suggestionIndex = $state(0);
  let dismissedTrigger: string | null = $state(null);
  let files: string[] = $state.raw([]);
  const suggestionsId = $props.id();
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
  });

  const canSend = $derived(
    Boolean(
      composer.text.trim() && snapshot.state.status !== 'starting' && snapshot.queue.length < 5 && !sending && !loading,
    ),
  );
  const workModes = $derived(
    (Object.keys(workModeLabels) as AgentWorkMode[]).map((value) => ({
      value,
      label: workModeLabels[value],
    })),
  );
  const modes: { value: AgentPermissionMode; label: string }[] = [
    { value: 'default', label: t('agentChat.modeDefault') },
    { value: 'acceptEdits', label: t('agentChat.modeAcceptEdits') },
    { value: 'auto', label: t('agentChat.modeAuto') },
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
    {
      value: '',
      label: snapshot.state.model
        ? `${t('agentChat.modelDefault')} · ${modelName(snapshot.state.model)}`
        : t('agentChat.modelDefault'),
      short: snapshot.state.model ? modelName(snapshot.state.model) : t('agentChat.modelLabel'),
    },
    ...snapshot.state.models.filter((model) => model.value !== 'default'),
  ]);
  const replyLengths = [
    { value: 'short' as const, label: t('agentChat.replyShort'), short: t('agentChat.replyShortChip') },
    { value: 'detailed' as const, label: t('agentChat.replyDetailed'), short: t('agentChat.replyDetailedChip') },
  ];
  const efforts = $derived(
    snapshot.state.models.find((model) =>
      [snapshot.state.modelChoice ?? 'default', snapshot.state.model].includes(model.value),
    )?.efforts ?? [],
  );
  const usage = $derived(snapshot.state.usage);
  const numbers = new Intl.NumberFormat(undefined, { notation: 'compact' });
  const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const effortOptions = $derived([
    { value: '', label: t('agentChat.effortDefault'), short: t('agentChat.effortAuto') },
    ...efforts.map((effort) => ({ value: effort, label: effortLabels[effort] })),
  ]);
  const settingsSummary = $derived(
    [
      snapshot.state.provider === 'claude' &&
        snapshot.state.permissionMode !== 'default' &&
        chipOf(modes, snapshot.state.permissionMode),
      snapshot.state.workMode !== 'normal' && workModeLabels[snapshot.state.workMode],
      models.length > 1 ? chipOf(models, snapshot.state.modelChoice ?? '') : t('agentChat.settings'),
    ]
      .filter(Boolean)
      .join(' · '),
  );

  function chipOf<T>(options: readonly { value: T; label: string; short?: string }[], value: T): string {
    const option = options.find((item) => item.value === value);
    return option ? (option.short ?? option.label) : '';
  }

  const trigger = $derived(findTrigger(composer.text, caret));
  const attachable = $derived(
    activeTab && (!activeTab.isPrivate || developer) && /^https?:/.test(activeTab.url) ? activeTab : null,
  );
  // Floating over a page, the chat asks about that page unless other tabs are attached, like Dia.
  const pageContext = $derived(floating && composer.attachments.length === 0 ? attachable : null);
  const attachableTabs = $derived(tabs.filter((tab) => (!tab.isPrivate || developer) && /^https?:/.test(tab.url)));
  const suggestions = $derived(
    !trigger || dismissedTrigger === `${trigger.kind}:${trigger.start}`
      ? []
      : composerSuggestions(trigger, snapshot.state.commands, composer.attachments, attachableTabs, files),
  );

  async function send(): Promise<void> {
    if (!canSend) return;
    onsending(true);
    const text = composer.text;
    try {
      const sent = composer.images;
      const attached = composer.attachments.length ? composer.attachments : pageContext ? [pageContext] : [];
      if (
        !(await window.yalqen.sendAgentChat(
          snapshot.state.id,
          text,
          attached.map((tab) => tab.id),
          $state.snapshot(sent),
        ))
      )
        throw new Error('Unavailable');
      if (composer.text === text) {
        updateDraft({ text: '' });
        if (composer.attachments === attached) updateDraft({ attachments: [] });
      }
      if (composer.images === sent) updateDraft({ images: [] });
      attachmentChanged = false;
      onsent();
    } catch {
      onfailed();
    } finally {
      onsending(false);
      textarea?.focus();
    }
  }

  async function addImages(files: Iterable<File>): Promise<void> {
    imageRejected = false;
    for (const file of files) {
      if (!acceptsImage(file) || composer.images.length >= MAX_IMAGES) {
        imageRejected = true;
        continue;
      }
      try {
        const image = await readImage(file);
        if (composer.images.length >= MAX_IMAGES) continue;
        updateDraft({ images: [...composer.images, image] });
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
      onfailed();
    }
  }

  async function cancelQueued(messageId: string): Promise<void> {
    if (!snapshot.state.id) return;
    try {
      await window.yalqen.cancelQueuedAgentChat(snapshot.state.id, messageId);
    } catch {
      onfailed();
    }
  }

  async function interrupt(): Promise<void> {
    if (!snapshot.state.id || cancelling) return;
    cancelling = true;
    try {
      await window.yalqen.interruptAgentChat(snapshot.state.id);
    } catch {
      onfailed();
    } finally {
      cancelling = false;
    }
  }

  async function pickSuggestion(index: number): Promise<void> {
    const item = suggestions[index];
    if (!item || !trigger) return;
    if (item.insert === null) {
      const tab = attachableTabs.find((tab) => item.key === `tab:${tab.id}`);
      if (tab) addTab(tab);
    }
    const next = complete(composer.text, trigger, item.insert ?? '');
    updateDraft({ text: next.text });
    caret = next.caret;
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(next.caret, next.caret);
  }

  function trackCaret(): void {
    caret = textarea?.selectionStart ?? composer.text.length;
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

  function addTab(tab: TabSnapshot): void {
    if (composer.attachments.length >= MAX_CHAT_TABS || composer.attachments.some((item) => item.id === tab.id)) return;
    updateDraft({ attachments: [...composer.attachments, tab] });
    attachmentChanged = false;
  }

  function toggleTab(tab: TabSnapshot): void {
    if (composer.attachments.some((item) => item.id === tab.id))
      updateDraft({ attachments: composer.attachments.filter((item) => item.id !== tab.id) });
    else addTab(tab);
  }

  export function suggest(prompt: string): void {
    updateDraft({ text: prompt });
    if (attachable?.agentObserved) addTab(attachable);
    textarea?.focus();
  }

  export function fillIfEmpty(text: string): void {
    if (!composer.text.trim()) updateDraft({ text });
  }

  export function focus(): void {
    textarea?.focus();
  }

  $effect(() => {
    const valid = composer.attachments.filter((attached) =>
      attachableTabs.some((tab) => tab.id === attached.id && tab.url === attached.url),
    );
    if (valid.length !== composer.attachments.length) {
      updateDraft({ attachments: valid });
      attachmentChanged = true;
    }
  });

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
</script>

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
  <div class="composer-box" style:anchor-name="--composer-box">
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
    {#if composer.images.length}
      <div class="thumbnails">
        {#each composer.images as image, index (index)}
          <div class="thumbnail">
            <img src={image.thumbnail} alt="" />
            <IconButton
              size="sm"
              icon="close"
              label={t('agentChat.removeImage')}
              onclick={() => updateDraft({ images: composer.images.filter((entry) => entry !== image) })}
            />
          </div>
        {/each}
      </div>
    {/if}
    {#if imageRejected}<p class="image-hint" role="status">{t('agentChat.imageRejected')}</p>{/if}
    {#if attachmentChanged}<p class="image-hint" role="status">{t('agentChat.tabChanged')}</p>{/if}
    {#if pageContext}
      <div class="page-context" title={pageContext.url}>
        <span class="page-icon">
          {#if pageContext.faviconUrl}<img src={pageContext.faviconUrl} alt="" />{:else}<Icon
              name="globe"
              size={14}
            />{/if}
        </span>
        <span class="page-text"><span>{pageContext.title}</span><small>{displayHost(pageContext.url)}</small></span>
      </div>
    {/if}
    {#if composer.attachments.length || elements.length}
      <div class="chips">
        {#each composer.attachments as attachment (attachment.id)}
          <div class="attachment" title={attachment.url}>
            <Icon name="globe" size={12} /><span class="attachment-text">
              <span>{attachment.title}</span><small>{displayHost(attachment.url)}</small>
            </span><IconButton
              size="sm"
              icon="close"
              label={t('agentChat.removeTab')}
              onclick={() =>
                updateDraft({ attachments: composer.attachments.filter((tab) => tab.id !== attachment.id) })}
            />
          </div>
        {/each}
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
      bind:value={() => composer.text, (text) => updateDraft({ text })}
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
      placeholder={pageContext ? t('agentChat.placeholderPage') : t('agentChat.placeholderAgent', { agent: agentName })}
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
      <TabAttachments tabs={attachableTabs} selected={composer.attachments} ontoggle={toggleTab} />
      <IconButton
        icon="image"
        label={t('agentChat.addImage')}
        disabled={composer.images.length >= MAX_IMAGES}
        onclick={() => fileInput?.click()}
      />
      <IconButton
        icon="screenshot"
        label={t('visualComparison.open')}
        variant={comparisonOpen ? 'tonal' : 'ghost'}
        aria-expanded={comparisonOpen}
        onclick={ontogglecomparison}
      />
      <IconButton
        icon="check"
        label={t('browserChecks.open')}
        variant={checksOpen ? 'tonal' : 'ghost'}
        aria-expanded={checksOpen}
        onclick={ontogglechecks}
      />
      {@render settings()}
      <span class="spacer"></span>
      {#if usage}
        <span class="usage">
          {#if usage.contextTokens !== null && usage.contextLimit}<span
              title={t('agentChat.context', {
                used: numbers.format(usage.contextTokens),
                limit: numbers.format(usage.contextLimit),
              })}
            >
              {Math.round((usage.contextTokens / usage.contextLimit) * 100)}%
            </span>{/if}
          <span title={t('agentChat.cost')}>{currency.format(usage.cost)}</span>
        </span>
      {/if}
      {#if busy && !composer.text.trim()}<IconButton
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
  </div>
</form>

{#snippet settings()}
  <ComposerSettings label={t('agentChat.settings')} summary={settingsSummary} area="--composer-box">
    {#if snapshot.state.provider === 'claude'}
      <span class="setting-label">{t('agentChat.modeLabel')}</span>
      <Select
        aria-label={t('agentChat.modeLabel')}
        value={snapshot.state.permissionMode}
        options={modes}
        onchange={(permissionMode) => configure({ permissionMode })}
      />
    {/if}
    <span class="setting-label">{t('agentChat.workMode')}</span>
    <Select
      aria-label={t('agentChat.workMode')}
      title={t(`agentChat.workHint.${snapshot.state.workMode}`)}
      value={snapshot.state.workMode}
      options={workModes}
      onchange={(workMode) => configure({ workMode })}
    />
    <span class="setting-label">{t('agentChat.replyLength')}</span>
    <Select
      aria-label={t('agentChat.replyLength')}
      title={t(snapshot.state.replyLength === 'short' ? 'agentChat.replyShortHint' : 'agentChat.replyDetailedHint')}
      value={snapshot.state.replyLength}
      options={replyLengths}
      onchange={(replyLength) => configure({ replyLength })}
    />
    {#if models.length > 1}
      <span class="setting-label">{t('agentChat.modelLabel')}</span>
      <Select
        aria-label={t('agentChat.modelLabel')}
        title={snapshot.state.model ?? t('agentChat.modelLabel')}
        value={snapshot.state.modelChoice ?? ''}
        options={models}
        onchange={(model) => configure({ model: model || null })}
      />
    {/if}
    {#if efforts.length}
      <span class="setting-label">{t('agentChat.effortLabel')}</span>
      <Select
        aria-label={t('agentChat.effortLabel')}
        title={t('agentChat.effortLabel')}
        value={snapshot.state.effort ?? ''}
        options={effortOptions}
        onchange={(effort) => configure({ effort: (effort || null) as AgentEffort | null })}
      />
    {/if}
  </ComposerSettings>
{/snippet}

<style>
  .composer {
    flex: none;
    padding: 0 12px 10px;
  }
  .composer-box {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 0 6px;
    padding: 8px 8px 8px 14px;
    border: 1px solid rgb(from var(--text) r g b / 0.12);
    border-radius: 16px;
    background: rgb(from var(--text) r g b / 0.04);
  }
  .composer-box > * {
    grid-column: 1 / -1;
  }
  textarea {
    box-sizing: border-box;
    display: block;
    width: 100%;
    min-height: 22px;
    max-height: 180px;
    padding: 3px 0;
    border: 0;
    outline: 0;
    resize: none;
    field-sizing: content;
    background: none;
    color: var(--text);
    font: var(--ai-text) / 1.55 var(--font);
  }
  .composer-box > textarea {
    grid-column: 1;
    align-self: center;
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
    gap: 2px;
    min-width: 0;
    margin: 0;
  }
  .composer-box > .composer-controls {
    grid-column: 2;
  }
  .composer-controls :global(.icon-btn:not(.send-button)) {
    color: var(--text-muted);
  }
  .composer-controls :global(.icon-btn:not(.send-button):hover:not(:disabled)) {
    color: var(--text);
  }
  .composer-controls :global(.send-button) {
    flex: none;
  }
  .spacer {
    flex: 1;
  }
  .usage {
    display: flex;
    gap: 8px;
    padding: 0 4px;
    color: var(--text-muted);
    font-size: var(--ai-meta);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
    margin: 0 0 8px;
    color: var(--warn);
    font-size: var(--ai-meta);
  }
  .queue {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .queue li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 2px 10px;
    border-radius: var(--radius-control);
    background: var(--surface-hover);
    font-size: var(--ai-small);
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .attachment {
    width: fit-content;
    max-width: 100%;
    padding: 6px 4px 6px 8px;
    border-radius: 10px;
    background: rgb(from var(--text) r g b / 0.06);
    color: var(--text);
    font-size: var(--ai-meta);
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .attachment > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attachment > :global(svg) {
    flex: none;
  }
  .attachment-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .attachment-text > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attachment-text > span {
    font-weight: 600;
  }
  .attachment-text small {
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }
  .page-context {
    display: flex;
    align-items: center;
    gap: 10px;
    width: fit-content;
    max-width: 100%;
    margin: 2px 0 10px;
    padding: 8px 14px 8px 8px;
    border-radius: 10px;
    background: rgb(from var(--text) r g b / 0.08);
  }
  .page-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: light-dark(#ffffff, #1c1c1e);
    color: var(--text-muted);
  }
  .page-icon img {
    width: 16px;
    height: 16px;
    border-radius: 3px;
  }
  .page-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }
  .page-text > span,
  .page-text small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .page-text > span {
    max-width: 180px;
    font-size: var(--ai-small);
    font-weight: 500;
  }
  .page-text small {
    color: var(--text-muted);
    font-size: var(--ai-meta);
  }

  /* .composer-box keeps these above the shared button and select rules. */
  .composer-box .composer-controls :global(.settings-trigger) {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  .composer-box .composer-controls :global(.send-button),
  .composer-box .composer-controls :global(.send-button.accent:disabled) {
    border-radius: 50%;
    background-color: var(--frame-primary, var(--accent));
    color: #fff;
  }
  .composer-box .composer-controls :global(.send-button:disabled) {
    opacity: 0.55;
  }
</style>
