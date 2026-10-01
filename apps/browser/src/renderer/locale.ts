import { pickLocale, setLocale } from '../shared/i18n';

// Main passes the locale as ?lang= to file pages and writes it into <html lang> for internal pages.
const locale = pickLocale([new URLSearchParams(location.search).get('lang'), document.documentElement.lang]);
setLocale(locale);
document.documentElement.lang = locale;
