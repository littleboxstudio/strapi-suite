import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';

const EcommerceCustomerController = ({ strapi }: { strapi: Core.Strapi }) => {
  const customers = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceCustomerService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  const handleDomainError = (ctx: any, err: unknown) =>
    handleSharedDomainError(ctx, err, { invalid: 'Invalid customer', notFound: 'Customer not found' });

  const run = async (ctx: any, fn: (id: number) => Promise<unknown>) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    try {
      ctx.body = await fn(id);
    } catch (err) {
      return handleDomainError(ctx, err);
    }
  };

  return {
    async list(ctx: any) {
      const { page, search } = ctx.query || {};
      ctx.body = await customers().list({ page: Number(page) || 1, search: str(search) });
    },
    get: (ctx: any) => run(ctx, (id) => customers().get(id)),
    update: (ctx: any) =>
      run(ctx, (id) => customers().update(id, ctx.request?.body ?? {}, actorOf(ctx))),
    listOrders: (ctx: any) => {
      const { page, search } = ctx.query || {};
      return run(ctx, (id) =>
        customers().listOrders(id, { page: Number(page) || 1, search: str(search) })
      );
    },
    lastAddresses: (ctx: any) => run(ctx, async (id) => {
      // The service returns null for a customer without orders; the body must still be an object.
      return (await customers().lastOrderAddresses(id)) ?? { shippingAddress: null, billingAddress: null };
    }),
  };
};

export default EcommerceCustomerController;
