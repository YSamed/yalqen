<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { ClearDataRange, SettingsValues, SettingsView, ToolbarButtonId, UpdateStatus } from '../shared/types';
  import { REQUIRED_TOOLBAR_BUTTON, TOOLBAR_BUTTON_IDS } from '../shared/types';
  import { t } from '../shared/i18n';
  import Extensions from './components/Extensions.svelte';
  import Icon, { type IconName } from './components/Icon.svelte';
  import Passwords from './components/Passwords.svelte';
  import ProcessUsage from './components/ProcessUsage.svelte';
  import RequestRules from './components/RequestRules.svelte';
  import Button from './components/ui/Button.svelte';
  import IconButton from './components/ui/IconButton.svelte';
  import SegmentedControl from './components/ui/SegmentedControl.svelte';
  import Select from './components/ui/Select.svelte';
  import Switch from './components/ui/Switch.svelte';
  import TextField from './components/ui/TextField.svelte';

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

  const panelOptions = [
    { value: false, label: t('settings.panelWide') },
    { value: true, label: t('settings.panelNarrow') },
  ] as const;
  const sideOptions = [
    { value: 'left', label: t('settings.left') },
    { value: 'right', label: t('settings.right') },
  ] as const;
  const toolbarTabOptions = [
    { value: true, label: t('settings.allTabs') },
    { value: false, label: t('settings.currentPageOnly') },
  ] as const;
  const toolbarButtonLabels: Record<ToolbarButtonId, { label: string; icon: IconName }> = {
    bookmarks: { label: t('settings.bookmarks'), icon: 'bookmarks' },
    history: { label: t('settings.history'), icon: 'history' },
    extensions: { label: t('settings.paneExtensions'), icon: 'extensions' },
    profile: { label: t('settings.profile'), icon: 'profile' },
    settings: { label: t('settings.toolbarSettings'), icon: 'settings' },
    downloads: { label: t('settings.downloads'), icon: 'download' },
  };
  const discardOptions = [
    { value: 0, label: t('settings.off') },
    { value: 15, label: t('settings.minutes15') },
    { value: 30, label: t('settings.minutes30') },
    { value: 60, label: t('settings.hours1') },
    { value: 120, label: t('settings.hours2') },
  ] as const;
  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ] as const;
  const startupOptions = [
    { value: 'restore', label: t('settings.startupRestore') },
    { value: 'new-tab', label: t('settings.startupNewTab') },
  ] as const;

  const fontSizeOptions = [
    { value: 'small', label: t('settings.fontSmall') },
    { value: 'medium', label: t('settings.fontMedium') },
    { value: 'large', label: t('settings.fontLarge') },
    { value: 'xlarge', label: t('settings.fontXLarge') },
  ] as const;
  const zoomOptions = [0.8, 0.9, 1, 1.1, 1.25, 1.5].map((factor) => ({
    value: factor,
    label: t('settings.zoomPercent', { percent: Math.round(factor * 100) }),
  }));
  const languageOptions = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
  ] as const;
  const dnsOptions = [
    { value: 'automatic', label: t('settings.dnsAutomatic') },
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'google', label: 'Google' },
    { value: 'quad9', label: 'Quad9' },
    { value: 'off', label: t('settings.off') },
  ] as const;
  const rangeOptions: { value: ClearDataRange; label: string }[] = [
    { value: 'hour', label: t('settings.rangeHour') },
    { value: 'day', label: t('settings.rangeDay') },
    { value: 'week', label: t('settings.rangeWeek') },
    { value: 'month', label: t('settings.rangeMonth') },
    { value: 'all', label: t('settings.rangeAll') },
  ];
  const clearOptions = [
    { key: 'history', label: t('settings.clearHistory') },
    { key: 'downloads', label: t('settings.clearDownloads') },
    { key: 'siteData', label: t('settings.clearSiteData') },
    { key: 'cache', label: t('settings.clearCache') },
  ] as const;

  let clearRange = $state<ClearDataRange>('hour');
  let clearKinds = $state({ history: true, downloads: false, siteData: false, cache: false });
  let clearing = $state(false);
  let cleared = $state(false);
  const clearSelected = $derived(Object.values(clearKinds).some(Boolean));

  async function clearData(): Promise<void> {
    clearing = true;
    cleared = false;
    try {
      await api.clearData({ range: clearRange, ...clearKinds });
      cleared = true;
    } finally {
      clearing = false;
    }
  }

  let view = $state<SettingsView | null>(null);
  let templateDraft = $state('');
  let editingTemplate = $state(false);

  const values = $derived(view?.values);
  const isCustom = $derived(values?.searchEngine === 'custom');
  const engineOptions = $derived([
    ...(view?.engines ?? []).map((engine) => ({ value: engine.id, label: engine.label })),
    { value: 'custom' as const, label: t('settings.custom') },
  ]);
  const templateInvalid = $derived(isCustom && !!values?.customSearchTemplate && !view?.customTemplateValid);

  $effect(() => {
    if (!editingTemplate) templateDraft = values?.customSearchTemplate ?? '';
  });

  const toolbarButtons = $derived.by(() => {
    const shown = values?.toolbarButtons ?? [];
    return [...shown, ...TOOLBAR_BUTTON_IDS.filter((id) => !shown.includes(id))];
  });

  function updateToolbarButtons(order: ToolbarButtonId[], shown: Set<ToolbarButtonId>): void {
    update({ toolbarButtons: order.filter((id) => shown.has(id)) });
  }

  function toggleToolbarButton(id: ToolbarButtonId, visible: boolean): void {
    const shown = new SvelteSet(values?.toolbarButtons);
    if (visible) shown.add(id);
    else shown.delete(id);
    updateToolbarButtons(toolbarButtons, shown);
  }

  function moveToolbarButton(id: ToolbarButtonId, step: -1 | 1): void {
    const order = [...toolbarButtons];
    const index = order.indexOf(id);
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateToolbarButtons(order, new Set(values?.toolbarButtons));
  }

  function updateMessage(status: UpdateStatus): string {
    switch (status.state) {
      case 'unavailable':
        return t('settings.updateUnavailable');
      case 'idle':
        return t('settings.updateIdle');
      case 'checking':
        return t('settings.updateChecking');
      case 'up-to-date':
        return t('settings.updateUpToDate');
      case 'downloading':
        return t('settings.updateDownloading', { version: status.version, percent: status.percent });
      case 'ready':
        return t('settings.updateReady', { version: status.version });
      case 'failed':
        return t('settings.updateFailed');
    }
  }

  async function update(patch: Partial<SettingsValues>): Promise<void> {
    view = await api.update(patch);
  }

  function commitTemplate(): void {
    editingTemplate = false;
    void update({ customSearchTemplate: templateDraft.trim() || null });
  }

  onMount(() => {
    void api.get().then((next) => (view = next));
    return api.onChange((next) => (view = next));
  });
</script>

{#if view && values}
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
          <h2>{t('settings.search')}</h2>
          <div class="row">
            <label for="engine" class="label">
              <span>{t('settings.searchEngine')}</span>
              <span class="hint">{t('settings.searchEngineHint')}</span>
            </label>
            <Select
              id="engine"
              options={engineOptions}
              value={values.searchEngine}
              onchange={(value) => update({ searchEngine: value })}
            />
          </div>
          {#if isCustom}
            <div class="row stacked">
              <label for="engine-url" class="label">
                <span>{t('settings.searchUrl')}</span>
                <span class="hint">{t('settings.searchUrlHint')}</span>
              </label>
              <TextField
                id="engine-url"
                type="url"
                spellcheck="false"
                autocomplete="off"
                placeholder={t('settings.searchUrlPlaceholder')}
                invalid={templateInvalid}
                bind:value={templateDraft}
                onfocus={() => (editingTemplate = true)}
                onchange={commitTemplate}
                onblur={() => (editingTemplate = false)}
              />
              {#if templateInvalid}
                <span class="error" role="alert">{t('settings.searchUrlError')}</span>
              {/if}
            </div>
          {/if}

          <h2>{t('settings.defaultBrowser')}</h2>
          <div class="row">
            <span class="label">
              <span>{view.defaultBrowser ? t('settings.defaultBrowserYes') : t('settings.defaultBrowserNo')}</span>
              <span class="hint">{t('settings.defaultBrowserHint')}</span>
            </span>
            {#if !view.defaultBrowser}
              <Button variant="primary" onclick={async () => (view = await api.makeDefault())}
                >{t('settings.makeDefault')}</Button
              >
            {/if}
          </div>

          <h2>{t('settings.startup')}</h2>
          <div class="row">
            <span class="label">
              <span>{t('settings.whenBrowserOpens')}</span>
              <span class="hint">{t('settings.startupHint')}</span>
            </span>
            <Select
              aria-label={t('settings.whenBrowserOpens')}
              options={startupOptions}
              value={values.startupBehavior}
              onchange={(value) => update({ startupBehavior: value })}
            />
          </div>

          <h2>{t('settings.language')}</h2>
          <div class="row">
            <span class="label">
              <span>{t('settings.pageLanguage')}</span>
              <span class="hint">{t('settings.pageLanguageHint')}</span>
            </span>
            <SegmentedControl
              label={t('settings.pageLanguage')}
              options={languageOptions}
              value={values.pageLanguage}
              onchange={(value) => update({ pageLanguage: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.pageTranslation')}</span>
              <span class="hint">{t('settings.pageTranslationHint')}</span>
            </span>
            <Switch
              label={t('settings.pageTranslation')}
              checked={values.pageTranslation}
              onchange={(checked) => update({ pageTranslation: checked })}
            />
          </div>

          <h2>{t('settings.updates')}</h2>
          <div class="row">
            <span class="label">
              <span>Yalqen {view.version}</span>
              <span class="hint" class:ready={view.update.state === 'ready'} aria-live="polite">
                {updateMessage(view.update)}
              </span>
              {#if view.update.state === 'downloading'}
                <span
                  class="progress"
                  role="progressbar"
                  aria-valuenow={view.update.percent}
                  aria-label={t('settings.download')}
                >
                  <span style:width="{Math.max(2, view.update.percent)}%"></span>
                </span>
              {/if}
            </span>
            {#if view.update.state === 'ready'}
              <Button variant="primary" onclick={() => api.installUpdate()}>{t('settings.restart')}</Button>
            {:else if view.update.state !== 'unavailable'}
              <Button
                disabled={view.update.state === 'checking' || view.update.state === 'downloading'}
                onclick={() => api.checkForUpdates()}>{t('settings.checkNow')}</Button
              >
            {/if}
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.autoUpdate')}</span>
              <span class="hint">{t('settings.autoUpdateHint')}</span>
            </span>
            <Switch
              label={t('settings.autoUpdate')}
              checked={values.autoUpdate}
              onchange={(checked) => update({ autoUpdate: checked })}
            />
          </div>
        {:else if pane === 'appearance'}
          <h2>{t('settings.theme')}</h2>
          <div class="row">
            <span class="label">{t('settings.colorScheme')}</span>
            <SegmentedControl
              label={t('settings.theme')}
              options={themeOptions}
              value={values.theme}
              onchange={(value) => update({ theme: value })}
            />
          </div>

          <h2>{t('settings.pages')}</h2>
          <div class="row">
            <label for="font-size" class="label">
              <span>{t('settings.fontSize')}</span>
              <span class="hint">{t('settings.fontSizeHint')}</span>
            </label>
            <Select
              id="font-size"
              options={fontSizeOptions}
              value={values.fontSize}
              onchange={(value) => update({ fontSize: value })}
            />
          </div>
          <div class="row">
            <label for="default-zoom" class="label">
              <span>{t('settings.pageZoom')}</span>
              <span class="hint">{t('settings.pageZoomHint')}</span>
            </label>
            <Select
              id="default-zoom"
              options={zoomOptions}
              value={values.defaultZoom}
              onchange={(value) => update({ defaultZoom: value })}
            />
          </div>
          <h2>{t('settings.menus')}</h2>
          <div class="row">
            <span class="label">{t('settings.sidebar')}</span>
            <Switch
              label={t('settings.sidebarVisibility')}
              checked={values.sidebarVisible}
              onchange={(checked) => update({ sidebarVisible: checked })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.toolbar')}</span>
              <span class="hint">{t('settings.toolbarHint')}</span>
            </span>
            <Switch
              label={t('settings.toolbarVisibility')}
              checked={values.toolbarVisible}
              onchange={(checked) => update({ toolbarVisible: checked })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.toolbarTabs')}</span>
              <span class="hint">{t('settings.toolbarTabsHint')}</span>
            </span>
            <SegmentedControl
              label={t('settings.toolbarTabs')}
              options={toolbarTabOptions}
              value={values.toolbarTabs}
              onchange={(value) => update({ toolbarTabs: value })}
            />
          </div>

          <h2>{t('settings.toolbarButtons')}</h2>
          <ul class="buttons" aria-label={t('settings.toolbarButtons')}>
            {#each toolbarButtons as id, index (id)}
              {@const item = toolbarButtonLabels[id]}
              <li class="row">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={values.toolbarButtons.includes(id)}
                    disabled={id === REQUIRED_TOOLBAR_BUTTON}
                    onchange={(event) => toggleToolbarButton(id, event.currentTarget.checked)}
                  />
                  <Icon name={item.icon} size={16} />
                  <span class="label">
                    <span>{item.label}</span>
                    {#if id === REQUIRED_TOOLBAR_BUTTON}
                      <span class="hint">{t('settings.settingsAlwaysVisible')}</span>
                    {/if}
                  </span>
                </label>
                <span class="move">
                  <IconButton
                    icon="up"
                    label={t('settings.moveEarlier', { label: item.label })}
                    disabled={index === 0}
                    onclick={() => moveToolbarButton(id, -1)}
                  />
                  <IconButton
                    icon="down"
                    label={t('settings.moveLater', { label: item.label })}
                    disabled={index === toolbarButtons.length - 1}
                    onclick={() => moveToolbarButton(id, 1)}
                  />
                </span>
              </li>
            {/each}
          </ul>

          <h2>{t('settings.tabPanel')}</h2>
          <div class="row">
            <span class="label">{t('settings.panelAppearance')}</span>
            <SegmentedControl
              label={t('settings.panelAppearanceLabel')}
              options={panelOptions}
              value={values.panelCollapsed}
              onchange={(value) => update({ panelCollapsed: value })}
            />
          </div>
          <div class="row">
            <span class="label">{t('settings.position')}</span>
            <SegmentedControl
              label={t('settings.panelPosition')}
              options={sideOptions}
              value={values.panelSide}
              onchange={(value) => update({ panelSide: value })}
            />
          </div>
        {:else if pane === 'privacy'}
          <h2>{t('settings.protection')}</h2>
          <div class="row">
            <span class="label">
              <span>{t('settings.adBlocker')}</span>
              <span class="hint">{t('settings.adBlockerHint')}</span>
            </span>
            <Switch
              label={t('settings.adBlocker')}
              checked={values.adBlocking}
              onchange={(checked) => update({ adBlocking: checked })}
            />
          </div>

          <div class="row">
            <span class="label">
              <span>{t('settings.httpsOnly')}</span>
              <span class="hint">{t('settings.httpsOnlyHint')}</span>
            </span>
            <Switch
              label={t('settings.httpsOnly')}
              checked={values.httpsOnly}
              onchange={(checked) => update({ httpsOnly: checked })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.blockThirdPartyCookies')}</span>
              <span class="hint">{t('settings.blockThirdPartyCookiesHint')}</span>
            </span>
            <Switch
              label={t('settings.blockThirdPartyCookies')}
              checked={values.blockThirdPartyCookies}
              onchange={(checked) => update({ blockThirdPartyCookies: checked })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.askBeforeDownload')}</span>
              <span class="hint">{t('settings.askBeforeDownloadHint')}</span>
            </span>
            <Switch
              label={t('settings.askBeforeDownload')}
              checked={values.askBeforeDownload}
              onchange={(checked) => update({ askBeforeDownload: checked })}
            />
          </div>
          <div class="row">
            <label for="secure-dns" class="label">
              <span>{t('settings.secureDns')}</span>
              <span class="hint">{t('settings.secureDnsHint')}</span>
            </label>
            <Select
              id="secure-dns"
              options={dnsOptions}
              value={values.secureDns}
              onchange={(value) => update({ secureDns: value })}
            />
          </div>
          <h2>{t('settings.browsingData')}</h2>
          <div class="row stacked">
            <span class="label">
              <span>{t('settings.clearBrowsingData')}</span>
              <span class="hint">{t('settings.clearBrowsingDataHint')}</span>
            </span>
            <div class="clear">
              <Select
                aria-label={t('settings.timeRange')}
                options={rangeOptions}
                bind:value={clearRange}
                onchange={() => (cleared = false)}
              />
              {#each clearOptions as option (option.key)}
                <label class="check">
                  <input type="checkbox" bind:checked={clearKinds[option.key]} onchange={() => (cleared = false)} />
                  {option.label}
                </label>
              {/each}
              <div class="clear-actions">
                <Button variant="primary" disabled={!clearSelected || clearing} onclick={clearData}>
                  {clearing ? t('settings.clearing') : t('settings.clearData')}
                </Button>
                {#if cleared}<span class="hint" role="status">{t('settings.cleared')}</span>{/if}
              </div>
            </div>
          </div>
        {:else if pane === 'passwords'}
          <Passwords />
        {:else if pane === 'extensions'}
          <Extensions />
        {:else if pane === 'developer'}
          <RequestRules />
        {:else}
          <h2>{t('settings.memory')}</h2>
          <div class="row">
            <span class="label">
              <span>{t('settings.freezeBackgroundTabs')}</span>
              <span class="hint">{t('settings.freezeBackgroundTabsHint')}</span>
            </span>
            <Switch
              label={t('settings.freezeBackgroundTabs')}
              checked={values.freezeBackgroundTabs}
              onchange={(checked) => update({ freezeBackgroundTabs: checked })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>{t('settings.discardUnusedTabs')}</span>
              <span class="hint">{t('settings.discardUnusedTabsHint')}</span>
            </span>
            <SegmentedControl
              label={t('settings.discardUnusedTabs')}
              options={discardOptions}
              value={values.discardAfterMinutes}
              onchange={(value) => update({ discardAfterMinutes: value })}
            />
          </div>
          <ProcessUsage />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    overflow-y: auto;
    background: var(--bg);
  }

  .settings {
    width: min(920px, 100%);
    margin: 0 auto;
    padding: 42px 24px 80px;
  }

  h1 {
    margin: 0 0 20px;
    font-size: 30px;
    letter-spacing: -0.03em;
  }

  .layout {
    display: flex;
    align-items: flex-start;
    gap: 20px;
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
    padding: 4px 20px 12px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 20px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h2:first-child {
    margin-top: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .row:last-child {
    border-bottom: 0;
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .hint.ready {
    color: var(--text);
  }

  .progress {
    width: 220px;
    height: 4px;
    margin-top: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--well);
  }

  .progress > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.25s linear;
  }

  .error {
    color: var(--warn);
    font-size: var(--font-size-small);
  }

  .clear {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .check input {
    margin: 0;
  }

  .buttons {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .buttons .check {
    gap: 10px;
  }

  .move {
    display: flex;
    gap: 2px;
  }

  .clear-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
</style>
