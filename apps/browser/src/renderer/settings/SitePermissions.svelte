<script lang="ts">
  import { onMount } from 'svelte';
  import { getDomain } from 'tldts';
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

  interface Entry {
    origin: string;
    host: string;
    kind: SitePermission;
    decision: PermissionDecision;
  }

  const host = (origin: string) => new URL(origin).host;
  function subLabel(entry: Entry, domain: string): string {
    const kind = t(`permissions.${entry.kind}`);
    const subdomain = entry.host === domain ? '' : entry.host.slice(0, -domain.length - 1);
    return subdomain ? `${subdomain} · ${kind}` : kind;
  }

  const groups = $derived.by(() => {
    const byDomain: Record<string, { domain: string; origins: string[]; entries: Entry[] }> = {};
    for (const site of view?.sites ?? []) {
      const siteHost = host(site.origin);
      const domain = getDomain(siteHost) ?? siteHost;
      const group = (byDomain[domain] ??= { domain, origins: [], entries: [] });
      group.origins.push(site.origin);
      for (const { kind, decision } of site.permissions) {
        group.entries.push({ origin: site.origin, host: siteHost, kind, decision });
      }
    }
    return Object.values(byDomain);
  });
  const refresh = () => api.sitePermissions().then((next) => (view = next));

  async function choose(origin: string, kind: SitePermission, choice: Choice): Promise<void> {
    view = await api.setSitePermission(origin, kind, choice === 'ask' ? null : choice);
  }

  async function forget(origins: string[]): Promise<void> {
    for (const origin of origins) view = await api.forgetSitePermissions(origin);
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
  {#each groups as group (group.domain)}
    {#snippet picker(entry: Entry)}
      <Select
        options={choices(entry.kind)}
        value={entry.decision as Choice}
        aria-label={t('sitePermissions.choiceLabel', {
          permission: t(`permissions.${entry.kind}`),
          host: entry.host,
        })}
        onchange={(choice) => choose(entry.origin, entry.kind, choice)}
      />
    {/snippet}
    {#snippet forgetButton()}
      <IconButton
        icon="close"
        tone="muted"
        label={t('sitePermissions.forget', { host: group.domain })}
        onclick={() => forget(group.origins)}
      />
    {/snippet}
    <div class="site">
      {#if group.entries.length === 1}
        {@const entry = group.entries[0]}
        <div class="line">
          <span class="name">{entry.host}</span>
          <span class="kind">{t(`permissions.${entry.kind}`)}</span>
          {@render picker(entry)}
          {@render forgetButton()}
        </div>
      {:else}
        <div class="line">
          <span class="name">{group.domain}</span>
          {@render forgetButton()}
        </div>
        {#each group.entries as entry (`${entry.origin} ${entry.kind}`)}
          <div class="line sub">
            <span class="name">{subLabel(entry, group.domain)}</span>
            {@render picker(entry)}
          </div>
        {/each}
      {/if}
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
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 36px;
  }

  .line.sub {
    padding-left: 12px;
  }

  .line.sub .name {
    font-weight: 400;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    font-weight: 400;
    color: var(--text-muted);
  }

  .line > .kind {
    flex: none;
  }
</style>
