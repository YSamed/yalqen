<script lang="ts">
  import { onMount } from 'svelte';
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import type { IconName } from '../ui/Icon.svelte';
  import Button from '../ui/Button.svelte';
  import AgentBridge from './AgentBridge.svelte';
  import AppearancePane from './AppearancePane.svelte';
  import Extensions from './Extensions.svelte';
  import GeneralPane from './GeneralPane.svelte';
  import Passwords from './Passwords.svelte';
  import PerformancePane from './PerformancePane.svelte';
  import PrivacyPane from './PrivacyPane.svelte';
  import RequestRules from './RequestRules.svelte';
  import SitePermissions from './SitePermissions.svelte';

  const api = window.yalqenSettings;

  type PaneId = 'general' | 'appearance' | 'privacy' | 'passwords' | 'performance' | 'extensions' | 'developer';
  const panes: { id: PaneId; label: string; icon: IconName }[] = [
    { id: 'general', label: t('settings.paneGeneral'), icon: 'settings' },
    { id: 'appearance', label: t('settings.paneAppearance'), icon: 'appearance' },
    { id: 'privacy', label: t('settings.panePrivacy'), icon: 'lock' },
    { id: 'passwords', label: t('settings.panePasswords'), icon: 'key' },
    { id: 'performance', label: t('settings.panePerformance'), icon: 'gauge' },
    { id: 'extensions', label: t('settings.paneExtensions'), icon: 'extensions' },
    { id: 'developer', label: t('settings.paneDeveloper'), icon: 'sparkle' },
  ];
  const paneFromPath = panes.find((item) => `/${item.id}` === location.pathname)?.id;
  let pane = $state<PaneId>(paneFromPath ?? 'general');
  let view = $state<SettingsView | null>(null);

  $effect(() => {
    const path = pane === 'general' ? '/' : `/${pane}`;
    if (location.pathname !== path) history.replaceState(null, '', path);
  });

  function movePane(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = panes.findIndex((item) => item.id === pane);
    pane = panes[(index + step + panes.length) % panes.length].id;
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

{#if view}
  <div class="settings">
    <h1>{t('settings.pageTitle')}</h1>
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
            aria-selected={pane === item.id}
            tabindex={pane === item.id ? 0 : -1}
            onclick={() => (pane = item.id)}
            onkeydown={movePane}
          >
            {item.label}
          </Button>
        {/each}
      </div>
      <div id="pane" class="pane" role="tabpanel" aria-labelledby="tab-{pane}">
        {#if pane === 'general'}
          <GeneralPane {view} {update} {makeDefault} />
        {:else if pane === 'appearance'}
          <AppearancePane values={view.values} {update} />
        {:else if pane === 'privacy'}
          <PrivacyPane values={view.values} {update} />
          <SitePermissions />
        {:else if pane === 'passwords'}
          <Passwords />
        {:else if pane === 'extensions'}
          <Extensions />
        {:else if pane === 'developer'}
          <AgentBridge values={view.values} {update} />
          <RequestRules />
        {:else}
          <PerformancePane values={view.values} {update} />
        {/if}
      </div>
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

  h1 {
    margin: 0 0 24px;
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
  }

  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
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
