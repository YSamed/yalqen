<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_ZOOM_FACTORS,
    type ExtensionInfo,
    type SettingsValues,
    type ToolbarExtension,
  } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import { ACCENT_COLORS, accentHex, type AccentColorId } from '../../shared/accent';
  import type { FrameTheme } from '../../shared/frame-theme';
  import { DEFAULT_SPACE_ID, type SpaceView } from '../../shared/workspaces';
  import AccentPicker from '../ui/AccentPicker.svelte';
  import Button from '../ui/Button.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import ChoiceCards from './ChoiceCards.svelte';
  import SettingRow from './SettingRow.svelte';
  import ToolbarEditor from './ToolbarEditor.svelte';

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

  let installed = $state<ExtensionInfo[]>([]);
  const toolbarExtensions = $derived<ToolbarExtension[]>(
    installed.flatMap((extension) =>
      extension.enabled && extension.id ? [{ id: extension.id, title: extension.name, icon: extension.icon }] : [],
    ),
  );
  onMount(() => {
    api
      .extensions()
      .then((next) => (installed = next))
      .catch(() => {});
    return api.onExtensionsChange((next) => (installed = next));
  });

  type Theme = SettingsValues['theme'];
  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ] as const;

  type Layout = 'left-wide' | 'left-narrow' | 'right-wide' | 'right-narrow' | 'hidden';
  const layoutOptions = [
    { value: 'left-wide', label: t('settings.layoutLeftWide') },
    { value: 'left-narrow', label: t('settings.layoutLeftNarrow') },
    { value: 'right-wide', label: t('settings.layoutRightWide') },
    { value: 'right-narrow', label: t('settings.layoutRightNarrow') },
    { value: 'hidden', label: t('settings.layoutHidden') },
  ] as const;
  const layout = $derived<Layout>(
    values.sidebarVisible ? `${values.panelSide}-${values.panelCollapsed ? 'narrow' : 'wide'}` : 'hidden',
  );

  function setLayout(next: Layout): void {
    if (next === 'hidden') {
      void update({ sidebarVisible: false });
      return;
    }
    const [side, width] = next.split('-') as ['left' | 'right', 'wide' | 'narrow'];
    void update({ sidebarVisible: true, panelSide: side, panelCollapsed: width === 'narrow' });
  }

  const zoomOptions = DEFAULT_ZOOM_FACTORS.map((factor) => ({
    value: factor,
    label: t('settings.zoomPercent', { percent: Math.round(factor * 100) }),
  }));
  let choosingBackground = $state(false);

  async function chooseBackground(): Promise<void> {
    choosingBackground = true;
    try {
      await api.chooseNewTabBackground();
    } finally {
      choosingBackground = false;
    }
  }

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

  // One color themes the card frame; for the shared theme it also becomes the accent.
  function setThemeColor(id: AccentColorId): void {
    const theme: FrameTheme = { ...frame, colors: [accentHex(id)], texture: 'none' };
    if (scopedSpace) void api.setSpaceTheme(scopedSpace.id, theme);
    else void update({ frameTheme: theme, accentColor: id });
  }

  const pinnedOptions = [
    { value: 'always', label: t('settings.pinnedAlways') },
    { value: 'expanded', label: t('settings.pinnedExpanded') },
    { value: 'never', label: t('settings.pinnedNever') },
  ] as const;
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

{#snippet layoutPreview(option: Layout)}
  {@const right = option.startsWith('right')}
  {@const narrow = option.endsWith('narrow')}
  {@const width = narrow ? 16 : 42}
  {@const panelX = right ? 156 - width : 4}
  <svg viewBox="0 0 160 100">
    <rect class="frame" width="160" height="100" rx="6" />
    {#if option === 'hidden'}
      <rect class="dot" x="8" y="7" width="30" height="8" rx="4" />
      <rect class="tab" x="42" y="7" width="30" height="8" rx="4" />
      <rect class="tab" x="76" y="7" width="30" height="8" rx="4" />
      <rect class="page" x="6" y="20" width="148" height="74" rx="4" />
    {:else}
      <rect class="panel" x={panelX} y="4" {width} height="92" rx="4" />
      {#each [0, 1, 2, 3] as row (row)}
        {#if narrow}
          <circle class={row === 0 ? 'dot' : 'tab'} cx={panelX + 8} cy={14 + row * 11} r="3.5" />
        {:else}
          <rect
            class={row === 0 ? 'dot' : 'tab'}
            x={panelX + 6}
            y={11 + row * 11}
            width={30 - (row % 2) * 6}
            height="5"
            rx="2.5"
          />
        {/if}
      {/each}
      <rect class="page" x={right ? 6 : panelX + width + 6} y="8" width={148 - width - 2} height="84" rx="4" />
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
      <Button variant="ghost" onclick={() => api.setSpaceTheme(scopedSpace.id, null)}
        >{t('settings.frameScopeReset')}</Button
      >
    {/if}
  </SettingRow>

  <SettingRow title={t('settings.newTabBackground')} hint={t('settings.newTabBackgroundHint')}>
    <Button variant="tonal" disabled={choosingBackground} onclick={chooseBackground}>
      {t('settings.chooseNewTabBackground')}
    </Button>
    {#if values.newTabBackground}
      <Button variant="ghost" onclick={() => api.removeNewTabBackground()}
        >{t('settings.removeNewTabBackground')}</Button
      >
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
      id="default-zoom"
      options={zoomOptions}
      value={values.defaultZoom}
      onchange={(value) => update({ defaultZoom: value })}
    />
  </SettingRow>
{:else}
  <h2>{t('settings.tabPanel')}</h2>
  <ChoiceCards
    label={t('settings.tabPanel')}
    options={layoutOptions}
    value={layout}
    onchange={setLayout}
    preview={layoutPreview}
  />
  <SettingRow title={t('settings.pinnedTabs')}>
    <SegmentedControl
      label={t('settings.pinnedTabs')}
      options={pinnedOptions}
      value={values.pinnedDisplay}
      onchange={(value) => update({ pinnedDisplay: value })}
    />
  </SettingRow>
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

  <h2>{t('settings.toolbar')}</h2>
  <SettingRow title={t('settings.showToolbar')} hint={t('settings.showToolbarHint')}>
    <Switch
      label={t('settings.showToolbar')}
      checked={values.toolbarVisible}
      onchange={(checked) => update({ toolbarVisible: checked })}
    />
  </SettingRow>
  <ToolbarEditor
    shown={values.toolbarButtons}
    extensions={toolbarExtensions}
    onchange={(buttons) => update({ toolbarButtons: buttons })}
  />
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

  .frame {
    fill: var(--bg);
  }

  .panel {
    fill: var(--surface-hover);
  }

  .tab {
    fill: var(--border);
  }

  .page {
    fill: var(--surface);
    stroke: var(--border);
  }
</style>
