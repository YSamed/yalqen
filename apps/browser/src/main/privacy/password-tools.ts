import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { passwordOrigin, sanitizeCredential } from './passwords.js';
import type { SubmittedCredential } from '../../shared/types.js';

const GROUPS = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%*-_=+?'];
const ALPHABET = GROUPS.join('');
export function generatePassword(length: unknown = 20): string | null {
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 12 || length > 128) return null;
  const chars = GROUPS.map((group) => group[randomInt(group.length)]);
  while (chars.length < length) chars.push(ALPHABET[randomInt(ALPHABET.length)]);
  for (let index = chars.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join('');
}
export interface ImportedPassword extends SubmittedCredential {
  origin: string;
}
const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_CSV_ROWS = 10000;

function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new Error('CSV is too large');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    afterQuote = false;
  const cell = () => {
    row.push(field);
    field = '';
    afterQuote = false;
    if (row.length > 32) throw new Error('Too many columns');
  };
  const line = () => {
    cell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) throw new Error('Too many rows');
  };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += char;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      line();
    } else if (char === '"' && field === '' && !afterQuote) quoted = true;
    else {
      if (afterQuote || char === '"') throw new Error('Invalid CSV quoting');
      field += char;
    }
    if (field.length > 16384) throw new Error('CSV field is too long');
  }
  if (quoted) throw new Error('Unclosed CSV field');
  if (field || row.length || afterQuote) line();
  return rows;
}
export function parsePasswordCsv(text: string): { records: ImportedPassword[]; skipped: number } {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('Missing CSV header');
  const keys = header.map((key) => key.trim().toLowerCase());
  const url = keys.indexOf('url'),
    username = keys.indexOf('username'),
    password = keys.indexOf('password');
  if ([url, username, password].some((index) => index < 0) || new Set(keys).size !== keys.length)
    throw new Error('Missing or duplicate CSV columns');
  const records: ImportedPassword[] = [];
  let skipped = 0;
  for (const row of rows) {
    const origin = passwordOrigin(row[url]);
    const credential = sanitizeCredential({ username: row[username], password: row[password] });
    if (!origin || !credential || row.length !== header.length) {
      skipped++;
      continue;
    }
    records.push({ origin, ...credential });
  }
  return { records, skipped };
}
export function serializePasswordCsv(records: readonly ImportedPassword[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    'name,url,username,password\r\n' +
    records
      .map(({ origin, username, password }) => [new URL(origin).host, origin, username, password].map(quote).join(','))
      .join('\r\n') +
    '\r\n'
  );
}
export async function readPasswordCsv(file: string): Promise<{ records: ImportedPassword[]; skipped: number }> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_CSV_BYTES) throw new Error('Invalid CSV file');
  return parsePasswordCsv(await fs.readFile(file, 'utf8'));
}
export async function writePasswordCsv(file: string, records: readonly ImportedPassword[]): Promise<void> {
  const temporary = path.join(path.dirname(file), `.yalqen-passwords-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, serializePasswordCsv(records), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
