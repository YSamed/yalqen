export const RESPONSIVE_SCAN_WORLD = 1010;

// Geometry is evidence of clipping/overflow, not a judgment that the layout is incorrect.
// Form values, HTML and scripts are deliberately never included in the report.
export const RESPONSIVE_SCAN_SCRIPT = `(async () => {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 200);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
  const all = document.querySelectorAll('*');
  const findings = [];
  let truncated = all.length > 2000;
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const selectorOf = element => {
    const parts = [];
    for (let node = element; node && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      let part = node.tagName.toLowerCase();
      const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ').slice(0, 240);
  };
  const add = (kind, element, box, label) => {
    if (findings.length >= 20) { truncated = true; return; }
    findings.push({ kind, selector: selectorOf(element), label: clean(label), rect: {
      x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10,
      width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10
    } });
  };
  for (let index = 0; index < Math.min(all.length, 2000); index++) {
    const element = all[index];
    if (['HTML','BODY','SCRIPT','STYLE','NOSCRIPT','OPTION'].includes(element.tagName)) continue;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const inVerticalView = box.bottom > 0 && box.top < viewport.height;
    const outsideX = box.left < -2 || box.right > viewport.width + 2;
    const control = element.matches('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[tabindex]');
    const text = ['INPUT','TEXTAREA','SELECT'].includes(element.tagName) ? '' :
      [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ');
    const label = element.getAttribute('aria-label') || text;
    if (inVerticalView && outsideX) add('horizontal-overflow', element, box, label);
    if (control && ((inVerticalView && outsideX) ||
      (['fixed','sticky'].includes(style.position) && (box.top < -2 || box.bottom > viewport.height + 2))))
      add('offscreen-control', element, box, label);
    const clippedX = ['hidden','clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
    const clippedY = ['hidden','clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
    if (inVerticalView && box.right > 0 && box.left < viewport.width && clean(text) && (clippedX || clippedY))
      add('clipped-text', element, box, text);
  }
  return { viewport, documentWidth, horizontalOverflow: Math.max(0, documentWidth - viewport.width), findings, truncated };
})()`;
