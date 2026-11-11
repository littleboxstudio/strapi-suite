import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import coBody from 'co-body';
import { createEcommerceRawBodyMiddleware } from '../../../server/src/middlewares/ecommerceRawBody';

const PATH = '/api/littlebox-strapi-suite/ecommerce/stripe/webhook';

const strapi: any = { config: { get: (_k: string, d: any) => d } };

/** A koa-like ctx over a node-like request stream carrying `chunks`. */
const mkCtx = (opts: { path?: string; method?: string; chunks?: Buffer[]; headers?: any } = {}) => {
  const req: any = Readable.from(opts.chunks ?? []);
  const total = (opts.chunks ?? []).reduce((n, c) => n + c.length, 0);
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(total),
    ...(opts.headers ?? {}),
  };
  req.method = opts.method ?? 'POST';
  req.url = opts.path ?? PATH;
  req.socket = { remoteAddress: '127.0.0.1' };
  const ctx: any = {
    method: req.method,
    path: opts.path ?? PATH,
    req,
    request: { req },
    state: {},
    status: 404,
    body: undefined,
  };
  return ctx;
};

describe('ecommerceRawBody middleware', () => {
  it('captures the raw bytes and the next body parser still sees the JSON', async () => {
    const json = '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"x":"é"}}}';
    const bytes = Buffer.from(json, 'utf8');
    // Split mid multi-byte character: the capture must be byte-exact.
    const split = bytes.indexOf(0xc3) + 1;
    const ctx = mkCtx({ chunks: [bytes.subarray(0, split), bytes.subarray(split)] });
    const originalReq = ctx.req;
    let parsed: any;
    const next = vi.fn(async () => {
      // What strapi::body (koa-body -> co-body) does next.
      parsed = await coBody.json(ctx, { limit: '1mb' });
    });

    await createEcommerceRawBodyMiddleware({ strapi })(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(ctx.state.ecommerceRawBody)).toBe(true);
    expect(ctx.state.ecommerceRawBody.equals(bytes)).toBe(true);
    expect(parsed).toEqual(JSON.parse(json));
    // Request metadata is still reachable through the replacement request.
    expect(ctx.req.headers['content-type']).toBe('application/json');
    expect(ctx.req.method).toBe('POST');
    expect(ctx.req.socket).toBe(originalReq.socket);
    expect(ctx.request.req).toBe(ctx.req);
  });

  it('does nothing for other paths or methods', async () => {
    for (const ctx of [mkCtx({ path: '/api/littlebox-strapi-suite/modules/pages' }), mkCtx({ method: 'GET' })]) {
      const req = ctx.req;
      const next = vi.fn(async () => {});
      await createEcommerceRawBodyMiddleware({ strapi })(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.req).toBe(req);
      expect(ctx.state.ecommerceRawBody).toBeUndefined();
    }
  });

  it('honours a custom REST prefix', async () => {
    const custom: any = { config: { get: (k: string, d: any) => (k === 'api.rest.prefix' ? '/v2' : d) } };
    const ctx = mkCtx({ path: '/v2/littlebox-strapi-suite/ecommerce/stripe/webhook', chunks: [Buffer.from('{}')] });
    await createEcommerceRawBodyMiddleware({ strapi: custom })(ctx, async () => {});
    expect(ctx.state.ecommerceRawBody.toString()).toBe('{}');
  });

  it('answers 413 above 1 MB without calling next', async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 'a');
    const ctx = mkCtx({ chunks: [big.subarray(0, 600000), big.subarray(600000)] });
    const next = vi.fn(async () => {});
    await createEcommerceRawBodyMiddleware({ strapi })(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(413);
    expect(ctx.state.ecommerceRawBody).toBeUndefined();

    // Declared length above the limit is refused before reading.
    const declared = mkCtx({ chunks: [Buffer.from('{}')], headers: { 'content-length': String(2 * 1024 * 1024) } });
    await createEcommerceRawBodyMiddleware({ strapi })(declared, next);
    expect(next).not.toHaveBeenCalled();
    expect(declared.status).toBe(413);
  });
});
