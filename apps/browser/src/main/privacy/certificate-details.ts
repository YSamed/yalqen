import { X509Certificate } from 'node:crypto';
import { dialog, clipboard, type BaseWindow, type Certificate, type Session } from 'electron';
import { t } from '../../shared/i18n.js';

// Electron's verify callback takes -3 to keep Chromium's own verdict.
const USE_CHROMIUM_RESULT = -3;
type CertificateVerifyRequest = Electron.Request;

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
// Chromium verifies a server certificate once and caches the verdict, so the chain is kept from
// that verification. Observing every page load through the debugger would slow each one down.
const MAX_REMEMBERED_HOSTS = 512;
const MAX_CHAIN_LENGTH = 16;
const remembered = new WeakMap<Session, Map<string, Certificate>>();

export function rememberCertificates(
  session: Session,
  verify: (request: CertificateVerifyRequest) => number = () => USE_CHROMIUM_RESULT,
): void {
  const certificates = new Map<string, Certificate>();
  remembered.set(session, certificates);
  session.setCertificateVerifyProc((request, callback) => {
    const certificate = request.validatedCertificate ?? request.certificate;
    if (certificate) {
      certificates.delete(request.hostname);
      if (certificates.size >= MAX_REMEMBERED_HOSTS) certificates.delete(certificates.keys().next().value!);
      certificates.set(request.hostname, certificate);
    }
    callback(verify(request));
  });
}

export function forgetCertificates(session: Session): void {
  remembered.get(session)?.clear();
}

export function certificateChainFor(session: Session, url: string): CertificateDetails[] | null {
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  } catch {
    return null;
  }
  const encoded: string[] = [];
  const seen = new Set<string>();
  for (
    let certificate: Certificate | undefined = remembered.get(session)?.get(hostname);
    certificate && encoded.length < MAX_CHAIN_LENGTH && !seen.has(certificate.fingerprint);
    certificate = certificate.issuerCert
  ) {
    seen.add(certificate.fingerprint);
    encoded.push(certificate.data.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''));
  }
  return encoded.length ? parseCertificateChain(encoded) : null;
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
