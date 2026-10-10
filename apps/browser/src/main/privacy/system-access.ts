import { shell, systemPreferences } from 'electron';
import type { SystemAccess, SystemDevice } from '../../shared/types.js';

export const SYSTEM_DEVICES: readonly SystemDevice[] = ['camera', 'microphone', 'screen'];

export function isSystemDevice(value: unknown): value is SystemDevice {
  return SYSTEM_DEVICES.includes(value as SystemDevice);
}

export function systemAccessStatus(): Record<SystemDevice, SystemAccess> | null {
  // On non-macOS platforms, assume access is granted (common in desktop environments without centralized prompts)
  if (process.platform !== 'darwin') {
    return {
      camera: 'granted',
      microphone: 'granted',
      screen: 'granted',
    };
  }
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
  };
}

export async function requestSystemAccess(device: 'camera' | 'microphone'): Promise<boolean> {
  // On non-macOS platforms, assume permission is granted
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus(device);
  if (status === 'granted') return true;
  if (status === 'not-determined') return systemPreferences.askForMediaAccess(device);
  return false;
}

export function screenAccessGranted(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.getMediaAccessStatus('screen') === 'granted';
}

export function openSystemSettings(device: SystemDevice): void {
  // No-op for non-macOS platforms; implement desktop-specific later if needed
  if (process.platform === 'darwin') {
    const PRIVACY_PANES: Record<SystemDevice, string> = {
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    };
    void shell.openExternal(PRIVACY_PANES[device]);
  }
}
