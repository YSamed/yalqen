<script lang="ts">
  import { t } from '../../shared/i18n';
  import { parseExtensionAccess } from '../../shared/extension-sites';
  import type { ExtensionInfo, ExtensionSiteAccess } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import SettingRow from './SettingRow.svelte';

  let { extension }: { extension: ExtensionInfo } = $props();
  let mode = $state<ExtensionSiteAccess['mode']>('all');
  let sites = $state('');
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state(false);
  const policy = $derived(JSON.stringify(extension.access));
  const changed = $derived.by(() => {
    const access: ExtensionSiteAccess = JSON.parse(policy);
    return mode !== access.mode || (mode === 'sites' && sites.trim() !== access.sites.join('\n'));
  });
  const clearsSession = $derived(!changed && mode === 'click' && extension.sessionSites.length > 0);
  const uid = $props.id();
  const options = [
    { value: 'all' as const, label: t('extensionsPanel.accessAll') },
    { value: 'sites' as const, label: t('extensionsPanel.accessSites') },
    { value: 'click' as const, label: t('extensionsPanel.accessClick') },
  ];
  $effect(() => {
    const access: ExtensionSiteAccess = JSON.parse(policy);
    mode = access.mode;
    sites = access.sites.join('\n');
  });
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const access = parseExtensionAccess({
      mode,
      sites:
        mode === 'sites'
          ? sites
              .split('\n')
              .map((site) => site.trim())
              .filter(Boolean)
          : [],
    });
    status = null;
    if (!access) {
      error = true;
      status = t('extensions.accessInvalid');
      return;
    }
    saving = true;
    try {
      const result = await window.yalqenSettings.setExtensionAccess(extension.path, access);
      error = result !== null;
      status = result ?? t('extensionsPanel.accessSaved');
    } finally {
      saving = false;
    }
  }
</script>

<form class="access" onsubmit={save}>
  <fieldset disabled={saving || extension.updating}>
    <SettingRow
      title={t('extensionsPanel.siteAccess')}
      hint={mode === 'click'
        ? `${t('extensionsPanel.accessHint')} ${t('extensionsPanel.accessClickHint')}`
        : t('extensionsPanel.accessHint')}
    >
      <Select
        value={mode}
        {options}
        onchange={(value) => (mode = value)}
        aria-label={t('extensionsPanel.siteAccess')}
      />
    </SettingRow>
    {#if mode === 'sites'}
      <label for={uid}>{t('extensionsPanel.accessSitesLabel')}</label>
      <textarea
        id={uid}
        bind:value={sites}
        rows="3"
        maxlength="205000"
        spellcheck="false"
        placeholder="https://example.com"></textarea>
    {:else if mode === 'click'}
      {#if extension.sessionSites.length}
        <p class="hint">{t('extensionsPanel.accessSession')}: {extension.sessionSites.join(', ')}</p>
      {/if}
    {/if}
    {#if changed || clearsSession}
      <Button type="submit" size="sm" variant="tonal"
        >{clearsSession ? t('extensionsPanel.accessClearSession') : t('extensionsPanel.accessSave')}</Button
      >
    {/if}
    {#if status}<p class:error role={error ? 'alert' : 'status'}>{status}</p>{/if}
  </fieldset>
</form>

<style>
  .access {
    margin-top: 6px;
  }
  /* Doubled class outranks the settings page's card row style, which has the same specificity and loads later. */
  .access :global(.row.row) {
    justify-content: flex-start;
    gap: 12px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
  }
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
  }
  p {
    margin: 6px 0;
    overflow-wrap: anywhere;
  }
  label {
    display: block;
    margin: 8px 0 4px;
    font-size: 12px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    margin-bottom: 8px;
  }
</style>
