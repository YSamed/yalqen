<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AddressSuggestion, CommandBarAction } from '../shared/types';
  import { t } from '../shared/i18n';
  import { displayHost } from '../shared/hosts';
  import Icon from './components/Icon.svelte';
  import SearchField from './components/ui/SearchField.svelte';

  const KIND_ICON = { tab: 'sidebar', bookmark: 'star', history: 'history', command: 'gauge' } as const;

  let input: HTMLInputElement | undefined = $state();
  let value = $state('');
  let placeholder = $state(t('commandBar.placeholder'));
  let suggestions: AddressSuggestion[] = $state([]);
  let selected = $state(-1);

  function finish(action: CommandBarAction): void {
    value = '';
    suggestions = [];
    selected = -1;
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
    finish({ type: 'submit', input: value });
  }

  function onInput(event: Event): void {
    const text = (event.currentTarget as HTMLInputElement).value;
    selected = -1;
    if (text.trim() === '') suggestions = [];
    window.yalqenCommand.send({ type: 'input', input: text });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish({ type: 'dismiss' });
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
      placeholder = open.placeholder;
      value = open.value ?? '';
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
    return () => {
      offOpen();
      offSuggestions();
    };
  });
</script>

<svelte:head><title>{t('commandBar.pageTitle')}</title></svelte:head>

<svelte:window onkeydown={onKeydown} onmousedown={onBackdropMouseDown} />

<div class="backdrop">
  <div class="box">
    <form class="bar" role="search" onsubmit={submit}>
      <SearchField
        size="lg"
        bind:ref={input}
        bind:value
        oninput={onInput}
        {placeholder}
        aria-label={t('commandBar.placeholder')}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls="suggestions"
        aria-activedescendant={selected >= 0 ? `suggestion-${selected}` : undefined}
      />
    </form>
    {#if suggestions.length > 0}
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
            <span class="kind"><Icon name={KIND_ICON[suggestion.kind]} size={14} /></span>
            <span class="title">{suggestion.title || displayHost(suggestion.url)}</span>
            <span class="url">{detail(suggestion)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  :global(body) {
    background: transparent;
  }

  .backdrop {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    background: rgb(0 0 0 / 0.18);
  }

  .box {
    position: relative;
    width: min(640px, 100%);
  }

  .bar {
    --search-field-bg: rgb(255 255 255 / 0.88);
    --search-field-shadow:
      0 0 0 0.5px rgb(0 0 0 / 0.12), inset 0 1px rgb(255 255 255 / 0.8), 0 12px 40px rgb(0 0 0 / 0.22);
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    left: 0;
    margin: 0;
    padding: 6px;
    border-radius: 20px;
    background: var(--surface);
    box-shadow:
      0 0 0 0.5px rgb(0 0 0 / 0.12),
      0 12px 40px rgb(0 0 0 / 0.22);
    list-style: none;
  }

  .suggestions li {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 12px;
    border-radius: 14px;
    color: var(--text);
    font-size: 14px;
  }

  .suggestions li.selected {
    background: var(--surface-hover);
  }

  .kind {
    display: grid;
    flex: none;
    place-items: center;
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
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-color-scheme: dark) {
    .backdrop {
      background: rgb(0 0 0 / 0.35);
    }

    .bar {
      --search-field-bg: rgb(38 37 40 / 0.9);
      --search-field-shadow:
        0 0 0 0.5px rgb(255 255 255 / 0.14), inset 0 1px rgb(255 255 255 / 0.14), 0 12px 40px rgb(0 0 0 / 0.5);
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    .bar {
      --search-field-bg: #fff;
    }
  }

  @media (prefers-color-scheme: dark) and (prefers-reduced-transparency: reduce) {
    .bar {
      --search-field-bg: #26282c;
    }
  }
</style>
