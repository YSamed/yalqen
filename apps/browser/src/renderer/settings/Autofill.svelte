<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type { AutofillData, AutofillInfo, AutofillKind, AutofillView } from '../../shared/autofill';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';
  const api = window.yalqenSettings;
  let view = $state<AutofillView>({ available: false, records: [] });
  let editing = $state<string | null>(null);
  let data = $state<AutofillData | null>(null);
  let error = $state(false),
    busy = $state(false);
  const addressFields = [
    'givenName',
    'additionalName',
    'familyName',
    'organization',
    'city',
    'region',
    'postalCode',
    'country',
    'email',
    'tel',
  ] as const;
  const cardFields = ['name', 'number', 'month', 'year'] as const;
  onMount(() => {
    void api.autofill().then((next) => (view = next));
    return api.onAutofillChange((next) => {
      view = next;
    });
  });
  function add(kind: AutofillKind): void {
    editing = null;
    error = false;
    data =
      kind === 'card'
        ? { kind, label: '', name: '', number: '', month: '', year: '' }
        : {
            kind,
            label: '',
            givenName: '',
            additionalName: '',
            familyName: '',
            organization: '',
            streetAddress: '',
            city: '',
            region: '',
            postalCode: '',
            country: '',
            email: '',
            tel: '',
          };
  }
  async function edit(record: AutofillInfo): Promise<void> {
    busy = true;
    error = false;
    try {
      const next = await api.readAutofill(record.id);
      if (next) {
        editing = record.id;
        data = next;
      } else error = true;
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!data) return;
    busy = true;
    error = false;
    try {
      if (await api.saveAutofill({ id: editing, data: $state.snapshot(data) })) {
        data = null;
        editing = null;
      } else error = true;
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }
  async function remove(record: AutofillInfo): Promise<void> {
    if (!confirm(t('autofill.removePrompt', { label: record.label }))) return;
    busy = true;
    try {
      if (!(await api.removeAutofill(record.id))) error = true;
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }
</script>

<h2>{t('autofill.title')}</h2>
<p class="hint">{t('autofill.intro')}</p>
<p class="hint">{t('autofill.cardHint')}</p>
{#if !view.available}<p role="status">{t('autofill.unavailable')}</p>{/if}
<div class="actions">
  <Button variant="tonal" disabled={!view.available || busy} onclick={() => add('address')}
    >{t('autofill.addAddress')}</Button
  >
  <Button variant="tonal" disabled={!view.available || busy} onclick={() => add('card')}>{t('autofill.addCard')}</Button
  >
</div>
{#if data}
  <form onsubmit={save}>
    <fieldset disabled={busy}>
      <legend>{data.kind === 'card' ? t('autofill.addCard') : t('autofill.addAddress')}</legend>
      <label for="autofill-label">{t('autofill.label')}</label>
      <TextField id="autofill-label" bind:value={data.label} maxlength={128} required autocomplete="off" />
      {#if data.kind === 'address'}
        {#each addressFields as field (field)}
          <label for="autofill-{field}">{t(`autofill.${field}`)}</label>
          <TextField
            id="autofill-{field}"
            bind:value={data[field]}
            maxlength={field === 'country' ? 2 : 512}
            autocomplete="off"
          />
        {/each}
        <label for="autofill-streetAddress">{t('autofill.streetAddress')}</label>
        <textarea
          id="autofill-streetAddress"
          bind:value={data.streetAddress}
          rows="3"
          maxlength="4096"
          autocomplete="off"></textarea>
      {:else}
        {#each cardFields as field (field)}
          <label for="autofill-{field}">{t(`autofill.${field}`)}</label>
          <TextField
            id="autofill-{field}"
            bind:value={data[field]}
            maxlength={field === 'number' ? 64 : field === 'month' ? 2 : field === 'year' ? 4 : 256}
            type={field === 'number' ? 'password' : 'text'}
            required
            autocomplete="off"
            inputmode={field === 'name' ? 'text' : 'numeric'}
          />
        {/each}
      {/if}
      <div class="actions">
        <Button type="submit" variant="tonal">{t('autofill.save')}</Button>
        <Button
          onclick={() => {
            data = null;
            error = false;
          }}>{t('autofill.cancel')}</Button
        >
      </div>
    </fieldset>
  </form>
{/if}
{#if error}<p class="error" role="alert">{t('autofill.failed')}</p>{/if}
<ul>
  {#each view.records as record (record.id)}
    <li>
      <div><strong>{record.label}</strong><span class="hint">{record.detail}</span></div>
      <Button size="sm" variant="tonal" disabled={busy || !view.available} onclick={() => edit(record)}
        >{t('autofill.edit')}</Button
      >
      <Button size="sm" disabled={busy} onclick={() => remove(record)}>{t('autofill.remove')}</Button>
    </li>
  {:else}<li class="hint">{t('autofill.empty')}</li>{/each}
</ul>

<style>
  p {
    margin: 4px 0 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin: 12px 0;
  }
  form {
    margin: 12px 0;
    padding: 16px;
    background: var(--surface-hover);
    border-radius: var(--radius);
  }
  fieldset {
    border: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-weight: 600;
    margin-bottom: 8px;
  }
  label {
    display: block;
    margin: 8px 0 4px;
    font-size: 12px;
  }
  form :global(input) {
    width: 100%;
    box-sizing: border-box;
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
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  li > div {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
</style>
