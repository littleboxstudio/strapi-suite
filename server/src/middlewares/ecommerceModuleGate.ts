import type { Core } from '@strapi/strapi';
import { ECOMMERCE_MODULE, LtbConfigs, PLUGIN_ID } from '../config';

/** The body Strapi gives a 404, so a disabled store looks like a route that does not exist. */
export const NOT_FOUND_BODY = {
  data: null,
  error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} },
};

/** True when the e-commerce module is on (its `active` setting row is `"true"`). */
export async function isEcommerceActive(strapi: Core.Strapi): Promise<boolean> {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const setting = await strapi.db.query(config.uuid.app.setting).findOne({
    where: { module: ECOMMERCE_MODULE, property: 'active' },
  });
  return setting?.value === 'true';
}

/**
 * True for every e-commerce endpoint: the admin routes (`/<plugin>/admin/ecommerce/...`) and the
 * content API (`<api prefix>/<plugin>/ecommerce/...`: storefront and Stripe webhook).
 */
export function isEcommercePath(path: string, apiPrefix: string): boolean {
  const api = `${String(apiPrefix).replace(/\/+$/, '')}/${PLUGIN_ID}/ecommerce`;
  const admin = `/${PLUGIN_ID}/admin/ecommerce`;
  return [api, admin].some((base) => path === base || path.startsWith(`${base}/`));
}

/**
 * Answers 404 to every e-commerce endpoint while the module is off, before authentication and
 * policies run, so a disabled store never reveals that its routes exist (no 401 / 403).
 *
 * Registered with `strapi.server.use` during the plugin's `register()`, so it runs before the
 * router (mounted in `bootstrap`). The routes keep `check-module-is-active` as a second guard.
 */
export function createEcommerceModuleGate({ strapi }: { strapi: Core.Strapi }) {
  return async (ctx: any, next: () => Promise<void>) => {
    const apiPrefix: string = strapi.config.get('api.rest.prefix', '/api');
    const path = String(ctx.path ?? '');
    if (!isEcommercePath(path, apiPrefix)) return next();
    if (await isEcommerceActive(strapi)) return next();
    ctx.req?.resume?.();
    ctx.status = 404;
    ctx.body = NOT_FOUND_BODY;
  };
}
