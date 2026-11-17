import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const page = (name: string) => fileURLToPath(new URL(`src/renderer/${name}`, import.meta.url));

const DEV_PORT = Number(process.env.YALQEN_DEV_SERVER_PORT ?? 5173);
const DEV_HOST = '127.0.0.1';
const POLICY = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;

// The built pages are loaded over `file://`, where the policy stops at `default-src 'none'`. A dev
// server needs the one addition of the HMR socket, and only while serving, so the build output keeps
// the stricter policy it ships with.
function devServerPolicy(): Plugin {
  return {
    name: 'yalqen-dev-server-policy',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) =>
        html.replace(POLICY, (_match, head: string, policy: string, tail: string) => {
          const connect = `connect-src 'self' ws://${DEV_HOST}:${DEV_PORT} ws://localhost:${DEV_PORT}`;
          return `${head}${policy}; ${connect}${tail}`;
        }),
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [svelte(), devServerPolicy()],
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome152',
    rolldownOptions: {
      input: {
        index: page('index.html'),
        settings: page('settings.html'),
        command: page('command.html'),
        find: page('find.html'),
        welcome: page('welcome.html'),
        confirm: page('confirm.html'),
        peek: page('peek.html'),
      },
    },
  },
});
