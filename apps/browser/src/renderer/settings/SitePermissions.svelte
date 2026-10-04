<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../shared/i18n';
  import type {
    PermissionDecision,
    SitePermission,
    SitePermissionsView,
    SystemAccess,
    SystemDevice,
  } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Select from '../ui/Select.svelte';
  import SettingRow from './SettingRow.svelte';

  type Choice = PermissionDecision | 'ask';

  const api = window.yalqenSettings;
  const devices: { device: SystemDevice; label: string }[] = [
    { device: 'camera', label: t('permissions.camera') },
    { device: 'microphone', label: t('permissions.microphone') },
    { device: 'screen', label: t('sitePermissions.screen') },
  ];
  const accessText: Record<SystemAccess, string> = {
    granted: t('sitePermissions.systemGranted'),
    denied: t('sitePermissions.systemDenied'),
    restricted: t('sitePermissions.systemRestricted'),
    'not-determined': t('sitePermissions.systemNotAsked'),
    unknown: t('sitePermissions.systemDenied'),
  };
  const choices = (kind: SitePermission): { value: Choice; label: string }[] => [
    { value: 'ask', label: kind === 'popups' ? t('siteInfo.defaultBlock') : t('siteInfo.ask') },
    { value: 'allow', label: t('siteInfo.allow') },
    { value: 'deny', label: t('siteInfo.block') },
  ];

  let view = $state<SitePermissionsView | null>(null);

  const host = (origin: string) => new URL(origin).host;
  const refresh = () => api.sitePermissions().then((next) => (view = next));

  async function choose(origin: string, kind: SitePermission, choice: Choice): Promise<void> {
    view = await api.setSitePermission(origin, kind, choice === 'ask' ? null : choice);
  }

  async function forget(origin: string): Promise<void> {
    view = await api.forgetSitePermissions(origin);
  }

  onMount(() => {
    void refresh();
    // Picks up switches flipped in System Settings while this page was in the background.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });
</script>

{#if view}
  {#if view.system}
    <h2>{t('sitePermissions.systemTitle')}</h2>
    <p class="hint intro">{t('sitePermissions.systemIntro')}</p>
    {#each devices as { device, label } (device)}
      <SettingRow title={label} hint={accessText[view.system[device]]}>
        {#if view.system[device] !== 'granted'}
          <Button size="sm" variant="tonal" onclick={() => api.openSystemSettings(device)}>
            {t('permissionHandlers.openSystemSettings')}
          </Button>
        {/if}
      </SettingRow>
    {/each}
  {/if}

  <h2>{t('sitePermissions.title')}</h2>
  <p class="hint intro">{t('sitePermissions.intro')}</p>
  {#each view.sites as site (site.origin)}
    <div class="site">
      <div class="site-head">
        <span class="name">{host(site.origin)}</span>
        <IconButton
          icon="close"
          tone="muted"
          label={t('sitePermissions.forget', { host: host(site.origin) })}
          onclick={() => forget(site.origin)}
        />
      </div>
      {#each site.permissions as { kind, decision } (kind)}
        <div class="permission">
          <span>{t(`permissions.${kind}`)}</span>
          <Select
            options={choices(kind)}
            value={decision as Choice}
            aria-label={t('sitePermissions.choiceLabel', {
              permission: t(`permissions.${kind}`),
              host: host(site.origin),
            })}
            onchange={(choice) => choose(site.origin, kind, choice)}
          />
        </div>
      {/each}
    </div>
  {:else}
    <p class="hint empty">{t('sitePermissions.empty')}</p>
  {/each}
{/if}

<style>
  .intro {
    margin: 0 0 8px;
  }

  .empty {
    margin: 8px 0;
  }

  .site {
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .site-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .name {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .permission {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0 0 12px;
  }
</style>
