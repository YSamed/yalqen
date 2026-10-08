<script lang="ts">
  import { t } from '../../shared/i18n';
  import { parseExtensionAccess } from '../../shared/extension-sites';
  import type { ExtensionInfo, ExtensionSiteAccess } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';

  let { extension }: { extension: ExtensionInfo } = $props();
  let mode = $state<ExtensionSiteAccess['mode']>('all');
  let sites = $state('');
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state(false);
  const policy = $derived(JSON.stringify(extension.access));
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
    <legend>{t('extensionsPanel.siteAccess')}</legend>
    <Select value={mode} {options} onchange={(value) => (mode = value)} aria-label={t('extensionsPanel.siteAccess')} />
    <p class="hint">{t('extensionsPanel.accessHint')}</p>
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
      <p class="hint">{t('extensionsPanel.accessClickHint')}</p>
      {#if extension.sessionSites.length}
        <p class="hint">{t('extensionsPanel.accessSession')}: {extension.sessionSites.join(', ')}</p>
      {/if}
    {/if}
    <Button type="submit" size="sm" variant="tonal">{t('extensionsPanel.accessSave')}</Button>
    {#if status}<p class:error role={error ? 'alert' : 'status'}>{status}</p>{/if}
  </fieldset>
</form>

<style>
  .access {
    margin-top: 8px;
  }
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-weight: 500;
    margin-bottom: 6px;
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
