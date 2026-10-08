<script lang="ts">
  import type { TabGroup } from '../../shared/tab-groups';
  import { t } from '../../shared/i18n';
  let { groups }: { groups: TabGroup[] } = $props();
  let name = $state('');
  const send = window.yalqen.send;
</script>

<details class="groups">
  <summary>{t('tabGroups.manage')}</summary>
  <p>{t('tabGroups.selectionHint')}</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      if (name.trim()) {
        send({ type: 'set-tab-group', name });
        name = '';
      }
    }}
  >
    <input
      class="field"
      bind:value={name}
      maxlength="80"
      required
      aria-label={t('tabGroups.name')}
      placeholder={t('tabGroups.name')}
    />
    <button class="btn tonal">{t('tabGroups.create')}</button>
  </form>
  <select
    class="field"
    aria-label={t('tabGroups.assign')}
    value="choose"
    onchange={(event) => {
      send({ type: 'set-tab-group', name: event.currentTarget.value ? event.currentTarget.value.slice(6) : null });
      event.currentTarget.value = 'choose';
    }}
  >
    <option value="choose" disabled>{t('tabGroups.assign')}</option>
    <option value="">{t('tabGroups.ungroup')}</option>
    {#each groups as group (group.name)}<option value={'group:' + group.name}>{group.name}</option>{/each}
  </select>
  {#each groups as group (group.name)}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
        send({ type: 'rename-tab-group', name: group.name, next: input.value });
      }}
    >
      <input class="field" name="name" value={group.name} maxlength="80" required aria-label={t('tabGroups.rename')} />
      <button class="btn tonal">{t('tabGroups.rename')}</button>
      <button type="button" class="btn" onclick={() => send({ type: 'remove-tab-group', name: group.name })}
        >{t('tabGroups.ungroup')}</button
      >
    </form>
  {/each}
</details>

<style>
  .groups {
    flex: none;
    margin: 8px 0;
    font-size: 12px;
  }
  summary {
    cursor: pointer;
    color: var(--text-muted);
  }
  p {
    color: var(--text-muted);
    font-size: 11px;
  }
  form {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 8px 0;
  }
  input,
  select {
    min-width: 0;
    width: 100%;
    font-size: 12px;
  }
  button {
    font-size: 11px;
    min-height: 26px;
    padding: 3px 6px;
  }
</style>
