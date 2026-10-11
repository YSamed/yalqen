<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../shared/i18n';

  let { children }: { children: Snippet } = $props();
</script>

<!-- Settings people rarely change stay folded; a settings search opens the group when something inside matches. -->
<details class="advanced">
  <summary>{t('settings.advanced')}</summary>
  {@render children()}
</details>

<style>
  .advanced {
    margin-top: 26px;
    border-top: 1px solid var(--border);
  }

  .advanced summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    color: var(--text-muted);
    font-weight: 500;
    cursor: pointer;
    list-style: none;
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .advanced summary::after {
    content: '';
    flex: none;
    width: 7px;
    height: 7px;
    margin-right: 4px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg);
    transition: transform 0.15s;
  }

  .advanced[open] summary::after {
    transform: rotate(-135deg);
  }

  .advanced summary:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 2px;
    border-radius: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .advanced summary::after {
      transition: none;
    }
  }
</style>
