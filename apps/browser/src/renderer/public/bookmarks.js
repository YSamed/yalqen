const options = document.getElementById('folder-options');

// toggle does not bubble, so a capturing listener sees every row's editor open.
document.addEventListener(
  'toggle',
  (event) => {
    const details = event.target;
    if (!options || !(details instanceof HTMLDetailsElement) || !details.open) return;
    for (const select of details.querySelectorAll('select[data-folder-options]')) {
      const current = select.value;
      select.replaceChildren(options.content.cloneNode(true));
      select.value = current;
      select.removeAttribute('data-folder-options');
    }
  },
  true,
);
