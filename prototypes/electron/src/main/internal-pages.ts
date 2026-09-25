import fs from 'node:fs';
import { protocol, type Session } from 'electron';
import { INTERNAL_SCHEME } from '../shared/types.js';

const NEW_TAB_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** Must run before the app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/**
 * Serves yalqen://newtab/ from a static file. The welcome text is written out
 * on the first new tab page of each launch and shown finished afterwards.
 */
export function serveInternalPages(session: Session, newTabFile: string): void {
  const page = fs.readFileSync(newTabFile, 'utf8');
  let welcomed = false;

  session.protocol.handle(INTERNAL_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== 'newtab' || url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }
    const html = welcomed ? page : page.replace('<html lang="tr">', '<html lang="tr" class="animate">');
    welcomed = true;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': NEW_TAB_CSP },
    });
  });
}
