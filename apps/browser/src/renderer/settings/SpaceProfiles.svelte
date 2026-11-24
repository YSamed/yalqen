<script lang="ts">
  import { untrack } from 'svelte';
  import type { SettingsValues, SettingsView } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { ACCENT_COLORS, accentHex, type AccentColorId } from '../../shared/accent';
  import { DEFAULT_SPACE_ID, type SpaceView } from '../../shared/workspaces';
  import AccentPicker from '../ui/AccentPicker.svelte';
  import Button from '../ui/Button.svelte';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import Select from '../ui/Select.svelte';
  import TextField from '../ui/TextField.svelte';
  import SpaceRules from './SpaceRules.svelte';

  type DataPage = 'privacy' | 'passwords';
  type Page = DataPage | 'profiles' | `profile:${string}`;

  let {
    settings,
    update,
    profile = null,
    open,
    showData,
  }: {
    settings: SettingsView;
    update: (patch: Partial<SettingsValues>) => Promise<void>;
    profile?: string | null;
    open: (page: Page) => void;
    showData: (page: DataPage, space: string) => void;
  } = $props();

  const api = window.yalqenSettings;
  let busy = $state(false);
  let failed = $state(false);
  let showRules = $state(untrack(() => settings.values.spaceRules.length > 0));

  const edited = $derived(profile === null ? undefined : settings.spaces.find((space) => space.id === profile));
  const names = $derived(new Map(settings.spaces.map((space) => [space.id, space.name])));

  const colorOf = (space: SpaceView) => space.theme?.colors[0] ?? accentHex(settings.values.accentColor);
  const colorId = (space: SpaceView): AccentColorId =>
    ACCENT_COLORS.find(({ hex }) => hex === colorOf(space))?.id ?? settings.values.accentColor;

  // Spaces that share one data profile share cookies and sign-ins, like linked profiles.
  const shareOf = (id: string) => settings.spaceShares.find((share) => share.spaceIds.includes(id));
  const shareValue = (id: string) => {
    const share = shareOf(id);
    if (!share) return 'common';
    return share.spaceIds.length === 1 ? 'own' : share.id;
  };
  const shareOptions = (id: string) => [
    { value: 'own', label: t('profiles.dataOwn') },
    { value: 'common', label: t('profiles.dataCommon') },
    ...settings.spaceShares
      .filter((share) => share.spaceIds.some((spaceId) => spaceId !== id))
      .map((share) => ({
        value: share.id,
        label: t('profiles.dataSharedWith', {
          names: share.spaceIds
            .filter((spaceId) => spaceId !== id)
            .map((spaceId) => names.get(spaceId) ?? '')
            .join(', '),
        }),
      })),
  ];

  async function run(...args: Parameters<typeof api.spaceAction>): Promise<string | null> {
    busy = true;
    try {
      const result = await api.spaceAction(...args);
      failed = result === null && args[0] !== 'remove';
      return result;
    } finally {
      busy = false;
    }
  }

  function setColor(space: SpaceView, id: AccentColorId): void {
    if (space.id === DEFAULT_SPACE_ID) {
      void update({
        accentColor: id,
        frameTheme: { ...settings.values.frameTheme, colors: [accentHex(id)], texture: 'none' },
      });
      return;
    }
    void api.setSpaceTheme(space.id, {
      ...(space.theme ?? settings.values.frameTheme),
      colors: [accentHex(id)],
      texture: 'none',
    });
  }

  // A space's own data lives under its id, so switching back to "own" finds the same passwords again.
  function share(id: string, value: string): void {
    if (value === shareValue(id)) return;
    const own = id === DEFAULT_SPACE_ID ? 'new' : id;
    void run('share', id, value === 'common' ? null : value === 'own' ? own : value);
  }

  async function rename(space: SpaceView, input: HTMLInputElement): Promise<void> {
    if (input.value.trim() === space.name) return;
    if (!(await run('rename', space.id, input.value))) input.value = space.name;
  }

  async function create(): Promise<void> {
    const id = await run('create');
    if (id) open(`profile:${id}`);
  }

  async function remove(id: string): Promise<void> {
    if (await run('remove', id)) open('profiles');
  }
</script>

{#snippet dataRow(icon: IconName, tone: string, label: string, page: DataPage)}
  <button type="button" class="row link" onclick={() => edited && showData(page, edited.id)}>
    <span class="identity">
      <span class="tile" style:background={tone}><Icon name={icon} size={14} /></span>
      {label}
    </span>
    <span class="trail"><Icon name="external" size={14} /></span>
  </button>
{/snippet}

{#if failed}<p class="error" role="alert">{t('spaces.failed')}</p>{/if}

{#if edited}
  <div class="row">
    <label class="label" for="profile-name">{t('profiles.name')}</label>
    {#key edited.id}
      <TextField
        id="profile-name"
        value={edited.name}
        maxlength={80}
        autocomplete="off"
        disabled={busy || edited.id === DEFAULT_SPACE_ID}
        onchange={(event: Event) => rename(edited, event.currentTarget as HTMLInputElement)}
      />
    {/key}
  </div>
  <div class="row">
    <span class="label">{t('settings.themeColor')}</span>
    <AccentPicker label={t('settings.themeColor')} value={colorId(edited)} onchange={(id) => setColor(edited, id)} />
  </div>

  <h2>{t('profiles.data')}</h2>
  <div class="row">
    <span class="label">
      {t('profiles.dataSharing')}
      <span class="hint">{t('profiles.dataSharingHint')}</span>
    </span>
    <Select
      variant="ghost"
      options={shareOptions(edited.id)}
      value={shareValue(edited.id)}
      aria-label={t('profiles.dataSharing')}
      onchange={(value) => share(edited.id, value)}
    />
  </div>
  {@render dataRow('lock', '#0a84ff', t('profiles.dataPrivacy'), 'privacy')}
  {@render dataRow('key', '#30b350', t('profiles.dataPasswords'), 'passwords')}
  {@render dataRow('card', '#e0a800', t('profiles.dataCards'), 'passwords')}
  {@render dataRow('bell', '#f2792b', t('profiles.dataNotifications'), 'privacy')}

  <div class="actions">
    <Button variant="surface" onclick={() => open('privacy')}>{t('profiles.clearData')}</Button>
    <Button
      variant="danger"
      disabled={busy || edited.id === DEFAULT_SPACE_ID}
      title={edited.id === DEFAULT_SPACE_ID ? t('profiles.originalHint') : undefined}
      onclick={() => remove(edited.id)}
    >
      {t('profiles.removeEllipsis')}
    </Button>
  </div>
{:else}
  <p class="hint intro">{t('profiles.spacesHint')}</p>

  <h2>{t('profiles.windowsLinks')}</h2>
  <div class="actions">
    <Button variant="surface" aria-expanded={showRules} onclick={() => (showRules = !showRules)}>
      {t('profiles.linkRules')}
    </Button>
  </div>
  {#if showRules}<SpaceRules view={settings} {update} />{/if}

  <h2>{t('settings.paneProfiles')}</h2>
  <ul>
    {#each settings.spaces as space (space.id)}
      <li class="row">
        <button type="button" class="link" onclick={() => open(`profile:${space.id}`)}>
          <span class="identity">
            <span class="dot" style:background={colorOf(space)}></span>
            {#if space.icon}<span>{space.icon}</span>{/if}
            <strong>{space.name}</strong>
          </span>
          <span class="trail"><Icon name="forward" size={14} /></span>
        </button>
      </li>
    {/each}
  </ul>
  <div class="actions">
    <Button variant="surface" disabled={busy} onclick={create}>{t('profiles.createEllipsis')}</Button>
  </div>
{/if}

<style>
  .intro {
    margin: 8px 10px 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li.row {
    padding: 0;
  }
  .link {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 42px;
    padding: 7px 10px;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: start;
  }
  button.row.link {
    width: 100%;
  }
  .link:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  strong {
    overflow: hidden;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: #fff;
  }
  .trail {
    display: inline-flex;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
</style>
