import type { Core } from '@strapi/strapi';
import { Readable } from 'node:stream';
import { PLUGIN_ID } from '../config/index';

/** Stripe events are a few KB; anything above this is refused before signature checks. */
export const ECOMMERCE_RAW_BODY_LIMIT = 1024 * 1024;

export const STRIPE_WEBHOOK_SUBPATH = '/ecommerce/stripe/webhook';

class PayloadTooLarge extends Error {}

/** Reads the whole stream into one Buffer, failing past `limit` bytes. */
const readAll = (stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
    };
    const onData = (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        cleanup();
        // Let the rest drain so the socket can still carry the 413.
        stream.resume();
        reject(new PayloadTooLarge());
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });

/**
 * A readable stream replaying `bytes`, that answers every non-stream property (headers, method,
 * url, socket, …) from the original request, so downstream middlewares (strapi::body's
 * co-body, cookies, ip, logger) behave as with the real request.
 */
const replayRequest = (original: any, bytes: Buffer): any => {
  const replay = Readable.from(bytes.length ? [bytes] : []);
  return new Proxy(replay, {
    get(target, prop) {
      if (prop in target) return Reflect.get(target, prop, target);
      const value = Reflect.get(original, prop, original);
      return typeof value === 'function' ? value.bind(original) : value;
    },
    has(target, prop) {
      return prop in target || prop in original;
    },
  });
};

/**
 * Captures the exact bytes of the Stripe webhook request (needed for the HMAC signature) into
 * `ctx.state.ecommerceRawBody`, then hands the next middlewares a request replaying those bytes,
 * so `strapi::body` still parses the JSON.
 *
 * Registered with `strapi.server.use` during the plugin's `register()`: Strapi mounts the app
 * middlewares from `config/middlewares` (including `strapi::body`) later, in `bootstrap()`
 * (`server.initMiddlewares()`), so this one always runs before the body parser. It also runs
 * before `strapi::errors`, so it answers 413 itself instead of throwing.
 */
export function createEcommerceRawBodyMiddleware({ strapi }: { strapi: Core.Strapi }) {
  return async (ctx: any, next: () => Promise<void>) => {
    if (ctx.method !== 'POST') return next();
    const prefix: string = strapi.config.get('api.rest.prefix', '/api');
    const target = `${String(prefix).replace(/\/+$/, '')}/${PLUGIN_ID}${STRIPE_WEBHOOK_SUBPATH}`;
    const path = String(ctx.path ?? '').replace(/\/+$/, '');
    if (path !== target) return next();

    const tooLarge = () => {
      ctx.status = 413;
      ctx.body = { error: { status: 413, name: 'PayloadTooLargeError', message: 'Payload too large' } };
    };
    const declared = Number(ctx.req?.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > ECOMMERCE_RAW_BODY_LIMIT) {
      ctx.req?.resume?.();
      return tooLarge();
    }

    let raw: Buffer;
    try {
      raw = await readAll(ctx.req, ECOMMERCE_RAW_BODY_LIMIT);
    } catch (err) {
      if (err instanceof PayloadTooLarge) return tooLarge();
      throw err;
    }
    ctx.state.ecommerceRawBody = raw;
    const replay = replayRequest(ctx.req, raw);
    ctx.req = replay;
    if (ctx.request) ctx.request.req = replay;
    return next();
  };
}
