export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:";

export function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

// Internal pages follow the accent color picked in settings; empty keeps the stylesheet's default.
let accentAttribute = '';

export function setPageAccent(hex: string | null): void {
  accentAttribute = hex && /^#[0-9a-f]{6}$/i.test(hex) ? ` style="--accent: ${hex}"` : '';
}

export function htmlResponse(body: string, csp: string, noStore = true): Response {
  return new Response(accentAttribute ? body.replace('<html ', `<html${accentAttribute} `) : body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      ...(noStore ? { 'cache-control': 'no-store' } : {}),
    },
  });
}

export function scriptResponse(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
