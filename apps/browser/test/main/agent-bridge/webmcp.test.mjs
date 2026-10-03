import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import webmcp from '../../../dist/main/agent-bridge/webmcp.js';

const { WEBMCP_SCRIPT, LIST_PAGE_TOOLS, callPageToolExpression, pageToolResult, sanitizePageTools } = webmcp;

function page() {
  const context = vm.createContext({ navigator: {} });
  vm.runInContext(WEBMCP_SCRIPT, context);
  return context;
}

test('the stand-in lets a page register, list and run tools', async () => {
  const context = page();
  vm.runInContext(
    `navigator.modelContext.provideContext({ tools: [{ name: 'echo', description: 'Echo', inputSchema: {}, execute: async (input) => ({ echoed: input.text }) }] });
     navigator.modelContext.registerTool({ name: 'other', execute: () => 1 }).unregister();`,
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(LIST_PAGE_TOOLS, context))), [
    { name: 'echo', description: 'Echo', inputSchema: {} },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await vm.runInContext(callPageToolExpression('echo', { text: 'hi' }), context))),
    {
      echoed: 'hi',
    },
  );
  assert.throws(() => vm.runInContext(callPageToolExpression('missing', {}), context), /no tool named missing/);
  assert.equal(Object.keys(vm.runInContext('navigator.modelContext', context)).includes('__yalqenTools'), false);
});

test('a native modelContext is left alone', () => {
  const context = vm.createContext({ navigator: { modelContext: { native: true } } });
  vm.runInContext(WEBMCP_SCRIPT, context);
  assert.equal(vm.runInContext(LIST_PAGE_TOOLS, context), null);
});

test('tool lists and results from the page are bounded', () => {
  assert.equal(sanitizePageTools('nope'), null);
  assert.deepEqual(sanitizePageTools([{ name: 'a', description: 3 }, { nope: true }, null]), [
    { name: 'a', description: undefined, inputSchema: undefined },
  ]);
  assert.equal(pageToolResult('x'.repeat(70000)).length, 64 * 1024 + 1);
  assert.equal(pageToolResult({ ok: true }), '{\n  "ok": true\n}');
});
