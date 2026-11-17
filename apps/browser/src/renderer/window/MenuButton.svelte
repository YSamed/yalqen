<script lang="ts">
  import { t } from '../../shared/i18n';
  import IconButton from '../ui/IconButton.svelte';

  const send = window.yalqen.send;
</script>

<IconButton
  size="lg"
  variant="surface"
  tone="muted"
  icon="menu"
  label={t('toolbar.menu')}
  title={t('toolbar.menuTitle')}
  aria-haspopup="menu"
  onclick={() => send({ type: 'open-app-menu' })}
/>
