import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isUniqueViolation } from './dbErrors';

export type StockMovementType =
  | 'ORDER_DEDUCT'
  | 'ORDER_RESTOCK'
  | 'CANCEL_RESTOCK'
  | 'RETURN_RESTOCK'
  | 'RETURN_NO_RESTOCK'
  | 'MANUAL_ADJUST';

export type StockMoveInput = {
  variantId: number;
  /** Signed: negative takes units out of stock, positive puts them back. */
  quantity: number;
  type: StockMovementType;
  /** Idempotency key: a second move with the same key changes nothing. */
  operationKey: string;
  orderId?: number;
  reason?: string;
  actor: string;
};

/** Movement types that count towards the units an order still holds. */
const ORDER_NET_TYPES: StockMovementType[] = [
  'ORDER_DEDUCT',
  'ORDER_RESTOCK',
  'CANCEL_RESTOCK',
  'RETURN_RESTOCK',
];

/**
 * The stock ledger: every change to a variant's stock is a movement row plus an atomic
 * `stock = stock + quantity` on the variant. Stock may go below zero.
 */
const EcommerceStockService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };

  const warnMissing = (input: StockMoveInput): void => {
    strapi.log?.warn?.(
      `[ecommerce] stock movement ${input.operationKey} recorded without stock change: variant ${input.variantId} no longer exists (order ${input.orderId ?? '-'})`
    );
  };

  const move = async (input: StockMoveInput): Promise<{ applied: boolean }> => {
    const u = uids();
    const movements = () => strapi.db.query(u.stockMovement);

    const existing = await movements().findOne({
      where: { operationKey: input.operationKey },
    });
    if (existing) return { applied: false };

    try {
      // Reuses the caller's transaction when there is one (Strapi nests by context).
      return await strapi.db.transaction(async ({ trx }: { trx: any }) => {
        // A variant deleted from its product (design: deletion is blocked only while OPEN
        // orders use it) must not block cancelling or modifying older orders: the movement is
        // still recorded, by id only, and there is no stock left to change.
        const variantExists = !!(await strapi.db
          .query(u.variant)
          .findOne({ where: { id: input.variantId }, select: ['id'] }));
        await movements().create({
          data: {
            variant: variantExists ? input.variantId : null,
            variantId: input.variantId,
            order: input.orderId ?? null,
            type: input.type,
            quantity: input.quantity,
            operationKey: input.operationKey,
            reason: input.reason ?? null,
            actor: input.actor,
          },
        });

        if (variantExists && input.type !== 'RETURN_NO_RESTOCK' && input.quantity !== 0) {
          const { tableName } = strapi.db.metadata.get(u.variant);
          const updated = await strapi.db
            .connection(tableName)
            .where({ id: input.variantId })
            .increment('stock', input.quantity)
            .transacting(trx);
          if (!updated) warnMissing(input);
        } else if (!variantExists) {
          warnMissing(input);
        }
        return { applied: true };
      });
    } catch (err) {
      // A concurrent move with the same key won the race: it is already applied.
      if (isUniqueViolation(err)) return { applied: false };
      throw err;
    }
  };

  return {
    move,

    /** Units of each variant the order still holds (deductions minus restocks). */
    async netDeductedForOrder(orderId: number): Promise<Map<number, number>> {
      const u = uids();
      const rows: { variantId: number; quantity: number; type: StockMovementType }[] =
        await strapi.db.query(u.stockMovement).findMany({
          where: { order: orderId, type: { $in: ORDER_NET_TYPES } },
        });
      const net = new Map<number, number>();
      for (const r of rows) {
        if (!ORDER_NET_TYPES.includes(r.type)) continue;
        net.set(r.variantId, (net.get(r.variantId) ?? 0) - (r.quantity ?? 0));
      }
      for (const [id, units] of net) if (units === 0) net.delete(id);
      return net;
    },

    /** Current stock per variant; unknown ids are absent. */
    async available(variantIds: number[]): Promise<Map<number, number>> {
      const out = new Map<number, number>();
      if (!variantIds.length) return out;
      const rows: { id: number; stock: number }[] = await strapi.db
        .query(uids().variant)
        .findMany({ where: { id: { $in: variantIds } }, select: ['id', 'stock'] });
      rows.forEach((r) => out.set(r.id, r.stock ?? 0));
      return out;
    },
  };
};

export default EcommerceStockService;
