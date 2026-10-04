import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { t } from '../../shared/i18n.js';
import { resolveInside } from './extension-manifest.js';

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const STORED = 0;
const DEFLATED = 8;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function findEnd(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - END_SIZE - MAX_COMMENT);
  for (let offset = zip.length - END_SIZE; offset >= lowest; offset--) {
    if (zip.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new Error(t('zip.invalidPackage'));
}

function readZip(zip: Buffer): ZipEntry[] {
  const end = findEnd(zip);
  const count = zip.readUInt16LE(end + 10);
  if (count === 0xffff || zip.readUInt32LE(end + 16) === 0xffffffff) throw new Error(t('zip.tooLarge'));
  if (count > MAX_ENTRIES) throw new Error(t('zip.tooManyFiles'));

  const entries: ZipEntry[] = [];
  let total = 0;
  let cursor = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(t('zip.invalidPackage'));
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error(t('zip.tooLarge'));
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(t('zip.invalidPackage'));
    }
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);
    if (raw.length !== compressedSize) throw new Error(t('zip.invalidPackage'));

    let data: Buffer;
    if (method === STORED) data = raw;
    else if (method === DEFLATED) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new Error(t('zip.unsupportedCompression'));
    if (data.length !== size) throw new Error(t('zip.invalidPackage'));
    entries.push({ name, data });
  }
  return entries;
}

export function extractZip(zip: Buffer, destination: string): void {
  const files = readZip(zip).map((entry) => {
    const target = entry.name.includes('\0') ? null : resolveInside(destination, entry.name.replaceAll('\\', '/'));
    if (!target) throw new Error(t('zip.invalidFilePath'));
    return { target, data: entry.data };
  });
  for (const { target, data } of files) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
