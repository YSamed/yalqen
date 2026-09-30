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
  if (magic !== CRX_MAGIC || file.length < 16) throw new Error('Mağaza geçerli bir uzantı paketi döndürmedi');
  const version = file.readUInt32LE(4);
  if (version === 3) return file.subarray(12 + file.readUInt32LE(8));
  if (version === 2) return file.subarray(16 + file.readUInt32LE(8) + file.readUInt32LE(12));
  throw new Error('Desteklenmeyen uzantı paketi sürümü');
}

export async function downloadCrx(
  id: string,
  fetchFile: (url: string, init: RequestInit) => Promise<Response>,
  chromeVersion: string,
): Promise<Buffer> {
  const response = await fetchFile(crxUrl(id, chromeVersion), { credentials: 'omit' });
  if (response.status === 204 || response.status === 404) throw new Error('Uzantı Chrome Web Mağazası’nda bulunamadı');
  if (!response.ok) throw new Error(`Mağaza yanıt vermedi (${response.status})`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_CRX_BYTES) throw new Error('Uzantı paketi çok büyük');
  const file = Buffer.from(await response.arrayBuffer());
  if (file.length > MAX_CRX_BYTES) throw new Error('Uzantı paketi çok büyük');
  return crxPayload(file);
}
