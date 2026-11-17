import { describe, it, expect, beforeEach } from 'vitest';
import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { createEditRunner } from '../../../server/src/services/modules/ecommerce/orderEditRunner';
import { setupCommerce, createOrder, UIDS, type Commerce } from './helpers/commerceSetup';

beforeEach(() => __resetEventHandlersForTests());

const actor = 'user:1';
const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

/**
 * Order 4500 (2 × 2000 + 500 shipping), paid in full, with a COMPLETED INVOICED refund of 500
 * as the refund service leaves it: the stored total already lowered to 4000.
 */
const adjustedOrder = async (amount = 500) => {
  const c = setupCommerce();
  const id = await createOrder(c);
  await c.payments.addManualPayment(id, { amount: 4500, idempotencyKey: 'pay-1' }, actor);
  c.tables[UIDS.refund].push({
    id: 700,
    order: id,
    payment: null,
    method: 'MANUAL_TRANSFER',
    kind: 'MONEY',
    status: 'COMPLETED',
    scope: 'INVOICED',
    amount,
    currency: 'EUR',
    reason: 'GOODWILL',
    idempotencyKey: 'inv-1',
    storeCredit: null,
    metadata: null,
  });
  orderRow(c, id).total = Math.max(0, 4500 - amount);
  await c.orders.recalculate(id, { actor });
  return { c, id };
};

describe('creditAdjustment (INVOICED refunds lower the order total)', () => {
  it('the order view exposes the adjustment; the order stays PAID', async () => {
    const { c, id } = await adjustedOrder();
    const view = await c.orders.get(id);
    expect(view.totals).toMatchObject({ creditAdjustment: 500, total: 4000 });
    expect(view.paymentStatus).toBe('PAID');
  });

  it('the view shows the adjustment as applied: never above the total before it', async () => {
    const { c, id } = await adjustedOrder(5000);
    const view = await c.orders.get(id);
    expect(view.totals).toMatchObject({ creditAdjustment: 4500, total: 0 });
  });

  it('an order edit that rewrites the totals keeps the adjustment', async () => {
    const { c, id } = await adjustedOrder();
    const runner = createEditRunner(c.strapi, {
      orders: () => c.orders,
      history: () => c.services.EcommerceOrderHistoryService,
      emit: async () => {},
    });
    await runner.runEdit(id, 'lines', 'op-adjust-0001', actor, {
      prepare: async () => null,
      write: async (state: any) => {
        await runner.writeTotals(state, {});
        return {
          outcome: 'NONE' as const,
          difference: 0,
          history: { type: 'LINES_CHANGED' as const, description: 'Test edit', previousValue: null, newValue: {} },
        };
      },
    });
    expect(orderRow(c, id).total).toBe(4000);
  });

  it('a return keeps the adjustment: 4500 − 2000 returned − 500 adjustment = 2000', async () => {
    const { c, id } = await adjustedOrder();
    const lineId = c.tables[UIDS.orderLine].find((l) => l.order === id).id as number;
    await c.services.EcommerceShipmentService.create(
      id,
      {
        lines: [{ orderLineId: lineId, quantity: 2 }],
        method: { mode: 'MANUAL', carrierName: 'CTT' },
        notifyCustomer: false,
        idempotencyKey: 's1',
      },
      actor
    );
    await c.services.EcommerceReturnService.register(
      id,
      { lines: [{ orderLineId: lineId, quantity: 1, restock: true }], reason: 'Damaged', idempotencyKey: 'r1' },
      actor
    );
    expect(orderRow(c, id).total).toBe(2000);
  });
});
