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
    // Absent (undefined) outside Electron and on macOS, where the caption buttons are native.
    readonly windowControlsOverlay?: WindowControlsOverlay;
  }
}
