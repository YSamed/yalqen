import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutofillData, AutofillInfo, AutofillKind, AutofillView } from '../../shared/autofill.js';
import type { Cipher } from './passwords.js';

const MAX_RECORDS = 200;
interface SavedRecord {
  id: string;
  kind: AutofillKind;
  secret: string;
}

function text(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.length <= max ? value.trim() : null;
}
export function sanitizeAutofill(value: unknown): AutofillData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const label = text(input.label, 128);
  if (!label) return null;
  if (input.kind === 'card') {
    const name = text(input.name, 256),
      rawNumber = text(input.number, 64),
      month = text(input.month, 2),
      year = text(input.year, 4);
    if (!name || !rawNumber || !month || !year || !/^[\d -]+$/.test(rawNumber)) return null;
    const number = rawNumber.replace(/[ -]/g, '');
    if (
      !/^\d{12,19}$/.test(number) ||
      /^0+$/.test(number) ||
      !/^\d{1,2}$/.test(month) ||
      +month < 1 ||
      +month > 12 ||
      !/^\d{4}$/.test(year) ||
      +year < 2000 ||
      +year > 2100
    )
      return null;
    let sum = 0;
    for (let index = number.length - 1, double = false; index >= 0; index--, double = !double) {
      let digit = +number[index]!;
      if (double) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    if (sum % 10 !== 0) return null;
    return { kind: 'card', label, name, number, month: month.padStart(2, '0'), year };
  }
  if (input.kind !== 'address') return null;
  const keys = [
    'givenName',
    'additionalName',
    'familyName',
    'organization',
    'streetAddress',
    'city',
    'region',
    'postalCode',
    'country',
    'email',
    'tel',
  ] as const;
  const fields = Object.fromEntries(keys.map((key) => [key, text(input[key], key === 'streetAddress' ? 4096 : 512)]));
  if (
    Object.values(fields).some((field) => field === null) ||
    !(fields.givenName || fields.familyName || fields.streetAddress)
  )
    return null;
  const country = fields.country!.toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return null;
  return { kind: 'address', label, ...fields, country } as AutofillData;
}

export class AutofillStore {
  readonly file: string;
  private records: SavedRecord[] = [];
  private summaries = new Map<string, import('../../shared/autofill.js').AutofillInfo | null>();
  constructor(
    directory: string,
    private readonly cipher: Cipher,
  ) {
    this.file = path.join(directory, 'autofill.json');
    try {
      if (fs.statSync(this.file).size > 4 * 1024 * 1024) return;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.records)) return;
      const seen = new Set<string>();
      this.records = data.records.slice(0, MAX_RECORDS).filter((record: SavedRecord) => {
        if (
          !record ||
          typeof record.id !== 'string' ||
          record.id.length > 128 ||
          seen.has(record.id) ||
          !['card', 'address'].includes(record.kind) ||
          typeof record.secret !== 'string' ||
          record.secret.length > 32768
        )
          return false;
        seen.add(record.id);
        return true;
      });
    } catch {
      /* A missing or invalid file starts with an empty collection. */
    }
  }
  save(value: unknown): boolean {
    if (!this.cipher.available() || !value || typeof value !== 'object') return false;
    const { id, data } = value as { id: unknown; data: unknown };
    const clean = sanitizeAutofill(data);
    const old = typeof id === 'string' ? this.records.find((record) => record.id === id) : null;
    if (
      !clean ||
      (id !== null && !old) ||
      (old && old.kind !== clean.kind) ||
      (!old && this.records.length >= MAX_RECORDS)
    )
      return false;
    try {
      const record: SavedRecord = {
        id: old?.id ?? randomUUID(),
        kind: clean.kind,
        secret: this.cipher.encrypt(JSON.stringify(clean)),
      };
      return this.replace(old ? this.records.map((item) => (item === old ? record : item)) : [...this.records, record]);
    } catch {
      return false;
    }
  }
  read(id: string): AutofillData | null {
    if (!this.cipher.available()) return null;
    const record = this.records.find((record) => record.id === id);
    if (!record) return null;
    try {
      const data = sanitizeAutofill(JSON.parse(this.cipher.decrypt(record.secret)));
      return data?.kind === record.kind ? data : null;
    } catch {
      return null;
    }
  }
  choices(kind?: AutofillKind): AutofillInfo[] {
    if (!this.cipher.available()) return [];
    return this.records.flatMap((record) => {
      if (kind && record.kind !== kind) return [];
      if (this.summaries.has(record.id)) {
        const cached = this.summaries.get(record.id);
        return cached ? [{ ...cached }] : [];
      }
      const data = this.read(record.id);
      const info = data
        ? {
            id: record.id,
            kind: data.kind,
            label: data.label,
            detail:
              data.kind === 'card'
                ? `•••• ${data.number.slice(-4)} · ${data.month}/${data.year}`
                : [data.givenName, data.familyName, data.city].filter(Boolean).join(' '),
          }
        : null;
      this.summaries.set(record.id, info);
      return info ? [{ ...info }] : [];
    });
  }
  view(): AutofillView {
    return { available: this.cipher.available(), records: this.choices() };
  }
  remove(id: string): boolean {
    return this.replace(this.records.filter((record) => record.id !== id));
  }
  private replace(records: SavedRecord[]): boolean {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, records }), { mode: 0o600 });
      fs.renameSync(temp, this.file);
      this.records = records;
      this.summaries.clear();
      return true;
    } catch {
      return false;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}
