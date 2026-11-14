import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { sendPdf } from './pdf';
import {
  MAX_KEY,
  asObject,
  toInt,
  fail,
  nonNegativeCents,
  objectList,
  optionalBoolean,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid invoice';
/** Most entries in each list of an invoice selection. */
const MAX_LIST = 200;

const EcommerceInvoiceController = ({ strapi }: { strapi: Core.Strapi }) => {
  const invoices = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceInvoiceService');
  const actorOf = (ctx: any): string => `user:${ctx.state?.user?.id}`;

  const run = async (
    ctx: any,
    fn: (id: number) => Promise<unknown>,
    opts: { status?: number; notFound?: string } = {}
  ) => {
    const id = toInt(ctx.params?.id);
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

  /** An array (absent → empty) of at most `MAX_LIST` entries. */
  const list = (path: string, v: unknown): unknown[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return fail(MSG, path, 'invalid');
    if (v.length > MAX_LIST) return fail(MSG, path, 'too_long');
    return v;
  };

  const ids = (path: string, v: unknown): number[] =>
    list(path, v).map((id, i) => positiveInt(MSG, `${path}.${i}`, id));

  return {
    selection: (ctx: any) =>
      run(ctx, (id) => invoices().selection(id), { notFound: 'Order not found' }),

    issue: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const b = asObject(ctx.request?.body);
          const input = {
            lines: list('lines', b.lines).map((raw, i) => {
              const l = asObject(raw);
              return {
                orderLineId: positiveInt(MSG, `lines.${i}.orderLineId`, l.orderLineId),
                quantity: positiveInt(MSG, `lines.${i}.quantity`, l.quantity),
              };
            }),
            shippingLineIds: ids('shippingLineIds', b.shippingLineIds),
            paymentIds: ids('paymentIds', b.paymentIds),
            expectedTotal: nonNegativeCents(MSG, 'expectedTotal', b.expectedTotal),
            idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
          };
          return invoices().issue(id, input, actorOf(ctx));
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
      const id = toInt(ctx.params?.id);
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
