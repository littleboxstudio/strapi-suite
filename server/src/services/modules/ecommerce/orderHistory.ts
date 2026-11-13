import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

export type OrderHistoryType =
  | 'ORDER_CREATED'
  | 'ORDER_STATUS_CHANGED'
  | 'PAYMENT_STATUS_CHANGED'
  | 'FULFILLMENT_STATUS_CHANGED'
  | 'LINE_ADDED'
  | 'LINE_REMOVED'
  | 'LINE_QUANTITY_CHANGED'
  | 'ADDRESS_CHANGED'
  | 'SHIPPING_CHANGED'
  | 'ORDER_DISCOUNT_CHANGED'
  | 'ORDER_MODIFIED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_COMPLETED'
  | 'PAYMENT_INSTRUCTIONS_SENT'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELLED'
  | 'STOCK_MOVED'
  | 'ORDER_CANCELLED'
  | 'ORDER_ARCHIVED'
  | 'NOTIFICATION_SENT'
  | 'NOTIFICATION_FAILED'
  | 'SHIPMENT_CREATED'
  | 'SHIPMENT_FAILED'
  | 'SHIPMENT_CANCELLED'
  /** Cancelled at the carrier, but the shipment changed here meanwhile and stays as it was. */
  | 'SHIPMENT_CARRIER_CANCELLED'
  | 'SHIPMENT_DELIVERED'
  | 'SHIPMENT_TRACKING_UPDATED'
  | 'RETURN_REGISTERED'
  | 'INVOICE_ISSUED'
  | 'INVOICE_FAILED'
  | 'INVOICE_UNCERTAIN'
  | 'CREDIT_NOTE_ISSUED'
  | 'PROMOTIONS_APPLIED'
  | 'PROMOTIONS_RELEASED'
  // Order editing by section (plan 10). The older line/shipping/modification types above stay
  // for the rows already written.
  | 'LINES_CHANGED'
  | 'SHIPPING_RECALCULATED'
  | 'SHIPPING_LINE_EDITED'
  | 'SHIPPING_LINE_ADDED'
  | 'DISCOUNTS_RECALCULATED'
  | 'MANUAL_DISCOUNT_ADDED'
  | 'MANUAL_DISCOUNT_REMOVED'
  | 'REVIEW_FLAG_RAISED'
  | 'REVIEW_FLAG_CLEARED'
  | 'REVIEW_FLAG_DISMISSED';

export type OrderHistoryEntry = {
  orderId: number;
  type: OrderHistoryType | string;
  /** Human-readable English text. */
  description: string;
  previousValue?: object | null;
  newValue?: object | null;
  /** `user:<id>` | `system` | `storefront` | `webhook:<provider>` */
  actor: string;
  operationId?: string;
  /** Globally unique (DB index): makes a once-only entry, e.g. `modify:<operationId>`. */
  uniqueKey?: string;
};

/** Insert-only order history. Writes join the caller's transaction when there is one. */
const EcommerceOrderHistoryService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uid = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce.orderHistory;
  };

  // JSON columns only accept objects, arrays or null.
  const json = (v: unknown): object | null => (v && typeof v === 'object' ? (v as object) : null);

  return {
    async record(entry: OrderHistoryEntry): Promise<void> {
      await strapi.db.query(uid()).create({
        data: {
          order: entry.orderId,
          type: entry.type,
          description: entry.description,
          previousValue: json(entry.previousValue),
          newValue: json(entry.newValue),
          actor: entry.actor,
          operationId: entry.operationId ?? null,
          uniqueKey: entry.uniqueKey ?? null,
        },
      });
    },
  };
};

export default EcommerceOrderHistoryService;
