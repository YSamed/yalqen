import type { CommandBarApi, FindBarApi, SettingsApi, WelcomeApi, YalqenApi } from '../shared/types';

declare global {
  interface Window {
    yalqen: YalqenApi;
    yalqenSettings: SettingsApi;
    yalqenCommand: CommandBarApi;
    yalqenFind: FindBarApi;
    yalqenWelcome: WelcomeApi;
  }
}
