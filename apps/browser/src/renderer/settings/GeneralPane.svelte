<script lang="ts">
  import { untrack } from 'svelte';
  import type { SettingsValues, SettingsView, UpdateStatus } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import TextField from '../ui/TextField.svelte';
  import SettingRow from './SettingRow.svelte';
  import Profiles from './Profiles.svelte';
  import { webPageUrl } from '../../shared/startup-pages';

  let {
    view,
    update,
    makeDefault,
  }: {
    view: SettingsView;
    update: (patch: Partial<SettingsValues>) => Promise<void>;
    makeDefault: () => Promise<void>;
  } = $props();

  const api = window.yalqenSettings;
  const startupOptions = [
    { value: 'restore', label: t('settings.startupRestore') },
    { value: 'new-tab', label: t('settings.startupNewTab') },
    { value: 'pages', label: t('settings.startupPages') },
  ] as const;

  const interfaceLanguageOptions = $derived([
    { value: 'system' as const, label: t('settings.interfaceLanguageSystem') },
    { value: 'tr' as const, label: 'Türkçe' },
    { value: 'en' as const, label: 'English' },
  ]);
  const startupInterfaceLanguage = untrack(() => view.values.interfaceLanguage);

  let templateDraft = $state('');
  let editingTemplate = $state(false);
  let choosingDirectory = $state(false);
  let homeDraft = $state('');
  let pagesDraft = $state('');
  let editingHome = $state(false);
  let editingPages = $state(false);
  const pageLines = $derived(
    pagesDraft
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean),
  );
  const homeInvalid = $derived(!!homeDraft.trim() && !webPageUrl(homeDraft));
  const pagesInvalid = $derived(pageLines.length > 20 || pageLines.some((url) => !webPageUrl(url)));

  const values = $derived(view.values);
  const languageChanged = $derived(values.interfaceLanguage !== startupInterfaceLanguage);
  const isCustom = $derived(values.searchEngine === 'custom');
  const engineOptions = $derived([
    ...view.engines.map((engine) => ({ value: engine.id, label: engine.label })),
    { value: 'custom' as const, label: t('settings.custom') },
  ]);
  const templateInvalid = $derived(isCustom && !!values.customSearchTemplate && !view.customTemplateValid);

  $effect(() => {
    if (!editingTemplate) templateDraft = values.customSearchTemplate ?? '';
  });
  $effect(() => {
    if (!editingHome) homeDraft = values.homePageUrl ?? '';
    if (!editingPages) pagesDraft = values.startupUrls.join('\n');
  });

  function saveHome(): void {
    if (homeInvalid) return;
    editingHome = false;
    void update({ homePageUrl: webPageUrl(homeDraft) });
  }
  function savePages(): void {
    if (pagesInvalid) return;
    editingPages = false;
    void update({ startupUrls: pageLines });
  }

  function commitTemplate(): void {
    editingTemplate = false;
    void update({ customSearchTemplate: templateDraft.trim() || null });
  }

  async function chooseDownloadDirectory(): Promise<void> {
    choosingDirectory = true;
    try {
      await api.chooseDownloadDirectory();
    } finally {
      choosingDirectory = false;
    }
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
</script>

<Profiles />
<h2>{t('settings.search')}</h2>
<SettingRow title={t('settings.searchEngine')} hint={t('settings.searchEngineHint')} labelFor="engine">
  <Select
    id="engine"
    options={engineOptions}
    value={values.searchEngine}
    onchange={(value) => update({ searchEngine: value })}
  />
</SettingRow>
{#if isCustom}
  <SettingRow title={t('settings.searchUrl')} hint={t('settings.searchUrlHint')} labelFor="engine-url" stacked>
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
  </SettingRow>
{/if}

<h2>{t('settings.defaultBrowser')}</h2>
<SettingRow
  title={view.defaultBrowser ? t('settings.defaultBrowserYes') : t('settings.defaultBrowserNo')}
  hint={t('settings.defaultBrowserHint')}
>
  {#if !view.defaultBrowser}
    <Button variant="primary" onclick={makeDefault}>{t('settings.makeDefault')}</Button>
  {/if}
</SettingRow>

<h2>{t('settings.startup')}</h2>
<SettingRow title={t('settings.whenBrowserOpens')} hint={t('settings.startupHint')}>
  <Select
    aria-label={t('settings.whenBrowserOpens')}
    options={startupOptions}
    value={values.startupBehavior}
    onchange={(value) => update({ startupBehavior: value })}
  />
</SettingRow>

{#if values.startupBehavior === 'pages'}
  <SettingRow title={t('settings.startupUrls')} hint={t('settings.startupUrlsHint')} labelFor="startup-urls" stacked>
    <textarea
      id="startup-urls"
      class="field md"
      rows="4"
      maxlength="164000"
      bind:value={pagesDraft}
      aria-invalid={pagesInvalid}
      class:invalid={pagesInvalid}
      onfocus={() => (editingPages = true)}
      onchange={savePages}
      spellcheck="false"
      autocomplete="off"></textarea>
    {#if pagesInvalid}<span class="error" role="alert">{t('settings.pageUrlError')}</span>{/if}
  </SettingRow>
{/if}

<SettingRow title={t('settings.homePage')} hint={t('settings.homePageHint')} labelFor="home-page" stacked>
  <TextField
    id="home-page"
    type="url"
    maxlength={8192}
    bind:value={homeDraft}
    invalid={homeInvalid}
    onfocus={() => (editingHome = true)}
    onchange={saveHome}
    spellcheck="false"
    autocomplete="off"
    placeholder="https://example.com/"
  />
  {#if homeInvalid}<span class="error" role="alert">{t('settings.pageUrlError')}</span>{/if}
</SettingRow>
<SettingRow title={t('settings.showHomeButton')}>
  <Switch
    label={t('settings.showHomeButton')}
    checked={values.toolbarButtons.includes('home')}
    onchange={(shown) =>
      update({
        toolbarButtons: shown
          ? ['home', ...values.toolbarButtons.filter((id) => id !== 'home')]
          : values.toolbarButtons.filter((id) => id !== 'home'),
      })}
  />
</SettingRow>

<h2>{t('settings.downloads')}</h2>
<SettingRow title={t('settings.downloadDirectory')} hint={view.downloadDirectory}>
  <Button variant="tonal" disabled={choosingDirectory} onclick={chooseDownloadDirectory}>
    {t('settings.changeDownloadDirectory')}
  </Button>
  {#if values.downloadDirectory}
    <Button variant="ghost" onclick={() => update({ downloadDirectory: null })}
      >{t('settings.resetDownloadDirectory')}</Button
    >
  {/if}
</SettingRow>
<SettingRow title={t('settings.askDownloadLocation')} hint={t('settings.askDownloadLocationHint')}>
  <Switch
    label={t('settings.askDownloadLocation')}
    checked={values.askDownloadLocation}
    onchange={(checked) => update({ askDownloadLocation: checked })}
  />
</SettingRow>

<h2>{t('settings.language')}</h2>
<SettingRow
  title={t('settings.interfaceLanguage')}
  hint={t('settings.interfaceLanguageHint')}
  labelFor="interface-language"
>
  <Select
    id="interface-language"
    options={interfaceLanguageOptions}
    value={values.interfaceLanguage}
    onchange={(value) => update({ interfaceLanguage: value })}
  />
  {#if languageChanged}
    <Button variant="primary" onclick={() => api.relaunch()}>{t('settings.restartNow')}</Button>
  {/if}
</SettingRow>

<h2>{t('settings.updates')}</h2>
<div class="row">
  <span class="label">
    <span>Yalqen {view.version}</span>
    <span class="hint" class:ready={view.update.state === 'ready'} aria-live="polite">
      {updateMessage(view.update)}
    </span>
    {#if view.update.state === 'downloading'}
      <span class="progress" role="progressbar" aria-valuenow={view.update.percent} aria-label={t('settings.download')}>
        <span style:width="{Math.max(2, view.update.percent)}%"></span>
      </span>
    {/if}
  </span>
  {#if view.update.state === 'ready'}
    <Button variant="primary" onclick={() => api.installUpdate()}>{t('settings.restart')}</Button>
  {:else if view.update.state !== 'unavailable'}
    <Button
      variant="tonal"
      disabled={view.update.state === 'checking' || view.update.state === 'downloading'}
      onclick={() => api.checkForUpdates()}>{t('settings.checkNow')}</Button
    >
  {/if}
</div>
<SettingRow title={t('settings.autoUpdate')} hint={t('settings.autoUpdateHint')}>
  <Switch
    label={t('settings.autoUpdate')}
    checked={values.autoUpdate}
    onchange={(checked) => update({ autoUpdate: checked })}
  />
</SettingRow>

<style>
  #startup-urls {
    width: 100%;
    min-height: 88px;
    max-height: 280px;
    padding: 8px 10px;
    resize: vertical;
    box-sizing: border-box;
  }

  .label .hint.ready {
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
</style>
