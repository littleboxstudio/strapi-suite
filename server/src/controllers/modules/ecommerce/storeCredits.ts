import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import {
  MAX_LONG,
  asObject,
  cents,
  optionalString,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid store credit';

/** Admin store credit endpoints. Admins see the code (they need it to give to the customer). */
const EcommerceStoreCreditController = ({ strapi }: { strapi: Core.Strapi }) => {
  const credits = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceStoreCreditService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const run = async (ctx: any, fn: () => Promise<unknown>, status?: number) => {
    try {
      const result = await fn();
      if (status) ctx.status = status;
      ctx.body = result;
    } catch (err) {
      return handleSharedDomainError(ctx, err, {
        invalid: MSG,
        notFound: 'Store credit not found',
        withCode: true,
      });
    }
  };

  const withId = (ctx: any, fn: (id: number) => Promise<unknown>, status?: number) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    return run(ctx, () => fn(id), status);
  };

  return {
    list: (ctx: any) => {
      const { page, search } = ctx.query || {};
      return run(ctx, async () =>
        credits().list({
          page: Number(page) || 1,
          search: typeof search === 'string' ? search.slice(0, 100) : undefined,
        })
      );
    },

    get: (ctx: any) => withId(ctx, (id) => credits().get(id)),

    listForCustomer: (ctx: any) => withId(ctx, (id) => credits().listForCustomer(id)),

    issue: (ctx: any) =>
      run(
        ctx,
        async () => {
          const b = asObject(ctx.request?.body);
          const key = requiredString(MSG, 'idempotencyKey', b.idempotencyKey);
          return credits().issue({
            customerId: positiveInt(MSG, 'customerId', b.customerId),
            amount: cents(MSG, 'amount', b.amount),
            expiresAt: optionalString(MSG, 'expiresAt', b.expiresAt, 64),
            conditions: optionalString(MSG, 'conditions', b.conditions, MAX_LONG),
            actor: actorOf(ctx),
            operationKey: `admin-issue:${key}`,
          });
        },
        201
      ),

    void: (ctx: any) => withId(ctx, (id) => credits().void(id, actorOf(ctx))),
  };
};

export default EcommerceStoreCreditController;
