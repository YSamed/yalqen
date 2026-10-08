const api = window.yalqenReadingList;
const search = document.querySelector('input[type=search]'),
  status = document.querySelector('select'),
  items = document.querySelector('ol'),
  error = document.querySelector('[role=alert]'),
  readonly = document.querySelector('[data-readonly]'),
  empty = document.querySelector('[data-empty]'),
  rowTemplate = document.querySelector('template');
let generation = 0,
  busy = false;
function working(value) {
  busy = value;
  for (const button of document.querySelectorAll('li button')) button.disabled = value || readonly.hidden === false;
}
async function refresh() {
  const run = ++generation;
  error.hidden = true;
  try {
    const view = await api.list(search.value, status.value);
    if (run !== generation) return;
    if (!view) throw Error('unavailable');
    readonly.hidden = view.writable;
    empty.hidden = view.entries.length !== 0;
    const fragment = document.createDocumentFragment();
    for (const entry of view.entries) {
      const row = rowTemplate.content.cloneNode(true),
        visit = row.querySelector('a'),
        title = row.querySelector('strong'),
        url = row.querySelector('.url'),
        read = row.querySelector('[data-read]'),
        remove = row.querySelector('[data-remove]');
      visit.href = entry.url;
      title.textContent = entry.title;
      url.textContent = entry.url;
      read.textContent = read.dataset[entry.read ? 'unreadLabel' : 'readLabel'];
      read.setAttribute('aria-pressed', String(entry.read));
      read.disabled = remove.disabled = busy || !view.writable;
      read.addEventListener('click', () => mutate(() => api.setRead(entry.id, !entry.read)));
      remove.addEventListener('click', () => mutate(() => api.remove(entry.id)));
      fragment.append(row);
    }
    items.replaceChildren(fragment);
  } catch {
    if (run === generation) error.hidden = false;
  }
}
async function mutate(action) {
  if (busy) return;
  working(true);
  try {
    if (!(await action())) throw Error('save');
    await refresh();
  } catch {
    error.hidden = false;
  } finally {
    working(false);
  }
}
document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
  void refresh();
});
status.addEventListener('change', () => void refresh());
api.onChange(() => {
  void refresh();
});
void refresh();
