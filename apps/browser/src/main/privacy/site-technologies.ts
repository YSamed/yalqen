interface TechnologyRule {
  name: string;
  resources?: RegExp[];
  generator?: RegExp;
  selectors?: string[];
  globals?: string[];
  cookies?: RegExp[];
}

export interface TechnologySignals {
  resources: string[];
  generator: string;
  selectors: string[];
  globals: string[];
}

const RULES: readonly TechnologyRule[] = [
  { name: 'WordPress', generator: /^WordPress/i, resources: [/\/wp-(?:content|includes)\//] },
  { name: 'Shopify', globals: ['Shopify'], resources: [/cdn\.shopify\.com/] },
  { name: 'Wix', generator: /^Wix\.com/i, resources: [/static\.parastorage\.com/] },
  { name: 'Squarespace', generator: /Squarespace/i, resources: [/static1\.squarespace\.com/] },
  { name: 'Webflow', generator: /^Webflow/i, selectors: ['html[data-wf-site]'] },
  { name: 'Drupal', generator: /^Drupal/i, globals: ['Drupal'] },
  { name: 'Joomla', generator: /^Joomla/i },
  { name: 'Ghost', generator: /^Ghost/i },
  { name: 'Hugo', generator: /^Hugo/i },
  { name: 'Jekyll', generator: /^Jekyll/i },
  { name: 'Astro', generator: /^Astro/i, selectors: ['astro-island'] },
  { name: 'Gatsby', generator: /^Gatsby/i, selectors: ['#___gatsby'] },
  { name: 'Next.js', globals: ['__NEXT_DATA__'], selectors: ['#__next'], resources: [/\/_next\/static\//] },
  { name: 'Nuxt', globals: ['__NUXT__'], selectors: ['#__nuxt'], resources: [/\/_nuxt\//] },
  { name: 'Remix', globals: ['__remixContext'] },
  { name: 'React', selectors: ['[data-reactroot]'], resources: [/\/react(?:-dom)?(?:\.[a-z]+)*\.js(?:$|\?)/i] },
  { name: 'Vue.js', globals: ['__VUE__'], selectors: ['[data-v-app]'], resources: [/\/vue(?:\.[a-z]+)*\.js(?:$|\?)/i] },
  { name: 'Angular', selectors: ['[ng-version]'] },
  { name: 'Svelte', selectors: ['[class*="svelte-"]'] },
  { name: 'jQuery', globals: ['jQuery'], resources: [/\/jquery[-.\d]*(?:\.min)?\.js(?:$|\?)/i] },
  { name: 'Bootstrap', globals: ['bootstrap'], resources: [/\/bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)(?:$|\?)/i] },
  { name: 'Font Awesome', resources: [/font-?awesome/i] },
  { name: 'Google Fonts', resources: [/fonts\.googleapis\.com/] },
  {
    name: 'Google Analytics',
    resources: [/googletagmanager\.com\/gtag\/js/, /google-analytics\.com\/(?:analytics|ga)\.js/],
    cookies: [/^_ga(?:_|$)/],
  },
  { name: 'Google Tag Manager', globals: ['google_tag_manager'], resources: [/googletagmanager\.com\/gtm\.js/] },
  { name: 'Stripe', resources: [/js\.stripe\.com/] },
  { name: 'Cloudflare', resources: [/\/cdn-cgi\//], cookies: [/^__cf_bm$/, /^cf_clearance$/] },
  { name: 'Laravel', cookies: [/^laravel_session$/] },
  { name: 'PHP', cookies: [/^PHPSESSID$/] },
];

const MAX_LIST = 400;
const MAX_TEXT = 300;

const SELECTORS = [...new Set(RULES.flatMap((rule) => rule.selectors ?? []))];
const GLOBALS = [...new Set(RULES.flatMap((rule) => rule.globals ?? []))];

// Runs in the page's own world, because globals such as jQuery are invisible to an isolated world.
export const TECHNOLOGY_SCRIPT = `(() => {
  const clip = (value) => String(value ?? '').slice(0, ${MAX_TEXT});
  const resources = [];
  try {
    for (const node of document.querySelectorAll('script[src], link[href]')) {
      if (resources.length >= ${MAX_LIST}) break;
      resources.push(clip(node.getAttribute('src') ?? node.getAttribute('href')));
    }
  } catch {}
  let generator = '';
  try {
    generator = clip(document.querySelector('meta[name="generator" i]')?.getAttribute('content'));
  } catch {}
  const selectors = ${JSON.stringify(SELECTORS)}.filter((selector) => {
    try {
      return document.querySelector(selector) !== null;
    } catch {
      return false;
    }
  });
  const globals = ${JSON.stringify(GLOBALS)}.filter((name) => {
    try {
      return name in window;
    } catch {
      return false;
    }
  });
  return { resources, generator, selectors, globals };
})()`;

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, limit)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.slice(0, MAX_TEXT));
}

export function parseTechnologySignals(raw: unknown): TechnologySignals | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { resources, generator, selectors, globals } = raw as Record<string, unknown>;
  return {
    resources: strings(resources, MAX_LIST),
    generator: typeof generator === 'string' ? generator.slice(0, MAX_TEXT) : '',
    selectors: strings(selectors, SELECTORS.length),
    globals: strings(globals, GLOBALS.length),
  };
}

export function detectTechnologies(signals: TechnologySignals | null, cookieNames: readonly string[]): string[] {
  return RULES.filter(
    (rule) =>
      (signals !== null &&
        (rule.resources?.some((pattern) => signals.resources.some((url) => pattern.test(url))) ||
          (rule.generator?.test(signals.generator) ?? false) ||
          rule.selectors?.some((selector) => signals.selectors.includes(selector)) ||
          rule.globals?.some((name) => signals.globals.includes(name)))) ||
      rule.cookies?.some((pattern) => cookieNames.some((name) => pattern.test(name))),
  )
    .map((rule) => rule.name)
    .sort((a, b) => a.localeCompare(b));
}
