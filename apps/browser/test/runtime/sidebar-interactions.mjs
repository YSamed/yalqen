import assert from 'node:assert/strict';
import types from '../../dist/shared/types.js';
import { browserState, finish, openInterface, tab } from '../helpers/interface-harness.mjs';

const { placeSidebarFooterItem } = types;
const footerItems = ['history', 'downloads', 'settings'];
const row = (id) => `aside button.select[title="https://${id}.example/"]`;
const folder = (name) => `aside .group-heading[data-folder="${name}"]`;

finish(
  (async () => {
    const ui = await openInterface('sidebar-interactions', {
      state: browserState([tab('a'), tab('b'), tab('c'), tab('d'), tab('e', { group: 'Work' })], {
        tabGroups: [
          { name: 'Work', collapsed: false, count: 1, parent: null },
          { name: 'Later', collapsed: false, count: 0, parent: null },
        ],
        spaces: [
          { id: '', name: 'Default', icon: null },
          { id: 'side', name: 'Side', icon: null },
        ],
        sidebarFooterItems: footerItems,
        zoom: 1.25,
      }),
    });
    const taken = (...kinds) => {
      const found = ui.actions.filter((action) => kinds.includes(action.type));
      ui.actions.length = 0;
      return found;
    };
    const lowerHalf = async (selector) => {
      const box = await ui.center(selector);
      return { x: box.x, y: Math.round(box.y + (box.bottom - box.y) / 2) };
    };
    const nudge = ({ x, y }) => [
      { x, y: y + 2 },
      { x, y: y + 8 },
    ];

    await ui.click(row('c'));
    assert.deepEqual(taken('activate-tab'), [{ type: 'activate-tab', id: 'c', animate: true }]);
    console.log('PASS: a click on a tab row activates it');

    const b = await ui.center(row('b'));
    await ui.drag(b, [...nudge(b), await lowerHalf(row('d'))]);
    assert.deepEqual(taken('move-row', 'activate-tab'), [{ type: 'move-row', id: 'b', target: 'd', after: true }]);
    console.log('PASS: dragging a tab below another moves it there without activating it');

    const c = await ui.center(row('c'));
    await ui.drag(c, [...nudge(c), await ui.center(folder('Work'))]);
    assert.deepEqual(taken('move-tab-to-group', 'move-row'), [{ type: 'move-tab-to-group', id: 'c', name: 'Work' }]);
    console.log('PASS: dropping a tab on a folder moves it into that folder');

    const target = await lowerHalf(row('d'));
    await ui.drag(c, [...nudge(c), target], { release: false });
    await ui.key('Escape');
    const after = await lowerHalf(row('a'));
    ui.mouse('mouseMove', after);
    await ui.settle();
    ui.mouse('mouseUp', after, false);
    await ui.settle();
    assert.deepEqual(taken('move-row', 'move-tab-to-group', 'activate-tab'), []);
    console.log('PASS: Escape cancels a tab drag, even if the pointer keeps moving');

    const later = await ui.center(folder('Later'));
    await ui.drag(later, [...nudge(later), await ui.center(folder('Work'))]);
    assert.deepEqual(taken('move-tab-group', 'toggle-tab-group'), [
      { type: 'move-tab-group', name: 'Later', parent: 'Work' },
    ]);
    console.log('PASS: dropping a folder on another nests it without toggling either');

    await ui.click('.footer-tools .tool-button:first-child');
    assert.deepEqual(taken('open-history'), [{ type: 'open-history' }]);
    await ui.click('.more-button');
    const [menu] = taken('open-sidebar-menu');
    assert.equal(menu.kind, 'tabs');
    assert.ok(menu.anchor.width > 0 && menu.footer.width > 0, 'the menu is anchored to the button and the footer');
    console.log('PASS: footer buttons run their action and anchor the menu');

    const drop = (from, slot, dropped = true) =>
      ui.run(`(() => {
        const tools = document.querySelector('.footer-tools');
        const button = tools.querySelectorAll('.tool-button')[${from}];
        const dataTransfer = new DataTransfer();
        const clientX = tools.getBoundingClientRect().left + ${slot} * 35 + 5;
        const fire = (node, type) => node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX }));
        fire(button, 'dragstart');
        if (${dropped}) {
          fire(tools, 'dragover');
          fire(tools, 'drop');
        }
        fire(button, 'dragend');
      })()`);
    await drop(0, 2);
    assert.deepEqual(taken('set-sidebar-footer-items'), [
      { type: 'set-sidebar-footer-items', items: placeSidebarFooterItem(footerItems, 'history', 2) },
    ]);
    await drop(1, 0, false);
    assert.deepEqual(taken('set-sidebar-footer-items'), [
      { type: 'set-sidebar-footer-items', items: ['history', 'settings'] },
    ]);
    console.log('PASS: footer buttons reorder on drop and leave the footer when dropped outside');

    await ui.click('.page-actions .bookmark');
    await ui.click('.page-actions .split');
    assert.deepEqual(taken('toggle-bookmark', 'split-new-tab'), [
      { type: 'toggle-bookmark' },
      { type: 'split-new-tab' },
    ]);
    console.log('PASS: page actions bookmark the page and split it with a new tab');

    const sidebar = await ui.center(row('a'));
    const page = (script) => ui.window.webContents.executeJavaScript(script);
    await page(`window.__wheels = []; addEventListener('wheel', (e) => __wheels.push({
      dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, t: Math.round(e.timeStamp), target: e.target?.className ?? '' }), true)`);
    for (let step = 0; step < 4; step++) {
      ui.window.webContents.sendInputEvent({
        type: 'mouseWheel',
        ...sidebar,
        deltaX: -30,
        deltaY: 0,
        hasPreciseScrollingDeltas: true,
      });
      await ui.settle(30);
    }
    await ui.settle(250);
    const switched = taken('switch-space');
    if (switched.length !== 1) console.error('space swipe wheel events:', JSON.stringify(await page('__wheels')));
    assert.deepEqual(switched, [{ type: 'switch-space', id: 'side' }]);
    console.log('PASS: a horizontal swipe over the sidebar switches space once');
  })(),
);
