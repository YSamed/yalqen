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
  if (!enabled) return false;
  if (!signed) {
    console.info(
      '[passkeys] Touch ID passkeys are on in settings, but this build is not signed for them; only signed releases can use Touch ID.',
    );
    return false;
  }
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

const ACCOUNTS_PER_PAGE = 8;

export function accountLabel(account: WebAuthnAccount, index: number): string {
  const name = account.name?.trim();
  const display = account.displayName?.trim();
  if (name && display && name !== display) return `${display} (${name})`;
  return name || display || t('passkeys.account', { number: index + 1 });
}

export interface AccountChoice {
  site: string;
  accounts: string[];
  hasPrevious: boolean;
  hasNext: boolean;
}

type AccountPick = number | 'previous' | 'next' | null;
type PickAccount = (choice: AccountChoice) => Promise<AccountPick>;

// A site asking for any passkey it knows gets the user's pick among the ones on this Mac; Cancel refuses.
export async function chooseAccount(
  site: string,
  accounts: readonly WebAuthnAccount[],
  pick: PickAccount,
): Promise<string | undefined> {
  let offset = 0;
  while (offset < accounts.length) {
    const page = accounts.slice(offset, offset + ACCOUNTS_PER_PAGE);
    const hasPrevious = offset > 0;
    const hasNext = offset + page.length < accounts.length;
    const choice = await pick({
      site,
      accounts: page.map((account, index) => accountLabel(account, offset + index)),
      hasPrevious,
      hasNext,
    });
    if (typeof choice === 'number') return page[choice]?.credentialId;
    if (choice === 'next' && hasNext) offset += ACCOUNTS_PER_PAGE;
    else if (choice === 'previous' && hasPrevious) offset -= ACCOUNTS_PER_PAGE;
    else break;
  }
  return undefined;
}

export function pickAccountWithDialog(parentOf: (contents: WebContents) => BaseWindow | undefined) {
  return (contents: WebContents | null): PickAccount =>
    async ({ site, accounts, hasPrevious, hasNext }) => {
      const buttons: { label: string; pick: AccountPick }[] = accounts.map((label, index) => ({ label, pick: index }));
      if (hasPrevious) buttons.push({ label: t('passkeys.previousAccounts'), pick: 'previous' });
      if (hasNext) buttons.push({ label: t('passkeys.nextAccounts'), pick: 'next' });
      buttons.push({ label: t('passkeys.cancel'), pick: null });
      const options: MessageBoxOptions = {
        type: 'question',
        message: t('passkeys.chooseAccount', { site }),
        detail: t('passkeys.chooseAccountDetail'),
        buttons: buttons.map(({ label }) => label),
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true,
      };
      const parent = contents && !contents.isDestroyed() ? parentOf(contents) : undefined;
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return buttons[response]?.pick ?? null;
    };
}

// Sessions ask once Touch ID passkeys are on and a page wants any passkey it knows. The request waits for the
// callback, which runs exactly once whatever happens.
export function watchAccountChoices(browsing: Session, pickFor: (contents: WebContents | null) => PickAccount): void {
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
