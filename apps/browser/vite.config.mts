import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const page = (name: string) => fileURLToPath(new URL(`src/renderer/${name}`, import.meta.url));

const DEV_PORT = Number(process.env.YALQEN_DEV_SERVER_PORT ?? 5173);
const DEV_HOST = '127.0.0.1';
const POLICY = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;

// The renderer runs sandboxed with context isolation, so it cannot read process.platform for
// itself. A build targets one platform, so the value is inlined here as a literal instead of being
// guessed from the user agent, which any page can be given a different one of.
const PLATFORM_DEFINE = { __YALQEN_PLATFORM__: JSON.stringify(process.platform) };

// The built pages are loaded over `file://`, where the policy stops at `default-src 'none'`. A dev
// server needs the one addition of the HMR socket, and only while serving, so the build output keeps
// the stricter policy it ships with.
function devServerPolicy(): Plugin {
  return {
    name: 'yalqen-dev-server-policy',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string, ctx) =>
        html.replace(POLICY, (_match, head: string, policy: string, tail: string) => {
          const port = ctx.server?.config.server.port ?? DEV_PORT;
          const connect = `connect-src 'self' ws://${DEV_HOST}:${port} ws://localhost:${port}`;
          return `${head}${policy}; ${connect}${tail}`;
        }),
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  define: PLATFORM_DEFINE,
  plugins: [svelte(), devServerPolicy()],
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
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
