<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import type { IconName } from '../ui/Icon.svelte';
  import Button from '../ui/Button.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import AgentBridge from './AgentBridge.svelte';
  import AppearancePane from './AppearancePane.svelte';
  import Extensions from './Extensions.svelte';
  import GeneralPane from './GeneralPane.svelte';
  import Passwords from './Passwords.svelte';
  import Autofill from './Autofill.svelte';
  import PerformancePane from './PerformancePane.svelte';
  import PrivacyPane from './PrivacyPane.svelte';
  import RequestRules from './RequestRules.svelte';
  import SitePermissions from './SitePermissions.svelte';
  import SiteProtectionExceptions from './SiteProtectionExceptions.svelte';
  import SiteStorage from './SiteStorage.svelte';

  const api = window.yalqenSettings;

  type PaneId =
    'general' | 'appearance' | 'privacy' | 'sites' | 'passwords' | 'performance' | 'extensions' | 'developer';
  const panes: { id: PaneId; label: string; icon: IconName }[] = [
    { id: 'general', label: t('settings.paneGeneral'), icon: 'settings' },
    { id: 'appearance', label: t('settings.paneAppearance'), icon: 'appearance' },
    { id: 'privacy', label: t('settings.panePrivacy'), icon: 'lock' },
    { id: 'sites', label: t('settings.paneSites'), icon: 'globe' },
    { id: 'passwords', label: t('settings.panePasswordsAutofill'), icon: 'key' },
    { id: 'performance', label: t('settings.panePerformance'), icon: 'gauge' },
    { id: 'extensions', label: t('settings.paneExtensions'), icon: 'extensions' },
    { id: 'developer', label: t('settings.paneDeveloper'), icon: 'sparkle' },
  ];
  // Addresses and cards used to have their own pane; older links still land next to passwords.
  const aliases: Record<string, PaneId> = { '/autofill': 'passwords' };
  const paneFromPath = panes.find((item) => `/${item.id}` === location.pathname)?.id ?? aliases[location.pathname];
  let pane = $state<PaneId>(paneFromPath ?? 'general');
  let view = $state<SettingsView | null>(null);
  let query = $state('');
  let results = $state<HTMLElement>();
  let anyMatch = $state(true);
  const searching = $derived(query.trim() !== '');

  $effect(() => {
    const path = pane === 'general' ? '/' : `/${pane}`;
    if (location.pathname !== path) history.replaceState(null, '', `${path}${location.hash}`);
  });

  // Rows come from many components, so matching works on what they render: a section heading that
  // matches keeps its whole section, otherwise only the rows that mention the term stay visible.
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
    // Lists such as passwords or site data load after the pane appears.
    const observer = new MutationObserver(filterResults);
    observer.observe(results, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  });

  function showPane(id: PaneId): void {
    query = '';
    pane = id;
  }

  function movePane(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = panes.findIndex((item) => item.id === pane);
    showPane(panes[(index + step + panes.length) % panes.length].id);
    document.getElementById(`tab-${pane}`)?.focus();
  }

  async function update(patch: Partial<SettingsValues>): Promise<void> {
    view = await api.update(patch);
  }

  async function makeDefault(): Promise<void> {
    view = await api.makeDefault();
  }

  onMount(() => {
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
    <GeneralPane {view} {update} {makeDefault} />
  {:else if id === 'appearance'}
    <AppearancePane values={view.values} {update} />
  {:else if id === 'privacy'}
    <PrivacyPane values={view.values} threatLists={view.threatLists} {update} />
  {:else if id === 'sites'}
    <SitePermissions />
    <SiteProtectionExceptions values={view.values} {update} />
    <SiteStorage />
  {:else if id === 'passwords'}
    <Passwords />
    <Autofill />
  {:else if id === 'extensions'}
    <Extensions values={view.values} {update} />
  {:else if id === 'developer'}
    <AgentBridge values={view.values} {update} />
    <RequestRules />
  {:else}
    <PerformancePane values={view.values} {update} />
  {/if}
{/snippet}

{#if view}
  <div class="settings">
    <div class="heading">
      <h1>{t('settings.pageTitle')}</h1>
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
    </div>
    <div class="layout">
      <div class="panes" role="tablist" aria-orientation="vertical" aria-label={t('settings.sections')}>
        {#each panes as item (item.id)}
          <Button
            size="lg"
            icon={item.icon}
            role="tab"
            id="tab-{item.id}"
            class="pane-tab"
            aria-controls="pane"
            aria-selected={!searching && pane === item.id}
            tabindex={pane === item.id ? 0 : -1}
            onclick={() => showPane(item.id)}
            onkeydown={movePane}
          >
            {item.label}
          </Button>
        {/each}
      </div>
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
  </div>
{/if}

<style>
  :global(:root) {
    --font-size: 14px;
    --font-size-small: 12px;
  }

  :global(body) {
    overflow-y: auto;
    background: var(--bg);
    line-height: 1.45;
  }

  .settings {
    width: min(1000px, 100%);
    margin: 0 auto;
    padding: 42px 24px 80px;
  }

  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin: 0 0 24px;
  }

  .search {
    width: min(320px, 50%);
  }

  h1 {
    margin: 0;
    font-size: 30px;
    letter-spacing: -0.03em;
  }

  .layout {
    display: flex;
    align-items: flex-start;
    gap: 40px;
  }

  .panes {
    position: sticky;
    top: 24px;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 4px;
    width: 180px;
  }

  .panes :global(.pane-tab) {
    justify-content: flex-start;
    width: 100%;
    height: auto;
    min-height: var(--control-lg);
    padding-block: 6px;
    white-space: normal;
    text-align: start;
  }

  /* Long labels such as "Passwords and autofill" wrap instead of being cut off. */
  .panes :global(.pane-tab > span) {
    overflow: visible;
    text-overflow: clip;
  }

  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
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
    font-size: 17px;
    font-weight: 600;
  }

  .pane :global(h2) {
    margin: 30px 0 8px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
  }

  .pane :global(h2:first-child) {
    margin-top: 6px;
  }

  .pane :global(.row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    min-height: 58px;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
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
</style>
