import type { RequestRule } from './types.js';

export function newRequestRule(): RequestRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    pattern: '',
    action: 'block',
    status: 200,
    contentType: 'application/json',
    body: '',
    redirectUrl: '',
    headers: '',
  };
}
