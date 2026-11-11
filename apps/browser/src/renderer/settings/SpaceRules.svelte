<script lang="ts">
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { MAX_SPACE_RULES, normalizeSpaceRule } from '../../shared/space-rules';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Select from '../ui/Select.svelte';
  import TextField from '../ui/TextField.svelte';

  let { view, update }: { view: SettingsView; update: (patch: Partial<SettingsValues>) => Promise<void> } = $props();

  let host = $state('');
  let path = $state('');
  let space = $state('');

  const rules = $derived(view.values.spaceRules);
  const names = $derived(new Map(view.spaces.map((item) => [item.id, item.name])));
  const options = $derived(view.spaces.map((item) => ({ value: item.id, label: item.name })));
  const draft = $derived(normalizeSpaceRule({ host, path, space }));
  const invalid = $derived((host !== '' || path !== '') && !draft);

  function add(): void {
    if (!draft || rules.length >= MAX_SPACE_RULES) return;
    void update({
      spaceRules: [...rules.filter((rule) => rule.host !== draft.host || rule.path !== draft.path), draft],
    });
    host = '';
    path = '';
  }

  function remove(index: number): void {
    void update({ spaceRules: rules.filter((_, position) => position !== index) });
  }
</script>

<h2>{t('airTraffic.title')}</h2>
<p class="hint intro">{t('airTraffic.intro')}</p>

{#each rules as rule, index (rule.host + rule.path)}
  <div class="rule">
    <span class="target">{rule.host}{rule.path}</span>
    <span class="hint">→ {names.get(rule.space) ?? t('airTraffic.missingSpace')}</span>
    <IconButton
      icon="close"
      tone="muted"
      label={t('airTraffic.remove', { host: rule.host + rule.path })}
      onclick={() => remove(index)}
    />
  </div>
{:else}
  <p class="hint">{t('airTraffic.empty')}</p>
{/each}

<form
  class="rule"
  onsubmit={(event) => {
    event.preventDefault();
    add();
  }}
>
  <TextField
    class="host"
    bind:value={host}
    spellcheck="false"
    autocomplete="off"
    placeholder={t('airTraffic.host')}
    aria-label={t('airTraffic.host')}
    {invalid}
  />
  <TextField
    class="path"
    bind:value={path}
    spellcheck="false"
    autocomplete="off"
    placeholder="/org"
    aria-label={t('airTraffic.path')}
    {invalid}
  />
  <Select {options} bind:value={space} aria-label={t('airTraffic.space')} />
  <Button variant="tonal" icon="plus" type="submit" disabled={!draft}>{t('airTraffic.add')}</Button>
</form>
{#if invalid}<p class="hint error" role="alert">{t('airTraffic.invalid')}</p>{/if}

<style>
  .intro {
    margin: 0 0 8px;
  }

  .rule {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }

  .target {
    flex: none;
    font-weight: 500;
  }

  .rule > :global(.host) {
    flex: 2;
  }

  .rule > :global(.path) {
    flex: 1;
  }

  .rule > .hint {
    flex: 1;
  }
</style>
