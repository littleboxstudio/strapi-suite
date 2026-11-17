import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import {
  MAX_KEY,
  MAX_LONG,
  asObject,
  cents,
  fail,
  optionalString,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid refund';
const MAX_ITEMS = 200;

/** INVOICED (plan 15): the chosen elements, `{ invoiceId, index, quantity }` each. */
const refundItems = (v: unknown) => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return fail(MSG, 'items', 'invalid');
  if (v.length > MAX_ITEMS) return fail(MSG, 'items', 'too_long');
  return v.map((raw, i) => {
    const item = asObject(raw);
    const index = item.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) fail(MSG, `items.${i}.index`, 'invalid');
    return {
      invoiceId: positiveInt(MSG, `items.${i}.invoiceId`, item.invoiceId),
      index: index as number,
      quantity: positiveInt(MSG, `items.${i}.quantity`, item.quantity),
    };
  });
};

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
          const scope =
            b.scope === undefined || b.scope === null ? undefined : requiredString(MSG, 'scope', b.scope, 40);
          const invoiced = scope === 'INVOICED';
          const input = {
            method: requiredString(MSG, 'method', b.method, 40),
            scope,
            // INVOICED: the amount is the sum of the items (optional; the service checks it).
            amount:
              invoiced && (b.amount === undefined || b.amount === null)
                ? undefined
                : cents(MSG, 'amount', b.amount),
            ...(invoiced ? { items: refundItems(b.items) } : {}),
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

    remove: (ctx: any) => run(ctx, (id) => refunds().remove(id, actorOf(ctx))),

    markFailed: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const note = optionalString(MSG, 'note', b.note, MAX_LONG);
        return refunds().markFailed(id, actorOf(ctx), { note });
      }),
  };
};

export default EcommerceRefundController;
