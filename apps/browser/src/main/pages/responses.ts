export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:";

export function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

export function htmlResponse(body: string, csp: string, noStore = true): Response {
  return new Response(body, {
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
