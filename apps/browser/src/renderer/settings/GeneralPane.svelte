<script lang="ts">
  import { untrack } from 'svelte';
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import TextField from '../ui/TextField.svelte';
  import SettingRow from './SettingRow.svelte';
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
  let pagesDraft = $state('');
  let editingPages = $state(false);
  const pageLines = $derived(
    pagesDraft
      .split('\n')
      .map((url) => url.trim())
      .filter(Boolean),
  );
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
    if (!editingPages) pagesDraft = values.startupUrls.join('\n');
  });

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
</script>

{#if !view.defaultBrowser}
  <div class="banner" role="note">
    <span class="label">
      <span>{t('settings.defaultBrowserNo')}</span>
      <span class="hint">{t('settings.defaultBrowserHint')}</span>
    </span>
    <Button variant="primary" onclick={makeDefault}>{t('settings.makeDefault')}</Button>
  </div>
{/if}

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

<h2>{t('settings.downloads')}</h2>
<SettingRow title={t('settings.downloadDirectory')} detail={view.downloadDirectory}>
  <Button variant="tonal" disabled={choosingDirectory} onclick={chooseDownloadDirectory}>
    {t('settings.changeDownloadDirectory')}
  </Button>
  {#if values.downloadDirectory}
    <Button variant="ghost" onclick={() => update({ downloadDirectory: null })}
      >{t('settings.resetDownloadDirectory')}</Button
    >
  {/if}
</SettingRow>
<SettingRow title={t('settings.askBeforeDownload')} hint={t('settings.askBeforeDownloadHint')}>
  <Switch
    label={t('settings.askBeforeDownload')}
    checked={values.askBeforeDownload}
    onchange={(checked) => update({ askBeforeDownload: checked })}
  />
</SettingRow>

<h2>{t('settings.importData')}</h2>
<SettingRow title={t('settings.importBookmarks')} hint={t('settings.importBookmarksHint')}>
  <Button variant="tonal" onclick={() => api.showImportMenu('bookmarks')}>{t('settings.importEllipsis')}</Button>
</SettingRow>
<SettingRow title={t('settings.importHistory')} hint={t('settings.importHistoryHint')}>
  <Button variant="tonal" onclick={() => api.showImportMenu('history')}>{t('settings.importEllipsis')}</Button>
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
<SettingRow title={t('settings.pageTranslation')} hint={t('settings.pageTranslationHint')}>
  <Switch
    label={t('settings.pageTranslation')}
    checked={values.pageTranslation}
    onchange={(checked) => update({ pageTranslation: checked })}
  />
</SettingRow>

<h2>{t('settings.miniSection')}</h2>
<SettingRow title={t('settings.miniWindow')} hint={t('settings.miniWindowHint')}>
  <Switch
    label={t('settings.miniWindow')}
    checked={values.miniWindow}
    onchange={(checked) => update({ miniWindow: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.pictureInPicture')} hint={t('settings.pictureInPictureHint')}>
  <Switch
    label={t('settings.pictureInPicture')}
    checked={values.pictureInPicture}
    onchange={(checked) => update({ pictureInPicture: checked })}
  />
</SettingRow>

<style>
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin: 6px 0 4px;
    padding: 14px 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  #startup-urls {
    width: 100%;
    min-height: 88px;
    max-height: 280px;
    padding: 8px 10px;
    resize: vertical;
    box-sizing: border-box;
  }
</style>
