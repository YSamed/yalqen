import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sessionModule from '../../../dist/main/agent-bridge/agent-session.js';

const { AgentSession } = sessionModule;
const live = !!process.env.YALQEN_LIVE;

test('live: real PTY, real shell, real claude', { skip: !live }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-agent-session-'));
  const session = new AgentSession({
    connect: async () => ({ url: 'http://127.0.0.1:47823/mcp', token: 'live-run' }),
    onState: () => console.log(session.state()),
    onOutput: (o) => process.stdout.write(o.data),
    // NOTE: no loadPty, no shell, no env — production defaults kick in.
  });
  t.after(() => session.dispose());
  session.selectDirectory(directory);
  const state = await session.start({ cols: 120, rows: 40 });
  console.log(state);
  await new Promise((r) => setTimeout(r, 2500));
  session.dispose();
  await fs.promises.rm(directory, { recursive: true, retryDelay: 250, maxRetries: 10, force: true });
});
