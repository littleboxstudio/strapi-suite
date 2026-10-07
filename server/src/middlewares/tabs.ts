import type { Core } from '@strapi/strapi';
import { parseHandlerUid } from '../utils/tabs';
import { createContentTypeTabsGrouper } from '../utils/groupByContentTypeTabs';

export function createTabsMiddleware({ strapi }: { strapi: Core.Strapi }) {
  const groupByContentTypeTabs = createContentTypeTabsGrouper(strapi);

  return async (ctx: any, next: () => Promise<void>) => {
    await next();

    if (ctx.method !== 'GET' || ctx.status !== 200) return;
    const prefix: string = strapi.config.get('api.rest.prefix', '/api');
    if (!ctx.path?.startsWith(prefix)) return;
    const body = ctx.body;
    if (!body || typeof body !== 'object' || body.data == null) return;

    const uid = parseHandlerUid(ctx.state?.route?.handler);
    if (!uid) return;

    // The grouper never throws, so a valid response is never turned into a 500
    // (this middleware runs outside strapi::errors).
    const data = groupByContentTypeTabs(uid, body.data);
    if (data !== body.data) ctx.body = { ...body, data };
  };
}
