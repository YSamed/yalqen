import type { WebContents } from 'electron';

const MAX_RELOADS = 2;

// The window's interface talks to the browser through window.yalqen, which its preload exposes. On rare launches
// the page has come up without it and stayed empty, with no tabs, until it was reloaded by hand. So once the page
// has loaded, the window checks for the bridge and reloads the page if it is missing, a couple of times at most.
// Preload errors and each recovery are logged so the cause can be traced.
export function watchInterfaceBridge(contents: WebContents, bridge = 'yalqen', maxReloads = MAX_RELOADS): void {
  let reloads = 0;
  contents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[window] the interface preload failed:', preloadPath, error);
  });
  contents.on('did-finish-load', () => {
    contents.executeJavaScript(`typeof window.${bridge} === 'object'`, false).then(
      (ready: unknown) => {
        if (ready === true || contents.isDestroyed() || reloads >= maxReloads) return;
        reloads += 1;
        console.warn(`[window] the interface loaded without its preload; reloading it (${reloads}/${maxReloads})`);
        contents.reload();
      },
      () => {},
    );
  });
}
