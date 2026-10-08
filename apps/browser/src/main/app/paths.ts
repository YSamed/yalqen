import path from 'node:path';
import { app } from 'electron';

// Compiled main modules live in dist/main/<domain>/, beside dist/preload and dist/renderer.
const DIST = path.join(__dirname, '../..');

export function preloadPath(name: 'preload' | 'page-preload' | 'command-preload' | 'find-preload'): string {
  return path.join(DIST, 'preload', `${name}.js`);
}

export function pageScriptPath(name: 'component-inspector' | 'reader'): string {
  return path.join(DIST, 'page-scripts', `${name}.js`);
}

export function rendererPath(file: string): string {
  return path.join(DIST, 'renderer', file);
}

export function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'brand/icon-512.png')
    : path.resolve(app.getAppPath(), 'resources/icon-512.png');
}
