import { describe, it, expect, vi } from 'vitest';
import { setupCommerce, createOrder, UIDS, type Commerce } from './helpers/commerceSetup';
import { createEditRunner } from '../../../server/src/services/modules/ecommerce/orderEditRunner';
import { readReviewFlags } from '../../../server/src/services/modules/ecommerce/domain/orderEditing';
import type { EditKind } from '../../../server/src/services/modules/ecommerce/orderEditing';

const runnerOf = (c: Commerce) =>
  createEditRunner(c.strapi, {
    orders: () => c.orders,
    history: () => c.services.EcommerceOrderHistoryService,
    emit: async (type, event) => {
      const collector = c.bus.collector();
      collector.emit({ type, ...event });
      await collector.flush();
    },
  });

/** A test edit: raises SHIPPING_REVIEW and persists it; outcome NONE. */
const flagEdit = (runner: ReturnType<typeof runnerOf>) => {
  const write = vi.fn(async (state: any, _prepared: unknown, w: any) => {
    runner.assertEditable(state, 'ADD_PRODUCTS');
    const flags = await w.raise(
      readReviewFlags(state.order.reviewFlags),
      'SHIPPING_REVIEW',
      'PRODUCTS_CHANGED'
    );
    await runner.writeTotals(state, { reviewFlags: flags });
    return {
      outcome: 'NONE' as const,
      difference: 0,
      history: {
        type: 'LINES_CHANGED' as const,
        description: 'Test edit',
        previousValue: null,
        newValue: { test: true },
      },
    };
  });
  return { prepare: vi.fn(async () => null), write };
};

const run = (
  runner: ReturnType<typeof runnerOf>,
  orderId: number,
  operationId: string,
  kind: EditKind = 'lines',
  steps = flagEdit(runner)
) => runner.runEdit(orderId, kind, operationId, 'user:1', steps);

const issues = async (p: Promise<unknown>) => {
  const err: any = await p.catch((e) => e);
  return err?.errors ?? err;
};

const historyOf = (c: Commerce, orderId: number, type: string) =>
  c.tables[UIDS.orderHistory].filter((h) => h.order === orderId && h.type === type);

const orderRow = (c: Commerce, id: number) => c.tables[UIDS.order].find((o) => o.id === id);

describe('createEditRunner.runEdit', () => {
  it('applies an operationId once and replays its outcome', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const runner = runnerOf(c);
    const steps = flagEdit(runner);

    const first = await run(runner, id, 'op-edit-0001', 'lines', steps);
    const second = await run(runner, id, 'op-edit-0001', 'lines', steps);

    expect(first).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(second).toMatchObject({ outcome: 'NONE', difference: 0 });
    expect(second.order.id).toBe(id);
    expect(steps.write).toHaveBeenCalledTimes(1);
    expect(steps.prepare).toHaveBeenCalledTimes(1);

    const [main] = historyOf(c, id, 'LINES_CHANGED');
    expect(historyOf(c, id, 'LINES_CHANGED')).toHaveLength(1);
    expect(main).toMatchObject({
      uniqueKey: 'edit:op-edit-0001',
      operationId: 'op-edit-0001',
      actor: 'user:1',
    });
    expect(main.newValue).toEqual({
      test: true,
      kind: 'lines',
      operationId: 'op-edit-0001',
      outcome: 'NONE',
      difference: 0,
    });
    const raised = historyOf(c, id, 'REVIEW_FLAG_RAISED');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ operationId: 'op-edit-0001', actor: 'user:1' });
    expect(raised[0].newValue).toMatchObject({ code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED' });

    expect(readReviewFlags(orderRow(c, id).reviewFlags)).toEqual([
      expect.objectContaining({ code: 'SHIPPING_REVIEW', reason: 'PRODUCTS_CHANGED', actor: 'user:1' }),
    ]);
    expect(first.order.reviewFlags).toEqual([
      expect.objectContaining({ code: 'SHIPPING_REVIEW' }),
    ]);
    const modified = c.events.filter((e) => e.type === 'ORDER_MODIFIED');
    expect(modified).toHaveLength(1);
    expect(modified[0]).toMatchObject({
      orderId: id,
      payload: { kind: 'lines', outcome: 'NONE', difference: 0 },
    });
  });

  it('refuses an operationId reused for another edit kind or on another order', async () => {
    const c = setupCommerce();
    c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
    const id = await createOrder(c);
    const other = await createOrder(c);
    const runner = runnerOf(c);
    await run(runner, id, 'op-edit-0002');

    const steps = flagEdit(runner);
    expect(await issues(run(runner, id, 'op-edit-0002', 'address', steps))).toEqual([
      { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
    ]);
    expect(await issues(run(runner, other, 'op-edit-0002', 'lines', steps))).toEqual([
      { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
    ]);
    expect(steps.write).not.toHaveBeenCalled();
    expect(historyOf(c, other, 'LINES_CHANGED')).toEqual([]);
  });

  it('requires an operationId of 8 to 64 characters', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const runner = runnerOf(c);
    expect(await issues(run(runner, id, 'short'))).toEqual([
      { path: 'operationId', code: 'required' },
    ]);
    expect(await issues(run(runner, id, 'x'.repeat(65)))).toEqual([
      { path: 'operationId', code: 'required' },
    ]);
  });

  it('refuses a cancelled order with ORDER_NOT_EDITABLE (CANCELLED) and writes nothing', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    await c.orders.cancel(id, 'user:1');
    const runner = runnerOf(c);
    expect(await issues(run(runner, id, 'op-edit-0003'))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'CANCELLED' },
    ]);
    expect(historyOf(c, id, 'LINES_CHANGED')).toEqual([]);
    expect(historyOf(c, id, 'REVIEW_FLAG_RAISED')).toEqual([]);
  });

  it('refuses an order with a PENDING shipment with ORDER_NOT_EDITABLE (SHIPMENT_PENDING)', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.shipment].push({ id: 1, order: id, status: 'PENDING', items: { lines: [] }, shippingCost: 0 });
    const runner = runnerOf(c);
    expect(await issues(run(runner, id, 'op-edit-0004'))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE', detail: 'SHIPMENT_PENDING' },
    ]);
  });
});

describe('createEditRunner helpers', () => {
  it('assertEditable refuses an action that needs no shipment once one is ACTIVE', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    c.tables[UIDS.shipment].push({ id: 1, order: id, status: 'ACTIVE', items: { lines: [] }, shippingCost: 0 });
    const runner = runnerOf(c);
    const state = await c.orders.computeOrderState(id);
    expect(() => runner.assertEditable(state, 'ADD_PRODUCTS')).not.toThrow();
    let err: any;
    try {
      runner.assertEditable(state, 'EDIT_ADDRESS');
    } catch (e) {
      err = e;
    }
    expect(err?.errors).toEqual([{ path: 'order', code: 'ORDER_HAS_SHIPMENTS' }]);
  });

  it('writeTotals persists the read-through editing data of a legacy order', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    Object.assign(orderRow(c, id), {
      shippingLines: null,
      manualDiscounts: null,
      reviewFlags: null,
      orderDiscount: 300,
      total: 4200,
    });
    const runner = runnerOf(c);
    await run(runner, id, 'op-edit-0005');
    const row = orderRow(c, id);
    expect(row.shippingLines.lines).toEqual([
      expect.objectContaining({ id: 1, origin: 'CHECKOUT', amount: 500 }),
    ]);
    expect(row.manualDiscounts.items).toEqual([
      expect.objectContaining({ id: 1, kind: 'LEGACY', amount: 300 }),
    ]);
    expect(row).toMatchObject({ orderDiscount: 300, total: 4200, shippingTotal: 500 });
  });

  it('writeTotals refuses an order that is no longer OPEN', async () => {
    const c = setupCommerce();
    const id = await createOrder(c);
    const runner = runnerOf(c);
    const state = await c.orders.computeOrderState(id);
    orderRow(c, id).orderStatus = 'ARCHIVED';
    expect(await issues(runner.writeTotals(state, {}))).toEqual([
      { path: 'order', code: 'ORDER_NOT_EDITABLE' },
    ]);
  });

  it('outcomeOf follows the modification rule', () => {
    const c = setupCommerce();
    const { outcomeOf } = runnerOf(c);
    const s = (due: number, excess: number) => ({ due, excess }) as any;
    expect(outcomeOf(s(0, 0), s(100, 0))).toBe('DUE');
    expect(outcomeOf(s(0, 0), s(0, 100))).toBe('REFUNDABLE');
    expect(outcomeOf(s(0, 100), s(0, 100))).toBe('NONE');
    expect(outcomeOf(s(100, 0), s(50, 0))).toBe('NONE');
  });
});
