import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from '../../../config';
import { handleDomainError as handleSharedDomainError } from './errors';
import { sendPdf } from './pdf';
import { MAX_PARCELS } from '../../../services/modules/ecommerce/shipments';
import { MAX_PICKUP_POINT_ID_LENGTH } from '../../../services/modules/ecommerce/domain/storefront/limits';
import {
  MAX_KEY,
  asObject,
  toInt,
  fail,
  lineQuantities,
  nullableString,
  optionalBoolean,
  optionalString,
  positiveInt,
  requiredString,
} from './validation';

const MSG = 'Invalid shipment';
/** Provider and service ids of a chosen delivery method. */
const MAX_METHOD_ID = 64;
/** Admin UI locale codes (`pt`, `en`, `pt-BR`, …). */
const MAX_LOCALE = 16;

const EcommerceShipmentController = ({ strapi }: { strapi: Core.Strapi }) => {
  const shipments = (): any => strapi.plugin(PLUGIN_ID).service('EcommerceShipmentService');
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
        notFound: opts.notFound ?? 'Shipment not found',
        withCode: true,
      });
    }
  };

  /** Carrier parcels: an integer 1–99. */
  const parcelsOf = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_PARCELS) {
      return fail(MSG, 'parcels', 'invalid');
    }
    return v;
  };

  const parseShipment = (b: Record<string, unknown>) => {
    const m = asObject(b.method);
    let method: any;
    if (m.mode === 'MANUAL') {
      const providerId = optionalString(MSG, 'method.providerId', m.providerId, MAX_METHOD_ID);
      const serviceId = optionalString(MSG, 'method.serviceId', m.serviceId, MAX_METHOD_ID);
      method = {
        mode: 'MANUAL',
        ...(providerId !== undefined ? { providerId } : {}),
        ...(serviceId !== undefined ? { serviceId } : {}),
        carrierName: requiredString(MSG, 'method.carrierName', m.carrierName, 120),
        trackingCode: optionalString(MSG, 'method.trackingCode', m.trackingCode, 255),
        trackingUrl: optionalString(MSG, 'method.trackingUrl', m.trackingUrl, 2000),
      };
    } else if (m.mode === 'CARRIER') {
      // The chosen carrier and service; none: the order's method.
      const providerId = optionalString(MSG, 'method.providerId', m.providerId, MAX_METHOD_ID);
      const serviceId = nullableString(MSG, 'method.serviceId', m.serviceId, MAX_METHOD_ID);
      method = {
        mode: 'CARRIER',
        ...(providerId !== undefined ? { providerId } : {}),
        ...(serviceId !== undefined ? { serviceId } : {}),
      };
    } else if (m.mode === 'STORE_PICKUP') {
      // The store; none: the order's. No tracking, no parcels, always notified.
      const pickupPointId = optionalString(
        MSG,
        'method.pickupPointId',
        m.pickupPointId,
        MAX_PICKUP_POINT_ID_LENGTH
      );
      method = { mode: 'STORE_PICKUP', ...(pickupPointId !== undefined ? { pickupPointId } : {}) };
    } else {
      return fail(MSG, 'method.mode', 'invalid');
    }
    return {
      lines: lineQuantities(MSG, b.lines, false),
      method,
      notifyCustomer: optionalBoolean(MSG, 'notifyCustomer', b.notifyCustomer, true),
      idempotencyKey: requiredString(MSG, 'idempotencyKey', b.idempotencyKey, MAX_KEY),
      ...(b.parcels !== undefined && method.mode !== 'STORE_PICKUP' ? { parcels: parcelsOf(b.parcels) } : {}),
    };
  };

  return {
    create: (ctx: any) =>
      run(ctx, (id) => shipments().create(id, parseShipment(asObject(ctx.request?.body)), actorOf(ctx)), {
        status: 201,
        notFound: 'Order not found',
      }),

    /** The delivery methods the ship modal offers, named in `?locale=` (the admin's UI locale). */
    shipMethods: (ctx: any) =>
      run(
        ctx,
        (id) => {
          const raw = ctx.query?.locale;
          const locale = typeof raw === 'string' && raw.trim() && raw.length <= MAX_LOCALE ? raw.trim() : undefined;
          return shipments().shipMethods(id, locale);
        },
        { notFound: 'Order not found' }
      ),

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

    markFailed: (ctx: any) => run(ctx, (id) => shipments().markFailed(id, actorOf(ctx))),

    cancel: (ctx: any) =>
      run(ctx, (id) => {
        const b = asObject(ctx.request?.body);
        const reason = optionalString(MSG, 'reason', b.reason, 500);
        return shipments().cancel(id, { reason }, actorOf(ctx));
      }),

    label: async (ctx: any) => {
      const id = toInt(ctx.params?.id);
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
