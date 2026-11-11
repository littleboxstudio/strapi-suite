import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { sendPdf } from './pdf';
import {
  MAX_KEY,
  asObject,
  fail,
  nonNegativeCents,
  objectList,
  optionalBoolean,
  requiredString,
} from './validation';

const MSG = 'Invalid invoice';

const toInt = (v: unknown): number => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);

const EcommerceInvoiceController = ({ strapi }: { strapi: Core.Strapi }) => {
  const invoices = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceInvoiceService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const run = async (
    ctx: any,
    fn: (id: number) => Promise<unknown>,
    opts: { status?: number; notFound?: string } = {}
  ) => {
    const id = Number(ctx.params?.id);
    if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
    try {
      const result = await fn(id);
      if (opts.status) ctx.status = opts.status;
      ctx.body = result;
    } catch (err) {
      return handleSharedDomainError(ctx, err, {
        invalid: MSG,
        notFound: opts.notFound ?? 'Invoice not found',
        withCode: true,
      });
    }
  };

  /** `{ scope: 'PAYMENT', paymentId } | { scope: 'TOTAL' }` → the service's scope. */
  const scopeOf = (scope: unknown, paymentId: unknown) => {
    if (scope === 'TOTAL') return { type: 'TOTAL' as const };
    if (scope === 'PAYMENT') {
      if (typeof paymentId !== 'number' || !Number.isInteger(paymentId) || paymentId < 1) {
        return fail(MSG, 'paymentId', 'invalid');
      }
      return { type: 'PAYMENT' as const, paymentId };
    }
    return fail(MSG, 'scope', 'invalid');
  };

  return {
    preview: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const q = asObject(ctx.query);
          const scope = scopeOf(q.scope, q.scope === 'PAYMENT' ? toInt(q.paymentId) : undefined);
          return invoices().preview(id, scope);
        },
        { notFound: 'Order not found' }
      ),

    issue: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const b = asObject(ctx.request?.body);
          const scope = scopeOf(b.scope, b.paymentId);
          const idempotencyKey = requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY);
          return invoices().issue(id, scope, { idempotencyKey }, actorOf(ctx));
        },
        { status: 201, notFound: 'Order not found' }
      ),

    reconcile: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const markFailed = optionalBoolean(MSG, 'markFailed', b.markFailed, false);
        return invoices().reconcile(id, { markFailed }, actorOf(ctx));
      }),

    pdf: async (ctx: any) => {
      const id = Number(ctx.params?.id);
      if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
      try {
        sendPdf(ctx, await invoices().getPdf(id));
      } catch (err) {
        return handleSharedDomainError(ctx, err, {
          invalid: MSG,
          notFound: 'Invoice not found',
          withCode: true,
        });
      }
    },

    creditNotePreview: (ctx: any) => run(ctx, (id) => invoices().creditNotePreview(id)),

    issueCreditNote: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const b = asObject(ctx.request?.body);
          const input = {
            lines: objectList(MSG, 'lines', b.lines).map((l, i) => {
              if (typeof l.index !== 'number' || !Number.isInteger(l.index) || l.index < 0) {
                return fail(MSG, `lines.${i}.index`, 'invalid');
              }
              return { index: l.index, value: nonNegativeCents(MSG, `lines.${i}.value`, l.value) };
            }),
            reason: requiredString(MSG, 'reason', b.reason, 500),
            idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
          };
          return invoices().issueCreditNote(id, input, actorOf(ctx));
        },
        { status: 201 }
      ),
  };
};

export default EcommerceInvoiceController;
