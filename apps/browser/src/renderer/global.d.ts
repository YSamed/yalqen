import type { CommandBarApi, ConfirmApi, FindBarApi, PeekApi, SettingsApi, YalqenApi } from '../shared/types';

interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

declare global {
  const __YALQEN_PLATFORM__: string;

  interface Window {
    yalqen: YalqenApi;
    yalqenSettings: SettingsApi;
    yalqenCommand: CommandBarApi;
    yalqenFind: FindBarApi;
    yalqenPeek: PeekApi;
    yalqenConfirm: ConfirmApi;
  }

  interface Navigator {
    readonly windowControlsOverlay?: WindowControlsOverlay;
  }
}
