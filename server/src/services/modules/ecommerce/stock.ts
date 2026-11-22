import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { isUniqueViolation } from './dbErrors';
import { EcommerceValidationError } from './errors';

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
  /**
   * A deduction that must find the units: the check and the deduction are one atomic update, and
   * a stock too low throws INSUFFICIENT_STOCK (rolling the caller's transaction back). Without it a
   * deduction may take stock below zero (admin edits).
   */
  requireStock?: boolean;
  /**
   * The caller re-evaluates the product's automated collections itself after its transaction
   * commits (the product save), so the move does not schedule a second sync.
   */
  skipCollectionSync?: boolean;
};

/**
 * Movement types that count towards the units an order still holds. A unit returned without
 * restock (damaged) is no longer held either, so a later cancel does not put it back.
 */
const ORDER_NET_TYPES: StockMovementType[] = [
  'ORDER_DEDUCT',
  'ORDER_RESTOCK',
  'CANCEL_RESTOCK',
  'RETURN_RESTOCK',
  'RETURN_NO_RESTOCK',
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

  /**
   * The variants' products are re-evaluated against the automated collections (an "inventory ≤ 0"
   * collection follows order stock changes). A failure is logged by error name only and never
   * undoes the stock move.
   */
  const syncCollections = async (variantIds: number[]): Promise<void> => {
    try {
      const rows: any[] = await strapi.db.query(uids().variant).findMany({
        where: { id: { $in: variantIds } },
        select: ['id'],
        populate: { product: { select: ['id'] } },
      });
      const productIds = [...new Set(rows.map((r) => r.product?.id).filter((id): id is number => !!id))];
      if (!productIds.length) return;
      const collections: { syncProducts(ids: number[]): Promise<unknown> } = strapi
        .plugin(PLUGIN_ID)
        .service('EcommerceCollectionService');
      await collections.syncProducts(productIds);
    } catch (e) {
      strapi.log?.warn?.(
        '[ecommerce] collection sync after a stock movement failed: ' + (e instanceof Error ? e.name : typeof e)
      );
    }
  };

  /** Variant ids whose collection sync waits for the commit of the transaction `trx`. */
  const pendingSync = new WeakMap<object, Set<number>>();

  /**
   * Inside a caller's transaction (order creation, cancel, edits, returns) the sync is deferred
   * until that transaction commits. Strapi's nested `transaction` reuses the outer trx without a
   * savepoint, so on Postgres any SQL error in the sync (e.g. a membership unique-key clash) would
   * abort the whole outer transaction even when caught: the order would fail and the stock move
   * roll back. After the commit the sync runs in its own transaction. All the moves of one
   * transaction share one sync (deduplicated). A rollback drops it.
   */
  const deferSync = (ctx: any, variantId: number) => {
    const key: object = ctx?.trx ?? ctx;
    let pending = pendingSync.get(key);
    if (pending) {
      pending.add(variantId);
      return;
    }
    pending = new Set([variantId]);
    pendingSync.set(key, pending);
    ctx.onRollback?.(() => pendingSync.delete(key));
    ctx.onCommit(() => {
      const ids = [...(pendingSync.get(key) ?? [])];
      pendingSync.delete(key);
      // Strapi runs commit callbacks without awaiting them; syncCollections never rejects.
      if (ids.length) void syncCollections(ids);
    });
  };

  const move = async (input: StockMoveInput): Promise<{ applied: boolean }> => {
    const nested = strapi.db.inTransaction?.() === true;
    const result = await applyMove(input, (ctx) => {
      if (!nested) return false;
      // Never inside the caller's transaction; without `onCommit` (not Strapi) there is no sync.
      if (!input.skipCollectionSync && typeof ctx?.onCommit === 'function') deferSync(ctx, input.variantId);
      return true;
    });
    // Not inside a caller's transaction: the move is committed, sync right away.
    if (result.applied && !result.deferred && !input.skipCollectionSync) await syncCollections([input.variantId]);
    return { applied: result.applied };
  };

  /** `schedule` runs inside the move's transaction once it succeeds; true when it deferred the sync. */
  const applyMove = async (
    input: StockMoveInput,
    schedule: (ctx: any) => boolean
  ): Promise<{ applied: boolean; deferred: boolean }> => {
    const u = uids();
    const movements = () => strapi.db.query(u.stockMovement);

    const existing = await movements().findOne({
      where: { operationKey: input.operationKey },
    });
    if (existing) return { applied: false, deferred: false };

    try {
      // Reuses the caller's transaction when there is one (Strapi nests by context).
      return await strapi.db.transaction(async (ctx: any) => {
        const { trx } = ctx;
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
          // Two orders racing for the last unit cannot both get it: the stock read before the
          // transaction is only a first check, this update is the guard.
          const guarded = input.requireStock === true && input.quantity < 0;
          let update = strapi.db.connection(tableName).where({ id: input.variantId });
          if (guarded) update = update.where('stock', '>=', -input.quantity);
          const updated = await update.increment('stock', input.quantity).transacting(trx);
          if (!updated && guarded) {
            // Rolls the caller's transaction back (the movement row included).
            throw new EcommerceValidationError('Insufficient stock', [
              { path: `stock.${input.variantId}`, code: 'INSUFFICIENT_STOCK', detail: String(input.variantId) },
            ]);
          }
          if (!updated) warnMissing(input);
        } else if (!variantExists) {
          warnMissing(input);
        }
        return { applied: true, deferred: schedule(ctx) };
      });
    } catch (err) {
      // A concurrent move with the same key won the race: it is already applied.
      if (isUniqueViolation(err)) return { applied: false, deferred: false };
      throw err;
    }
  };

  return {
    move,

    /** Units of each variant the order still holds (deductions minus restocks and returns). */
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
