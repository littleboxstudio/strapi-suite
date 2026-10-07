import { describe, it, expect, vi } from 'vitest';
import { createTabsMiddleware } from '../../server/src/middlewares/tabs';

const KEY = 'littlebox-strapi-suite';
const contentType = {
  pluginOptions: {
    [KEY]: {
      tabs: [
        { id: 't1', name: 'Loja - Vitrine' },
        { id: 't2', name: 'Title' },
      ],
    },
  },
  attributes: {
    title: { type: 'string' },
    banner: { type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
    other: { type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
  },
};

function makeStrapi() {
  return {
    config: { get: vi.fn((_key: string, fallback: string) => fallback) },
    contentType: vi.fn((uid: string) => (uid === 'api::home.home' ? contentType : undefined)),
    log: { warn: vi.fn() },
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/api/home',
    status: 200,
    body: { data: { id: 1, title: 'Home', banner: 'b', other: 'o' }, meta: {} },
    state: { route: { handler: 'api::home.home.find' } },
    ...overrides,
  } as any;
}

describe('createTabsMiddleware', () => {
  it('agrupa a resposta e avisa sobre conflitos uma única vez', async () => {
    const strapi = makeStrapi();
    const middleware = createTabsMiddleware({ strapi: strapi as any });
    const ctx = makeCtx();
    await middleware(ctx, async () => {});
    expect(ctx.body).toEqual({
      data: { id: 1, title: 'Home', other: 'o', loja_vitrine: { banner: 'b' } },
      meta: {},
    });
    await middleware(makeCtx(), async () => {});
    expect(strapi.log.warn).toHaveBeenCalledTimes(1);
  });

  it('não altera respostas fora das condições', async () => {
    const strapi = makeStrapi();
    const middleware = createTabsMiddleware({ strapi: strapi as any });
    const cases = [
      makeCtx({ method: 'POST' }),
      makeCtx({ status: 404 }),
      makeCtx({ path: '/admin/home' }),
      makeCtx({ state: { route: { handler: 'api::home.home.update' } } }),
      makeCtx({ state: { route: { handler: 'api::other.other.find' } } }),
      makeCtx({ body: { data: null } }),
    ];
    for (const ctx of cases) {
      const before = ctx.body;
      await middleware(ctx, async () => {});
      expect(ctx.body).toBe(before);
    }
  });
});

describe('createTabsMiddleware — falhas', () => {
  it('mantém a resposta original e registra erro se o agrupamento falhar', async () => {
    const strapi = makeStrapi();
    strapi.contentType = vi.fn(() => {
      return {
        get pluginOptions() {
          throw new Error('boom');
        },
        attributes: {},
      };
    }) as any;
    (strapi.log as any).error = vi.fn();
    const middleware = createTabsMiddleware({ strapi: strapi as any });
    const ctx = makeCtx();
    const before = ctx.body;
    await middleware(ctx, async () => {});
    expect(ctx.body).toBe(before);
    expect((strapi.log as any).error).toHaveBeenCalledTimes(1);
  });
});
