<script lang="ts" module>
  const paths = {
    back: 'M10 3 5 8l5 5',
    forward: 'm6 3 5 5-5 5',
    up: 'm3 10 5-5 5 5',
    down: 'm3 6 5 5 5-5',
    reload: 'M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3',
    history: 'M3 4.5A5.5 5.5 0 1 1 2.5 8M2.5 3v2h2M8 5v3.5l2 1',
    profile: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13c0-2.1 1.8-3.5 4.5-3.5s4.5 1.4 4.5 3.5',
    download: 'M8 2.5v7m-2.5-2.5L8 9.5 10.5 7M3 11v2h10v-2',
    update: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 10.5v-5M5.8 7.7 8 5.5l2.2 2.2',
    plus: 'M8 3v10M3 8h10',
    search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm3.3 7.8 3.2 3.2',
    close: 'm4.5 4.5 7 7m0-7-7 7',
    sidebar: 'M2.5 3.5h11v9h-11zM10 3.5v9',
    'sidebar-left': 'M2.5 3.5h11v9h-11zM6 3.5v9',
    pin: 'M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5',
    sound: 'M2.5 6h2l3-2.5v9L4.5 10h-2zM10.5 6a2.8 2.8 0 0 1 0 4M12.3 4.3a5.2 5.2 0 0 1 0 7.4',
    muted: 'M2.5 6h2l3-2.5v9L4.5 10h-2zM10.5 6.5l3 3m0-3-3 3',
    lock: 'M5 7.5V5.5a3 3 0 0 1 6 0v2M4 7.5h8v6H4z',
    info: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.5v3.5M8 5.3v.01',
    warning: 'M8 2.5 14 13H2zM8 6.5v3M8 11.3v.01',
    'popup-blocked': 'M2.5 4.5h8v8h-8zM6.5 2.5h7v7M4.5 6.5l4 4m0-4-4 4',
    star: 'M8 2.3l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.3l-3.53 1.85.7-3.93L2.3 6.45l3.95-.55z',
    bookmarks: 'M4.5 2.5h7v11L8 11l-3.5 2.5z',
    extensions: 'M3 5h2.5v-.5a1.5 1.5 0 1 1 3 0V5H11v2.5h.5a1.5 1.5 0 1 1 0 3H11V13H3v-2.5h.5a1.5 1.5 0 1 0 0-3H3z',
    private:
      'M2.5 9.8a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9.5 9.8a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM6.5 9.8h3M1.8 7.5 3.6 3.5h8.8l1.8 4',
    moon: 'M12.5 9.5A5 5 0 0 1 6.5 3.5a5 5 0 1 0 6 6z',
    globe:
      'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.7 6 5.7 8s.7 3.9 2.3 5.5',
    translate:
      'M2.5 4h6M5.5 2.5V4M3.5 4c.4 2 1.7 3.6 3.5 4.5M7.5 4c-.4 2-1.7 3.6-3.5 4.5M9 13.5l2.5-6 2.5 6M9.9 11.5h3.2',
    settings:
      'M2.5 5h7M12.5 5h1M2.5 11h1M6.5 11h7M12.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
    appearance: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 2.5v11',
    gauge: 'M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.5-3',
    sparkle: 'M8 2.5c.4 2.9 2.6 5.1 5.5 5.5-2.9.4-5.1 2.6-5.5 5.5-.4-2.9-2.6-5.1-5.5-5.5 2.9-.4 5.1-2.6 5.5-5.5z',
    'panel-close': 'M2.5 3.5h11v9h-11zM6 3.5v9M11 6.5 9.5 8l1.5 1.5',
    'panel-close-right': 'M2.5 3.5h11v9h-11zM10 3.5v9M5 6.5 6.5 8 5 9.5',
    'panel-expand': 'M2.5 3.5h11v9h-11zM6 3.5v9M9.5 6.5 11 8l-1.5 1.5',
    'panel-expand-right': 'M2.5 3.5h11v9h-11zM10 3.5v9M6.5 6.5 5 8l1.5 1.5',
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
