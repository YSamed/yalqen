/// <reference types="vite/client" />
import type { SettingsApi, YalqenApi } from '../shared/types';

declare global {
  interface Window {
    /** Present in the browser window. */
    yalqen: YalqenApi;
    /** Present in the settings window. */
    yalqenSettings: SettingsApi;
  }
}
