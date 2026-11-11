import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProviderDefinition } from '../../../../server/src/services/modules/ecommerce/providers/registry';

const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const stubFetch = (impl: (...a: any[]) => any) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

const run = (id: string, config: Record<string, unknown>, secrets: Record<string, string>) =>
  getProviderDefinition(id)!.testConnection!({ config, secrets });

describe('stripe testConnection', () => {
  const secrets = { secretKey: 'sk_live_SECRET123' };
  it('ok on 200 with bearer auth', async () => {
    const f = stubFetch(async () => res(200));
    expect(await run('stripe', {}, secrets)).toEqual({ ok: true });
    expect(f.mock.calls[0][0]).toBe('https://api.stripe.com/v1/account');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer sk_live_SECRET123');
  });
  it('INVALID_CREDENTIALS on 401', async () => {
    stubFetch(async () => res(401));
    const r = await run('stripe', {}, secrets);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(r)).not.toContain('SECRET123');
  });
  it('ok with "Restricted key" on 403', async () => {
    stubFetch(async () => res(403));
    expect(await run('stripe', {}, secrets)).toEqual({ ok: true, message: 'Restricted key' });
  });
  it('UNREACHABLE on network error without leaking the secret', async () => {
    stubFetch(async () => { throw new Error('boom Bearer sk_live_SECRET123'); });
    const r = await run('stripe', {}, secrets);
    expect(r.code).toBe('UNREACHABLE');
    expect(JSON.stringify(r)).not.toContain('SECRET123');
  });
  it('MISSING_FIELDS without a key', async () => {
    const f = stubFetch(async () => res(200));
    expect((await run('stripe', {}, {})).code).toBe('MISSING_FIELDS');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('resend testConnection', () => {
  const secrets = { apiKey: 're_SECRET456' };
  it('ok on 200', async () => {
    const f = stubFetch(async () => res(200));
    expect((await run('resend', {}, secrets)).ok).toBe(true);
    expect(f.mock.calls[0][0]).toBe('https://api.resend.com/domains');
  });
  it.each([401, 403])('INVALID_CREDENTIALS on %i', async (s) => {
    stubFetch(async () => res(s));
    const r = await run('resend', {}, secrets);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(r)).not.toContain('SECRET456');
  });
  it('UNREACHABLE on network error', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    expect((await run('resend', {}, secrets)).code).toBe('UNREACHABLE');
  });
  it('ok for a sending-only key (401 restricted_api_key)', async () => {
    stubFetch(async () =>
      res(401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' })
    );
    expect(await run('resend', {}, secrets)).toEqual({ ok: true, message: 'Key valid (sending access only)' });
  });
  it('INVALID_CREDENTIALS on 401 with another error name or an unreadable body', async () => {
    stubFetch(async () => res(401, { statusCode: 401, name: 'validation_error' }));
    expect((await run('resend', {}, secrets)).code).toBe('INVALID_CREDENTIALS');
    stubFetch(async () => ({ status: 401, ok: false, json: async () => { throw new SyntaxError('x'); } }) as any);
    expect((await run('resend', {}, secrets)).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('moloni testConnection', () => {
  const config = { clientId: 'cid', username: 'user@x.pt', companyId: 1 };
  const secrets = { clientSecret: 'cs SECRET&1', password: 'p=SECRET#2' };
  it('ok when access_token is present, with encoded query', async () => {
    const f = stubFetch(async () => res(200, { access_token: 'tok' }));
    expect(await run('moloni', config, secrets)).toEqual({ ok: true });
    const url: string = f.mock.calls[0][0];
    expect(url.startsWith('https://api.moloni.pt/v1/grant/?grant_type=password&')).toBe(true);
    expect(url).toContain('client_id=cid');
    expect(url).toContain(`client_secret=${encodeURIComponent('cs SECRET&1')}`);
    expect(url).toContain(`username=${encodeURIComponent('user@x.pt')}`);
    expect(url).toContain(`password=${encodeURIComponent('p=SECRET#2')}`);
  });
  it('INVALID_CREDENTIALS without access_token', async () => {
    stubFetch(async () => res(400, { error: 'invalid_grant' }));
    const r = await run('moloni', config, secrets);
    expect(r.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('UNREACHABLE on network error whose message holds the URL', async () => {
    stubFetch(async () => { throw new Error('failed https://api.moloni.pt/v1/grant/?password=p%3DSECRET%232'); });
    const r = await run('moloni', config, secrets);
    expect(r.code).toBe('UNREACHABLE');
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('MISSING_FIELDS', async () => {
    expect((await run('moloni', {}, {})).code).toBe('MISSING_FIELDS');
  });
});

describe('ctt-expresso testConnection', () => {
  it('is NOT_IMPLEMENTED', async () => {
    expect(await run('ctt-expresso', {}, {})).toEqual({ ok: false, code: 'NOT_IMPLEMENTED' });
  });
});

describe('timeouts', () => {
  afterEach(() => vi.useRealTimers());

  const onAbort = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

  it('stripe: header stall aborts after 10s -> UNREACHABLE', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    stubFetch((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return onAbort(signal);
    });
    const p = run('stripe', {}, { secretKey: 'sk_SECRET' });
    await vi.advanceTimersByTimeAsync(10000);
    const r = await p;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(true);
    expect(r.code).toBe('UNREACHABLE');
  });

  it('moloni: body stall aborts after 10s -> UNREACHABLE', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    stubFetch(async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return { status: 200, ok: true, json: () => onAbort(signal!) } as unknown as Response;
    });
    const p = run('moloni', { clientId: 'c', username: 'u' }, { clientSecret: 's', password: 'p' });
    await vi.advanceTimersByTimeAsync(10000);
    const r = await p;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(true);
    expect(r.code).toBe('UNREACHABLE');
  });

  it('moloni: 5xx -> UNREACHABLE; non-JSON 4xx -> INVALID_CREDENTIALS', async () => {
    stubFetch(async () => res(503));
    expect((await run('moloni', { clientId: 'c', username: 'u' }, { clientSecret: 's', password: 'p' })).code).toBe('UNREACHABLE');
    stubFetch(async () => ({ status: 400, ok: false, json: async () => { throw new SyntaxError('x'); } }) as any);
    expect((await run('moloni', { clientId: 'c', username: 'u' }, { clientSecret: 's', password: 'p' })).code).toBe('INVALID_CREDENTIALS');
  });

  it('secrets are not trimmed', async () => {
    const f = stubFetch(async () => res(200));
    await run('stripe', {}, { secretKey: ' sk ' });
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer  sk ');
  });
});
