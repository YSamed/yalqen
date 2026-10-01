const list = document.getElementById('downloads');
const RETRY_MS = 2000;
let version = Number(list.dataset.version);
let shown = list.innerHTML;

function focusedCommand() {
  const active = document.activeElement;
  return active instanceof HTMLAnchorElement && list.contains(active) ? active.getAttribute('href') : null;
}

function render(html) {
  if (html === shown) return;
  shown = html;
  const focused = focusedCommand();
  list.innerHTML = html;
  if (focused) [...list.querySelectorAll('a')].find((link) => link.getAttribute('href') === focused)?.focus();
}

async function watch() {
  for (;;) {
    try {
      const response = await fetch(`yalqen://downloads/changes?since=${version}`);
      if (!response.ok) throw new Error(`Downloads: ${response.status}`);
      const next = await response.json();
      version = next.version;
      if (typeof next.html === 'string') render(next.html);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

void watch();
