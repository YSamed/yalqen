<script lang="ts">
  import { DEFAULT_ZOOM_FACTORS, type SettingsValues } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { ACCENT_COLORS, accentHex, type AccentColorId } from '../../shared/accent';
  import type { FrameTheme } from '../../shared/frame-theme';
  import { DEFAULT_SPACE_ID, type SpaceView } from '../../shared/workspaces';
  import AccentPicker from '../ui/AccentPicker.svelte';
  import Button from '../ui/Button.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import ChoiceCards from './ChoiceCards.svelte';
  import SettingRow from './SettingRow.svelte';

  let {
    values,
    spaces = [],
    update,
    section,
  }: {
    values: SettingsValues;
    spaces?: SpaceView[];
    update: (patch: Partial<SettingsValues>) => Promise<void>;
    section: 'look' | 'tabs';
  } = $props();

  const api = window.yalqenSettings;

  type Theme = SettingsValues['theme'];
  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ] as const;

  const zoomOptions = DEFAULT_ZOOM_FACTORS.map((factor) => ({
    value: factor,
    label: t('settings.zoomPercent', { percent: Math.round(factor * 100) }),
  }));

  // The space menu opens this pane with #space=<id> to theme just that space.
  let frameScope = $state(new URLSearchParams(location.hash.slice(1)).get('space') ?? DEFAULT_SPACE_ID);
  $effect(() => {
    const follow = () => {
      const space = new URLSearchParams(location.hash.slice(1)).get('space');
      if (space !== null) frameScope = space;
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  });
  const scopedSpace = $derived(spaces.find((space) => space.id !== DEFAULT_SPACE_ID && space.id === frameScope));
  const frame = $derived(scopedSpace?.theme ?? values.frameTheme);
  const themeColor = $derived<AccentColorId>(
    ACCENT_COLORS.find(({ hex }) => hex === frame.colors[0])?.id ?? values.accentColor,
  );

  // One color themes the card frame and the accent; the shared theme also stores it as the global accent.
  function setThemeColor(id: AccentColorId): void {
    const theme: FrameTheme = { ...frame, colors: [accentHex(id)], texture: 'none' };
    if (scopedSpace) void api.setSpaceTheme(scopedSpace.id, theme);
    else void update({ frameTheme: theme, accentColor: id });
  }
</script>

{#snippet mockWindow(scheme: 'light' | 'dark')}
  <rect class="win {scheme}" width="160" height="100" rx="6" />
  <rect class="side {scheme}" width="40" height="100" rx="6" />
  <rect class="line {scheme}" x="8" y="12" width="24" height="5" rx="2.5" />
  <rect class="dot" x="8" y="23" width="20" height="5" rx="2.5" />
  <rect class="line {scheme}" x="8" y="34" width="22" height="5" rx="2.5" />
  <rect class="line {scheme}" x="50" y="12" width="98" height="7" rx="3.5" />
  <rect class="line {scheme}" x="50" y="27" width="70" height="4" rx="2" />
  <rect class="line {scheme}" x="50" y="36" width="82" height="4" rx="2" />
{/snippet}

{#snippet themePreview(theme: Theme)}
  <svg viewBox="0 0 160 100">
    {#if theme === 'system'}
      <defs><clipPath id="theme-half"><rect width="80" height="100" /></clipPath></defs>
      {@render mockWindow('dark')}
      <g clip-path="url(#theme-half)">{@render mockWindow('light')}</g>
    {:else}
      {@render mockWindow(theme)}
    {/if}
  </svg>
{/snippet}

{#if section === 'look'}
  <h2>{t('settings.theme')}</h2>
  <ChoiceCards
    label={t('settings.theme')}
    options={themeOptions}
    value={values.theme}
    onchange={(value) => update({ theme: value })}
    preview={themePreview}
  />
  <SettingRow title={scopedSpace ? t('settings.themeColorFor', { space: scopedSpace.name }) : t('settings.themeColor')}>
    <AccentPicker label={t('settings.themeColor')} value={themeColor} onchange={setThemeColor} />
    {#if scopedSpace?.theme}
      <Button variant="ghost" onclick={() => api.setSpaceTheme(scopedSpace.id, null)}>
        {t('settings.frameScopeReset')}
      </Button>
    {/if}
  </SettingRow>

  <SettingRow title={t('settings.darkSites')} hint={t('settings.darkSitesHint')}>
    <Switch
      label={t('settings.darkSites')}
      checked={values.darkSites}
      onchange={(checked) => update({ darkSites: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.pageZoom')} hint={t('settings.pageZoomHint')} labelFor="default-zoom">
    <Select
      controlled
      id="default-zoom"
      options={zoomOptions}
      value={values.defaultZoom}
      onchange={(value) => update({ defaultZoom: value })}
    />
  </SettingRow>
{:else}
  <h2>{t('settings.tabPanel')}</h2>
  <SettingRow title={t('settings.pinnedTabsStayHome')} hint={t('settings.pinnedTabsStayHomeHint')}>
    <Switch
      label={t('settings.pinnedTabsStayHome')}
      checked={values.pinnedTabsStayHome}
      onchange={(checked) => update({ pinnedTabsStayHome: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.recentTabCycling')} hint={t('settings.recentTabCyclingHint')}>
    <Switch
      label={t('settings.recentTabCycling')}
      checked={values.recentTabCycling}
      onchange={(checked) => update({ recentTabCycling: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.pageSwipe')} hint={t('settings.pageSwipeHint')}>
    <Switch
      label={t('settings.pageSwipe')}
      checked={values.pageSwipe}
      onchange={(checked) => update({ pageSwipe: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.tabCleanup')} hint={t('settings.tabCleanupHint')}>
    <Switch
      label={t('settings.tabCleanup')}
      checked={values.manualTabCleanup}
      onchange={(checked) => update({ manualTabCleanup: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.tabModes')} hint={t('settings.tabModesHint')}>
    <Switch
      label={t('settings.tabModes')}
      checked={values.tabModes}
      onchange={(checked) => update({ tabModes: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.autoDeveloperMode')} hint={t('settings.autoDeveloperModeHint')}>
    <Switch
      label={t('settings.autoDeveloperMode')}
      checked={values.autoDeveloperMode}
      disabled={!values.tabModes}
      onchange={(checked) => update({ autoDeveloperMode: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.bookmarksPanel')} hint={t('settings.bookmarksPanelHint')}>
    <Switch
      label={t('settings.bookmarksPanel')}
      checked={values.bookmarksPanel}
      onchange={(checked) => update({ bookmarksPanel: checked })}
    />
  </SettingRow>
  <SettingRow title={t('settings.mediaPlayer')} hint={t('settings.mediaPlayerHint')}>
    <Switch
      label={t('settings.mediaPlayer')}
      checked={values.sidebarWidgets.includes('media')}
      onchange={(checked) => update({ sidebarWidgets: checked ? ['media'] : [] })}
    />
  </SettingRow>
{/if}

<style>
  svg {
    --mock-light: #ffffff;
    --mock-light-side: #f1f1f3;
    --mock-light-line: #d6d6db;
    --mock-dark: #1b1b1e;
    --mock-dark-side: #111113;
    --mock-dark-line: #36363c;
  }

  .win.light {
    fill: var(--mock-light);
  }

  .side.light {
    fill: var(--mock-light-side);
  }

  .line.light {
    fill: var(--mock-light-line);
  }

  .win.dark {
    fill: var(--mock-dark);
  }

  .side.dark {
    fill: var(--mock-dark-side);
  }

  .line.dark {
    fill: var(--mock-dark-line);
  }

  .dot {
    fill: var(--accent);
  }
</style>
