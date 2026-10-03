<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import {
    DEFAULT_ZOOM_FACTORS,
    REQUIRED_TOOLBAR_BUTTON,
    TOOLBAR_BUTTON_IDS,
    type SettingsValues,
    type ToolbarButtonId,
  } from '../../shared/types';
  import { t } from '../../shared/i18n';
  import Icon, { type IconName } from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import Switch from '../ui/Switch.svelte';
  import SettingRow from './SettingRow.svelte';

  let { values, update }: { values: SettingsValues; update: (patch: Partial<SettingsValues>) => Promise<void> } =
    $props();

  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ] as const;
  const fontSizeOptions = [
    { value: 'small', label: t('settings.fontSmall') },
    { value: 'medium', label: t('settings.fontMedium') },
    { value: 'large', label: t('settings.fontLarge') },
    { value: 'xlarge', label: t('settings.fontXLarge') },
  ] as const;
  const zoomOptions = DEFAULT_ZOOM_FACTORS.map((factor) => ({
    value: factor,
    label: t('settings.zoomPercent', { percent: Math.round(factor * 100) }),
  }));
  const pinnedOptions = [
    { value: 'always', label: t('settings.pinnedAlways') },
    { value: 'expanded', label: t('settings.pinnedExpanded') },
    { value: 'never', label: t('settings.pinnedNever') },
  ] as const;
  const toolbarTabOptions = [
    { value: true, label: t('settings.allTabs') },
    { value: false, label: t('settings.currentPageOnly') },
  ] as const;
  const panelOptions = [
    { value: false, label: t('settings.panelWide') },
    { value: true, label: t('settings.panelNarrow') },
  ] as const;
  const sideOptions = [
    { value: 'left', label: t('settings.left') },
    { value: 'right', label: t('settings.right') },
  ] as const;
  const toolbarButtonLabels: Record<ToolbarButtonId, { label: string; icon: IconName }> = {
    bookmarks: { label: t('settings.bookmarks'), icon: 'bookmarks' },
    history: { label: t('settings.history'), icon: 'history' },
    extensions: { label: t('settings.paneExtensions'), icon: 'extensions' },
    profile: { label: t('settings.profile'), icon: 'profile' },
    settings: { label: t('settings.toolbarSettings'), icon: 'settings' },
    downloads: { label: t('settings.downloads'), icon: 'download' },
  };

  const toolbarButtons = $derived([
    ...values.toolbarButtons,
    ...TOOLBAR_BUTTON_IDS.filter((id) => !values.toolbarButtons.includes(id)),
  ]);

  function updateToolbarButtons(order: ToolbarButtonId[], shown: Set<ToolbarButtonId>): void {
    void update({ toolbarButtons: order.filter((id) => shown.has(id)) });
  }

  function toggleToolbarButton(id: ToolbarButtonId, visible: boolean): void {
    const shown = new SvelteSet(values.toolbarButtons);
    if (visible) shown.add(id);
    else shown.delete(id);
    updateToolbarButtons(toolbarButtons, shown);
  }

  function moveToolbarButton(id: ToolbarButtonId, step: -1 | 1): void {
    const order = [...toolbarButtons];
    const index = order.indexOf(id);
    const target = index + step;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateToolbarButtons(order, new Set(values.toolbarButtons));
  }
</script>

<h2>{t('settings.theme')}</h2>
<SettingRow title={t('settings.colorScheme')}>
  <SegmentedControl
    label={t('settings.theme')}
    options={themeOptions}
    value={values.theme}
    onchange={(value) => update({ theme: value })}
  />
</SettingRow>

<h2>{t('settings.pages')}</h2>
<SettingRow title={t('settings.fontSize')} hint={t('settings.fontSizeHint')} labelFor="font-size">
  <Select
    id="font-size"
    options={fontSizeOptions}
    value={values.fontSize}
    onchange={(value) => update({ fontSize: value })}
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
<h2>{t('settings.menus')}</h2>
<SettingRow title={t('settings.sidebar')}>
  <Switch
    label={t('settings.sidebarVisibility')}
    checked={values.sidebarVisible}
    onchange={(checked) => update({ sidebarVisible: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.pinnedTabs')}>
  <SegmentedControl
    label={t('settings.pinnedTabs')}
    options={pinnedOptions}
    value={values.pinnedDisplay}
    onchange={(value) => update({ pinnedDisplay: value })}
  />
</SettingRow>
<SettingRow title={t('settings.toolbar')} hint={t('settings.toolbarHint')}>
  <Switch
    label={t('settings.toolbarVisibility')}
    checked={values.toolbarVisible}
    onchange={(checked) => update({ toolbarVisible: checked })}
  />
</SettingRow>
<SettingRow title={t('settings.toolbarTabs')} hint={t('settings.toolbarTabsHint')}>
  <SegmentedControl
    label={t('settings.toolbarTabs')}
    options={toolbarTabOptions}
    value={values.toolbarTabs}
    onchange={(value) => update({ toolbarTabs: value })}
  />
</SettingRow>

<h2>{t('settings.toolbarButtons')}</h2>
<ul class="buttons" aria-label={t('settings.toolbarButtons')}>
  {#each toolbarButtons as id, index (id)}
    {@const item = toolbarButtonLabels[id]}
    <li class="row">
      <label class="check">
        <input
          type="checkbox"
          checked={values.toolbarButtons.includes(id)}
          disabled={id === REQUIRED_TOOLBAR_BUTTON}
          onchange={(event) => toggleToolbarButton(id, event.currentTarget.checked)}
        />
        <Icon name={item.icon} size={16} />
        <span class="label">
          <span>{item.label}</span>
          {#if id === REQUIRED_TOOLBAR_BUTTON}
            <span class="hint">{t('settings.settingsAlwaysVisible')}</span>
          {/if}
        </span>
      </label>
      <span class="move">
        <IconButton
          icon="up"
          label={t('settings.moveEarlier', { label: item.label })}
          disabled={index === 0}
          onclick={() => moveToolbarButton(id, -1)}
        />
        <IconButton
          icon="down"
          label={t('settings.moveLater', { label: item.label })}
          disabled={index === toolbarButtons.length - 1}
          onclick={() => moveToolbarButton(id, 1)}
        />
      </span>
    </li>
  {/each}
</ul>

<h2>{t('settings.tabPanel')}</h2>
<SettingRow title={t('settings.panelAppearance')}>
  <SegmentedControl
    label={t('settings.panelAppearanceLabel')}
    options={panelOptions}
    value={values.panelCollapsed}
    onchange={(value) => update({ panelCollapsed: value })}
  />
</SettingRow>
<SettingRow title={t('settings.position')}>
  <SegmentedControl
    label={t('settings.panelPosition')}
    options={sideOptions}
    value={values.panelSide}
    onchange={(value) => update({ panelSide: value })}
  />
</SettingRow>

<style>
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .check input {
    margin: 0;
  }

  .buttons {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .buttons .check {
    gap: 10px;
  }

  .move {
    display: flex;
    gap: 2px;
  }
</style>
