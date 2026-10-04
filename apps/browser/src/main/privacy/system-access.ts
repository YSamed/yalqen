import { shell, systemPreferences } from 'electron';
import type { SystemAccess, SystemDevice } from '../../shared/types.js';

const PRIVACY_PANES: Record<SystemDevice, string> = {
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

export const SYSTEM_DEVICES: readonly SystemDevice[] = ['camera', 'microphone', 'screen'];

export function isSystemDevice(value: unknown): value is SystemDevice {
  return SYSTEM_DEVICES.includes(value as SystemDevice);
}

export function systemAccessStatus(): Record<SystemDevice, SystemAccess> | null {
  if (process.platform !== 'darwin') return null;
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

export async function requestSystemAccess(device: 'camera' | 'microphone'): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus(device);
  if (status === 'granted') return true;
  if (status === 'not-determined') return systemPreferences.askForMediaAccess(device);
  return false;
}

export function screenAccessGranted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted';
}

export function openSystemSettings(device: SystemDevice): void {
  if (process.platform === 'darwin') void shell.openExternal(PRIVACY_PANES[device]);
}
