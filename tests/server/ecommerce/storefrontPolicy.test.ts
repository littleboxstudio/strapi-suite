import { describe, expect, it, vi } from 'vitest';
import checkStorefrontToken, { touchLastUsedAt } from '../../../server/src/policies/check-storefront-token';
import policies from '../../../server/src/policies';

type Token = { id: number | string; kind?: string | null; type?: string; expiresAt?: unknown; lastUsedAt?: unknown };

/** Strapi stub: `strapi.service('admin::api-token')` and the store settings. */
const setup = (opts: { tokens?: Record<string, Token>; chosen?: number | null } = {}) => {
  const tokens = opts.tokens ?? {};
  const apiTokens = {
    hash: vi.fn((t: string) => `h(${t})`),
    getByAccessKey: vi.fn(async (key: string) => {
      const raw = key.slice(2, -1);
      return tokens[raw] ?? null;
    }),
  };
  const getStoreSettings = vi.fn(async () => ({
    storefrontApiTokenId: opts.chosen === undefined ? 7 : opts.chosen,
  }));
  const strapi: any = {
    service: vi.fn((name: string) => (name === 'admin::api-token' ? apiTokens : undefined)),
    plugin: () => ({ service: (n: string) => (n === 'EcommerceSettingsService' ? { getStoreSettings } : undefined) }),
  };
  const run = (authorization?: string) =>
    checkStorefrontToken(
      { request: { header: authorization === undefined ? {} : { authorization } } },
      {},
      { strapi }
    );
  return { run, apiTokens, strapi };
};

const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString();
const PAST = () => new Date(Date.now() - 1000).toISOString();

describe('check-storefront-token policy', () => {
  it('is registered next to check-api-token', () => {
    expect(policies['check-storefront-token']).toBe(checkStorefrontToken);
    expect(policies['check-api-token']).toBeDefined();
  });

  it('no Authorization header → false', async () => {
    const { run, apiTokens } = setup();
    expect(await run()).toBe(false);
    expect(apiTokens.getByAccessKey).not.toHaveBeenCalled();
  });

  it('the raw token without the "Bearer " prefix → false (not looked up)', async () => {
    const { run, apiTokens } = setup({ tokens: { abc: { id: 7, kind: 'content-api' } } });
    expect(await run('abc')).toBe(false);
    expect(await run('Bearerabc')).toBe(false);
    expect(await run('Bearer ')).toBe(false);
    expect(apiTokens.getByAccessKey).not.toHaveBeenCalled();
  });

  it('unknown token → false', async () => {
    const { run } = setup();
    expect(await run('Bearer nope')).toBe(false);
  });

  it('looks the token up by its hash through strapi.service("admin::api-token")', async () => {
    const { run, apiTokens, strapi } = setup({ tokens: { abc: { id: 7, kind: 'content-api' } } });
    expect(await run('Bearer abc')).toBe(true);
    expect(strapi.service).toHaveBeenCalledWith('admin::api-token');
    expect(apiTokens.hash).toHaveBeenCalledWith('abc');
    expect(apiTokens.getByAccessKey).toHaveBeenCalledWith('h(abc)');
  });

  it('expired token (expiresAt as an ISO string in the past) → false', async () => {
    const { run } = setup({ tokens: { abc: { id: 7, kind: 'content-api', expiresAt: PAST() } } });
    expect(await run('Bearer abc')).toBe(false);
  });

  it('an unreadable expiresAt → false', async () => {
    const { run } = setup({ tokens: { abc: { id: 7, kind: 'content-api', expiresAt: 'not a date' } } });
    expect(await run('Bearer abc')).toBe(false);
  });

  it('expiresAt in the future (string or Date) → true', async () => {
    const a = setup({ tokens: { abc: { id: 7, kind: 'content-api', expiresAt: FUTURE() } } });
    expect(await a.run('Bearer abc')).toBe(true);
    const b = setup({
      tokens: { abc: { id: 7, kind: 'content-api', expiresAt: new Date(Date.now() + 60_000) } },
    });
    expect(await b.run('Bearer abc')).toBe(true);
  });

  it('a valid token that is not the chosen one (including the read-only token of the other modules) → false', async () => {
    const { run } = setup({
      tokens: {
        menus: { id: 3, kind: 'content-api', type: 'read-only' },
        other: { id: 8, kind: 'content-api', type: 'custom' },
      },
    });
    expect(await run('Bearer menus')).toBe(false);
    expect(await run('Bearer other')).toBe(false);
  });

  it('an admin-kind token with the chosen id → false', async () => {
    const { run } = setup({ tokens: { adm: { id: 7, kind: 'admin' } } });
    expect(await run('Bearer adm')).toBe(false);
  });

  it('the chosen token (content-api or no kind, custom type, numeric or string id) → true', async () => {
    const { run } = setup({
      tokens: {
        a: { id: 7, kind: 'content-api', type: 'custom' },
        b: { id: '7', kind: 'content-api', type: 'custom' },
        c: { id: 7, kind: null, type: 'full-access' },
        d: { id: 7 },
      },
    });
    for (const t of ['a', 'b', 'c', 'd']) expect(await run(`Bearer ${t}`)).toBe(true);
  });

  it('no storefrontApiTokenId in the settings → false', async () => {
    const { run } = setup({ chosen: null, tokens: { abc: { id: 7, kind: 'content-api' } } });
    expect(await run('Bearer abc')).toBe(false);
  });
});

describe('check-storefront-token policy — lastUsedAt', () => {
  const withDb = (tokens: Record<string, Token>, update = vi.fn(async () => ({}))) => {
    const ctx = setup({ tokens });
    ctx.strapi.db = { query: vi.fn(() => ({ update })) };
    ctx.strapi.log = { warn: vi.fn() };
    return { ...ctx, update };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('stamps lastUsedAt of an accepted token that was never used', async () => {
    const { run, update, strapi } = withDb({ abc: { id: 7, kind: 'content-api', lastUsedAt: null } });
    expect(await run('Bearer abc')).toBe(true);
    await flush();
    expect(strapi.db.query).toHaveBeenCalledWith('admin::api-token');
    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { lastUsedAt: expect.any(Date) } });
  });

  it('stamps it again only after an hour (string or Date)', async () => {
    const recent = new Date(Date.now() - 30 * 60_000);
    const old = new Date(Date.now() - 61 * 60_000);
    const a = withDb({ abc: { id: 7, kind: 'content-api', lastUsedAt: recent.toISOString() } });
    await a.run('Bearer abc');
    await flush();
    expect(a.update).not.toHaveBeenCalled();
    const b = withDb({ abc: { id: 7, kind: 'content-api', lastUsedAt: old } });
    await b.run('Bearer abc');
    await flush();
    expect(b.update).toHaveBeenCalledTimes(1);
  });

  it('never stamps a refused token', async () => {
    const { run, update } = withDb({ other: { id: 8, kind: 'content-api', lastUsedAt: null } });
    expect(await run('Bearer other')).toBe(false);
    await flush();
    expect(update).not.toHaveBeenCalled();
  });

  it('a failing update never fails the request', async () => {
    const update = vi.fn(async () => {
      throw new Error('db down');
    });
    const { run, strapi } = withDb({ abc: { id: 7, kind: 'content-api', lastUsedAt: null } }, update);
    expect(await run('Bearer abc')).toBe(true);
    await flush();
    expect(strapi.log.warn).toHaveBeenCalled();
  });

  it('touchLastUsedAt resolves even without a database', async () => {
    await expect(touchLastUsedAt({} as any, { id: 7, lastUsedAt: null })).resolves.toBeUndefined();
  });
});
