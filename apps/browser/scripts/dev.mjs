import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage: node scripts/dev.mjs [electron flags]

Serves src/renderer with Vite and opens the browser against it, so a Svelte change reloads
without a rebuild. Anything after the script name goes to Electron, for example
--remote-debugging-port=9222 for an editor debugger.

Options:
  --port <n>   port for the Vite server (default: 5173, or YALQEN_DEV_SERVER_PORT)`;

const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log(usage);
  process.exit(0);
}

const portFlag = argv.indexOf('--port');
const port = portFlag === -1 ? (process.env.YALQEN_DEV_SERVER_PORT ?? '5173') : (argv[portFlag + 1] ?? '5173');
const electronArgs = portFlag === -1 ? argv : [...argv.slice(0, portFlag), ...argv.slice(portFlag + 2)];

// Vite is ESM-only and loads a native bundler, so it runs in this Node process rather than inside
// Electron's main process. Main only needs the address through the environment.
const { createServer } = await import('vite');
const server = await createServer({
  configFile: path.join(project, 'vite.config.mts'),
  root: path.join(project, 'src/renderer'),
  server: { port: Number(port) },
});

await server.listen();
const address = server.resolvedUrls?.local?.[0];
if (!address) {
  console.error('The dev server started without a local address.');
  await server.close();
  process.exit(1);
}
console.log(`Vite is serving src/renderer at ${address}`);

const executable = require('electron');
console.log(`Starting Electron against ${address}`);
const child = spawn(executable, [...electronArgs, project], {
  cwd: project,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, YALQEN_DEV_SERVER_URL: address },
});

let closing = false;
const shutdown = async (signal) => {
  if (closing) return;
  closing = true;
  if (!child.killed) child.kill(signal);
  await server.close();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(signal));

// The window can outlive the terminal that started it, so the server follows Electron rather than
// the other way round.
child.on('exit', async (code, signal) => {
  await server.close();
  process.exitCode = code ?? (signal ? 1 : 0);
});
child.on('error', async (error) => {
  console.error(error);
  await server.close();
  process.exitCode = 1;
});
