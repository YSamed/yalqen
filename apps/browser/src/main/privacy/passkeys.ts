import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  dialog,
  webContents,
  type BaseWindow,
  type MessageBoxOptions,
  type Session,
  type WebAuthnAccount,
  type WebContents,
} from 'electron';
import { t } from '../../shared/i18n.js';

// Touch ID passkeys: Electron's WebAuthn platform authenticator keeps passkeys in the macOS Keychain, bound to the
// Secure Enclave. It needs this keychain group in the app's signature, which only signed releases carry: they
// embed a provisioning profile that grants it (build/entitlements.main.mac.plist). Development builds are signed
// ad hoc and cannot carry it, so they never turn it on.
export const PASSKEY_KEYCHAIN_GROUP = '7TNMJ5UM72.com.yalqen.browser.webauthn';

export function signedForPasskeys(
  platform: NodeJS.Platform = process.platform,
  packaged: boolean = app.isPackaged,
  resources: string = process.resourcesPath,
  exists: (file: string) => boolean = fs.existsSync,
): boolean {
  return platform === 'darwin' && packaged && exists(path.join(resources, '..', 'embedded.provisionprofile'));
}

// Called once at startup, as the setting says; changing it takes effect after a restart.
export function enablePasskeys(enabled: boolean, signed = signedForPasskeys()): boolean {
  if (!enabled || !signed) return false;
  try {
    app.configureWebAuthn({
      touchID: { keychainAccessGroup: PASSKEY_KEYCHAIN_GROUP, promptReason: t('passkeys.promptReason') },
    });
    return true;
  } catch (error) {
    console.warn('[passkeys] Touch ID passkeys could not be turned on:', error);
    return false;
  }
}

const MOST_ACCOUNTS = 8;

export function accountLabel(account: WebAuthnAccount, index: number): string {
  const name = account.name?.trim();
  const display = account.displayName?.trim();
  if (name && display && name !== display) return `${display} (${name})`;
  return name || display || t('passkeys.account', { number: index + 1 });
}

export interface AccountChoice {
  site: string;
  accounts: string[];
}

// A site asking for any passkey it knows gets the user's pick among the ones on this Mac; Cancel refuses.
export async function chooseAccount(
  site: string,
  accounts: readonly WebAuthnAccount[],
  pick: (choice: AccountChoice) => Promise<number | null>,
): Promise<string | undefined> {
  const shown = accounts.slice(0, MOST_ACCOUNTS);
  if (shown.length === 0) return undefined;
  const index = await pick({ site, accounts: shown.map(accountLabel) });
  return index === null ? undefined : shown[index]?.credentialId;
}

export function pickAccountWithDialog(parentOf: (contents: WebContents) => BaseWindow | undefined) {
  return (contents: WebContents | null) =>
    async ({ site, accounts }: AccountChoice): Promise<number | null> => {
      const options: MessageBoxOptions = {
        type: 'question',
        message: t('passkeys.chooseAccount', { site }),
        detail: t('passkeys.chooseAccountDetail'),
        buttons: [...accounts, t('passkeys.cancel')],
        defaultId: 0,
        cancelId: accounts.length,
        noLink: true,
      };
      const parent = contents && !contents.isDestroyed() ? parentOf(contents) : undefined;
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response < accounts.length ? response : null;
    };
}

// Sessions ask once Touch ID passkeys are on and a page wants any passkey it knows. The request waits for the
// callback, which runs exactly once whatever happens.
export function watchAccountChoices(
  browsing: Session,
  pickFor: (contents: WebContents | null) => (choice: AccountChoice) => Promise<number | null>,
): void {
  browsing.on('select-webauthn-account', (_event, details, callback) => {
    let answered = false;
    const answer = (credentialId?: string) => {
      if (answered) return;
      answered = true;
      callback(credentialId);
    };
    const contents = details.frame ? (webContents.fromFrame(details.frame) ?? null) : null;
    void chooseAccount(details.relyingPartyId, details.accounts, pickFor(contents)).then(answer, () => answer());
  });
}
