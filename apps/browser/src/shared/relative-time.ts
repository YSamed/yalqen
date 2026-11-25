const DAY = 86_400_000;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', DAY],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function timeAgo(time: number, locale: string, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const elapsed = time - now;
  for (const [unit, size] of UNITS)
    if (Math.abs(elapsed) >= size || unit === 'minute') return format.format(Math.round(elapsed / size), unit);
  return '';
}

export function dayLabel(time: number, locale: string, now = Date.now()): string {
  const startOf = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(time) - startOf(now)) / DAY);
  const label =
    days >= -1
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
      : new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}
