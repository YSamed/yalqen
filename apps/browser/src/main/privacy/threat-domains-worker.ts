import { parentPort } from 'node:worker_threads';
import { normalizeThreatDomains } from './threat-domains.js';

parentPort?.once('message', (bytes: Uint8Array) => {
  try {
    const { text: normalized, starts } = normalizeThreatDomains(Buffer.from(bytes).toString('utf8'));
    parentPort?.postMessage({ text: normalized, starts }, [starts.buffer]);
  } catch (error) {
    parentPort?.postMessage({ error: (error as Error).message });
  }
});
