import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError } from './errors';

/** Admin API for collections, their manual products and bulk product actions. */
const EcommerceCollectionController = ({ strapi }: { strapi: Core.Strapi }) => {
  const collections = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceCollectionService');
  const toId = (ctx: any) => Number(ctx.params.id);
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const productIds = (ctx: any) => ctx.request.body?.productIds;

  const labels = {
    collection: { invalid: 'Invalid collection', notFound: 'Collection not found' },
    bulk: { invalid: 'Invalid bulk action', notFound: 'Not found' },
  };

  /** Runs `work`; maps domain errors (400/404/409). */
  const run = async (ctx: any, work: () => Promise<void>, label: keyof typeof labels = 'collection') => {
    try {
      await work();
    } catch (err) {
      return handleDomainError(ctx, err, labels[label]);
    }
  };

  const members = (method: 'addProducts' | 'removeProducts' | 'reorderProducts') => (ctx: any) =>
    run(ctx, async () => {
      await collections()[method](toId(ctx), productIds(ctx));
      ctx.status = 204;
    });

  return {
    list: (ctx: any) =>
      run(ctx, async () => {
        const { page, search, locale } = ctx.query || {};
        ctx.body = await collections().list({ page: Number(page) || 1, search: text(search), locale: text(locale) });
      }),
    get: (ctx: any) =>
      run(ctx, async () => {
        ctx.body = await collections().get(toId(ctx));
      }),
    create: (ctx: any) =>
      run(ctx, async () => {
        const { id } = await collections().create(ctx.request.body);
        ctx.status = 201;
        ctx.body = { id };
      }),
    update: (ctx: any) =>
      run(ctx, async () => {
        await collections().update(toId(ctx), ctx.request.body);
        ctx.status = 204;
      }),
    delete: (ctx: any) =>
      run(ctx, async () => {
        await collections().delete(toId(ctx));
        ctx.status = 204;
      }),
    listProducts: (ctx: any) =>
      run(ctx, async () => {
        const { page, locale } = ctx.query || {};
        ctx.body = await collections().listProducts(toId(ctx), { page: Number(page) || 1, locale: text(locale) });
      }),
    addProducts: members('addProducts'),
    removeProducts: members('removeProducts'),
    reorderProducts: members('reorderProducts'),
    bulkProducts: (ctx: any) =>
      run(
        ctx,
        async () => {
          const body = ctx.request.body ?? {};
          ctx.body = await collections().bulkProducts({
            productIds: body.productIds,
            action: body.action,
            value: body.value,
          });
        },
        'bulk'
      ),
  };
};

export default EcommerceCollectionController;
