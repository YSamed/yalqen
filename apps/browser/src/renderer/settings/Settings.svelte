<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { SettingsSaveResult, SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { accentCss, accentHex } from '../../shared/accent';
  import type { IconName } from '../ui/Icon.svelte';
  import Icon from '../ui/Icon.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import AboutPane from './AboutPane.svelte';
  import AgentBridge from './AgentBridge.svelte';
  import AppearancePane from './AppearancePane.svelte';
  import Extensions from './Extensions.svelte';
  import GeneralPane from './GeneralPane.svelte';
  import Passwords from './Passwords.svelte';
  import Autofill from './Autofill.svelte';
  import DataScope from './DataScope.svelte';
  import PerformancePane from './PerformancePane.svelte';
  import PrivacyPane from './PrivacyPane.svelte';
  import Profiles from './Profiles.svelte';
  import ProfilesPane from './ProfilesPane.svelte';
  import RequestRules from './RequestRules.svelte';
  import Sites from './Sites.svelte';
  import ShortcutsPane from './ShortcutsPane.svelte';

  const api = window.yalqenSettings;

  type PaneId = 'general' | 'tabs' | 'privacy' | 'profiles' | 'passwords' | 'extensions' | 'shortcuts' | 'advanced';
  const panes: { id: PaneId; label: string; icon: IconName }[] = [
    { id: 'general', label: t('settings.paneGeneral'), icon: 'settings' },
    { id: 'tabs', label: t('settings.paneTabs'), icon: 'sidebar' },
    { id: 'privacy', label: t('settings.panePrivacy'), icon: 'lock' },
    { id: 'profiles', label: t('settings.paneProfiles'), icon: 'profile' },
    { id: 'passwords', label: t('settings.panePasswordsAutofill'), icon: 'key' },
    { id: 'extensions', label: t('settings.paneExtensions'), icon: 'extensions' },
    { id: 'shortcuts', label: t('settings.paneShortcuts'), icon: 'menu' },
    { id: 'advanced', label: t('settings.paneAdvanced'), icon: 'code' },
  ];
  const aliases: Record<string, PaneId> = {
    '/autofill': 'passwords',
    '/appearance': 'general',
    '/performance': 'tabs',
    '/sites': 'privacy',
    '/developer': 'advanced',
    '/about': 'advanced',
  };
  const paneFromPath = panes.find((item) => `/${item.id}` === location.pathname)?.id ?? aliases[location.pathname];
  type Page = PaneId | `profile:${string}`;
  let dataSpace = $state(new URLSearchParams(location.search).get('space') ?? '');
  // The main process reads ?space= from this page's URL to pick whose passwords, cards and permissions to serve.
  function setDataSpace(id: string): void {
    const url = new URL(location.href);
    if (id) url.searchParams.set('space', id);
    else url.searchParams.delete('space');
    history.replaceState(null, '', url);
    dataSpace = id;
  }

  function showData(page: 'privacy' | 'passwords', space: string): void {
    setDataSpace(space);
    showPane(page);
  }

  const profileFromHash = new URLSearchParams(location.hash.slice(1)).get('profile');
  let trail = $state<Page[]>([
    paneFromPath === 'profiles' && profileFromHash !== null
      ? `profile:${profileFromHash}`
      : (paneFromPath ?? 'general'),
  ]);
  let at = $state(0);
  const page = $derived(trail[at]);
  const editedProfile = $derived(page.startsWith('profile:') ? page.slice('profile:'.length) : null);
  const pane = $derived<PaneId>(editedProfile === null ? (page as PaneId) : 'profiles');
  const paneLabel = $derived(
    editedProfile === null ? (panes.find((item) => item.id === pane)?.label ?? '') : t('profiles.edit'),
  );
  let view = $state<SettingsView | null>(null);
  let saveFailed = $state(false);
  let query = $state('');
  let results = $state<HTMLElement>();
  let anyMatch = $state(true);
  const searching = $derived(query.trim() !== '');

  $effect(() => {
    if (view) document.documentElement.style.setProperty('--accent', accentCss(accentHex(view.values.accentColor)));
  });

  $effect(() => {
    const path = pane === 'general' ? '/' : `/${pane}`;
    if (location.pathname !== path) history.replaceState(null, '', `${path}${location.search}${location.hash}`);
  });

  function filterResults(): void {
    if (!results) return;
    const term = query.trim().toLocaleLowerCase();
    const matches = (element: Element) => (element.textContent ?? '').toLocaleLowerCase().includes(term);
    let found = false;
    for (const section of results.querySelectorAll<HTMLElement>(':scope > .result')) {
      let heading: HTMLElement | null = null;
      let headingMatches = false;
      let sectionFound = false;
      const closeGroup = () => {
        if (heading) heading.hidden = !sectionFound;
      };
      for (const child of section.querySelector('.result-body')?.children ?? []) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.tagName === 'H2') {
          closeGroup();
          heading = child;
          headingMatches = matches(child);
          sectionFound = false;
          continue;
        }
        const visible = headingMatches || matches(child);
        child.hidden = !visible;
        if (visible) sectionFound = true;
      }
      closeGroup();
      section.hidden = !section.querySelector('.result-body > :not([hidden])');
      if (!section.hidden) found = true;
    }
    anyMatch = found;
  }

  $effect(() => {
    if (!searching || !results) return;
    void query;
    void tick().then(filterResults);
    const observer = new MutationObserver(filterResults);
    observer.observe(results, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  });

  function showPane(id: Page): void {
    query = '';
    if (id === page) return;
    trail = [...trail.slice(0, at + 1), id];
    at = trail.length - 1;
  }

  function step(offset: -1 | 1): void {
    query = '';
    at = Math.min(Math.max(at + offset, 0), trail.length - 1);
  }

  function movePane(event: KeyboardEvent): void {
    const offset = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const index = panes.findIndex((item) => item.id === pane);
    showPane(panes[(index + offset + panes.length) % panes.length].id);
    document.getElementById(`tab-${pane}`)?.focus();
  }

  async function saveSettings(request: () => Promise<SettingsSaveResult | null>): Promise<void> {
    try {
      const result = await request();
      if (!result) return;
      view = result.view;
      saveFailed = !result.saved;
    } catch {
      saveFailed = true;
    }
  }

  function update(patch: Partial<SettingsValues>): Promise<void> {
    return saveSettings(() => api.update($state.snapshot(patch)));
  }

  function chooseDownloadDirectory(): Promise<void> {
    return saveSettings(() => api.chooseDownloadDirectory());
  }

  async function makeDefault(): Promise<void> {
    view = await api.makeDefault();
  }

  onMount(() => {
    if (new URLSearchParams(location.search).has('window')) document.documentElement.classList.add('window');
    void api.get().then((next) => {
      view = next;
    });
    return api.onChange((next) => {
      view = next;
    });
  });
</script>

{#snippet content(id: PaneId, view: SettingsView)}
  {#if id === 'general'}
    <GeneralPane section="general" {view} {update} {makeDefault} {chooseDownloadDirectory} />
    <AppearancePane section="look" values={view.values} {update} />
  {:else if id === 'tabs'}
    <AppearancePane section="tabs" values={view.values} {update} />
    <GeneralPane section="windows" {view} {update} {makeDefault} {chooseDownloadDirectory} />
    <PerformancePane values={view.values} {update} />
  {:else if id === 'privacy'}
    <PrivacyPane section="protection" values={view.values} threatLists={view.threatLists} {update} />
    {#key dataSpace}
      <DataScope spaces={view.spaces} value={dataSpace} onchange={setDataSpace} />
      <Sites values={view.values} {update} />
    {/key}
  {:else if id === 'profiles'}
    <ProfilesPane {view} {update} profile={searching ? null : editedProfile} open={showPane} {showData} />
  {:else if id === 'passwords'}
    {#key dataSpace}
      <DataScope spaces={view.spaces} value={dataSpace} onchange={setDataSpace} />
      <Passwords />
      <Autofill />
    {/key}
  {:else if id === 'extensions'}
    <Extensions values={view.values} {update} />
  {:else if id === 'shortcuts'}
    <ShortcutsPane values={view.values} {update} />
  {:else}
    <AboutPane {view} {update} />
    <Profiles />
    <PrivacyPane section="advanced" values={view.values} threatLists={view.threatLists} {update} />
    <AgentBridge values={view.values} {update} />
    <RequestRules />
  {/if}
{/snippet}

{#if view}
  <div class="settings">
    <nav class="sidebar" aria-label={t('settings.sections')}>
      <div class="panes" role="tablist" aria-orientation="vertical">
        {#each panes as item (item.id)}
          <button
            type="button"
            role="tab"
            id="tab-{item.id}"
            class="pane-tab"
            aria-controls="pane"
            aria-selected={!searching && pane === item.id}
            tabindex={pane === item.id ? 0 : -1}
            onclick={() => showPane(item.id)}
            onkeydown={movePane}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </button>
        {/each}
      </div>
    </nav>
    <main class="main">
      <header class="header">
        <div class="history">
          <button type="button" aria-label={t('toolbar.back')} disabled={at === 0} onclick={() => step(-1)}>
            <Icon name="back" size={16} />
          </button>
          <button
            type="button"
            aria-label={t('toolbar.forward')}
            disabled={at === trail.length - 1}
            onclick={() => step(1)}
          >
            <Icon name="forward" size={16} />
          </button>
        </div>
        <h1>{searching ? t('settings.searchSettings') : paneLabel}</h1>
        <div class="search">
          <SearchField
            bind:value={query}
            aria-label={t('settings.searchSettings')}
            placeholder={t('settings.searchSettings')}
            onkeydown={(event) => {
              if (event.key === 'Escape') query = '';
            }}
          />
        </div>
      </header>
      {#if saveFailed}
        <p class="save-error" role="alert">{t('settings.saveFailed')}</p>
      {/if}
      <div class="scroll">
        {#if searching}
          <div id="pane" class="pane" role="region" aria-label={t('settings.searchSettings')} bind:this={results}>
            {#each panes as item (item.id)}
              <section class="result" aria-label={item.label}>
                <p class="result-title">{item.label}</p>
                <div class="result-body">{@render content(item.id, view)}</div>
              </section>
            {/each}
            {#if !anyMatch}<p class="hint" role="status">{t('settings.searchEmpty')}</p>{/if}
          </div>
        {:else}
          <div id="pane" class="pane" role="tabpanel" aria-labelledby="tab-{pane}">
            {@render content(pane, view)}
          </div>
        {/if}
      </div>
    </main>
  </div>
{/if}

<style>
  :global(:root) {
    --font-size: 13px;
    --font-size-small: 11px;
    --settings-sidebar: color-mix(in srgb, var(--surface) 70%, transparent);
    --settings-group: var(--surface);
  }

  :global(html),
  :global(body) {
    height: 100%;
    overflow: hidden;
  }

  :global(body) {
    background: var(--bg);
    line-height: 1.4;
  }

  :global(html.window),
  :global(html.window body) {
    background: transparent;
  }

  .settings {
    display: flex;
    height: 100vh;
  }

  .sidebar {
    flex: none;
    width: 196px;
    padding: 64px 10px 12px;
    border-right: 1px solid var(--border);
    background: var(--settings-sidebar);
  }

  :global(html.window) {
    --settings-group: light-dark(#ffffff, #27282b);
  }

  :global(html.window) .sidebar {
    background: light-dark(#ebebef, #232729);
  }

  :global(html.window) .main {
    background: light-dark(#f5f5f7, #1e1f21);
  }

  :global(html.window) .sidebar,
  :global(html.window) .header {
    -webkit-app-region: drag;
  }

  :global(html.window) .panes,
  :global(html.window) .history,
  :global(html.window) .search {
    -webkit-app-region: no-drag;
  }

  .panes {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pane-tab {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: start;
    cursor: default;
  }

  .pane-tab span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pane-tab :global(svg) {
    flex: none;
    color: rgb(from var(--text) r g b / 0.85);
    stroke-width: 1.2;
  }

  .pane-tab:hover {
    background: var(--surface-hover);
  }

  .pane-tab[aria-selected='true'] {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .pane-tab[aria-selected='true'] :global(svg) {
    color: currentColor;
  }

  .pane-tab:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 1px;
  }

  .main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    background: var(--bg);
  }

  .header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    height: 52px;
    padding: 0 16px 0 9px;
  }

  .history {
    display: flex;
    padding: 2px;
    border-radius: 999px;
    background: rgb(from var(--text) r g b / 0.1);
  }

  .history button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 31px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--text);
  }

  .history button:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .history button:disabled {
    color: var(--text-muted);
    opacity: 0.5;
  }

  h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .search {
    width: min(170px, 35%);
  }

  .save-error {
    flex: none;
    margin: 0;
    padding: 4px 20px 8px;
    color: var(--warn);
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
  }

  .pane {
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
    padding: 8px 20px 32px;
  }

  .pane :global([hidden]) {
    display: none !important;
  }

  .result-body {
    display: flex;
    flex-direction: column;
  }

  .result + .result {
    margin-top: 12px;
  }

  .result-title {
    margin: 6px 0 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 15px;
    font-weight: 600;
  }

  .pane :global(h2) {
    margin: 26px 0 6px;
    padding-inline: 10px;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }

  .pane :global(h2:first-child) {
    margin-top: 8px;
  }

  .pane :global(.row) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 42px;
    padding: 7px 10px;
    background: var(--settings-group);
  }

  .pane :global(.row + .row)::before {
    content: '';
    position: absolute;
    top: 0;
    right: 10px;
    left: 10px;
    border-top: 1px solid var(--border);
  }

  .pane :global(.row:not(.row + .row)) {
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
  }

  .pane :global(.row:not(:has(+ .row))) {
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
  }

  .pane :global(.row.stacked) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .pane :global(.label) {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pane :global(.hint) {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .pane :global(.error) {
    color: var(--warn);
    font-size: var(--font-size-small);
  }

  @media (max-width: 560px) {
    .sidebar {
      width: 56px;
    }

    .pane-tab span {
      display: none;
    }
  }
</style>
