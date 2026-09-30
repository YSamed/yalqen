export const WEB_STORE_ORIGIN = 'https://chromewebstore.google.com';
export const WEB_STORE_CALL = 'yalqen-webstore:call';
export const WEB_STORE_EVENT = 'yalqen-webstore:event';

export const WebStoreResult = {
  ALREADY_INSTALLED: 'already_installed',
  FEATURE_DISABLED: 'feature_disabled',
  INSTALL_ERROR: 'install_error',
  INSTALL_IN_PROGRESS: 'install_in_progress',
  INVALID_ID: 'invalid_id',
  MANIFEST_ERROR: 'manifest_error',
  SUCCESS: 'success',
  UNKNOWN_ERROR: 'unknown_error',
  USER_CANCELLED: 'user_cancelled',
} as const;

export const WebStoreInstallStatus = {
  DEPRECATED_MANIFEST_VERSION: 'deprecated_manifest_version',
  DISABLED: 'disabled',
  ENABLED: 'enabled',
  INSTALLABLE: 'installable',
} as const;

export const WebStoreMv2Status = {
  INACTIVE: 'inactive',
  SOFT_DISABLE: 'soft_disable',
  WARNING: 'warning',
} as const;

export const WebStoreWebGl = {
  ALLOWED: 'webgl_allowed',
  BLOCKED: 'webgl_blocked',
} as const;

export type WebStoreEventKind = 'installed' | 'uninstalled';
