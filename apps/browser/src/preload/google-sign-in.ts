import { webFrame } from 'electron';

const PAGE_SCRIPT = `(() => {
  const chromeApi = (globalThis.chrome = globalThis.chrome || {});
  chromeApi.app = chromeApi.app || { isInstalled: false };
  chromeApi.csi = chromeApi.csi || (() => ({}));
  chromeApi.loadTimes = chromeApi.loadTimes || (() => ({}));
  const data = navigator.userAgentData;
  if (!data) return;
  const major = (data.brands.find((entry) => entry.brand === 'Chromium') || {}).version;
  if (!major) return;
  const brands = [...data.brands, { brand: 'Google Chrome', version: major }];
  Object.defineProperty(Object.getPrototypeOf(data), 'brands', { get: () => brands, configurable: true });
})();`;

export function setupGoogleSignInPage(): void {
  void webFrame.executeJavaScript(PAGE_SCRIPT);
}
