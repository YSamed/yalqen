export interface OneTimeCode {
  code: string;
  source: string;
  context: string;
}

export interface OneTimeCodeAvailability {
  available: boolean;
  label: string;
}

const WEBMAIL: { host: RegExp; path?: RegExp }[] = [
  { host: /^mail\.google\.com$/ },
  { host: /^outlook\.(live|office|office365)\.com$/, path: /^\/(mail|owa)\b/ },
  { host: /^mail\.yahoo\.com$/ },
  { host: /^mail\.yandex\.(com|ru|com\.tr)$/ },
  { host: /^mail\.proton\.me$/ },
  { host: /^(www\.)?icloud\.com$/, path: /^\/mail\b/ },
  { host: /^mail\.zoho\.(com|eu)$/ },
];

// Only these signed-in inbox pages are read, and only after the person asks for a code.
export function isWebmail(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      WEBMAIL.some(({ host, path }) => host.test(url.hostname) && (!path || path.test(url.pathname)))
    );
  } catch {
    return false;
  }
}

export const MAX_MAIL_TEXT = 30_000;

export const MAIL_TEXT_SCRIPT = `(() => {
  const root = document.querySelector('[role="main"], main') || document.body;
  return root ? root.innerText.slice(0, ${MAX_MAIL_TEXT}) : '';
})()`;

const KEYWORD =
  /\b(code|codes|otp|passcode|pin|one[- ]time|verification|verify|security|2fa|two[- ]factor|2-step|sign[- ]?in|log[- ]?in)\b|kod|doğrula|onay|güvenlik|tek kullanımlık|giriş/i;
const CANDIDATE = /(?<![\d.,:/+-])(\d{3}[- ]\d{3}|\d{4,8})(?![\d.,:/%]|\s?(TL|USD|EUR|₺|\$|€))/g;
const YEAR = /^(19|20)\d{2}$/;

// Inbox lists show the newest mail first, so codes come back in the order they appear.
export function findOneTimeCodes(text: string, source: string, limit = 5): OneTimeCode[] {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const found: OneTimeCode[] = [];
  for (let index = 0; index < lines.length && found.length < limit; index++) {
    if (!KEYWORD.test(lines[index])) continue;
    for (const line of lines.slice(index, index + 3)) {
      for (const match of line.matchAll(CANDIDATE)) {
        const code = match[1].replace(/[- ]/g, '');
        if (YEAR.test(code) || found.some((item) => item.code === code)) continue;
        found.push({ code, source, context: lines[index].slice(0, 80) });
        if (found.length >= limit) break;
      }
      if (found.length >= limit) break;
    }
  }
  return found;
}

const NAMED = /\b(otp|one ?time|verification ?code|verify ?code|2fa|totp|mfa|passcode|sms ?code)\b/i;

// Sites that skip autocomplete="one-time-code" usually still name the field after the code.
export function isOneTimeCodeField(input: { autocomplete: string; name: string; id: string; type: string }): boolean {
  if (input.autocomplete.trim().toLowerCase().split(/\s+/).at(-1) === 'one-time-code') return true;
  if (!['text', 'tel', 'number', ''].includes(input.type)) return false;
  return NAMED.test(`${input.name} ${input.id}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' '));
}
