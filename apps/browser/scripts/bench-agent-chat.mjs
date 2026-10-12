import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mainModule } from './main-module.mjs';

const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: path.resolve(fileURLToPath(new URL('../dist/main/', import.meta.url))) },
    out: { type: 'string' },
  },
});
const { AgentChat } = (await import(pathToFileURL(mainModule(values['module-dir'], 'agent-bridge/agent-chat.js'))))
  .default;

const text = (length, seed) =>
  Array.from({ length: Math.ceil(length / 60) }, (_, line) => `Line ${line} of block ${seed}: const value = ${line};`)
    .join('\n')
    .slice(0, length);
const tool = (id, name, input, output) => ({
  type: 'tool',
  id,
  name,
  input,
  output,
  status: 'done',
  verification: null,
  task: null,
  steps: [],
});
const message = (id, role, parts) => ({
  id,
  role,
  parts,
  context: null,
  elements: [],
  episode: null,
  images: [],
  reverted: false,
  workMode: 'normal',
});

// A coding session: short prompts, replies with prose, a file read and a command result.
function transcript(bytes) {
  const messages = [];
  for (let turn = 0, size = 0; size < bytes; turn++) {
    const pair = [
      message(`user-${turn}`, 'user', [{ type: 'text', text: text(300, turn) }]),
      message(`assistant-${turn}`, 'assistant', [
        { type: 'text', text: text(1500, turn) },
        tool(`read-${turn}`, 'Read', JSON.stringify({ file_path: `/src/file-${turn}.ts` }), text(12000, turn)),
        tool(`bash-${turn}`, 'Bash', JSON.stringify({ command: 'npm test' }), text(2000, turn)),
        { type: 'text', text: text(1200, turn) },
      ]),
    ];
    messages.push(...pair);
    size += JSON.stringify(pair).length;
  }
  return messages;
}

let checksum = 0;
const results = [];
for (const kib of [100, 400, 900]) {
  let sent = '';
  const chat = new AgentChat({
    connect: async () => ({ url: 'http://127.0.0.1:1/mcp', token: 'bench' }),
    onState: () => undefined,
    // Builds before the snapshot was published as JSON left the serialization to the window.
    onUpdate: (update) => {
      sent = typeof update === 'string' ? update : JSON.stringify(update);
    },
    loadClient: async () => {
      throw new Error('The benchmark does not start an agent');
    },
  });
  chat.messages = transcript(kib * 1024);
  const reply = chat.messages.at(-1).parts.at(-1);
  const publish = () => {
    reply.text += ' word';
    chat.publish();
  };
  for (let index = 0; index < 50; index++) publish();
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    for (let index = 0; index < 100; index++) publish();
    samples.push((performance.now() - start) / 100);
  }
  samples.sort((a, b) => a - b);
  const parsed = JSON.parse(sent);
  checksum += parsed.messages.length + parsed.messages.at(-1).parts.at(-1).text.length;
  results.push({
    name: `streamed reply, ${parsed.messages.length} messages, ${Math.round(sent.length / 1024)} KiB`,
    medianMs: Number(samples[3].toFixed(4)),
  });
  chat.dispose();
}

const record = { node: process.version, checksum, results };
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.table(results);
console.log(`checksum ${checksum}`);
