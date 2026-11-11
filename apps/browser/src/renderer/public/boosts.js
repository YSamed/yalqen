const api = window.yalqenBoosts;
const form = document.querySelector('form'),
  field = (name) => form.elements[name],
  error = document.querySelector('[role=alert]'),
  readonly = document.querySelector('[data-readonly]'),
  empty = document.querySelector('[data-empty]');
const requested = new URLSearchParams(location.search).get('site');
const blank = { enabled: true, accent: null, background: null, font: null, hidden: [], css: '' };
let sites = new Map(),
  writable = false;

function show(origin) {
  const boost = sites.get(origin) ?? blank;
  field('site').value = origin;
  field('enabled').checked = boost.enabled;
  field('useAccent').checked = boost.accent !== null;
  field('accent').value = boost.accent ?? '#2563eb';
  field('useBackground').checked = boost.background !== null;
  field('background').value = boost.background ?? '#ffffff';
  field('font').value = boost.font ?? '';
  field('hidden').value = boost.hidden.join('\n');
  field('css').value = boost.css;
  for (const control of form.elements) control.disabled = !writable;
  form.querySelector('[data-remove]').disabled = !writable || !sites.has(origin);
}

async function refresh(selected) {
  error.hidden = true;
  try {
    const view = await api.list();
    if (!view) throw Error('unavailable');
    sites = new Map(view.sites.map((site) => [site.origin, site.boost]));
    writable = view.writable;
    readonly.hidden = writable;
    const origins = [...new Set([...sites.keys(), ...(requested ? [requested] : [])])].sort();
    empty.hidden = origins.length !== 0;
    form.hidden = origins.length === 0;
    field('site').replaceChildren(
      ...origins.map((origin) =>
        Object.assign(document.createElement('option'), { value: origin, textContent: origin }),
      ),
    );
    if (origins.length) show(origins.includes(selected) ? selected : (requested ?? origins[0]));
  } catch {
    error.hidden = false;
  }
}

async function mutate(action) {
  try {
    if (!(await action())) throw Error('save');
    await refresh(field('site').value);
  } catch {
    error.hidden = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const boost = {
    enabled: field('enabled').checked,
    accent: field('useAccent').checked ? field('accent').value : null,
    background: field('useBackground').checked ? field('background').value : null,
    font: field('font').value || null,
    hidden: field('hidden')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    css: field('css').value,
  };
  void mutate(() => api.save(field('site').value, boost));
});
form.querySelector('[data-remove]').addEventListener('click', () => void mutate(() => api.remove(field('site').value)));
field('site').addEventListener('change', () => show(field('site').value));
api.onChange(() => {
  void refresh(field('site').value);
});
void refresh(requested);
