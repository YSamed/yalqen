export type AutofillKind = 'address' | 'card';
export interface AutofillAddress {
  kind: 'address';
  label: string;
  givenName: string;
  additionalName: string;
  familyName: string;
  organization: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  email: string;
  tel: string;
}
export interface AutofillCard {
  kind: 'card';
  label: string;
  name: string;
  number: string;
  month: string;
  year: string;
}
export type AutofillData = AutofillAddress | AutofillCard;
export interface ManualAutofill {
  id: string | null;
  data: AutofillData;
}
export interface AutofillInfo {
  id: string;
  kind: AutofillKind;
  label: string;
  detail: string;
}
export interface AutofillView {
  available: boolean;
  records: AutofillInfo[];
}
export interface AutofillAvailability {
  address: boolean;
  card: boolean;
  addressLabel: string;
  cardLabel: string;
}

const ADDRESS_FIELDS = new Set([
  'name',
  'given-name',
  'additional-name',
  'family-name',
  'organization',
  'street-address',
  'address-line1',
  'address-line2',
  'address-line3',
  'address-level1',
  'address-level2',
  'postal-code',
  'country',
  'country-name',
  'email',
  'tel',
]);
const CARD_FIELDS = new Set([
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
]);

// The section and shipping/billing tokens keep distinct forms from being filled together.
export function autofillField(value: string): { kind: AutofillKind; field: string; section: string } | null {
  const tokens = value.trim().toLowerCase().split(/\s+/);
  const field = tokens.at(-1)!;
  if (!ADDRESS_FIELDS.has(field) && !CARD_FIELDS.has(field)) return null;
  return {
    kind: CARD_FIELDS.has(field) ? 'card' : 'address',
    field,
    section: tokens
      .filter((token) => token.startsWith('section-') || token === 'shipping' || token === 'billing')
      .join(' '),
  };
}

export function autofillValues(data: AutofillData, locale: string): Record<string, string> {
  if (data.kind === 'card') {
    const names = data.name.split(/\s+/);
    return {
      'cc-name': data.name,
      'cc-given-name': names[0] ?? '',
      'cc-additional-name': names.slice(1, -1).join(' '),
      'cc-family-name': names.length > 1 ? names.at(-1)! : '',
      'cc-number': data.number,
      'cc-exp': `${data.month}/${data.year}`,
      'cc-exp-month': data.month,
      'cc-exp-year': data.year,
    };
  }
  const lines = data.streetAddress.split('\n');
  let country = data.country;
  try {
    country = new Intl.DisplayNames([locale], { type: 'region' }).of(data.country) ?? country;
  } catch {
    /* Retain the country code when the locale cannot be resolved. */
  }
  return {
    name: [data.givenName, data.additionalName, data.familyName].filter(Boolean).join(' '),
    'given-name': data.givenName,
    'additional-name': data.additionalName,
    'family-name': data.familyName,
    organization: data.organization,
    'street-address': data.streetAddress,
    'address-line1': lines[0] ?? '',
    'address-line2': lines[1] ?? '',
    'address-line3': lines.slice(2).join(', '),
    'address-level1': data.region,
    'address-level2': data.city,
    'postal-code': data.postalCode,
    country: data.country,
    'country-name': country,
    email: data.email,
    tel: data.tel,
  };
}
