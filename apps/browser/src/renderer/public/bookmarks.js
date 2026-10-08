const options = document.getElementById('folder-options');
function populate(select) {
  if (!options) return;
  const current = select.value;
  select.replaceChildren(options.content.cloneNode(true));
  const exclude = select.dataset.exclude;
  if (exclude)
    for (const option of [...select.options]) {
      if (option.value === exclude || JSON.parse(option.dataset.ancestors || '[]').includes(exclude)) option.remove();
    }
  select.value = current;
  select.removeAttribute('data-folder-options');
}
for (const select of document.querySelectorAll('form.new-folder select, form.bulk select')) populate(select);

// toggle does not bubble, so a capturing listener sees every row's editor open.
document.addEventListener(
  'toggle',
  (event) => {
    const details = event.target;
    if (!options || !(details instanceof HTMLDetailsElement) || !details.open) return;
    for (const select of details.querySelectorAll('select[data-folder-options]')) {
      populate(select);
    }
  },
  true,
);

const bulk = document.getElementById('bulk-bookmarks');
const choices = [...document.querySelectorAll('[data-bookmark-selection]')];
const all = document.querySelector('[data-select-all]');
const count = document.querySelector('[data-selection-count]');
const label = count?.textContent || '';
function updateSelection() {
  const selected = choices.filter((choice) => choice.checked).length;
  if (count) count.textContent = label.replace('0', String(selected));
  if (all) {
    all.checked =
      selected === Math.min(choices.length, 1000) && choices.slice(0, 1000).every((choice) => choice.checked);
    all.indeterminate = selected > 0 && !all.checked;
  }
  for (const button of bulk?.querySelectorAll('[data-bulk-action]') || [])
    button.disabled = selected === 0 || selected > 1000;
}
all?.addEventListener('change', () => {
  for (const [index, choice] of choices.entries()) choice.checked = all.checked && index < 1000;
  updateSelection();
});
for (const choice of choices) choice.addEventListener('change', updateSelection);
window.addEventListener('pageshow', updateSelection);
bulk?.addEventListener('submit', (event) => {
  const selected = choices.filter((choice) => choice.checked).length;
  if (!selected || selected > 1000 || (event.submitter?.dataset.confirm && !confirm(event.submitter.dataset.confirm)))
    event.preventDefault();
});
