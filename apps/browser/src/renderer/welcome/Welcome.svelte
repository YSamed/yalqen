<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { accentHex, type AccentColorId } from '../../shared/accent';
  import { t } from '../../shared/i18n';
  import type { ThemeSource, WelcomeImportResult, WelcomeOpen, WelcomeTabs } from '../../shared/types';
  import AccentPicker from '../ui/AccentPicker.svelte';

  type Step = 'thanks' | 'name' | 'import' | 'look' | 'ready';
  type ImportState = 'idle' | 'running' | 'done' | 'failed';

  const api = window.yalqenWelcome;
  const themes: { value: ThemeSource; label: string }[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ];
  const layouts: { value: WelcomeTabs; label: string }[] = [
    { value: 'left', label: t('welcome.tabsLeft') },
    { value: 'top', label: t('welcome.tabsTop') },
  ];
  const keys = [
    { label: t('welcome.keyNewTab'), keys: '⌘ T' },
    { label: t('welcome.keyAddress'), keys: '⌘ L' },
    { label: t('welcome.keySidebar'), keys: '⇧ ⌘ P' },
    { label: t('welcome.keyDevTools'), keys: '⌥ ⌘ I' },
  ];

  let open = $state<WelcomeOpen | null>(null);
  let step = $state(0);
  let name = $state('');
  let accent = $state<AccentColorId>('orange');
  let theme = $state<ThemeSource>('system');
  let tabs = $state<WelcomeTabs>('left');
  let source = $state(0);
  let bookmarks = $state(true);
  let history = $state(true);
  let importState = $state<ImportState>('idle');
  let imported = $state<WelcomeImportResult | null>(null);
  let card = $state<HTMLElement>();

  const steps = $derived<Step[]>(
    open && open.sources.length > 0
      ? ['thanks', 'name', 'import', 'look', 'ready']
      : ['thanks', 'name', 'look', 'ready'],
  );
  const current = $derived(steps[step] ?? 'thanks');
  const sourceName = $derived(open?.sources.find((item) => item.id === source)?.browser ?? '');
  const trimmedName = $derived(name.trim());

  $effect(() => {
    document.documentElement.style.setProperty('--accent', accentHex(accent));
  });

  async function focusPrimary(): Promise<void> {
    await tick();
    card?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  function go(next: number): void {
    step = Math.max(0, Math.min(steps.length - 1, next));
    void focusPrimary();
  }

  function next(): void {
    if (current === 'name') api.send({ type: 'name', name: trimmedName });
    go(step + 1);
  }

  function finish(): void {
    api.send({ type: 'finish' });
  }

  function pickAccent(value: AccentColorId): void {
    accent = value;
    api.send({ type: 'appearance', accent: value });
  }

  function pickTheme(value: ThemeSource): void {
    theme = value;
    api.send({ type: 'appearance', theme: value });
  }

  function pickTabs(value: WelcomeTabs): void {
    tabs = value;
    api.send({ type: 'appearance', tabs: value });
  }

  async function runImport(): Promise<void> {
    if (importState === 'running') return;
    if (importState === 'done' || (!bookmarks && !history)) {
      next();
      return;
    }
    importState = 'running';
    try {
      imported = await api.importFrom({ source, bookmarks, history });
      importState = imported.ok ? 'done' : 'failed';
    } catch {
      importState = 'failed';
    }
    void focusPrimary();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  }

  onMount(() =>
    api.onOpen((next) => {
      document.documentElement.toggleAttribute('data-opaque', next.material === 'opaque');
      open = next;
      name = next.name;
      accent = next.accent;
      theme = next.theme;
      tabs = next.tabs;
      source = next.sources[0]?.id ?? 0;
      step = 0;
      importState = 'idle';
      imported = null;
      void focusPrimary();
    }),
  );
</script>

<svelte:head><title>{t('welcome.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="scrim">
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="welcome-title" bind:this={card}>
      <div class="frame">
        <header>
          <img class="mark" src="newtab-mark.png" alt="Yalqen" width="30" height="30" />
          <div
            class="dots"
            role="progressbar"
            aria-label={t('welcome.progress')}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
          >
            {#each steps as item, index (item)}
              <span class:done={index <= step} class:current={index === step}></span>
            {/each}
          </div>
        </header>

        {#key current}
          <section class="step" class:centered={current === 'thanks' || current === 'ready'}>
            {#if current === 'thanks'}
              <p class="badge">{t('welcome.badge')}</p>
              <h1 id="welcome-title" class="display">{t('welcome.thanksTitle')}</h1>
              <span class="rule" aria-hidden="true"></span>
              <p class="lead">{t('welcome.thanksText')}</p>
              <p class="signature">{t('welcome.signature')}</p>
              <p class="role">{t('welcome.signatureRole')}</p>
              <div class="actions">
                <button type="button" class="primary wide" data-autofocus onclick={next}>{t('welcome.accept')}</button>
              </div>
            {:else if current === 'name'}
              <h1 id="welcome-title">{t('welcome.nameTitle')}</h1>
              <p class="lead">{t('welcome.nameText')}</p>
              <form
                class="name"
                onsubmit={(event) => {
                  event.preventDefault();
                  next();
                }}
              >
                <label for="welcome-name">{t('welcome.nameLabel')}</label>
                <input
                  id="welcome-name"
                  type="text"
                  bind:value={name}
                  maxlength={40}
                  autocomplete="given-name"
                  spellcheck="false"
                  placeholder={t('welcome.namePlaceholder')}
                  data-autofocus
                />
                <div class="actions">
                  <button type="submit" class="primary grow">{t('welcome.continue')}</button>
                  <button type="button" class="quiet" onclick={() => go(step + 1)}>{t('welcome.notNow')}</button>
                </div>
              </form>
            {:else if current === 'import' && open}
              <h1 id="welcome-title">{t('welcome.importTitle')}</h1>
              <p class="lead">{t('welcome.importText')}</p>
              <div class="sources" role="radiogroup" aria-label={t('welcome.importSource')}>
                {#each open.sources.slice(0, 4) as item (item.id)}
                  <button
                    type="button"
                    class="source"
                    role="radio"
                    aria-checked={source === item.id}
                    disabled={importState !== 'idle'}
                    onclick={() => (source = item.id)}
                  >
                    <span class="initial" aria-hidden="true">{item.browser.charAt(0)}</span>
                    <span class="browser">{item.browser}</span>
                    <span class="profile">{item.profile}</span>
                  </button>
                {/each}
              </div>
              <div class="kinds">
                <label class="kind">
                  <input type="checkbox" bind:checked={bookmarks} disabled={importState !== 'idle'} />
                  {t('welcome.importBookmarks')}
                </label>
                <label class="kind">
                  <input type="checkbox" bind:checked={history} disabled={importState !== 'idle'} />
                  {t('welcome.importHistory')}
                </label>
              </div>
              <p class="status" role="status">
                {#if importState === 'done' && imported}
                  {t('welcome.imported', { bookmarks: imported.bookmarks, visits: imported.visits })}
                {:else if importState === 'failed'}
                  {t('welcome.importFailed')}
                {/if}
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="primary grow"
                  data-autofocus
                  disabled={importState === 'running'}
                  onclick={importState === 'failed' ? next : runImport}
                >
                  {#if importState === 'running'}
                    {t('welcome.importing')}
                  {:else if importState === 'idle' && (bookmarks || history)}
                    {t('welcome.importFrom', { browser: sourceName })}
                  {:else}
                    {t('welcome.continue')}
                  {/if}
                </button>
                {#if importState === 'idle'}
                  <button type="button" class="quiet" onclick={() => go(step + 1)}>{t('welcome.startFresh')}</button>
                {/if}
              </div>
            {:else if current === 'look'}
              <h1 id="welcome-title">{t('welcome.lookTitle')}</h1>
              <p class="lead">{t('welcome.lookText')}</p>
              <p class="label">{t('welcome.accent')}</p>
              <AccentPicker label={t('welcome.accent')} value={accent} onchange={pickAccent} size={30} />
              <p class="label">{t('settings.theme')}</p>
              <div class="choices three" role="radiogroup" aria-label={t('settings.theme')}>
                {#each themes as option (option.value)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme === option.value}
                    onclick={() => pickTheme(option.value)}>{option.label}</button
                  >
                {/each}
              </div>
              <p class="label">{t('welcome.tabs')}</p>
              <div class="choices" role="radiogroup" aria-label={t('welcome.tabs')}>
                {#each layouts as option (option.value)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={tabs === option.value}
                    onclick={() => pickTabs(option.value)}>{option.label}</button
                  >
                {/each}
              </div>
              <div class="actions">
                <button type="button" class="primary wide" data-autofocus onclick={next}>{t('welcome.continue')}</button
                >
              </div>
            {:else}
              <h1 id="welcome-title" class="display">
                {trimmedName ? t('welcome.readyTitleNamed', { name: trimmedName }) : t('welcome.readyTitle')}
              </h1>
              <p class="lead">{t('welcome.readyText')}</p>
              <ul class="keys">
                {#each keys as item (item.keys)}
                  <li><span>{item.label}</span><kbd>{item.keys}</kbd></li>
                {/each}
              </ul>
              <div class="actions">
                <button type="button" class="primary wide" data-autofocus onclick={finish}>{t('welcome.start')}</button>
              </div>
            {/if}
          </section>
        {/key}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    background: transparent;
  }

  .scrim {
    --card: #fbfaf8;
    --hair: rgb(16 18 24 / 0.1);
    --field: #fff;
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
    background: rgb(30 30 36 / 0.22);
    color: var(--text);
    font-family: var(--font);
  }

  @media (prefers-color-scheme: dark) {
    .scrim {
      --card: #1c1c1f;
      --hair: rgb(255 255 255 / 0.1);
      --field: #232327;
      background: rgb(5 5 7 / 0.5);
    }
  }

  .card {
    --swatch-gap: var(--card);
    width: min(500px, 100%);
    max-height: 100%;
    overflow: auto;
    box-sizing: border-box;
    padding: 10px;
    border-radius: 22px;
    background: var(--card);
    box-shadow:
      0 0 0 0.5px var(--hair),
      0 30px 80px rgb(0 0 0 / 0.35),
      0 2px 6px rgb(0 0 0 / 0.15);
    animation: arrive 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .frame {
    display: flex;
    flex-direction: column;
    padding: 34px 40px 30px;
    border-radius: 15px;
    box-shadow: inset 0 0 0 1px var(--hair);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .mark {
    width: 30px;
    height: 30px;
  }

  .dots {
    display: flex;
    gap: 5px;
  }

  .dots span {
    width: 5px;
    height: 5px;
    border-radius: 3px;
    background: var(--border);
    transition:
      width 240ms var(--ease-out),
      background-color 240ms var(--ease-out);
  }

  .dots span.done {
    background: var(--accent);
  }

  .dots span.current {
    width: 18px;
  }

  .step {
    display: flex;
    flex-direction: column;
    padding-top: 20px;
    animation: settle 280ms var(--ease-out) both;
  }

  .step.centered {
    align-items: center;
    text-align: center;
  }

  h1 {
    margin: 0;
    font-family: ui-serif, 'New York', Georgia, serif;
    font-size: 32px;
    font-weight: 500;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }

  h1.display {
    margin-top: 12px;
    font-size: 44px;
    line-height: 1.05;
  }

  .badge {
    margin: 0;
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .rule {
    width: 40px;
    height: 1px;
    margin-top: 20px;
    background: var(--hair);
  }

  .lead {
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  .centered .lead {
    margin-top: 18px;
    font-size: 15px;
  }

  .signature {
    margin: 20px 0 0;
    font-family: ui-serif, 'New York', Georgia, serif;
    font-size: 22px;
    font-style: italic;
  }

  .role {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
    align-self: stretch;
    margin-top: 24px;
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
  }

  .primary {
    height: 44px;
    padding: 0 22px;
    border: 0;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    background-image: linear-gradient(rgb(0 0 0 / 0.08) 0 0);
  }

  .primary:disabled {
    opacity: 0.7;
  }

  .wide,
  .grow {
    flex: 1;
  }

  .quiet {
    height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
  }

  .quiet:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  :focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
    outline-offset: 3px;
  }

  .name {
    display: flex;
    flex-direction: column;
  }

  .name label,
  .label {
    margin: 22px 0 8px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  .name input {
    height: 46px;
    padding: 0 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--field);
    color: var(--text);
    font: inherit;
    font-size: 16px;
  }

  .name input:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 8px;
    margin-top: 20px;
  }

  .source,
  .choices button {
    border: 0;
    border-radius: 12px;
    background: var(--field);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .source {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 14px 8px 12px;
  }

  .source[aria-checked='true'],
  .choices button[aria-checked='true'] {
    background: color-mix(in srgb, var(--accent) 16%, var(--field));
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .initial {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-bottom: 6px;
    border-radius: 9px;
    background: var(--surface-hover);
    color: var(--text-muted);
    font-weight: 650;
  }

  .source[aria-checked='true'] .initial {
    background: var(--accent);
    color: #fff;
  }

  .browser {
    font-size: 13px;
    font-weight: 500;
  }

  .profile {
    max-width: 100%;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kinds {
    display: flex;
    gap: 18px;
    margin-top: 14px;
  }

  .kind {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }

  .kind input {
    accent-color: var(--accent);
  }

  .status {
    min-height: 18px;
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .status:empty {
    min-height: 0;
    margin: 0;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .choices.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .choices button {
    height: 38px;
    font-size: 13px;
    font-weight: 500;
  }

  .keys {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-self: stretch;
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
  }

  .keys li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 42px;
    padding: 0 14px;
    border-radius: 11px;
    background: var(--field);
    box-shadow: inset 0 0 0 1px var(--border);
    font-size: 14px;
  }

  kbd {
    padding: 3px 8px;
    border-radius: 7px;
    background: var(--surface-hover);
    box-shadow: inset 0 -1px 0 var(--border);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.97);
    }
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .step {
      animation: none;
    }
  }
</style>
