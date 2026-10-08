const api = window.yalqenWorkspaces,
  items = document.querySelector('ol'),
  error = document.querySelector('[role=alert]'),
  readonly = document.querySelector('[data-readonly]'),
  save = document.getElementById('save');
let busy = false,
  generation = 0;
function working(value) {
  busy = value;
  for (const control of document.querySelectorAll('input,button')) control.disabled = value || !readonly.hidden;
}
async function refresh() {
  const run = ++generation;
  try {
    const view = await api.list();
    if (run !== generation) return;
    if (!view) throw Error('unavailable');
    readonly.hidden = view.writable;
    document.querySelector('[data-empty]').hidden = view.entries.length !== 0;
    const fragment = document.createDocumentFragment();
    for (const entry of view.entries) {
      const row = document.querySelector('template').content.cloneNode(true),
        form = row.querySelector('form'),
        input = form.elements.name;
      row.querySelector('strong').textContent = entry.name;
      row.querySelector('.meta').textContent =
        `${entry.count} · ${new Date(entry.savedAt).toLocaleString(document.documentElement.lang)}`;
      input.value = entry.name;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void mutate(() => api.rename(entry.id, input.value));
      });
      row.querySelector('[data-open]').addEventListener('click', () => {
        void mutate(() => api.open(entry.id));
      });
      const remove = row.querySelector('[data-remove]');
      remove.addEventListener('click', () => {
        if (window.confirm(remove.dataset.confirm)) void mutate(() => api.remove(entry.id));
      });
      fragment.append(row);
    }
    items.replaceChildren(fragment);
    working(busy);
  } catch {
    if (run === generation) error.hidden = false;
  }
}
async function mutate(action) {
  if (busy) return;
  working(true);
  error.hidden = true;
  try {
    if (!(await action())) throw Error('save');
    await refresh();
  } catch {
    error.hidden = false;
  } finally {
    working(false);
  }
}
save.addEventListener('submit', (event) => {
  event.preventDefault();
  void mutate(async () => {
    const saved = await api.save(save.elements.name.value);
    if (saved) save.reset();
    return saved;
  });
});
api.onChange(() => {
  void refresh();
});
void refresh();
