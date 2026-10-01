import { createHash } from 'node:crypto';
import { t } from '../shared/i18n.js';

export const STORE_HOME = 'https://chromewebstore.google.com/';
const ID_PATTERN = /^[a-p]{32}$/;
const STORE_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);
const CRX_MAGIC = 'Cr24';
const ZIP_MAGIC = 'PK\x03\x04';
export const MAX_CRX_BYTES = 128 * 1024 * 1024;

export function parseStoreId(input: string): string | null {
  const text = input.trim();
  if (ID_PATTERN.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !STORE_HOSTS.has(url.hostname)) return null;
    return url.pathname.split('/').find((part) => ID_PATTERN.test(part)) ?? null;
  } catch {
    return null;
  }
}

export function crxUrl(id: string, chromeVersion: string): string {
  const query = new URLSearchParams({
    response: 'redirect',
    prodversion: chromeVersion,
    acceptformat: 'crx3',
    x: `id=${id}&installsource=ondemand&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${query}`;
}

export function crxPayload(file: Buffer): Buffer {
  const magic = file.toString('latin1', 0, 4);
  if (magic === ZIP_MAGIC) return file;
  if (magic !== CRX_MAGIC || file.length < 16) throw new Error(t('chromeWebStore.invalidResponse'));
  const version = file.readUInt32LE(4);
  if (version === 3) return file.subarray(12 + file.readUInt32LE(8));
  if (version === 2) return file.subarray(16 + file.readUInt32LE(8) + file.readUInt32LE(12));
  throw new Error(t('chromeWebStore.unsupportedVersion'));
}

function readVarint(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let position = start;
  while (position < buffer.length && shift < 35) {
    const byte = buffer[position++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: position };
    shift += 7;
  }
  throw new Error(t('chromeWebStore.invalidPackage'));
}

function protoFields(buffer: Buffer, wanted: readonly number[]): { field: number; data: Buffer }[] {
  const found: { field: number; data: Buffer }[] = [];
  let position = 0;
  while (position < buffer.length) {
    const tag = readVarint(buffer, position);
    position = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (wire === 0) {
      position = readVarint(buffer, position).next;
    } else if (wire === 2) {
      const length = readVarint(buffer, position);
      const end = length.next + length.value;
      if (end > buffer.length) throw new Error(t('chromeWebStore.invalidPackage'));
      if (wanted.includes(field)) found.push({ field, data: buffer.subarray(length.next, end) });
      position = end;
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      throw new Error(t('chromeWebStore.invalidPackage'));
    }
  }
  return found;
}

export function extensionIdOfKey(publicKey: Buffer): string {
  const digest = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  return Array.from(digest, (byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0xf))).join('');
}

export function crxPublicKey(file: Buffer, id: string): string | null {
  if (file.toString('latin1', 0, 4) !== CRX_MAGIC || file.length < 16) return null;
  const version = file.readUInt32LE(4);
  const candidates: Buffer[] = [];
  if (version === 2) {
    candidates.push(file.subarray(16, 16 + file.readUInt32LE(8)));
  } else if (version === 3) {
    const header = file.subarray(12, 12 + file.readUInt32LE(8));
    for (const { data } of protoFields(header, [2, 3])) {
      candidates.push(...protoFields(data, [1]).map((item) => item.data));
    }
  }
  const key = candidates.find((candidate) => extensionIdOfKey(candidate) === id);
  return key ? key.toString('base64') : null;
}

export interface DownloadedCrx {
  zip: Buffer;
  key: string | null;
}

export async function downloadCrx(
  id: string,
  fetchFile: (url: string, init: RequestInit) => Promise<Response>,
  chromeVersion: string,
): Promise<DownloadedCrx> {
  const response = await fetchFile(crxUrl(id, chromeVersion), { credentials: 'omit' });
  if (response.status === 204 || response.status === 404) throw new Error(t('chromeWebStore.notFound'));
  if (!response.ok) throw new Error(t('chromeWebStore.noResponse', { status: response.status }));
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_CRX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(t('chromeWebStore.tooLarge'));
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CRX_BYTES) throw new Error(t('chromeWebStore.tooLarge'));
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      // Do not keep downloading an oversized or failed response after rejecting it.
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  const file = Buffer.concat(chunks, size);
  return { zip: crxPayload(file), key: crxPublicKey(file, id) };
}
