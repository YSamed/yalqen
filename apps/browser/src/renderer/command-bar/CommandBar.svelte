<script lang="ts">
  import { accentCss } from '../../shared/accent';
  import { onMount, tick } from 'svelte';
  import type { AddressSuggestion, CommandBarAction, CommandBarOpen } from '../../shared/types';
  import { matchSearchKeyword } from '../../shared/search-keyword';
  import { t } from '../../shared/i18n';
  import { displayHost } from '../../shared/hosts';
  import Icon from '../ui/Icon.svelte';
  import SidebarMenu from './SidebarMenu.svelte';

  const KIND_ICON = { tab: 'sidebar', bookmark: 'star', history: 'history', command: 'gauge' } as const;

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  let placeholder = $state(t('commandBar.placeholder'));
  let suggestions: AddressSuggestion[] = $state([]);
  let selected = $state(-1);
  let engines: CommandBarOpen['engines'] = $state([]);
  let engine: CommandBarOpen['engines'][number] | null = $state(null);
  let menu: CommandBarOpen['menu'] | null = $state.raw(null);
  let tint: string | null = $state(null);
  let area: CommandBarOpen['area'] | null = $state(null);

  function finish(action: CommandBarAction): void {
    value = '';
    suggestions = [];
    selected = -1;
    engine = null;
    menu = null;
    window.yalqenCommand.send(action);
  }

  function pick(suggestion: AddressSuggestion): void {
    if (suggestion.commandId) finish({ type: 'run-command', id: suggestion.commandId });
    else if (suggestion.tabId) finish({ type: 'switch-tab', id: suggestion.tabId });
    else finish({ type: 'submit', input: suggestion.url });
  }

  function detail(suggestion: AddressSuggestion): string {
    if (suggestion.kind === 'command') return suggestion.hint ?? '';
    return suggestion.kind === 'tab' ? t('commandBar.switchToTab') : displayHost(suggestion.url);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (selected >= 0 && suggestions[selected]) {
      pick(suggestions[selected]);
      return;
    }
    if (value.trim() === '') return;
    finish({ type: 'submit', input: value, engine: engine?.id });
  }

  function onInput(event: Event): void {
    const text = (event.currentTarget as HTMLInputElement).value;
    selected = -1;
    if (text.trim() === '' || engine) suggestions = [];
    if (engine) return;
    window.yalqenCommand.send({ type: 'input', input: text });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish({ type: 'dismiss' });
    } else if (event.key === 'Tab' && !event.shiftKey && !engine) {
      const match = matchSearchKeyword(value, engines);
      if (!match) return;
      event.preventDefault();
      engine = match;
      value = '';
      suggestions = [];
      selected = -1;
    } else if (event.key === 'Backspace' && engine && value === '') {
      engine = null;
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length > 0) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      selected = ((selected + 1 + step + suggestions.length + 1) % (suggestions.length + 1)) - 1;
    }
  }

  function onBackdropMouseDown(event: MouseEvent): void {
    if (event.target instanceof HTMLElement && event.target.classList.contains('backdrop')) {
      finish({ type: 'dismiss' });
    }
  }

  onMount(() => {
    const offOpen = window.yalqenCommand.onOpen((open) => {
      document.documentElement.style.setProperty('--accent', accentCss(open.accent));
      placeholder = open.placeholder;
      tint = open.tint ?? null;
      area = open.area ?? null;
      menu = open.mode === 'sidebar-menu' ? (open.menu ?? null) : null;
      value = open.value ?? '';
      engines = open.engines;
      engine = null;
      suggestions = [];
      selected = -1;
      void tick().then(() => {
        input?.focus();
        input?.select();
      });
    });
    const offSuggestions = window.yalqenCommand.onSuggestions((next) => {
      if (next.input !== value) return;
      suggestions = next.suggestions;
      selected = -1;
    });
    const offArea = window.yalqenCommand.onArea((next) => {
      area = next;
    });
    return () => {
      offOpen();
      offSuggestions();
      offArea();
    };
  });
</script>

<svelte:head><title>{t('commandBar.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} onmousedown={onBackdropMouseDown} />

{#if menu}
  <SidebarMenu {menu} onaction={finish} />
{:else}
  <div class="backdrop">
    <div
      class="panel"
      class:tinted={tint !== null}
      class:placed={area !== null}
      style:--menu-tint={tint}
      style:--area-x={area ? `${area.x}px` : null}
      style:--area-y={area ? `${area.y}px` : null}
      style:--area-width={area ? `${area.width}px` : null}
      style:--area-height={area ? `${area.height}px` : null}
    >
      <form class="search" role="search" onsubmit={submit}>
        <Icon name="search" size={16} />
        <input
          bind:this={input}
          bind:value
          oninput={onInput}
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder={engine ? t('commandBar.searchOn', { engine: engine.label }) : placeholder}
          aria-label={t('commandBar.placeholder')}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="suggestions"
          aria-activedescendant={selected >= 0 ? `suggestion-${selected}` : undefined}
        />
        {#if engine}<span class="engine">{engine.label}</span>{/if}
      </form>
      {#if suggestions.length > 0}
        <div class="divider"></div>
        <ul class="suggestions" id="suggestions" role="listbox" aria-label={t('commandBar.suggestions')}>
          {#each suggestions as suggestion, index (suggestion.url)}
            <li
              id="suggestion-{index}"
              role="option"
              tabindex="-1"
              aria-selected={index === selected}
              class:selected={index === selected}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => pick(suggestion)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  pick(suggestion);
                }
              }}
              onmousemove={() => (selected = index)}
            >
              <span class="kind"><Icon name={KIND_ICON[suggestion.kind]} size={16} /></span>
              <span class="title">{suggestion.title || displayHost(suggestion.url)}</span>
              <span class="url">{detail(suggestion)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(html body) {
    background: transparent;
  }

  /* The search row stays where the old centered bar was while suggestions grow below it. */
  .backdrop {
    position: relative;
    display: grid;
    place-items: start center;
    height: 100%;
    padding: max(16px, calc(50vh - 25px)) 16px 16px;
    box-sizing: border-box;
    background: light-dark(rgb(30 30 36 / 0.16), rgb(5 5 7 / 0.4));
  }

  /* Same surface, edge and rows as the sidebar menus. */
  .panel {
    --menu-surface: light-dark(#f7f7f8, #26282b);
    --menu-hover: light-dark(rgb(16 18 24 / 0.06), rgb(255 255 255 / 0.08));
    --menu-line: light-dark(rgb(16 18 24 / 0.08), rgb(255 255 255 / 0.08));
    display: flex;
    flex-direction: column;
    width: min(640px, 100%);
    overflow: hidden;
    border-radius: 16px;
    background: var(--menu-surface);
    box-shadow:
      0 0 0 0.5px light-dark(rgb(16 18 24 / 0.16), rgb(255 255 255 / 0.16)),
      inset 0 1px 0 light-dark(rgb(255 255 255 / 0.7), rgb(255 255 255 / 0.06)),
      0 18px 48px rgb(0 0 0 / 0.32);
    color: var(--text);
    font-family: var(--font);
    animation: menu-in 140ms var(--ease-out);
  }

  /* Lines up with the new tab page's search box: centered on the page area, 24% down plus the mark. */
  .panel.placed {
    --panel-width: min(652px, var(--area-width) - 48px);
    position: absolute;
    top: calc(var(--area-y) + var(--area-height) * 0.24 + 98px);
    left: calc(var(--area-x) + (var(--area-width) - var(--panel-width)) / 2);
    width: var(--panel-width);
  }

  .panel.tinted {
    --menu-surface: light-dark(
      color-mix(in srgb, var(--menu-tint) 6%, #f7f7f8),
      color-mix(in srgb, var(--menu-tint) 16%, #222427)
    );
  }

  .search {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 50px;
    margin: 0;
    padding: 0 18px;
    color: var(--text-muted);
  }

  .search input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 17px;
    user-select: text;
  }

  .search input::placeholder {
    color: var(--text-muted);
  }

  .engine {
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--menu-hover);
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .divider {
    height: 1px;
    margin: 0 16px 6px;
    background: var(--menu-line);
  }

  .suggestions {
    margin: 0;
    padding: 0 6px 6px;
    list-style: none;
  }

  .suggestions li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 37px;
    padding: 0 10px;
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    cursor: default;
  }

  .suggestions li.selected {
    background: var(--menu-hover);
  }

  .kind {
    display: grid;
    flex: none;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--text-muted);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url {
    flex: none;
    max-width: 40%;
    margin-left: auto;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
