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
  | 'STOCK_MOVED'
  | 'ORDER_CANCELLED'
  | 'ORDER_ARCHIVED';

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
        },
      });
    },
  };
};

export default EcommerceOrderHistoryService;
