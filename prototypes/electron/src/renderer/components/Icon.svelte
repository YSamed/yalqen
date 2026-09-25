<script lang="ts" module>
  const paths = {
    back: 'M10 3 5 8l5 5',
    forward: 'm6 3 5 5-5 5',
    reload: 'M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3',
    plus: 'M8 3v10M3 8h10',
    search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm3.3 7.8 3.2 3.2',
    close: 'm4.5 4.5 7 7m0-7-7 7',
    sidebar: 'M2.5 3.5h11v9h-11zM10 3.5v9',
    pin: 'M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5',
    moon: 'M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z',
    globe: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.7 6 5.7 8s.7 3.9 2.3 5.5',
    settings: 'M2.5 5h7M12.5 5h1M2.5 11h1M6.5 11h7M12.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  } as const;

  export type IconName = keyof typeof paths;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
