// The renderer is sandboxed with context isolation, so it has no `process` to read. Vite inlines
// the platform the build ran on instead, which each release job does on the platform it packages
// for. Mirrors `src/main/platform.ts`, which can read `process.platform` for itself.
export const IS_MAC = __YALQEN_PLATFORM__ === 'darwin';
export const IS_WIN = __YALQEN_PLATFORM__ === 'win32';
export const IS_LINUX = __YALQEN_PLATFORM__ === 'linux';
export const IS_POSIX = IS_MAC || IS_LINUX;
