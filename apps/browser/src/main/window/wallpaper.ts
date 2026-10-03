import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Wallpaper } from '../../shared/types.js';

const run = promisify(execFile);
const WALLPAPER_INDEX = path.join(os.homedir(), 'Library/Application Support/com.apple.wallpaper/Store/Index.plist');
const AERIAL_THUMBNAILS = '/System/Library/ExtensionKit/Extensions/WallpaperAerialsExtension.appex/Contents/Resources';
const DESKTOP_CHOICE = 'AllSpacesAndDisplays.Desktop.Content.Choices.0';
const DESKTOP_IMAGE_SCRIPT =
  'ObjC.import("AppKit"); const url = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen($.NSScreen.mainScreen); url.isNil() ? "" : url.path.js';
const ASSET_ID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;

async function readChoice(key: string): Promise<string> {
  const { stdout } = await run('plutil', ['-extract', `${DESKTOP_CHOICE}.${key}`, 'raw', '-o', '-', WALLPAPER_INDEX]);
  return stdout.trim();
}

async function aerialThumbnail(): Promise<string | null> {
  if ((await readChoice('Provider')) !== 'com.apple.wallpaper.choice.aerials') return null;
  const configuration = Buffer.from(await readChoice('Configuration'), 'base64').toString('latin1');
  const assetId = ASSET_ID.exec(configuration)?.[0];
  if (!assetId) return null;
  const thumbnail = path.join(AERIAL_THUMBNAILS, `${assetId}.png`);
  return fs.existsSync(thumbnail) ? thumbnail : null;
}

async function desktopImage(): Promise<string | null> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', DESKTOP_IMAGE_SCRIPT]);
  const file = stdout.trim();
  return file && fs.existsSync(file) ? file : null;
}

let converted: { key: string; wallpaper: Wallpaper } | null = null;
let pending: Promise<Wallpaper | null> | null = null;

// Every window asks on load and on entering full screen; the lookup spawns several
// processes, so concurrent requests share one run and the converted image is reused
// until the desktop picture changes.
export function loadWallpaper(cacheDirectory: string): Promise<Wallpaper | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  pending ??= readWallpaper(cacheDirectory).finally(() => {
    pending = null;
  });
  return pending;
}

// Aerial wallpapers report a generic placeholder as the desktop image, so their
// preview thumbnail (light variant on the left half, dark on the right) is used instead.
async function readWallpaper(cacheDirectory: string): Promise<Wallpaper | null> {
  try {
    const aerial = await aerialThumbnail().catch(() => null);
    const source = aerial ?? (await desktopImage());
    if (!source) return null;
    const { mtimeMs } = await fs.promises.stat(source);
    const key = `${source}|${mtimeMs}`;
    if (converted?.key === key) return converted.wallpaper;
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
    const output = path.join(cacheDirectory, 'wallpaper.jpg');
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '640', source, '--out', output]);
    const image = (await fs.promises.readFile(output)).toString('base64');
    const wallpaper = { dataUrl: `data:image/jpeg;base64,${image}`, split: aerial !== null };
    converted = { key, wallpaper };
    return wallpaper;
  } catch (error) {
    console.warn('[wallpaper] could not load desktop picture', error);
    return null;
  }
}
