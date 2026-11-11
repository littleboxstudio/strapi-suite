import { vi } from 'vitest';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type MoloniCall = { path: string; body: any; query: URLSearchParams; init: any };
type Handler = (body: any, query: URLSearchParams) => unknown;

export const TOKEN = { access_token: 'AT-1', expires_in: 3600, refresh_token: 'RT-1' };

/**
 * Stubs `fetch` with a router keyed by Moloni path (`grant`, `taxes/getAll`, ...). A handler may
 * return a Response, throw (network failure), or any value (sent as JSON 200). `grant` defaults
 * to a valid token.
 */
export function moloniFake(routes: Record<string, Handler>) {
  const calls: MoloniCall[] = [];
  const all: Record<string, Handler> = { grant: () => TOKEN, ...routes };
  const f = vi.fn(async (url: string, init: any) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/(v1\/)?/, '').replace(/\/$/, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, query: u.searchParams, init });
    const handler = all[path] ?? all[url];
    if (!handler) return json(404, { error: 'no route' });
    const out = await handler(body, u.searchParams);
    return out instanceof Response ? out : json(200, out);
  });
  vi.stubGlobal('fetch', f);
  const paths = () => calls.map((c) => c.path);
  const of = (path: string) => calls.filter((c) => c.path === path);
  return { calls, f, paths, of };
}
