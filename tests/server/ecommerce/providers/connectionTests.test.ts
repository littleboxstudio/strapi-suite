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
