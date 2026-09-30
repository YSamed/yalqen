<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { ClearDataRange, SettingsValues, SettingsView, ToolbarButtonId, UpdateStatus } from '../shared/types';
  import { REQUIRED_TOOLBAR_BUTTON, TOOLBAR_BUTTON_IDS } from '../shared/types';
  import Extensions from './components/Extensions.svelte';
  import Icon, { type IconName } from './components/Icon.svelte';
  import Passwords from './components/Passwords.svelte';
  import ProcessUsage from './components/ProcessUsage.svelte';
  import RequestRules from './components/RequestRules.svelte';
  import Button from './components/ui/Button.svelte';
  import IconButton from './components/ui/IconButton.svelte';
  import SegmentedControl from './components/ui/SegmentedControl.svelte';
  import Select from './components/ui/Select.svelte';
  import TextField from './components/ui/TextField.svelte';

  const api = window.yalqenSettings;

  type PaneId = 'general' | 'appearance' | 'privacy' | 'passwords' | 'performance' | 'extensions' | 'developer';
  const panes: { id: PaneId; label: string; icon: IconName }[] = [
    { id: 'general', label: 'Genel', icon: 'settings' },
    { id: 'appearance', label: 'Görünüm', icon: 'appearance' },
    { id: 'privacy', label: 'Gizlilik', icon: 'lock' },
    { id: 'passwords', label: 'Şifreler', icon: 'key' },
    { id: 'performance', label: 'Performans', icon: 'gauge' },
    { id: 'extensions', label: 'Uzantılar', icon: 'extensions' },
    { id: 'developer', label: 'Geliştirici', icon: 'sparkle' },
  ];
  const paneFromPath = panes.find((item) => `/${item.id}` === location.pathname)?.id;
  let pane = $state<PaneId>(paneFromPath ?? 'general');

  $effect(() => {
    const path = pane === 'general' ? '/' : `/${pane}`;
    if (location.pathname !== path) history.replaceState(null, '', path);
  });

  function movePane(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = panes.findIndex((item) => item.id === pane);
    pane = panes[(index + step + panes.length) % panes.length].id;
    document.getElementById(`tab-${pane}`)?.focus();
  }

  const panelOptions = [
    { value: false, label: 'Geniş' },
    { value: true, label: 'Dar' },
  ] as const;
  const sideOptions = [
    { value: 'left', label: 'Sol' },
    { value: 'right', label: 'Sağ' },
  ] as const;
  const onOffOptions = [
    { value: true, label: 'Açık' },
    { value: false, label: 'Kapalı' },
  ] as const;
  const visibilityOptions = [
    { value: true, label: 'Görünür' },
    { value: false, label: 'Gizli' },
  ] as const;
  const toolbarTabOptions = [
    { value: true, label: 'Tüm sekmeler' },
    { value: false, label: 'Yalnızca açık sayfa' },
  ] as const;
  const toolbarButtonLabels: Record<ToolbarButtonId, { label: string; icon: IconName }> = {
    bookmarks: { label: 'Yer imleri', icon: 'bookmarks' },
    history: { label: 'Geçmiş', icon: 'history' },
    extensions: { label: 'Uzantılar', icon: 'extensions' },
    profile: { label: 'Profil', icon: 'profile' },
    settings: { label: 'Ayarlar', icon: 'settings' },
    downloads: { label: 'İndirilenler', icon: 'download' },
  };
  const discardOptions = [
    { value: 0, label: 'Kapalı' },
    { value: 15, label: '15 dk' },
    { value: 30, label: '30 dk' },
    { value: 60, label: '1 sa' },
    { value: 120, label: '2 sa' },
  ] as const;
  const themeOptions = [
    { value: 'system', label: 'Sistem' },
    { value: 'light', label: 'Açık' },
    { value: 'dark', label: 'Koyu' },
  ] as const;
  const startupOptions = [
    { value: 'restore', label: 'Kaldığım yerden devam et' },
    { value: 'new-tab', label: 'Yeni sekmeyle başla' },
  ] as const;

  const fontSizeOptions = [
    { value: 'small', label: 'Küçük' },
    { value: 'medium', label: 'Orta' },
    { value: 'large', label: 'Büyük' },
    { value: 'xlarge', label: 'Çok büyük' },
  ] as const;
  const zoomOptions = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const languageOptions = [
    { value: 'tr', label: 'Türkçe' },
    { value: 'en', label: 'English' },
  ] as const;
  const dnsOptions = [
    { value: 'automatic', label: 'Otomatik' },
    { value: 'cloudflare', label: 'Cloudflare' },
    { value: 'google', label: 'Google' },
    { value: 'quad9', label: 'Quad9' },
    { value: 'off', label: 'Kapalı' },
  ] as const;
  const rangeOptions: { value: ClearDataRange; label: string }[] = [
    { value: 'hour', label: 'Son 1 saat' },
    { value: 'day', label: 'Son 24 saat' },
    { value: 'week', label: 'Son 7 gün' },
    { value: 'month', label: 'Son 4 hafta' },
    { value: 'all', label: 'Tüm zamanlar' },
  ];
  const clearOptions = [
    { key: 'history', label: 'Tarama geçmişi' },
    { key: 'downloads', label: 'İndirme listesi' },
    { key: 'siteData', label: 'Çerezler ve site verileri' },
    { key: 'cache', label: 'Önbellek' },
  ] as const;

  let clearRange = $state<ClearDataRange>('hour');
  let clearKinds = $state({ history: true, downloads: false, siteData: false, cache: false });
  let clearing = $state(false);
  let cleared = $state(false);
  const clearSelected = $derived(Object.values(clearKinds).some(Boolean));

  async function clearData(): Promise<void> {
    clearing = true;
    cleared = false;
    try {
      await api.clearData({ range: clearRange, ...clearKinds });
      cleared = true;
    } finally {
      clearing = false;
    }
  }

  let view = $state<SettingsView | null>(null);
  let templateDraft = $state('');
  let editingTemplate = $state(false);

  const values = $derived(view?.values);
  const isCustom = $derived(values?.searchEngine === 'custom');
  const templateInvalid = $derived(isCustom && !!values?.customSearchTemplate && !view?.customTemplateValid);

  $effect(() => {
    if (!editingTemplate) templateDraft = values?.customSearchTemplate ?? '';
  });

  const toolbarButtons = $derived.by(() => {
    const shown = values?.toolbarButtons ?? [];
    return [...shown, ...TOOLBAR_BUTTON_IDS.filter((id) => !shown.includes(id))];
  });

  function updateToolbarButtons(order: ToolbarButtonId[], shown: Set<ToolbarButtonId>): void {
    update({ toolbarButtons: order.filter((id) => shown.has(id)) });
  }

  function toggleToolbarButton(id: ToolbarButtonId, visible: boolean): void {
    const shown = new SvelteSet(values?.toolbarButtons);
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
    updateToolbarButtons(order, new Set(values?.toolbarButtons));
  }

  function updateMessage(status: UpdateStatus): string {
    switch (status.state) {
      case 'unavailable':
        return 'Geliştirme sürümü kendini güncellemez.';
      case 'idle':
        return 'Yeni sürüm henüz denetlenmedi.';
      case 'checking':
        return 'Yeni sürüm denetleniyor…';
      case 'up-to-date':
        return 'Yalqen güncel.';
      case 'downloading':
        return `Yalqen ${status.version} indiriliyor… %${status.percent}`;
      case 'ready':
        return `Yalqen ${status.version} hazır. Yeniden başlatınca yüklenir, açık sekmeler geri gelir.`;
      case 'failed':
        return 'Güncelleme denetlenemedi. Bağlantınızı kontrol edip tekrar deneyin.';
    }
  }

  async function update(patch: Partial<SettingsValues>): Promise<void> {
    view = await api.update(patch);
  }

  function commitTemplate(): void {
    editingTemplate = false;
    void update({ customSearchTemplate: templateDraft.trim() || null });
  }

  onMount(() => {
    void api.get().then((next) => (view = next));
    return api.onChange((next) => (view = next));
  });
</script>

{#if view && values}
  <div class="settings">
    <h1>Ayarlar</h1>
    <div class="layout">
      <div class="panes" role="tablist" aria-orientation="vertical" aria-label="Ayarlar bölümleri">
        {#each panes as item (item.id)}
          <Button
            size="lg"
            icon={item.icon}
            role="tab"
            id="tab-{item.id}"
            class="pane-tab"
            aria-controls="pane"
            aria-selected={pane === item.id}
            tabindex={pane === item.id ? 0 : -1}
            onclick={() => (pane = item.id)}
            onkeydown={movePane}
          >
            {item.label}
          </Button>
        {/each}
      </div>
      <div id="pane" class="pane" role="tabpanel" aria-labelledby="tab-{pane}">
        {#if pane === 'general'}
          <h2>Arama</h2>
          <div class="row">
            <label for="engine" class="label">
              <span>Arama motoru</span>
              <span class="hint">Adres çubuğuna adres dışında bir şey yazıldığında kullanılır.</span>
            </label>
            <Select
              id="engine"
              value={values.searchEngine}
              onchange={(event) =>
                update({ searchEngine: event.currentTarget.value as SettingsValues['searchEngine'] })}
            >
              {#each view.engines as engine (engine.id)}
                <option value={engine.id}>{engine.label}</option>
              {/each}
              <option value="custom">Özel</option>
            </Select>
          </div>
          {#if isCustom}
            <div class="row stacked">
              <label for="engine-url" class="label">
                <span>Arama adresi</span>
                <span class="hint"
                  >Aranan metin %s yerine yazılır. Geçerli bir adres girilene kadar Google kullanılır.</span
                >
              </label>
              <TextField
                id="engine-url"
                type="url"
                spellcheck="false"
                autocomplete="off"
                placeholder="https://ornek.com/search?q=%s"
                invalid={templateInvalid}
                bind:value={templateDraft}
                onfocus={() => (editingTemplate = true)}
                onchange={commitTemplate}
                onblur={() => (editingTemplate = false)}
              />
              {#if templateInvalid}
                <span class="error" role="alert">Adres http(s) ile başlamalı ve %s içermeli.</span>
              {/if}
            </div>
          {/if}

          <h2>Varsayılan tarayıcı</h2>
          <div class="row">
            <span class="label">
              <span>{view.defaultBrowser ? 'Yalqen varsayılan tarayıcınız' : 'Yalqen varsayılan tarayıcı değil'}</span>
              <span class="hint">Diğer uygulamalardaki bağlantılar varsayılan tarayıcıda açılır.</span>
            </span>
            {#if !view.defaultBrowser}
              <Button variant="primary" onclick={async () => (view = await api.makeDefault())}>Varsayılan yap</Button>
            {/if}
          </div>

          <h2>Açılış</h2>
          <div class="row">
            <span class="label">
              <span>Tarayıcı açıldığında</span>
              <span class="hint">Yeni sekmeyle başla seçilirse, tarayıcı kapandığında açık sekmeler kaydedilmez.</span>
            </span>
            <Select
              aria-label="Tarayıcı açıldığında"
              value={values.startupBehavior}
              onchange={(event) =>
                update({ startupBehavior: event.currentTarget.value as SettingsValues['startupBehavior'] })}
            >
              {#each startupOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </Select>
          </div>

          <h2>Dil</h2>
          <div class="row">
            <span class="label">
              <span>Sayfa dili</span>
              <span class="hint">Sitelerden önce bu dilde içerik istenir; yazım denetimi de bu sırayı izler.</span>
            </span>
            <SegmentedControl
              label="Sayfa dili"
              options={languageOptions}
              value={values.pageLanguage}
              onchange={(value) => update({ pageLanguage: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>Sayfa çevirisi</span>
              <span class="hint">
                Sayfa dili farklıysa çevir düğmesi görünür. Çevirirken sayfa metni Google Çeviri'ye gönderilir; yalnızca
                düğmeye bastığınızda.
              </span>
            </span>
            <SegmentedControl
              label="Sayfa çevirisi"
              options={onOffOptions}
              value={values.pageTranslation}
              onchange={(value) => update({ pageTranslation: value })}
            />
          </div>

          <h2>Güncellemeler</h2>
          <div class="row">
            <span class="label">
              <span>Yalqen {view.version}</span>
              <span class="hint" aria-live="polite">{updateMessage(view.update)}</span>
            </span>
            {#if view.update.state === 'ready'}
              <Button variant="primary" onclick={() => api.installUpdate()}>Yeniden başlat</Button>
            {:else if view.update.state !== 'unavailable'}
              <Button
                disabled={view.update.state === 'checking' || view.update.state === 'downloading'}
                onclick={() => api.checkForUpdates()}
              >
                Şimdi denetle
              </Button>
            {/if}
          </div>
          <div class="row">
            <span class="label">
              <span>Güncellemeleri otomatik denetle</span>
              <span class="hint">
                Birkaç saatte bir GitHub'dan yeni sürüm olup olmadığına bakılır ve arka planda indirilir. Tarama verisi
                gönderilmez.
              </span>
            </span>
            <SegmentedControl
              label="Güncellemeleri otomatik denetle"
              options={onOffOptions}
              value={values.autoUpdate}
              onchange={(value) => update({ autoUpdate: value })}
            />
          </div>
        {:else if pane === 'appearance'}
          <h2>Tema</h2>
          <div class="row">
            <span class="label">Renk düzeni</span>
            <SegmentedControl
              label="Tema"
              options={themeOptions}
              value={values.theme}
              onchange={(value) => update({ theme: value })}
            />
          </div>

          <h2>Sayfalar</h2>
          <div class="row">
            <label for="font-size" class="label">
              <span>Yazı boyutu</span>
              <span class="hint">Sitenin kendi boyutu yoksa kullanılır. Yeni açılan sekmelerde geçerli olur.</span>
            </label>
            <Select
              id="font-size"
              value={values.fontSize}
              onchange={(event) => update({ fontSize: event.currentTarget.value as SettingsValues['fontSize'] })}
            >
              {#each fontSizeOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </Select>
          </div>
          <div class="row">
            <label for="default-zoom" class="label">
              <span>Sayfa yakınlaştırma</span>
              <span class="hint">Kendi yakınlaştırması kaydedilmemiş sayfalara uygulanır.</span>
            </label>
            <Select
              id="default-zoom"
              value={values.defaultZoom}
              onchange={(event) => update({ defaultZoom: Number(event.currentTarget.value) })}
            >
              {#each zoomOptions as factor (factor)}
                <option value={factor}>%{Math.round(factor * 100)}</option>
              {/each}
            </Select>
          </div>
          <h2>Menüler</h2>
          <div class="row">
            <span class="label">Yan menü</span>
            <SegmentedControl
              label="Yan menü görünürlüğü"
              options={visibilityOptions}
              value={values.sidebarVisible}
              onchange={(value) => update({ sidebarVisible: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>Üst menü</span>
              <span class="hint">İki menü gizliyken Görünüm menüsünden yeniden açabilirsiniz.</span>
            </span>
            <SegmentedControl
              label="Üst menü görünürlüğü"
              options={visibilityOptions}
              value={values.toolbarVisible}
              onchange={(value) => update({ toolbarVisible: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>Üst menüdeki sekmeler</span>
              <span class="hint">Yalnızca açık sayfanın adresini göstererek üst menüyü sadeleştirir.</span>
            </span>
            <SegmentedControl
              label="Üst menüdeki sekmeler"
              options={toolbarTabOptions}
              value={values.toolbarTabs}
              onchange={(value) => update({ toolbarTabs: value })}
            />
          </div>

          <h2>Üst menü düğmeleri</h2>
          <ul class="buttons" aria-label="Üst menü düğmeleri">
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
                      <span class="hint">Ayarlara erişmek için her zaman görünür kalır.</span>
                    {/if}
                  </span>
                </label>
                <span class="move">
                  <IconButton
                    icon="up"
                    label="{item.label} düğmesini öne al"
                    disabled={index === 0}
                    onclick={() => moveToolbarButton(id, -1)}
                  />
                  <IconButton
                    icon="down"
                    label="{item.label} düğmesini sona al"
                    disabled={index === toolbarButtons.length - 1}
                    onclick={() => moveToolbarButton(id, 1)}
                  />
                </span>
              </li>
            {/each}
          </ul>

          <h2>Sekme paneli</h2>
          <div class="row">
            <span class="label">Görünüm</span>
            <SegmentedControl
              label="Panel görünümü"
              options={panelOptions}
              value={values.panelCollapsed}
              onchange={(value) => update({ panelCollapsed: value })}
            />
          </div>
          <div class="row">
            <span class="label">Konum</span>
            <SegmentedControl
              label="Panel konumu"
              options={sideOptions}
              value={values.panelSide}
              onchange={(value) => update({ panelSide: value })}
            />
          </div>
        {:else if pane === 'privacy'}
          <h2>Koruma</h2>
          <div class="row">
            <span class="label">
              <span>Reklam engelleyici</span>
              <span class="hint"
                >EasyList ve uBlock Origin filtreleriyle reklamları engeller. Değişiklik yeni yüklenen sayfalarda
                geçerli olur.</span
              >
            </span>
            <SegmentedControl
              label="Reklam engelleyici"
              options={onOffOptions}
              value={values.adBlocking}
              onchange={(value) => update({ adBlocking: value })}
            />
          </div>

          <div class="row">
            <span class="label">
              <span>Yalnızca HTTPS</span>
              <span class="hint"
                >HTTP sayfalarını HTTPS ile açar; site desteklemiyorsa HTTP ile devam etmeden önce sorar. Yerel adresler
                ve IP adresleri hariç.</span
              >
            </span>
            <SegmentedControl
              label="Yalnızca HTTPS"
              options={onOffOptions}
              value={values.httpsOnly}
              onchange={(value) => update({ httpsOnly: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>Üçüncü taraf çerezleri engelle</span>
              <span class="hint"
                >Başka sitelerin, gömülü içeriklerle sizi siteler arasında izlemesini zorlaştırır. Bazı gömülü oturum
                açma ve yorum alanları çalışmayabilir.</span
              >
            </span>
            <SegmentedControl
              label="Üçüncü taraf çerezleri engelle"
              options={onOffOptions}
              value={values.blockThirdPartyCookies}
              onchange={(value) => update({ blockThirdPartyCookies: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>İndirmeden önce sor</span>
              <span class="hint">Bir site dosya indirmeye başlamadan önce onayınızı ister.</span>
            </span>
            <SegmentedControl
              label="İndirmeden önce sor"
              options={onOffOptions}
              value={values.askBeforeDownload}
              onchange={(value) => update({ askBeforeDownload: value })}
            />
          </div>
          <div class="row">
            <label for="secure-dns" class="label">
              <span>Güvenli DNS</span>
              <span class="hint"
                >Site adlarını şifreli sorgularla çözer. Otomatik, sistemin DNS sağlayıcısı destekliyorsa kullanır.</span
              >
            </label>
            <Select
              id="secure-dns"
              value={values.secureDns}
              onchange={(event) => update({ secureDns: event.currentTarget.value as SettingsValues['secureDns'] })}
            >
              {#each dnsOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </Select>
          </div>
          <h2>Tarama verileri</h2>
          <div class="row stacked">
            <span class="label">
              <span>Tarama verilerini temizle</span>
              <span class="hint"
                >Geçmiş ve indirme listesi seçilen aralıktan silinir. Çerezler, site verileri ve önbellek her zaman
                tümüyle silinir.</span
              >
            </span>
            <div class="clear">
              <Select aria-label="Zaman aralığı" bind:value={clearRange} onchange={() => (cleared = false)}>
                {#each rangeOptions as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </Select>
              {#each clearOptions as option (option.key)}
                <label class="check">
                  <input type="checkbox" bind:checked={clearKinds[option.key]} onchange={() => (cleared = false)} />
                  {option.label}
                </label>
              {/each}
              <div class="clear-actions">
                <Button variant="primary" disabled={!clearSelected || clearing} onclick={clearData}>
                  {clearing ? 'Temizleniyor…' : 'Verileri temizle'}
                </Button>
                {#if cleared}<span class="hint" role="status">Temizlendi.</span>{/if}
              </div>
            </div>
          </div>
        {:else if pane === 'passwords'}
          <Passwords />
        {:else if pane === 'extensions'}
          <Extensions />
        {:else if pane === 'developer'}
          <RequestRules />
        {:else}
          <h2>Bellek</h2>
          <div class="row">
            <span class="label">
              <span>Arka plan sekmelerini dondur</span>
              <span class="hint"
                >Sekme değişince eski sekmedeki kod ve animasyonlar durur. Ses çalan ve sabitlenen sekmeler dondurulmaz.</span
              >
            </span>
            <SegmentedControl
              label="Arka plan sekmelerini dondur"
              options={onOffOptions}
              value={values.freezeBackgroundTabs}
              onchange={(value) => update({ freezeBackgroundTabs: value })}
            />
          </div>
          <div class="row">
            <span class="label">
              <span>Kullanılmayan sekmeleri bellekten çıkar</span>
              <span class="hint"
                >Bu süre boyunca açılmayan sekmeler belleği boşaltır; sistem belleği azalınca en eski arka plan
                sekmeleri daha erken boşaltılır. Tıklayınca yeniden yüklenir. Ses çalan, sabitlenen ve içine yazı
                yazılan sekmelere dokunulmaz.</span
              >
            </span>
            <SegmentedControl
              label="Kullanılmayan sekmeleri bellekten çıkar"
              options={discardOptions}
              value={values.discardAfterMinutes}
              onchange={(value) => update({ discardAfterMinutes: value })}
            />
          </div>
          <ProcessUsage />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    overflow-y: auto;
    background: var(--bg);
  }

  .settings {
    width: min(920px, 100%);
    margin: 0 auto;
    padding: 42px 24px 80px;
  }

  h1 {
    margin: 0 0 20px;
    font-size: 30px;
    letter-spacing: -0.03em;
  }

  .layout {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }

  .panes {
    position: sticky;
    top: 24px;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 4px;
    width: 180px;
  }

  .panes :global(.pane-tab) {
    justify-content: flex-start;
    width: 100%;
  }

  .pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 20px 12px;
    border-radius: 14px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  h2 {
    margin: 20px 0 4px;
    color: var(--text-muted);
    font-size: var(--font-size-small);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h2:first-child {
    margin-top: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .row:last-child {
    border-bottom: 0;
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-small);
  }

  .error {
    color: var(--warn);
    font-size: var(--font-size-small);
  }

  .clear {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

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

  .clear-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }
</style>
