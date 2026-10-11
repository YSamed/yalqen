<script lang="ts">
  import { onMount } from 'svelte';
  import { getDomain } from 'tldts';
  import { getLocale, t } from '../../shared/i18n';
  import type { SiteStorageEntry, SiteStorageView } from '../../shared/site-storage';
  import type {
    PermissionDecision,
    SettingsValues,
    SitePermission,
    SitePermissionsView,
    SystemAccess,
    SystemDevice,
  } from '../../shared/types';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import TextField from '../ui/TextField.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  type Choice = PermissionDecision | 'ask';
  type ExceptionKey = 'adBlockExceptions' | 'thirdPartyCookieExceptions';
  interface Permission {
    origin: string;
    host: string;
    kind: SitePermission;
    decision: PermissionDecision;
  }
  interface Site {
    domain: string;
    permissions: Permission[];
    exceptions: { key: ExceptionKey; origin: string }[];
    storage?: SiteStorageEntry;
  }

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
  function shortAccess(device: string, access: SystemAccess): string {
    if (access === 'granted') return device;
    if (access === 'not-determined') return t('sites.systemAsk', { device });
    if (access === 'restricted') return t('sites.systemRestricted', { device });
    return t('sites.systemOff', { device });
  }
  const exceptionLabels: Record<ExceptionKey, { title: string; chip: string }> = {
    adBlockExceptions: { title: t('sites.allowAds'), chip: t('sites.adsChip') },
    thirdPartyCookieExceptions: { title: t('sites.allowCookies'), chip: t('sites.cookiesChip') },
  };
  const choices = (kind: SitePermission): { value: Choice; label: string }[] => [
    { value: 'ask', label: kind === 'popups' ? t('siteInfo.defaultBlock') : t('siteInfo.ask') },
    { value: 'allow', label: t('siteInfo.allow') },
    { value: 'deny', label: t('siteInfo.block') },
  ];

  let permissions = $state<SitePermissionsView | null>(null);
  let storage = $state<SiteStorageView | null>(null);
  let details = $state<Record<string, SiteStorageEntry | null>>({});
  let icons = $state<Record<string, string>>({});
  let brokenIcons = $state<Record<string, boolean>>({});
  // Exceptions switched off stay listed until the page reloads, so they can be switched back on.
  let switchedOff = $state<{ key: ExceptionKey; origin: string }[]>([]);
  let query = $state('');
  let busy = $state(false);
  let error = $state(false);

  const term = $derived(query.trim().toLowerCase());
  const domainOf = (host: string) => getDomain(host, { allowPrivateDomains: true }) ?? host;
  const hostOf = (origin: string) => new URL(origin).host;
  const hostnameOf = (origin: string) => new URL(origin).hostname;

  // Sites with a permission or exception come first; the rest of the list is sites that only store data.
  const configured = $derived.by(() => {
    const sites: Record<string, Site> = {};
    const site = (origin: string) => {
      const domain = domainOf(hostnameOf(origin));
      return (sites[domain] ??= { domain, permissions: [], exceptions: [] });
    };
    for (const { origin, permissions: list } of permissions?.sites ?? []) {
      for (const { kind, decision } of list)
        site(origin).permissions.push({ origin, host: hostOf(origin), kind, decision });
    }
    for (const key of ['adBlockExceptions', 'thirdPartyCookieExceptions'] as const) {
      const origins = [
        ...values[key],
        ...switchedOff
          .filter((item) => item.key === key && !values[key].includes(item.origin))
          .map((item) => item.origin),
      ];
      for (const origin of origins) site(origin).exceptions.push({ key, origin });
    }
    return Object.values(sites)
      .filter((entry) => entry.domain.includes(term))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  });
  const others = $derived(
    (storage?.sites ?? [])
      .filter((entry) => !configured.some((site) => site.domain === entry.domain))
      .map((entry): Site => ({ domain: entry.domain, permissions: [], exceptions: [], storage: entry })),
  );
  const sites = $derived([...configured, ...others]);

  $effect(() => {
    const missing = sites.map((site) => site.domain).filter((domain) => !(domain in icons));
    if (missing.length === 0) return;
    void api.siteIcons(missing).then((found) => {
      icons = { ...icons, ...Object.fromEntries(missing.map((domain) => [domain, found[domain] ?? ''])) };
    });
  });

  async function loadStorage(offset = 0): Promise<void> {
    busy = true;
    error = false;
    try {
      const next = await api.siteStorage(term, offset);
      if (next) storage = next;
      else error = true;
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }

  // Storage for a site with settings may sit on another page, so it is looked up when the site opens.
  async function loadDetails(site: Site): Promise<void> {
    if (site.storage || site.domain in details) return;
    const view = await api.siteStorage(site.domain, 0).catch(() => null);
    details = { ...details, [site.domain]: view?.sites.find((entry) => entry.domain === site.domain) ?? null };
  }

  async function clear(domain: string | null): Promise<void> {
    busy = true;
    error = false;
    try {
      if (await api.clearSiteStorage(domain)) {
        details = {};
        await loadStorage(storage?.offset ?? 0);
      }
    } catch {
      error = true;
    } finally {
      busy = false;
    }
  }

  async function choose(entry: Permission, choice: Choice): Promise<void> {
    permissions = await api.setSitePermission(entry.origin, entry.kind, choice === 'ask' ? null : choice);
  }

  async function forget(site: Site): Promise<void> {
    for (const origin of new Set(site.permissions.map((entry) => entry.origin)))
      permissions = await api.forgetSitePermissions(origin);
  }

  function setException(key: ExceptionKey, origin: string, allowed: boolean): void {
    if (!allowed && !switchedOff.some((item) => item.key === key && item.origin === origin))
      switchedOff = [...switchedOff, { key, origin }];
    const rest = values[key].filter((entry) => entry !== origin);
    void update({ [key]: allowed ? [...rest, origin] : rest });
  }

  function size(value: number): string {
    let unit = 0;
    while (value >= 1024 && unit < 3) {
      value /= 1024;
      unit++;
    }
    return `${value.toLocaleString(getLocale(), { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
  }

  function permissionLabel(entry: Permission, domain: string): string {
    const kind = t(`permissions.${entry.kind}`);
    const host = entry.host.replace(/:\d+$/, '');
    const subdomain = host === domain ? '' : host.slice(0, -domain.length - 1);
    return subdomain ? `${kind} · ${subdomain}` : kind;
  }

  const refreshPermissions = () => api.sitePermissions().then((next) => (permissions = next));

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function search(): void {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadStorage(), 250);
  }

  onMount(() => {
    void refreshPermissions();
    void loadStorage();
    // Picks up switches flipped in System Settings while this page was in the background.
    const onFocus = () => void refreshPermissions();
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(searchTimer);
      window.removeEventListener('focus', onFocus);
    };
  });
</script>

{#snippet storageText(entry: SiteStorageEntry)}
  {t('siteStorage.counts', { cookies: entry.cookies, origins: entry.origins })} ·
  {entry.databaseBytes === null ? t('siteStorage.unknown') : size(entry.databaseBytes)}
{/snippet}

{#if permissions?.system}
  <div
    class="system"
    role="group"
    aria-label={t('sitePermissions.systemTitle')}
    title={t('sitePermissions.systemIntro')}
  >
    <span class="system-label">macOS</span>
    {#each devices as { device, label } (device)}
      {@const access = permissions.system[device]}
      <span
        class="pill"
        class:ok={access === 'granted'}
        class:warn={access === 'denied' || access === 'restricted' || access === 'unknown'}
        title={accessText[access]}
      >
        {shortAccess(label, access)}
      </span>
      {#if access === 'denied' || access === 'unknown'}
        <Button size="sm" variant="ghost" onclick={() => api.openSystemSettings(device)}>
          {t('permissionHandlers.openSystemSettings')}
        </Button>
      {/if}
    {/each}
  </div>
{/if}

<section class="sites-section" aria-label={t('sites.list')} aria-busy={busy}>
  <div class="tools">
    <TextField
      bind:value={query}
      type="search"
      maxlength={200}
      placeholder={t('siteStorage.search')}
      aria-label={t('siteStorage.search')}
      oninput={search}
    />
    <Button variant="ghost" disabled={busy} onclick={() => clear(null)}>{t('siteStorage.clearAll')}</Button>
  </div>
  {#if error}<p class="error" role="alert">{t('siteStorage.failed')}</p>{/if}
  {#if storage?.limited}<p role="status" class="hint">{t('siteStorage.limited')}</p>{/if}

  {#if sites.length}
    <ul class="sites">
      {#each sites as site (site.domain)}
        {@const stored = site.storage ?? details[site.domain]}
        <li data-domain={site.domain}>
          <details
            ontoggle={(event) => {
              if (event.currentTarget.open) void loadDetails(site);
            }}
          >
            <summary>
              <span class="icon" aria-hidden="true">
                {#if icons[site.domain] && !brokenIcons[site.domain]}
                  <img
                    src={icons[site.domain]}
                    alt=""
                    width="16"
                    height="16"
                    referrerpolicy="no-referrer"
                    onerror={() => (brokenIcons = { ...brokenIcons, [site.domain]: true })}
                  />
                {:else}
                  {site.domain.charAt(0).toUpperCase()}
                {/if}
              </span>
              <span class="name">
                <strong>{site.domain}</strong>
                {#if site.storage}
                  <span class="hint"
                    >{t('siteStorage.counts', { cookies: site.storage.cookies, origins: site.storage.origins })}</span
                  >
                {/if}
              </span>
              <span class="chips">
                {#each site.permissions as entry (`${entry.origin} ${entry.kind}`)}
                  <span class="pill" class:ok={entry.decision === 'allow'} class:warn={entry.decision === 'deny'}>
                    {t(`permissions.${entry.kind}`)}
                  </span>
                {/each}
                {#each [...new Set(site.exceptions
                      .filter((item) => values[item.key].includes(item.origin))
                      .map((item) => item.key))] as key (key)}
                  <span class="pill">{exceptionLabels[key].chip}</span>
                {/each}
                {#if site.storage?.databaseBytes}<span class="pill">{size(site.storage.databaseBytes)}</span>{/if}
              </span>
              <span class="chevron" aria-hidden="true"></span>
            </summary>

            <div class="body">
              {#if site.permissions.length}
                <h3>{t('sites.permissions')}</h3>
                {#each site.permissions as entry (`${entry.origin} ${entry.kind}`)}
                  <div class="line">
                    <span>{permissionLabel(entry, site.domain)}</span>
                    <Select
                      options={choices(entry.kind)}
                      value={entry.decision as Choice}
                      aria-label={t('sitePermissions.choiceLabel', {
                        permission: t(`permissions.${entry.kind}`),
                        host: entry.host,
                      })}
                      onchange={(choice) => choose(entry, choice)}
                    />
                  </div>
                {/each}
              {/if}
              {#if site.exceptions.length}
                <h3>{t('sites.exceptions')}</h3>
                {#each site.exceptions as item (`${item.key} ${item.origin}`)}
                  <div class="line">
                    <span class="label">
                      <span>{exceptionLabels[item.key].title}</span>
                      <span class="hint">{item.origin}</span>
                    </span>
                    <Switch
                      label={`${exceptionLabels[item.key].title}: ${item.origin}`}
                      checked={values[item.key].includes(item.origin)}
                      onchange={(checked) => setException(item.key, item.origin, checked)}
                    />
                  </div>
                {/each}
              {/if}
              <h3>{t('sites.data')}</h3>
              <div class="line">
                <span class="hint">
                  {#if stored}{@render storageText(stored)}{:else if stored === null}{t('sites.noData')}{:else}…{/if}
                </span>
              </div>
              <div class="actions">
                {#if site.permissions.length}
                  <Button size="sm" variant="tonal" onclick={() => forget(site)}>{t('sites.resetPermissions')}</Button>
                {/if}
                <Button
                  size="sm"
                  variant="tonal"
                  data-action="clear-data"
                  disabled={busy}
                  onclick={() => clear(site.domain)}>{t('siteStorage.clear')}</Button
                >
              </div>
            </div>
          </details>
        </li>
      {/each}
    </ul>
  {:else if storage || error}
    <p class="hint empty">{t('siteStorage.empty')}</p>
  {/if}

  {#if storage && (storage.offset > 0 || storage.more)}
    <div class="pagination">
      <Button
        size="sm"
        disabled={busy || storage.offset === 0}
        onclick={() => loadStorage(Math.max(0, storage!.offset - 20))}>{t('siteStorage.previous')}</Button
      >
      <Button size="sm" disabled={busy || !storage.more} onclick={() => loadStorage(storage!.offset + 20)}
        >{t('siteStorage.next')}</Button
      >
    </div>
  {/if}
  <p class="hint footnote">{t('sites.footnote')}</p>
</section>

<style>
  .system {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 6px 0 18px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .system-label {
    margin-right: 2px;
    font-size: var(--font-size-small);
    font-weight: 600;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: var(--radius-pill);
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
  }

  .pill.ok {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--success);
  }

  .pill.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    color: var(--warn);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tools :global(input) {
    flex: 1;
    min-width: 0;
  }

  .sites {
    margin: 14px 0 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
    list-style: none;
  }

  .sites > li + li {
    border-top: 1px solid var(--border);
  }

  summary {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto 12px;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    list-style: none;
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background: var(--surface-hover);
  }

  summary:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: -2px;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--surface-hover);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
  }

  .name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name strong {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .chevron {
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--text-muted);
    border-bottom: 1.5px solid var(--text-muted);
    transform: rotate(-45deg);
    transition: transform 0.15s;
  }

  details[open] .chevron {
    transform: rotate(45deg);
  }

  .body {
    display: flex;
    flex-direction: column;
    padding: 0 14px 14px 54px;
  }

  .body h3 {
    margin: 12px 0 2px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 36px;
  }

  .line .label {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .pagination {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }

  .empty {
    margin: 14px 0 0;
  }

  .footnote {
    margin: 12px 0 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
