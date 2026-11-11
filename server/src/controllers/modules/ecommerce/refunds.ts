import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import {
  MAX_KEY,
  MAX_LONG,
  asObject,
  cents,
  optionalString,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid refund';

const EcommerceRefundController = ({ strapi }: { strapi: Core.Strapi }) => {
  const refunds = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceRefundService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const run = async (ctx: any, fn: (id: number) => Promise<unknown>, status?: number) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    try {
      const result = await fn(id);
      if (status) ctx.status = status;
      ctx.body = result;
    } catch (err) {
      return handleSharedDomainError(ctx, err, {
        invalid: MSG,
        notFound: 'Refund not found',
        withCode: true,
      });
    }
  };

  return {
    preview: (ctx: any) => run(ctx, (id) => refunds().preview(id)),
    list: (ctx: any) => run(ctx, (id) => refunds().list(id)),

    create: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const b = asObject(ctx.request?.body);
          const input = {
            method: requiredString(MSG, 'method', b.method, 40),
            amount: cents(MSG, 'amount', b.amount),
            reason: requiredString(MSG, 'reason', b.reason),
            description: optionalString(MSG, 'description', b.description, MAX_LONG),
            reference: optionalString(MSG, 'reference', b.reference),
            expiresAt: optionalString(MSG, 'expiresAt', b.expiresAt, 64),
            conditions: optionalString(MSG, 'conditions', b.conditions, MAX_LONG),
            paymentId:
              b.paymentId === undefined || b.paymentId === null
                ? undefined
                : positiveInt(MSG, 'paymentId', b.paymentId),
            idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
          };
          return refunds().create(id, input, actorOf(ctx));
        },
        201
      ),

    resume: (ctx: any) => run(ctx, (id) => refunds().resume(id, actorOf(ctx))),

    refresh: (ctx: any) => run(ctx, (id) => refunds().refresh(id, actorOf(ctx))),

    markFailed: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const note = optionalString(MSG, 'note', b.note, MAX_LONG);
        return refunds().markFailed(id, actorOf(ctx), { note });
      }),
  };
};

export default EcommerceRefundController;
