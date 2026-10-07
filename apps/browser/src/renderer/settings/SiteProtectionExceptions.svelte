<script lang="ts">
  import type { SettingsValues } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();
  const groups = [
    { key: 'adBlockExceptions', title: 'settings.adBlockExceptions' },
    { key: 'thirdPartyCookieExceptions', title: 'settings.cookieExceptions' },
  ] as const;
</script>

<h2>{t('settings.siteExceptions')}</h2>
<p class="hint">{t('settings.siteExceptionsHint')}</p>
{#each groups as group (group.key)}
  <SettingRow title={t(group.title)} stacked>
    {#if values[group.key].length === 0}
      <span class="hint">{t('settings.noSiteExceptions')}</span>
    {:else}
      <div class="exceptions">
        {#each values[group.key] as origin (origin)}
          <div class="exception">
            <span>{origin}</span>
            <Button
              variant="ghost"
              aria-label={`${t('settings.removeSiteException')}: ${origin}`}
              onclick={() => update({ [group.key]: values[group.key].filter((entry) => entry !== origin) })}
            >
              {t('settings.removeSiteException')}
            </Button>
          </div>
        {/each}
      </div>
    {/if}
  </SettingRow>
{/each}

<style>
  .exceptions {
    width: 100%;
  }
  .exception {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .exception span {
    overflow-wrap: anywhere;
  }
</style>
