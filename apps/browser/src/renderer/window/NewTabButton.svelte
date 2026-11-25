<script lang="ts">
  import { t } from '../../shared/i18n';
  import Button from '../ui/Button.svelte';

  const send = window.yalqen.send;
</script>

<Button
  size="lg"
  icon="plus"
  class="new-tab-wide"
  title={t('newTabButton.title')}
  onclick={() => send({ type: 'new-tab' })}
>
  {t('newTabButton.label')}
</Button>

<style>
  :global(.btn.new-tab-wide) {
    width: 100%;
    justify-content: flex-start;
    padding-left: 10px;
  }
</style>
