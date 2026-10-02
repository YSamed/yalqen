<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { RequestRule, RequestRuleAction } from '../../shared/types';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import Select from './ui/Select.svelte';
  import TextField from './ui/TextField.svelte';

  const api = window.yalqenSettings;

  const ACTIONS: { value: RequestRuleAction; label: string }[] = [
    { value: 'block', label: t('requestRulesPanel.actionBlock') },
    { value: 'mock', label: t('requestRulesPanel.actionMock') },
    { value: 'redirect', label: t('requestRulesPanel.actionRedirect') },
    { value: 'headers', label: t('requestRulesPanel.actionHeaders') },
  ];

  const HEADERS_PLACEHOLDER = ['Authorization: Bearer test', 'X-Debug: 1', 'X-Requested-With:'].join('\n');

  let rules = $state<RequestRule[]>([]);
  let saved = $state('[]');
  let saving = $state(false);
  const dirty = $derived(JSON.stringify(rules) !== saved);

  function load(next: RequestRule[]): void {
    rules = next;
    saved = JSON.stringify(next);
  }

  function add(): void {
    rules.push({
      id: crypto.randomUUID(),
      enabled: true,
      pattern: '',
      action: 'block',
      status: 200,
      contentType: 'application/json',
      body: '',
      redirectUrl: '',
      headers: '',
    });
  }

  async function save(): Promise<void> {
    saving = true;
    try {
      load(await api.saveRequestRules($state.snapshot(rules)));
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void api.requestRules().then(load);
  });
</script>

<h2>{t('requestRulesPanel.title')}</h2>
<!-- eslint-disable-next-line svelte/no-at-html-tags -- static dictionary text, no user data -->
<p class="hint intro">{@html t('requestRulesPanel.intro')}</p>

{#each rules as rule, index (rule.id)}
  <fieldset class="rule" class:disabled={!rule.enabled}>
    <legend class="visually-hidden">{t('requestRulesPanel.rule', { number: index + 1 })}</legend>
    <div class="line">
      <input
        type="checkbox"
        bind:checked={rule.enabled}
        aria-label={t('requestRulesPanel.ruleEnabled', { number: index + 1 })}
      />
      <TextField
        class="pattern"
        bind:value={rule.pattern}
        spellcheck="false"
        autocomplete="off"
        placeholder={t('requestRulesPanel.patternPlaceholder')}
        aria-label={t('requestRulesPanel.rulePattern', { number: index + 1 })}
        invalid={rule.enabled && rule.pattern.trim() === ''}
      />
      <Select
        options={ACTIONS}
        bind:value={rule.action}
        aria-label={t('requestRulesPanel.ruleAction', { number: index + 1 })}
      />
      <IconButton
        icon="close"
        tone="muted"
        label={t('requestRulesPanel.ruleDelete', { number: index + 1 })}
        onclick={() => (rules = rules.filter((item) => item.id !== rule.id))}
      />
    </div>
    {#if rule.action === 'mock'}
      <div class="line">
        <label class="inline">
          <span class="hint">{t('requestRulesPanel.status')}</span>
          <input class="field status" type="number" min="200" max="599" bind:value={rule.status} />
        </label>
        <label class="inline grow">
          <span class="hint">{t('requestRulesPanel.contentType')}</span>
          <TextField class="grow" bind:value={rule.contentType} spellcheck="false" />
        </label>
      </div>
      <textarea
        class="field code"
        rows="5"
        bind:value={rule.body}
        spellcheck="false"
        placeholder={'{ "ok": true }'}
        aria-label={t('requestRulesPanel.ruleResponseBody', { number: index + 1 })}></textarea>
    {:else if rule.action === 'redirect'}
      <TextField
        bind:value={rule.redirectUrl}
        type="url"
        spellcheck="false"
        placeholder="http://localhost:3000/api"
        aria-label={t('requestRulesPanel.ruleTargetUrl', { number: index + 1 })}
        invalid={rule.enabled && !/^https?:\/\//i.test(rule.redirectUrl)}
      />
    {:else if rule.action === 'headers'}
      <textarea
        class="field code"
        rows="3"
        bind:value={rule.headers}
        spellcheck="false"
        placeholder={HEADERS_PLACEHOLDER}
        aria-label={t('requestRulesPanel.ruleHeaders', { number: index + 1 })}></textarea>
      <span class="hint">{t('requestRulesPanel.headersHint')}</span>
    {/if}
  </fieldset>
{:else}
  <p class="hint empty">{t('requestRulesPanel.empty')}</p>
{/each}

<div class="actions">
  <Button variant="tonal" icon="plus" onclick={add}>{t('requestRulesPanel.addRule')}</Button>
  <span class="spacer"></span>
  {#if dirty}
    <Button variant="tonal" onclick={() => load(JSON.parse(saved))}>{t('requestRulesPanel.cancel')}</Button>
  {/if}
  <Button variant="primary" disabled={!dirty || saving} onclick={save}
    >{saving ? t('requestRulesPanel.saving') : t('requestRulesPanel.save')}</Button
  >
</div>

<style>
  .intro {
    margin: 0 0 8px;
  }

  .empty {
    margin: 8px 0;
  }

  .intro :global(code) {
    font-size: 0.95em;
  }

  .rule {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 12px 0;
    border: 0;
    border-bottom: 1px solid var(--border);
  }

  .rule.disabled {
    opacity: 0.6;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .line :global(.pattern),
  .grow,
  .line :global(.grow) {
    flex: 1;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status {
    width: 72px;
  }

  .code {
    height: auto;
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    resize: vertical;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 0 4px;
  }

  .spacer {
    flex: 1;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
