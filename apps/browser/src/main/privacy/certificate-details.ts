import { X509Certificate } from 'node:crypto';
import { dialog, clipboard, type BaseWindow, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { attachDebugger, withDebugger } from '../devtools/page-debugger.js';
import { OBSERVED_NETWORK_ENABLE } from '../devtools/page-overrides.js';

export interface CertificateDetails {
  subject: string;
  issuer: string;
  serial: string;
  validFrom: string;
  validTo: string;
  names: string;
  fingerprint: string;
  key: string;
  pem: string;
}
export function parseCertificateChain(value: unknown): CertificateDetails[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return null;
  try {
    return value.map((encoded) => {
      if (typeof encoded !== 'string' || encoded.length > 128 * 1024) throw new Error('Invalid certificate');
      const certificate = new X509Certificate(Buffer.from(encoded, 'base64'));
      const publicKey = certificate.publicKey;
      const details = publicKey.asymmetricKeyDetails;
      return {
        subject: certificate.subject,
        issuer: certificate.issuer,
        serial: certificate.serialNumber,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        names: certificate.subjectAltName ?? '',
        fingerprint: certificate.fingerprint256,
        key: [publicKey.asymmetricKeyType, details?.modulusLength, details?.namedCurve].filter(Boolean).join(' '),
        pem: certificate.toString(),
      };
    });
  } catch {
    return null;
  }
}
export async function readCertificateChain(contents: WebContents): Promise<CertificateDetails[] | null> {
  if (contents.isDestroyed()) return null;
  const url = contents.getURL();
  let navigated = false;
  const navigation = ({ isMainFrame, isSameDocument }: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (isMainFrame && !isSameDocument) navigated = true;
  };
  contents.on('did-start-navigation', navigation);
  try {
    const origin = new URL(url);
    if (origin.protocol !== 'https:') return null;
    const result = (await withDebugger(contents, () =>
      contents.debugger.sendCommand('Network.getCertificate', { origin: origin.origin }),
    )) as {
      tableNames?: unknown;
    };

    if (navigated || contents.isDestroyed() || contents.getURL() !== url) return null;
    return parseCertificateChain(result.tableNames);
  } catch {
    return null;
  } finally {
    if (!contents.isDestroyed()) contents.removeListener('did-start-navigation', navigation);
  }
}

// Chromium only keeps certificate data while Network observation is enabled. Observe
// each navigation temporarily, retain the public chain, then let the normal tab policy
// release the debugger so background pages can freeze again.
export class CertificateTracker {
  private revision = 0;
  private chain: CertificateDetails[] | null = null;
  private enabled: Promise<unknown> | null = null;
  private pending: Promise<void> | null = null;
  constructor(
    private readonly contents: WebContents,
    private readonly tracking: (active: boolean) => void,
  ) {
    contents.on('did-start-navigation', this.navigation);
    contents.on('did-finish-load', this.finish);
    contents.on('did-fail-load', this.fail);
  }
  begin(url: string): void {
    this.revision++;
    this.chain = null;
    this.enabled = null;
    if (!/^https?:/.test(url)) {
      this.tracking(false);
      return;
    }
    try {
      attachDebugger(this.contents);
      this.tracking(true);
      this.enabled = this.contents.debugger
        .sendCommand('Network.enable', OBSERVED_NETWORK_ENABLE.params)
        .catch(() => null);
    } catch {
      this.tracking(false);
    }
  }
  private navigation = ({
    url,
    isMainFrame,
    isSameDocument,
  }: {
    url: string;
    isMainFrame: boolean;
    isSameDocument: boolean;
  }) => {
    if (isMainFrame && !isSameDocument) this.begin(url);
  };
  private finish = () => {
    const revision = this.revision;
    if (!this.enabled) return;
    const capture = async () => {
      await this.enabled;
      const chain = await readCertificateChain(this.contents);
      if (revision !== this.revision) return;
      this.chain = chain;
      this.enabled = null;
      this.tracking(false);
    };
    this.pending = capture().catch(() => {
      if (revision === this.revision) {
        this.enabled = null;
        this.tracking(false);
      }
    });
  };
  private fail = (_event: unknown, code: number, _description: string, _url: string, main: boolean) => {
    if (main && code !== -3) {
      this.revision++;
      this.enabled = null;
      this.chain = null;
      this.tracking(false);
    }
  };
  async read(): Promise<CertificateDetails[] | null> {
    await this.pending;
    return this.chain;
  }
  stop(): void {
    this.revision++;
    this.contents.removeListener('did-start-navigation', this.navigation);
    this.contents.removeListener('did-finish-load', this.finish);
    this.contents.removeListener('did-fail-load', this.fail);
    this.chain = null;
    this.enabled = null;
    this.tracking(false);
  }
}
export function certificateText(chain: readonly CertificateDetails[]): string {
  return chain
    .map(
      (certificate, index) =>
        `${t('certificate.chainEntry', { number: index + 1 })}\n${t('certificate.subject')}: ${certificate.subject}\n${t('certificate.issuer')}: ${certificate.issuer}\n${t('certificate.serial')}: ${certificate.serial}\n${t('certificate.validFrom')}: ${certificate.validFrom}\n${t('certificate.validTo')}: ${certificate.validTo}\n${t('certificate.names')}: ${certificate.names}\nSHA-256: ${certificate.fingerprint}\n${t('certificate.publicKey')}: ${certificate.key}`,
    )
    .join('\n\n');
}
export async function showCertificateDetails(
  window: BaseWindow,
  url: string,
  chain: CertificateDetails[] | null,
  current: () => boolean,
  dialogs: Pick<typeof dialog, 'showMessageBox'> = dialog,
): Promise<void> {
  if (window.isDestroyed() || !current()) return;
  const text = chain ? certificateText(chain) : t('certificate.unavailable');
  const { response } = await dialogs.showMessageBox(window, {
    type: 'info',
    title: t('certificate.title'),
    message: new URL(url).host,
    detail: text,
    buttons: chain ? [t('certificate.close'), t('certificate.copy')] : [t('certificate.close')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 1 && chain && current()) clipboard.writeText(`${text}\n\n${chain.map(({ pem }) => pem).join('\n')}`);
}
