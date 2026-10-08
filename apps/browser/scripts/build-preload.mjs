import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Sandboxed preloads can only require Electron and a few Node built-ins, so each one is
// bundled into a single self-contained file.
const PRELOADS = ['preload', 'command-preload', 'find-preload', 'page-preload'];
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(project, 'dist/preload');

fs.rmSync(outDir, { recursive: true, force: true });
for (const name of PRELOADS) {
  await build({
    configFile: false,
    root: project,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome152',
      minify: false,
      sourcemap: true,
      lib: {
        entry: path.join(project, `src/preload/${name}.ts`),
        formats: ['cjs'],
        fileName: () => `${name}.js`,
      },
      rolldownOptions: { external: ['electron'] },
    },
  });
}

// Page scripts run inside local development pages through the debugger, as the body of one function.
const PAGE_SCRIPTS = { 'component-inspector': 'YalqenComponentInspector', reader: 'YalqenReader' };
fs.rmSync(path.join(project, 'dist/page-scripts'), { recursive: true, force: true });
for (const [name, global] of Object.entries(PAGE_SCRIPTS)) {
  await build({
    configFile: false,
    root: project,
    logLevel: 'warn',
    build: {
      outDir: path.join(project, 'dist/page-scripts'),
      emptyOutDir: false,
      target: 'chrome152',
      minify: true,
      lib: {
        entry: path.join(project, `src/page-scripts/${name}.ts`),
        formats: ['iife'],
        name: global,
        fileName: () => `${name}.js`,
      },
    },
  });
}
