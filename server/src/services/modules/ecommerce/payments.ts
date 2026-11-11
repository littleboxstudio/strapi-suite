import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { computeCoverage, type OrderActionKey } from './domain/orders';
import type { OrderHistoryEntry } from './orderHistory';
import type { OrderState } from './orders';

export type ManualPaymentInput = {
  /** Integer cents > 0. May exceed the due amount: the excess becomes refundable. */
  amount: number;
  reference?: string;
  methodLabel?: string;
  /**
   * Required. A repeated key returns the stored payment without side effects, even when the
   * other fields (amount, reference, label) differ: the first request wins.
   */
  idempotencyKey: string;
};

export type PaymentView = {
  id: number;
  method: string;
  status: string;
  amount: number;
  reference: string | null;
  externalId: string | null;
  completedAt: string | null;
  createdAt: string | null;
  methodLabel: string | null;
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const toPaymentView = (p: any): PaymentView => ({
  id: p.id,
  method: p.method,
  status: p.status,
  amount: num(p.amount),
  reference: p.reference ?? null,
  externalId: p.externalId ?? null,
  completedAt: p.completedAt ?? null,
  createdAt: p.createdAt ?? null,
  methodLabel: p.metadata?.methodLabel ?? null,
});

const EcommercePaymentService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    computeOrderState(orderId: number): Promise<OrderState>;
    assertAction(state: OrderState, action: OrderActionKey): void;
    recalculate(orderId: number, opts: { actor?: string; operationId?: string }): Promise<unknown>;
  } => service('EcommerceOrderService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): { emit(e: any): void; flush(): Promise<void> } } =>
    service('EcommerceEventBus');

  const findByKey = async (orderId: number, key: string): Promise<PaymentView | null> => {
    const row = await strapi.db.query(uids().payment).findOne({
      where: { idempotencyKey: key },
      populate: { order: { select: ['id'] } },
    });
    if (!row) return null;
    const owner = row.order && typeof row.order === 'object' ? row.order.id : row.order;
    // A key reused on another order is a client bug, never a replay.
    if (owner !== undefined && owner !== null && Number(owner) !== Number(orderId)) {
      throw new EcommerceValidationError('Invalid payment', [
        { path: 'idempotencyKey', code: 'IDEMPOTENCY_KEY_CONFLICT' },
      ]);
    }
    return toPaymentView(row);
  };

  const addManualPayment = async (
    rawOrderId: number | string,
    input: ManualPaymentInput,
    actor: string
  ): Promise<PaymentView> => {
    // Route params arrive as strings.
    const orderId = Number(rawOrderId);
    const amount = input?.amount;
    const idempotencyKey = clean(input?.idempotencyKey);
    if (!idempotencyKey) {
      throw new EcommerceValidationError('Invalid payment', [
        { path: 'idempotencyKey', code: 'required' },
      ]);
    }

    // A replay (double click) returns the stored payment before any precondition: the first
    // request may already have settled the order and removed ADD_PAYMENT.
    const existing = await findByKey(orderId, idempotencyKey);
    if (existing) return existing;

    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new EcommerceValidationError('Invalid payment', [
        { path: 'amount', code: 'invalid_amount' },
      ]);
    }
    const reference = clean(input?.reference) || null;
    const methodLabel = clean(input?.methodLabel) || null;

    const collector = events().collector();
    const operationId = randomUUID();
    try {
      const created = await strapi.db.transaction(async () => {
        const state = await orders().computeOrderState(orderId);
        orders().assertAction(state, 'ADD_PAYMENT');

        const { order } = state;
        const coverage = computeCoverage(
          {
            lines: state.lines.map((l) => ({
              id: l.id,
              unitPrice: l.unitPrice,
              unitDiscount: l.unitDiscount,
              quantity: l.quantity,
              returnedQuantity: l.returnedQuantity,
              tax: l.tax,
            })),
            orderDiscount: num(order.orderDiscount),
            shippingTotal: num(order.shippingTotal),
            shippingTax: num(order.shippingTax),
          },
          state.payments.filter((p) => p.status === 'COMPLETED'),
          amount
        );

        const payment = await strapi.db.query(uids().payment).create({
          data: {
            order: orderId,
            method: 'MANUAL',
            status: 'COMPLETED',
            amount,
            currency: 'EUR',
            reference,
            externalId: null,
            idempotencyKey,
            coverage,
            completedAt: new Date().toISOString(),
            actor,
            metadata: { methodLabel },
          },
        });

        const label = methodLabel ? ` (${methodLabel})` : '';
        const value = { paymentId: payment.id, method: 'MANUAL', amount, reference, methodLabel };
        await history().record({
          orderId,
          type: 'PAYMENT_CREATED',
          description: `Manual payment${label} of ${amount} cents registered`,
          previousValue: null,
          newValue: value,
          actor,
          operationId,
        });
        await history().record({
          orderId,
          type: 'PAYMENT_COMPLETED',
          description: `Manual payment${label} of ${amount} cents completed`,
          previousValue: null,
          newValue: value,
          actor,
          operationId,
        });
        await orders().recalculate(orderId, { actor, operationId });

        collector.emit({
          type: 'PAYMENT_COMPLETED',
          orderId,
          payload: { paymentId: payment.id, amount, method: 'MANUAL', reference: order.reference },
        });
        return payment;
      });
      await collector.flush();
      return toPaymentView(created);
    } catch (err) {
      // A concurrent request with the same key committed first: that payment is the answer.
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, idempotencyKey);
        if (winner) return winner;
      }
      throw err;
    }
  };

  return { addManualPayment };
};

export default EcommercePaymentService;
