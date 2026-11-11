import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';

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

/** Unique-index violation across SQLite, PostgreSQL and MySQL/MariaDB drivers. */
const isUniqueViolation = (err: any): boolean => {
  const code = String(err?.code ?? '');
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code.startsWith('SQLITE_CONSTRAINT') ||
    /unique|duplicate/i.test(String(err?.message ?? ''))
  );
};

/**
 * The stock ledger: every change to a variant's stock is a movement row plus an atomic
 * `stock = stock + quantity` on the variant. Stock may go below zero.
 */
const EcommerceStockService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };

  const move = async (
    input: StockMoveInput,
    opts: { trx?: any } = {}
  ): Promise<{ applied: boolean }> => {
    const u = uids();
    const movements = () => strapi.db.query(u.stockMovement);

    const existing = await movements().findOne({
      where: { operationKey: input.operationKey },
    });
    if (existing) return { applied: false };

    try {
      // Reuses the caller's transaction when there is one (Strapi nests by context).
      return await strapi.db.transaction(async ({ trx }: { trx: any }) => {
        await movements().create({
          data: {
            variant: input.variantId,
            variantId: input.variantId,
            order: input.orderId ?? null,
            type: input.type,
            quantity: input.quantity,
            operationKey: input.operationKey,
            reason: input.reason ?? null,
            actor: input.actor,
          },
        });

        if (input.type !== 'RETURN_NO_RESTOCK' && input.quantity !== 0) {
          const { tableName } = strapi.db.metadata.get(u.variant);
          await strapi.db
            .connection(tableName)
            .where({ id: input.variantId })
            .increment('stock', input.quantity)
            .transacting(opts.trx ?? trx);
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
