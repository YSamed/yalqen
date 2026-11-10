<script lang="ts">
  import {
    REQUIRED_TOOLBAR_BUTTON,
    TOOLBAR_BUTTON_IDS,
    toolbarExtensionId,
    toolbarExtensionItem,
    type ToolbarButtonId,
    type ToolbarExtension,
    type ToolbarItemId,
  } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Icon, { type IconName } from '../ui/Icon.svelte';

  let {
    shown: saved,
    extensions = [],
    onchange,
  }: {
    shown: readonly ToolbarItemId[];
    extensions?: readonly ToolbarExtension[];
    onchange: (buttons: ToolbarItemId[]) => void;
  } = $props();

  const buttons: Record<ToolbarButtonId, { label: string; icon: IconName }> = {
    home: { label: t('toolbar.home'), icon: 'home' },
    bookmarks: { label: t('settings.bookmarks'), icon: 'bookmarks' },
    history: { label: t('settings.history'), icon: 'history' },
    extensions: { label: t('settings.paneExtensions'), icon: 'extensions' },
    profile: { label: t('settings.profile'), icon: 'profile' },
    settings: { label: t('settings.toolbarSettings'), icon: 'settings' },
    screenshot: { label: t('toolbar.fullPageScreenshot'), icon: 'screenshot' },
    downloads: { label: t('settings.downloads'), icon: 'download' },
    devtools: { label: t('toolbar.devtools'), icon: 'code' },
  };

  function itemOf(id: ToolbarItemId): { label: string; icon: IconName; image: string | null } | null {
    const extensionId = toolbarExtensionId(id);
    if (!extensionId) return { ...buttons[id as ToolbarButtonId], image: null };
    const extension = extensions.find((candidate) => candidate.id === extensionId);
    return extension ? { label: extension.title, icon: 'extensions', image: extension.icon } : null;
  }

  // Pinned extensions that are no longer installed stay saved but are not shown or moved.
  const shown = $derived(saved.filter((id) => itemOf(id) !== null));
  const missing = $derived(saved.filter((id) => itemOf(id) === null));
  const hidden = $derived(TOOLBAR_BUTTON_IDS.filter((id) => !shown.includes(id)));
  const hiddenExtensions = $derived(
    extensions.map((extension) => toolbarExtensionItem(extension.id)).filter((id) => !shown.includes(id)),
  );
  let bar = $state<HTMLElement>();
  let dragging = $state<ToolbarItemId | null>(null);
  let dropIndex = $state<number | null>(null);

  function save(items: ToolbarItemId[]): void {
    onchange([...items, ...missing]);
  }

  function place(id: ToolbarItemId, index: number): void {
    const rest = shown.filter((item) => item !== id);
    const from = shown.indexOf(id);
    const at = from !== -1 && from < index ? index - 1 : index;
    rest.splice(Math.max(0, Math.min(at, rest.length)), 0, id);
    save(rest);
  }

  function remove(id: ToolbarItemId): void {
    if (id !== REQUIRED_TOOLBAR_BUTTON) save(shown.filter((item) => item !== id));
  }

  async function focusButton(id: ToolbarItemId): Promise<void> {
    await Promise.resolve();
    bar?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
  }

  function keydown(event: KeyboardEvent, id: ToolbarItemId): void {
    const index = shown.indexOf(id);
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const target = event.key === 'ArrowLeft' ? index - 1 : index + 2;
      if (target < 0 || target > shown.length) return;
      place(id, target);
      void focusButton(id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(id);
    }
  }

  function dragStart(event: DragEvent, id: ToolbarItemId): void {
    dragging = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  }

  function dragEnd(): void {
    dragging = null;
    dropIndex = null;
  }

  // The marker goes before the first button whose middle is right of the pointer.
  function dragOverBar(event: DragEvent): void {
    if (!dragging || !bar) return;
    event.preventDefault();
    const chips = [...bar.querySelectorAll<HTMLElement>('[data-id]')];
    const index = chips.findIndex((chip) => {
      const bounds = chip.getBoundingClientRect();
      return event.clientX < bounds.left + bounds.width / 2;
    });
    dropIndex = index === -1 ? chips.length : index;
  }

  function dropOnBar(event: DragEvent): void {
    event.preventDefault();
    if (dragging && dropIndex !== null) place(dragging, dropIndex);
    dragEnd();
  }

  function dragOverTray(event: DragEvent): void {
    if (!dragging || !shown.includes(dragging) || dragging === REQUIRED_TOOLBAR_BUTTON) return;
    event.preventDefault();
    dropIndex = null;
  }

  function dropOnTray(event: DragEvent): void {
    event.preventDefault();
    if (dragging) remove(dragging);
    dragEnd();
  }
</script>

{#snippet glyph(item: { icon: IconName; image: string | null })}
  {#if item.image}<img src={item.image} alt="" width="16" height="16" />{:else}<Icon name={item.icon} />{/if}
{/snippet}

{#snippet spare(id: ToolbarItemId)}
  {@const item = itemOf(id)!}
  <button
    type="button"
    class="chip spare"
    draggable="true"
    title={item.label}
    aria-label={t('settings.addToolbarButton', { label: item.label })}
    onclick={() => save([...shown, id])}
    ondragstart={(event) => dragStart(event, id)}
    ondragend={dragEnd}
  >
    {@render glyph(item)}
  </button>
{/snippet}

<div class="editor">
  <div
    class="bar"
    role="group"
    aria-label={t('settings.toolbarPreview')}
    bind:this={bar}
    ondragover={dragOverBar}
    ondragleave={(event) => {
      if (!bar?.contains(event.relatedTarget as Node | null)) dropIndex = null;
    }}
    ondrop={dropOnBar}
  >
    <span class="nav" aria-hidden="true">
      <Icon name="back" />
      <Icon name="forward" />
      <Icon name="reload" />
    </span>
    <span class="address" aria-hidden="true">
      <Icon name="lock" size={12} />
      <span>yalqen.com</span>
    </span>
    {#each shown as id, index (id)}
      {@const item = itemOf(id)!}
      {#if dropIndex === index}<span class="marker"></span>{/if}
      <button
        type="button"
        class="chip"
        class:dragging={dragging === id}
        data-id={id}
        draggable="true"
        title={id === REQUIRED_TOOLBAR_BUTTON ? `${item.label} · ${t('settings.settingsAlwaysVisible')}` : item.label}
        aria-label={id === REQUIRED_TOOLBAR_BUTTON
          ? item.label
          : t('settings.removeToolbarButton', { label: item.label })}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
        onclick={() => remove(id)}
        onkeydown={(event) => keydown(event, id)}
        ondragstart={(event) => dragStart(event, id)}
        ondragend={dragEnd}
      >
        {@render glyph(item)}
      </button>
    {/each}
    {#if dropIndex === shown.length}<span class="marker"></span>{/if}
  </div>

  <div
    class="tray"
    class:target={dragging && shown.includes(dragging) && dragging !== REQUIRED_TOOLBAR_BUTTON}
    role="group"
    aria-label={t('settings.toolbarAvailable')}
    ondragover={dragOverTray}
    ondrop={dropOnTray}
  >
    {#if hidden.length || hiddenExtensions.length}
      <span class="tray-label">{t('settings.toolbarAvailable')}</span>
    {:else}
      <span class="tray-label">{t('settings.toolbarAllShown')}</span>
    {/if}
    {#each hidden as id (id)}
      {@render spare(id)}
    {/each}
    {#if hiddenExtensions.length}
      <span class="tray-label extensions-label">{t('toolbar.extensions')}</span>
      {#each hiddenExtensions as id (id)}
        {@render spare(id)}
      {/each}
    {/if}
  </div>
  <p class="hint">{t('settings.toolbarEditHint')}</p>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 6px 0 14px;
    border-bottom: 1px solid var(--border);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-hover);
  }

  .nav {
    display: flex;
    gap: 10px;
    padding: 0 8px 0 4px;
    color: var(--text-muted);
  }

  .address {
    display: flex;
    flex: 1 1 140px;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--control-md);
    margin-right: 4px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .chip {
    display: grid;
    place-items: center;
    width: var(--control-md);
    height: var(--control-md);
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text);
    cursor: grab;
  }

  .chip:hover {
    background: var(--surface-hover);
  }

  .chip:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 1px;
  }

  .chip.dragging {
    opacity: 0.35;
  }

  .marker {
    width: 2px;
    height: 20px;
    border-radius: 1px;
    background: var(--accent);
  }

  .tray {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: var(--control-md);
    border-radius: 12px;
  }

  .tray.target {
    outline: 1px dashed var(--text-muted);
    outline-offset: 4px;
  }

  .tray-label {
    margin-right: 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .chip.spare {
    border: 1px dashed var(--border);
    color: var(--text-muted);
    cursor: pointer;
  }

  .chip.spare:hover {
    color: var(--text);
  }

  .chip img {
    display: block;
    pointer-events: none;
  }

  .extensions-label {
    margin-left: 8px;
  }

  p.hint {
    margin: 0;
  }
</style>
