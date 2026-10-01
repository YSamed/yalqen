<script lang="ts">
  import { onMount } from 'svelte';
  import type { RequestRule, RequestRuleAction } from '../../shared/types';
  import Button from './ui/Button.svelte';
  import IconButton from './ui/IconButton.svelte';
  import Select from './ui/Select.svelte';
  import TextField from './ui/TextField.svelte';

  const api = window.yalqenSettings;

  const ACTIONS: { value: RequestRuleAction; label: string }[] = [
    { value: 'block', label: 'Engelle' },
    { value: 'mock', label: 'Sahte yanıt' },
    { value: 'redirect', label: 'Yönlendir' },
    { value: 'headers', label: 'İstek başlıklarını değiştir' },
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

<h2>İstek kuralları</h2>
<p class="hint intro">
  Kurallar yalnızca geliştirici menüsünden ya da <code>&gt;istek kuralları</code> komutuyla uygulanmaya başlanan
  sekmelerde çalışır. Adreste <code>*</code> herhangi bir metinle eşleşir; ilk eşleşen kural uygulanır.
</p>

{#each rules as rule, index (rule.id)}
  <fieldset class="rule" class:disabled={!rule.enabled}>
    <legend class="visually-hidden">Kural {index + 1}</legend>
    <div class="line">
      <input type="checkbox" bind:checked={rule.enabled} aria-label="Kural {index + 1} etkin" />
      <TextField
        class="pattern"
        bind:value={rule.pattern}
        spellcheck="false"
        autocomplete="off"
        placeholder="https://api.ornek.com/*"
        aria-label="Kural {index + 1} adres kalıbı"
        invalid={rule.enabled && rule.pattern.trim() === ''}
      />
      <Select options={ACTIONS} bind:value={rule.action} aria-label="Kural {index + 1} işlemi" />
      <IconButton
        icon="close"
        tone="muted"
        label="Kural {index + 1} sil"
        onclick={() => (rules = rules.filter((item) => item.id !== rule.id))}
      />
    </div>
    {#if rule.action === 'mock'}
      <div class="line">
        <label class="inline">
          <span class="hint">Durum</span>
          <input class="field status" type="number" min="200" max="599" bind:value={rule.status} />
        </label>
        <label class="inline grow">
          <span class="hint">İçerik türü</span>
          <TextField class="grow" bind:value={rule.contentType} spellcheck="false" />
        </label>
      </div>
      <textarea
        class="field code"
        rows="5"
        bind:value={rule.body}
        spellcheck="false"
        placeholder={'{ "ok": true }'}
        aria-label="Kural {index + 1} yanıt gövdesi"></textarea>
    {:else if rule.action === 'redirect'}
      <TextField
        bind:value={rule.redirectUrl}
        type="url"
        spellcheck="false"
        placeholder="http://localhost:3000/api"
        aria-label="Kural {index + 1} hedef adres"
        invalid={rule.enabled && !/^https?:\/\//i.test(rule.redirectUrl)}
      />
    {:else if rule.action === 'headers'}
      <textarea
        class="field code"
        rows="3"
        bind:value={rule.headers}
        spellcheck="false"
        placeholder={HEADERS_PLACEHOLDER}
        aria-label="Kural {index + 1} başlıklar"></textarea>
      <span class="hint"
        >Her satıra bir başlık yazın. Değeri boş bırakılan başlık istekten çıkarılır; tarayıcının kendi eklediği Cookie
        ve Accept-Language gibi başlıklar yalnızca yeni bir değerle değiştirilebilir.</span
      >
    {/if}
  </fieldset>
{:else}
  <p class="hint empty">Henüz kural yok.</p>
{/each}

<div class="actions">
  <Button icon="plus" onclick={add}>Kural ekle</Button>
  <span class="spacer"></span>
  {#if dirty}
    <Button onclick={() => load(JSON.parse(saved))}>Vazgeç</Button>
  {/if}
  <Button variant="primary" disabled={!dirty || saving} onclick={save}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>
</div>

<style>
  h2 {
    margin: 12px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .intro {
    margin: 0 0 8px;
  }

  .empty {
    margin: 8px 0;
  }

  code {
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
