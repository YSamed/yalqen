import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const page = (name: string) => fileURLToPath(new URL(`src/renderer/${name}`, import.meta.url));

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    rolldownOptions: {
      input: { index: page('index.html'), settings: page('settings.html') },
    },
  },
});
