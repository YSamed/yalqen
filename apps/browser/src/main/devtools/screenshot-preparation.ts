// Serialized into an isolated page world: keep this function self-contained.
async function prepareScreenshot(maxWaitMs = 10000): Promise<void> {
  const originalX = window.scrollX;
  const originalY = window.scrollY;
  const deadline = Date.now() + maxWaitMs;
  const changed = new Map<HTMLImageElement, string | null>();
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const enableImages = () => {
    for (const image of document.images) {
      if (image.loading !== 'lazy' || changed.has(image)) continue;
      changed.set(image, image.getAttribute('loading'));
      image.loading = 'eager';
    }
  };

  try {
    enableImages();
    // Visit each viewport to trigger IntersectionObserver and scroll-based loaders.
    // Bound both time and steps so infinite feeds cannot keep capture running forever.
    const step = Math.max(1, Math.floor(window.innerHeight * 0.8));
    for (let y = 0, steps = 0; steps < 100 && Date.now() < deadline - 2000; y += step, steps++) {
      window.scrollTo({ left: originalX, top: y, behavior: 'instant' });
      await pause(80);
      enableImages();
      const height = document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight;
      if (y + window.innerHeight >= height) break;
    }

    // Debounced loaders may assign src shortly after the last viewport is visited.
    await pause(Math.min(250, Math.max(0, deadline - Date.now())));
    enableImages();
    const remaining = Math.max(0, deadline - Date.now());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // decode waits for fetching and decoding; broken images must not abort capture.
      await Promise.race([
        Promise.allSettled([...Array.from(document.images, (image) => image.decode()), document.fonts.ready]),
        new Promise<void>((resolve) => (timeout = setTimeout(resolve, remaining))),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    for (const [image, loading] of changed) {
      if (loading === null) image.removeAttribute('loading');
      else image.setAttribute('loading', loading);
    }
    window.scrollTo({ left: originalX, top: originalY, behavior: 'instant' });
    // Allow layout and the restored scroll position to settle before capture.
    await pause(80);
  }
}

export const PREPARE_SCREENSHOT_SCRIPT = `(${prepareScreenshot.toString()})()`;

// Chromium can skip painting these sections again after preparation restores the scroll position.
function revealDeferredContent(): void {
  const restore: Array<() => void> = [];
  const world = globalThis as typeof globalThis & { restoreScreenshotContent?: () => void };
  world.restoreScreenshotContent = () => {
    delete world.restoreScreenshotContent;
    for (const reset of restore) reset();
  };

  const deferred = Array.from(document.querySelectorAll<HTMLElement | SVGElement>('*')).filter(
    (element) => getComputedStyle(element).contentVisibility === 'auto',
  );
  for (const element of deferred) {
    const hadStyle = element.hasAttribute('style');
    const { style } = element;
    if (!style) continue;
    const value = style.getPropertyValue('content-visibility');
    const priority = style.getPropertyPriority('content-visibility');
    restore.push(() => {
      if (
        style.getPropertyValue('content-visibility') === 'visible' &&
        style.getPropertyPriority('content-visibility') === 'important'
      ) {
        style.setProperty('content-visibility', value, priority);
        if (!hadStyle && element.getAttribute('style') === '') element.removeAttribute('style');
      }
    });
    style.setProperty('content-visibility', 'visible', 'important');
  }
}

export const REVEAL_SCREENSHOT_CONTENT_SCRIPT = `(${revealDeferredContent.toString()})()`;
export const RESTORE_SCREENSHOT_CONTENT_SCRIPT = 'globalThis.restoreScreenshotContent?.()';
