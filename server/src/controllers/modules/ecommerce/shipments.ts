import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { sendPdf } from './pdf';
import {
  MAX_KEY,
  asObject,
  fail,
  lineQuantities,
  nonNegativeCents,
  nullableString,
  optionalBoolean,
  optionalString,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid shipment';

const EcommerceShipmentController = ({ strapi }: { strapi: Core.Strapi }) => {
  const shipments = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceShipmentService');
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
        notFound: opts.notFound ?? 'Shipment not found',
        withCode: true,
      });
    }
  };

  const parseShipment = (b: Record<string, unknown>) => {
    const m = asObject(b.method);
    let method: any;
    if (m.mode === 'MANUAL') {
      method = {
        mode: 'MANUAL',
        carrierName: requiredString(MSG, 'method.carrierName', m.carrierName, 120),
        trackingCode: optionalString(MSG, 'method.trackingCode', m.trackingCode, 255),
        trackingUrl: optionalString(MSG, 'method.trackingUrl', m.trackingUrl, 2000),
      };
    } else if (m.mode === 'CARRIER') {
      method = { mode: 'CARRIER' };
    } else {
      return fail(MSG, 'method.mode', 'invalid');
    }
    return {
      lines: lineQuantities(MSG, b.lines, false),
      method,
      shippingCost: nonNegativeCents(MSG, 'shippingCost', b.shippingCost ?? 0),
      notifyCustomer: optionalBoolean(MSG, 'notifyCustomer', b.notifyCustomer, true),
      idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
    };
  };

  return {
    create: (ctx: any) =>
      run(ctx, (id) => shipments().create(id, parseShipment(asObject(ctx.request?.body)), actorOf(ctx)), {
        status: 201,
        notFound: 'Order not found',
      }),

    deliver: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const input = {
          deliveredAt: requiredString(MSG, 'deliveredAt', b.deliveredAt, 64),
          notifyCustomer: optionalBoolean(MSG, 'notifyCustomer', b.notifyCustomer, true),
        };
        return shipments().confirmDelivery(id, input, actorOf(ctx));
      }),

    updateTracking: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const input = {
          trackingCode: nullableString(MSG, 'trackingCode', b.trackingCode, 255),
          trackingUrl: nullableString(MSG, 'trackingUrl', b.trackingUrl, 2000),
        };
        return shipments().updateTracking(id, input, actorOf(ctx));
      }),

    refreshTracking: (ctx: any) => run(ctx, (id) => shipments().refreshTracking(id, actorOf(ctx))),

    retry: (ctx: any) => run(ctx, (id) => shipments().retry(id, actorOf(ctx))),

    cancel: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const reason = optionalString(MSG, 'reason', b.reason, 500);
        return shipments().cancel(id, { reason }, actorOf(ctx));
      }),

    label: async (ctx: any) => {
      const id = Number(ctx.params?.id);
      if (!Number.isInteger(id) || id < 1) return ctx.badRequest('Invalid id');
      try {
        sendPdf(ctx, await shipments().getLabel(id));
      } catch (err) {
        return handleSharedDomainError(ctx, err, {
          invalid: MSG,
          notFound: 'Shipment not found',
          withCode: true,
        });
      }
    },
  };
};

export default EcommerceShipmentController;
