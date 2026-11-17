import type {
  CommandBarApi,
  ConfirmApi,
  FindBarApi,
  PeekApi,
  SettingsApi,
  WelcomeApi,
  YalqenApi,
} from '../shared/types';

// The Window Controls Overlay API ships in Chromium but is not in TypeScript's DOM lib, and
// Electron does not declare it either; only the parts the interface reads are declared here.
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

declare global {
  // Substituted by Vite at build time from the building machine's own platform; see the `define`
  // in vite.config.mts. Only `src/renderer/platform.ts` reads it.
  const __YALQEN_PLATFORM__: string;

  interface Window {
    yalqen: YalqenApi;
    yalqenSettings: SettingsApi;
    yalqenCommand: CommandBarApi;
    yalqenFind: FindBarApi;
    yalqenPeek: PeekApi;
    yalqenWelcome: WelcomeApi;
    yalqenConfirm: ConfirmApi;
  }

  interface Navigator {
    // Only the parts the interface reads are declared. Optional because it is absent outside
    // Electron and wherever the overlay is not laid out, so every reader has to guard for it.
    readonly windowControlsOverlay?: WindowControlsOverlay;
  }
}
