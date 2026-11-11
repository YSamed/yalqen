const api = window.yalqenEasels;
const $ = (selector) => document.querySelector(selector);
const picker = $('[data-picker]'),
  nameField = $('[data-name]'),
  color = $('[data-color]'),
  error = $('[role=alert]'),
  readonly = $('[data-readonly]'),
  empty = $('[data-empty]'),
  stage = $('.stage'),
  board = $('.board'),
  ink = $('.ink'),
  toolButtons = [...document.querySelectorAll('[data-tool]')];
const SVG = 'http://www.w3.org/2000/svg';
const MAX_STROKE_NUMBERS = 3990;
let easel = null,
  writable = false,
  tool = 'move';

function setTool(name) {
  tool = name;
  board.dataset.tool = name;
  for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === name));
}

function boardPoint(event) {
  const box = board.getBoundingClientRect();
  return [Math.round(event.clientX - box.left), Math.round(event.clientY - box.top)];
}

async function save(action) {
  try {
    if (!(await action())) throw Error('save');
  } catch {
    error.hidden = false;
    await open(easel?.id);
  }
}

function place(element, item) {
  Object.assign(element.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px` });
  if (item.kind === 'note') element.style.height = `${item.h}px`;
}

function makeMovable(handle, element, item) {
  handle.addEventListener('pointerdown', (event) => {
    if (tool !== 'move' || !writable) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX,
      startY = event.clientY,
      x = item.x,
      y = item.y;
    const move = (next) => {
      item.x = Math.max(0, Math.round(x + next.clientX - startX));
      item.y = Math.max(0, Math.round(y + next.clientY - startY));
      place(element, item);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      void save(() => api.patch(easel.id, item.id, { x: item.x, y: item.y }));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

function erasable(element, item) {
  element.addEventListener(
    'click',
    (event) => {
      if (tool !== 'erase' || !writable) return;
      event.preventDefault();
      event.stopPropagation();
      void save(() => api.removeItem(easel.id, item.id)).then(() => open(easel.id));
    },
    true,
  );
}

function drawStroke(item) {
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', item.points.join(' '));
  line.setAttribute('stroke', item.color);
  line.setAttribute('stroke-width', String(item.width));
  erasable(line, item);
  ink.append(line);
  return line;
}

function drawNote(item) {
  const note = document.createElement('div'),
    grip = document.createElement('div'),
    text = document.createElement('textarea');
  note.className = 'item note';
  grip.className = 'grip';
  text.value = item.text;
  text.maxLength = 2000;
  text.placeholder = board.dataset.placeholder;
  text.disabled = !writable;
  text.addEventListener('change', () => {
    item.text = text.value;
    void save(() => api.patch(easel.id, item.id, { text: item.text }));
  });
  note.append(grip, text);
  place(note, item);
  makeMovable(grip, note, item);
  erasable(note, item);
  board.append(note);
}

function drawClip(item) {
  const clip = document.createElement('div'),
    image = document.createElement('img'),
    source = document.createElement('a');
  clip.className = 'item clip';
  image.src = item.src;
  image.alt = item.title;
  source.href = item.url;
  source.rel = 'noreferrer';
  source.textContent = item.title || board.dataset.source;
  clip.append(image, source);
  place(clip, item);
  makeMovable(image, clip, item);
  erasable(clip, item);
  board.append(clip);
}

function render() {
  board.querySelectorAll('.item').forEach((node) => node.remove());
  ink.replaceChildren();
  for (const item of easel.items) {
    if (item.kind === 'stroke') drawStroke(item);
    else if (item.kind === 'note') drawNote(item);
    else drawClip(item);
  }
}

async function open(id) {
  error.hidden = true;
  try {
    const view = await api.list();
    if (!view) throw Error('unavailable');
    writable = view.writable;
    readonly.hidden = writable;
    empty.hidden = view.easels.length !== 0;
    stage.hidden = view.easels.length === 0;
    picker.replaceChildren(
      ...view.easels.map((entry) =>
        Object.assign(document.createElement('option'), { value: entry.id, textContent: entry.name }),
      ),
    );
    easel = null;
    if (!view.easels.length) return;
    const chosen = view.easels.some((entry) => entry.id === id) ? id : view.easels[0].id;
    easel = await api.open(chosen);
    if (!easel) throw Error('missing');
    picker.value = easel.id;
    nameField.value = easel.name;
    render();
  } catch {
    error.hidden = false;
  } finally {
    for (const control of document.querySelectorAll('header button, header input')) control.disabled = !writable;
    picker.disabled = false;
  }
}

async function add(item) {
  const added = await api.add(easel.id, item);
  if (!added) throw Error('save');
  easel.items.push(added);
  render();
  return added;
}

board.addEventListener('pointerdown', (event) => {
  if (!easel || !writable) return;
  if (tool === 'note' && event.target === board) {
    const [x, y] = boardPoint(event);
    void save(() => add({ kind: 'note', x, y, w: 200, h: 120, text: '' }));
  }
});

ink.addEventListener('pointerdown', (event) => {
  if (tool !== 'pen' || !easel || !writable) return;
  event.preventDefault();
  ink.setPointerCapture(event.pointerId);
  const points = [...boardPoint(event)];
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('stroke', color.value);
  line.setAttribute('stroke-width', '3');
  ink.append(line);
  const draw = () => line.setAttribute('points', points.join(' '));
  const move = (next) => {
    const [x, y] = boardPoint(next);
    if (points.length < MAX_STROKE_NUMBERS && Math.hypot(x - points.at(-2), y - points.at(-1)) >= 2) {
      points.push(x, y);
      draw();
    }
  };
  const end = () => {
    ink.removeEventListener('pointermove', move);
    ink.removeEventListener('pointerup', end);
    ink.removeEventListener('pointercancel', end);
    if (points.length === 2) points.push(...points);
    void save(() => add({ kind: 'stroke', color: color.value, width: 3, points }));
  };
  draw();
  ink.addEventListener('pointermove', move);
  ink.addEventListener('pointerup', end);
  ink.addEventListener('pointercancel', end);
});

for (const button of toolButtons) button.addEventListener('click', () => setTool(button.dataset.tool));
picker.addEventListener('change', () => void open(picker.value));
$('[data-create]').addEventListener('click', () => {
  void api.create(nameField.value).then((id) => (id ? open(id) : (error.hidden = false)));
});
$('[data-rename]').addEventListener('click', () => {
  if (easel) void save(() => api.rename(easel.id, nameField.value)).then(() => open(easel?.id));
});
$('[data-delete]').addEventListener('click', (event) => {
  if (easel && window.confirm(event.currentTarget.dataset.confirm)) void save(() => api.remove(easel.id));
});
api.onChange(() => void open(easel?.id));
setTool('move');
void open();
