<script lang="ts">
  import { untrack } from 'svelte';
  import { DEFAULT_ZOOM_FACTORS, type SettingsValues } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import AccentPicker from '../ui/AccentPicker.svelte';
  import Button from '../ui/Button.svelte';
  import AdvancedGroup from './AdvancedGroup.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import ChoiceCards from './ChoiceCards.svelte';
  import SettingRow from './SettingRow.svelte';
  import ToolbarEditor from './ToolbarEditor.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const api = window.yalqenSettings;
  const startupTransparency = untrack(() => values.transparency);
  const transparencyChanged = $derived(values.transparency !== startupTransparency);

  type Theme = SettingsValues['theme'];
  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ] as const;

  // Sidebar visibility, width and side are three settings, but people pick them as one layout.
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

<h2>{t('settings.theme')}</h2>
<ChoiceCards
  label={t('settings.theme')}
  options={themeOptions}
  value={values.theme}
  onchange={(value) => update({ theme: value })}
  preview={themePreview}
/>
<SettingRow title={t('settings.accent')} hint={t('settings.accentHint')}>
  <AccentPicker
    label={t('settings.accent')}
    value={values.accentColor}
    onchange={(value) => update({ accentColor: value })}
  />
</SettingRow>

<h2>{t('settings.tabPanel')}</h2>
<ChoiceCards
  label={t('settings.tabPanel')}
  options={layoutOptions}
  value={layout}
  onchange={setLayout}
  preview={layoutPreview}
/>

<h2>{t('settings.toolbar')}</h2>
<ToolbarEditor shown={values.toolbarButtons} onchange={(buttons) => update({ toolbarButtons: buttons })} />

<AdvancedGroup>
  <SettingRow title={t('settings.pinnedTabs')}>
    <SegmentedControl
      label={t('settings.pinnedTabs')}
      options={pinnedOptions}
      value={values.pinnedDisplay}
      onchange={(value) => update({ pinnedDisplay: value })}
    />
  </SettingRow>
  <SettingRow title={t('settings.mediaPlayer')} hint={t('settings.mediaPlayerHint')}>
    <Switch
      label={t('settings.mediaPlayer')}
      checked={values.sidebarWidgets.includes('media')}
      onchange={(checked) => update({ sidebarWidgets: checked ? ['media'] : [] })}
    />
  </SettingRow>
  <SettingRow title={t('settings.transparency')} hint={t('settings.transparencyHint')}>
    <Switch
      label={t('settings.transparency')}
      checked={values.transparency}
      onchange={(checked) => update({ transparency: checked })}
    />
    {#if transparencyChanged}
      <Button variant="primary" onclick={() => api.relaunch()}>{t('settings.restartNow')}</Button>
    {/if}
  </SettingRow>
  {#if startupTransparency}
    <SettingRow title={t('settings.glassTint')} hint={t('settings.glassTintHint')} labelFor="glass-tint">
      <input
        id="glass-tint"
        class="tint"
        type="range"
        min="0"
        max="100"
        value={values.glassTint}
        oninput={(event) => update({ glassTint: event.currentTarget.valueAsNumber })}
      />
    </SettingRow>
  {/if}
  <SettingRow title={t('settings.pageZoom')} hint={t('settings.pageZoomHint')} labelFor="default-zoom">
    <Select
      id="default-zoom"
      options={zoomOptions}
      value={values.defaultZoom}
      onchange={(value) => update({ defaultZoom: value })}
    />
  </SettingRow>
</AdvancedGroup>

<style>
  .tint {
    flex: none;
    width: 180px;
    accent-color: var(--accent);
  }

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
