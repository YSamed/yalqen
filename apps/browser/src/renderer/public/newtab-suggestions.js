const field = document.getElementById('q');
const form = document.getElementById('search-form');
const list = document.getElementById('suggestions');
const engineName = form.querySelector('.engine-name')?.textContent.trim() ?? '';
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  search: 'M7.3 12.1a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6zM11 11l3.5 3.5',
  globe:
    'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4zM1.8 8h12.4M8 1.8c1.6 1.7 2.4 3.8 2.4 6.2S9.6 12.5 8 14.2C6.4 12.5 5.6 10.4 5.6 8S6.4 3.5 8 1.8z',
};
const MAX_SITE_ROWS = 4;
let rows = [];
let selected = -1;
let requestId = 0;

function clear() {
  rows = [];
  selected = -1;
  list.replaceChildren();
  list.hidden = true;
  field.setAttribute('aria-expanded', 'false');
  field.removeAttribute('aria-activedescendant');
}

function select(index) {
  selected = index;
  for (const [position, item] of [...list.children].entries()) {
    item.classList.toggle('selected', position === index);
    item.setAttribute('aria-selected', String(position === index));
  }
  if (index >= 0) field.setAttribute('aria-activedescendant', `suggestion-${index}`);
  else field.removeAttribute('aria-activedescendant');
}

// Like Dia, the address shows the host and any path, without www. or a trailing slash.
function addressOf(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, '')}${pathname.replace(/\/$/, '')}` || url;
  } catch {
    return url;
  }
}

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// Like Dia, a site row reads "Title — domain" with a globe when the site has no icon.
function localRow(suggestion) {
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.append(icon('globe'));
  if (suggestion.faviconUrl?.startsWith('https:')) {
    const image = document.createElement('img');
    image.src = suggestion.faviconUrl;
    image.alt = '';
    image.addEventListener('error', () => kind.replaceChildren(icon('globe')));
    kind.replaceChildren(image);
  }
  const address = addressOf(suggestion.url);
  const title = document.createElement('span');
  title.className = 'title site';
  title.textContent = suggestion.title || address;
  if (!suggestion.title) return { url: suggestion.url, parts: [kind, title] };
  const detail = document.createElement('span');
  detail.className = 'detail';
  detail.textContent = `— ${address}`;
  return { url: suggestion.url, parts: [kind, title, detail] };
}

function actionRow(name, url, query, detail) {
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.append(icon(name));
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = query;
  const label = document.createElement('span');
  label.className = 'detail';
  label.textContent = `— ${detail}`;
  return { url, parts: [kind, title, label] };
}

function render(query, results) {
  clear();
  rows = [
    actionRow('search', `yalqen://newtab/search?q=${encodeURIComponent(query)}`, query, engineName),
    ...results.slice(0, MAX_SITE_ROWS).map(localRow),
  ];
  for (const [index, row] of rows.entries()) {
    const item = document.createElement('li');
    item.id = `suggestion-${index}`;
    item.role = 'option';
    item.setAttribute('aria-selected', 'false');
    const link = document.createElement('a');
    link.href = row.url;
    link.addEventListener('mousedown', (event) => event.preventDefault());
    link.append(...row.parts);
    item.append(link);
    list.append(item);
  }
  list.hidden = false;
  field.setAttribute('aria-expanded', 'true');
  select(0);
}

async function update() {
  const query = field.value.trim();
  const current = ++requestId;
  if (!query) {
    clear();
    return;
  }
  let results = [];
  try {
    const response = await fetch(`yalqen://newtab/suggestions?q=${encodeURIComponent(query)}`);
    if (response.ok) results = await response.json();
  } catch {
    results = [];
  }
  if (current !== requestId || field.value.trim() !== query) return;
  render(query, results);
}

field.addEventListener('input', update);
field.addEventListener('focus', update);
field.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    ++requestId;
    clear();
  } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length > 0) {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    select((selected + step + rows.length) % rows.length);
  }
});

form.addEventListener('submit', (event) => {
  if (selected < 0 || !rows[selected]) return;
  event.preventDefault();
  location.assign(rows[selected].url);
});
