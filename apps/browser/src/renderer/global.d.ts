import type {
  CommandBarApi,
  ConfirmApi,
  FindBarApi,
  PeekApi,
  SettingsApi,
  WelcomeApi,
  YalqenApi,
} from '../shared/types';

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
}
