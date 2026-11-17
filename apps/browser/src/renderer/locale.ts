import { pickLocale, setLocale } from '../shared/i18n';

const locale = pickLocale([new URLSearchParams(location.search).get('lang'), document.documentElement.lang]);
setLocale(locale);
document.documentElement.lang = locale;
