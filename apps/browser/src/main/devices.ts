import type { Rectangle, WebContents } from 'electron';
import type { DeviceFrame, DeviceId } from '../shared/types.js';
import { t } from '../shared/i18n.js';

export interface Device {
  id: DeviceId;
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  cornerRadius: number;
  userAgent: string;
  platform: string;
  mobile: boolean;
}

export const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export const GALAXY_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export const DEVICES: readonly Device[] = [
  {
    id: 'iphone-15',
    label: 'iPhone 15',
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    cornerRadius: 47,
    userAgent: IOS_UA,
    platform: 'iPhone',
    mobile: true,
  },
  {
    id: 'iphone-15-pro-max',
    label: 'iPhone 15 Pro Max',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    cornerRadius: 55,
    userAgent: IOS_UA,
    platform: 'iPhone',
    mobile: true,
  },
  {
    id: 'iphone-se',
    label: 'iPhone SE',
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    cornerRadius: 0,
    userAgent: IOS_UA,
    platform: 'iPhone',
    mobile: true,
  },
  {
    id: 'pixel-8',
    label: 'Pixel 8',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    cornerRadius: 32,
    userAgent: ANDROID_UA,
    platform: 'Linux armv8l',
    mobile: true,
  },
  {
    id: 'galaxy-s24',
    label: 'Galaxy S24',
    width: 360,
    height: 780,
    deviceScaleFactor: 3,
    cornerRadius: 32,
    userAgent: GALAXY_UA,
    platform: 'Linux armv8l',
    mobile: true,
  },
  {
    id: 'ipad-mini',
    label: 'iPad mini',
    width: 744,
    height: 1133,
    deviceScaleFactor: 2,
    cornerRadius: 18,
    userAgent: IPAD_UA,
    platform: 'iPad',
    mobile: true,
  },
  {
    id: 'responsive',
    get label() {
      return t('devices.responsive');
    },
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    cornerRadius: 0,
    userAgent: '',
    platform: '',
    mobile: false,
  },
];

export const RESPONSIVE_SIZE_LIMITS = { min: 200, max: 4000 };
export const DEVICE_SCALE_FACTORS = [1, 2, 3] as const;

export const DEFAULT_DEVICE_ID: DeviceId = 'iphone-15';

export function findDevice(id: DeviceId): Device {
  return DEVICES.find((device) => device.id === id) ?? DEVICES[0];
}

export interface Emulation {
  deviceId: DeviceId;
  landscape: boolean;
  size?: { width: number; height: number };
  scaleFactor?: number;
}

export function deviceSize(emulation: Emulation): { width: number; height: number } {
  const { width, height } = emulation.size ?? findDevice(emulation.deviceId);
  return emulation.landscape ? { width: height, height: width } : { width, height };
}

function isResizable(emulation: Emulation): boolean {
  return !findDevice(emulation.deviceId).mobile;
}

function clampSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.min(RESPONSIVE_SIZE_LIMITS.max, Math.max(RESPONSIVE_SIZE_LIMITS.min, value)));
}

export function resizeEmulation(emulation: Emulation, size: { width: number; height: number }): Emulation {
  if (!isResizable(emulation)) return emulation;
  const current = deviceSize(emulation);
  return {
    ...emulation,
    landscape: false,
    size: { width: clampSize(size.width, current.width), height: clampSize(size.height, current.height) },
  };
}

export function rotateEmulation(emulation: Emulation): Emulation {
  if (!isResizable(emulation)) return { ...emulation, landscape: !emulation.landscape };
  const { width, height } = deviceSize(emulation);
  return { ...emulation, landscape: false, size: { width: height, height: width } };
}

export function scaleEmulation(emulation: Emulation, scaleFactor: number): Emulation {
  if (!isResizable(emulation) || !(DEVICE_SCALE_FACTORS as readonly number[]).includes(scaleFactor)) return emulation;
  return { ...emulation, scaleFactor };
}

export function emulatedUserAgent(emulation: Emulation | null): { userAgent: string; platform: string } {
  if (!emulation) return { userAgent: '', platform: '' };
  const { userAgent, platform } = findDevice(emulation.deviceId);
  return { userAgent, platform };
}

function scaleFactorOf(emulation: Emulation): number {
  return emulation.scaleFactor ?? findDevice(emulation.deviceId).deviceScaleFactor;
}

const DEVICE_MARGIN = 32;
const DEVICE_LABEL_HEIGHT = 24;
const MIN_DEVICE_SCALE = 0.25;

export function fitDevice(emulation: Emulation, page: Rectangle): DeviceFrame {
  const device = findDevice(emulation.deviceId);
  const { width, height } = deviceSize(emulation);
  const availableWidth = page.width - 2 * DEVICE_MARGIN;
  const availableHeight = page.height - 2 * DEVICE_MARGIN - DEVICE_LABEL_HEIGHT;
  const scale = Math.max(MIN_DEVICE_SCALE, Math.min(1, availableWidth / width, availableHeight / height));
  const viewWidth = Math.round(width * scale);
  const viewHeight = Math.round(height * scale);
  return {
    label: device.label,
    width,
    height,
    scale,
    cornerRadius: device.cornerRadius,
    resizable: !device.mobile,
    deviceScaleFactor: scaleFactorOf(emulation),
    x: Math.round((page.width - viewWidth) / 2),
    y: DEVICE_LABEL_HEIGHT + Math.round((page.height - DEVICE_LABEL_HEIGHT - viewHeight) / 2),
    viewWidth,
    viewHeight,
  };
}

const PROTOCOL_VERSION = '1.3';

export async function applyDeviceMetrics(contents: WebContents, emulation: Emulation, scale: number): Promise<void> {
  const device = findDevice(emulation.deviceId);
  const { width, height } = deviceSize(emulation);
  const dbg = contents.debugger;
  if (!dbg.isAttached()) dbg.attach(PROTOCOL_VERSION);

  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scaleFactorOf(emulation),
    mobile: device.mobile,
    scale,
    screenOrientation: emulation.landscape
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 },
  });
}

export async function applyEmulation(contents: WebContents, emulation: Emulation, scale: number): Promise<void> {
  await applyDeviceMetrics(contents, emulation, scale);
  const device = findDevice(emulation.deviceId);
  const dbg = contents.debugger;
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: device.mobile, maxTouchPoints: 5 });
  await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: device.mobile, configuration: 'mobile' });
  await dbg.sendCommand('Emulation.setUserAgentOverride', {
    userAgent: device.userAgent,
    platform: device.platform,
  });
}

export async function clearEmulation(contents: WebContents): Promise<void> {
  if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
  const dbg = contents.debugger;
  await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
  await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: '' });
}
