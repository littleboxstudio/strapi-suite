import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { EcommerceAccountsUnavailableError } from '../../../services/modules/ecommerce/errors';
import { handleDomainError as handleSharedDomainError } from './errors';

const EcommerceCustomerController = ({ strapi }: { strapi: Core.Strapi }) => {
  const customers = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceCustomerService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;
  const adminOf = (ctx: any): { userId: number } => ({ userId: ctx.state?.user?.id });
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  const handleDomainError = (ctx: any, err: unknown) =>
    handleSharedDomainError(ctx, err, { invalid: 'Invalid customer', notFound: 'Customer not found' });

  const run = async (ctx: any, fn: (id: number) => Promise<unknown>) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    try {
      ctx.body = await fn(id);
    } catch (err) {
      if (err instanceof EcommerceAccountsUnavailableError) {
        ctx.status = 503;
        ctx.body = { data: null, error: { status: 503, name: 'ServiceUnavailableError', message: 'Accounts unavailable' } };
        return;
      }
      return handleDomainError(ctx, err);
    }
  };

  return {
    async list(ctx: any) {
      const { page, search, accountType, blocked } = ctx.query || {};
      ctx.body = await customers().list({
        page: Number(page) || 1,
        search: str(search),
        accountType: str(accountType),
        blocked: blocked === 'true' || blocked === true ? true : blocked === 'false' || blocked === false ? false : undefined,
      });
    },
    get: (ctx: any) => run(ctx, (id) => customers().get(id)),
    /** The customer event log: 50 per page, newest first; `search` and `type` narrow it. */
    listEvents: (ctx: any) =>
      run(ctx, (id) => {
        const { page, search, type } = ctx.query || {};
        return strapi
          .plugin(PLUGIN_ID)
          .service('EcommerceCustomerEventService')
          .list(id, { page, search: str(search), type: str(type) });
      }),
    update: (ctx: any) =>
      run(ctx, (id) => customers().update(id, ctx.request?.body ?? {}, actorOf(ctx))),
    block: (ctx: any) =>
      run(ctx, (id) => {
        const note = ctx.request?.body?.note;
        return customers().block(id, { note: note === undefined ? undefined : note }, adminOf(ctx));
      }),
    unblock: (ctx: any) => run(ctx, (id) => customers().unblock(id, adminOf(ctx))),
    setPassword: (ctx: any) =>
      run(ctx, async (id) => {
        await customers().setPassword(id, { password: ctx.request?.body?.password }, adminOf(ctx));
        return { ok: true };
      }),
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
