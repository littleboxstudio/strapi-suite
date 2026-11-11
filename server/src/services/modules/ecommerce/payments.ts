import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceValidationError } from './errors';
import { isUniqueViolation } from './dbErrors';
import { MAX_MONEY_CENTS, computeCoverage, type OrderActionKey } from './domain/orders';
import { storeCreditUsable } from './domain/storeCredit';
import { normalizeStoreCreditCode, type ConsumeStoreCreditInput } from './storeCredits';
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

/**
 * Value-based coverage (design 4.4) of a payment of `amount` that becomes COMPLETED now,
 * after the order's already COMPLETED payments. `state` comes from `computeOrderState`.
 */
export const coverageFor = (state: OrderState, amount: number) =>
  computeCoverage(
    {
      lines: state.lines.map((l) => ({
        id: l.id,
        unitPrice: l.unitPrice,
        unitDiscount: l.unitDiscount,
        quantity: l.quantity,
        returnedQuantity: l.returnedQuantity,
        tax: l.tax,
      })),
      orderDiscount: num(state.order.orderDiscount),
      shippingTotal: num(state.order.shippingTotal),
      shippingTax: num(state.order.shippingTax),
    },
    state.payments.filter((p) => p.status === 'COMPLETED'),
    amount
  );

export type StoreCreditPaymentInput = {
  code: string;
  /** Required. A repeated key returns the stored payment without side effects. */
  idempotencyKey: string;
};

export type PaymentInstructionsInput =
  { mode: 'MANUAL'; instructions: string } | { mode: 'STRIPE' };

export const MAX_INSTRUCTIONS_LENGTH = 5000;

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
    lockOrder(orderId: number): Promise<void>;
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

    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > MAX_MONEY_CENTS
    ) {
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
        await orders().lockOrder(orderId);
        const state = await orders().computeOrderState(orderId);
        orders().assertAction(state, 'ADD_PAYMENT');

        const { order } = state;
        const coverage = coverageFor(state, amount);

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

  /**
   * Pays the order with a store credit: `min(due, balance)` as a COMPLETED `STORE_CREDIT`
   * payment (value coverage) and the matching conditional consumption, in one transaction. The
   * credit must belong to the order's snapshot e-mail; any refusal leaves the balance and the
   * payments untouched.
   */
  const addStoreCreditPayment = async (
    rawOrderId: number | string,
    input: StoreCreditPaymentInput,
    actor: string
  ): Promise<PaymentView> => {
    const orderId = Number(rawOrderId);
    const idempotencyKey = clean(input?.idempotencyKey);
    if (!idempotencyKey) {
      throw new EcommerceValidationError('Invalid payment', [
        { path: 'idempotencyKey', code: 'required' },
      ]);
    }
    const existing = await findByKey(orderId, idempotencyKey);
    if (existing) return existing;
    const code = normalizeStoreCreditCode(input?.code);
    if (!code) {
      throw new EcommerceValidationError('Invalid payment', [{ path: 'code', code: 'required' }]);
    }
    const storeCredits: { consume(i: ConsumeStoreCreditInput): Promise<unknown> } =
      service('EcommerceStoreCreditService');
    const refuse = (c: string) =>
      new EcommerceValidationError('Invalid payment', [{ path: 'code', code: c }]);

    const collector = events().collector();
    const operationId = randomUUID();
    try {
      const created = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        const state = await orders().computeOrderState(orderId);
        orders().assertAction(state, 'ADD_PAYMENT');
        const { order } = state;
        const email = String(order.customerSnapshot?.email ?? '');

        const credit = await strapi.db.query(uids().storeCredit).findOne({ where: { code } });
        if (!credit) throw refuse('STORE_CREDIT_NOT_FOUND');
        const usable = storeCreditUsable(
          {
            status: credit.status,
            balance: Number(credit.balance) || 0,
            expiresAt: credit.expiresAt ?? null,
            emailNormalized: credit.emailNormalized ?? '',
          },
          email,
          new Date()
        );
        if ('code' in usable) throw refuse(usable.code);
        const amount = Math.min(state.summary.due, Number(credit.balance) || 0);

        const payment = await strapi.db.query(uids().payment).create({
          data: {
            order: orderId,
            method: 'STORE_CREDIT',
            status: 'COMPLETED',
            amount,
            currency: 'EUR',
            reference: credit.code,
            externalId: null,
            idempotencyKey,
            coverage: coverageFor(state, amount),
            completedAt: new Date().toISOString(),
            actor,
            metadata: { storeCreditId: credit.id, code: credit.code },
          },
        });
        // Strict conditional decrement: a concurrent consumption makes this throw and roll back.
        await storeCredits.consume({
          code: credit.code,
          email,
          amount,
          orderId,
          paymentId: payment.id,
          operationKey: `consume:${payment.id}`,
          actor,
        });

        const value = {
          paymentId: payment.id,
          method: 'STORE_CREDIT',
          amount,
          storeCreditId: credit.id,
          code: credit.code,
        };
        await history().record({
          orderId,
          type: 'PAYMENT_CREATED',
          description: `Store credit payment of ${amount} cents registered`,
          previousValue: null,
          newValue: value,
          actor,
          operationId,
        });
        await history().record({
          orderId,
          type: 'PAYMENT_COMPLETED',
          description: `Store credit payment of ${amount} cents completed`,
          previousValue: null,
          newValue: value,
          actor,
          operationId,
        });
        await orders().recalculate(orderId, { actor, operationId });
        collector.emit({
          type: 'PAYMENT_COMPLETED',
          orderId,
          payload: {
            paymentId: payment.id,
            amount,
            method: 'STORE_CREDIT',
            reference: order.reference,
          },
        });
        return payment;
      });
      await collector.flush();
      return toPaymentView(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, idempotencyKey);
        if (winner) return winner;
      }
      throw err;
    }
  };

  /**
   * Sends the customer how to pay what is due: free-text manual instructions, or a Stripe
   * payment link. Only emits `PAYMENT_INSTRUCTIONS_SENT` (the notification goes out from it);
   * never settles anything.
   */
  const sendPaymentInstructions = async (
    rawOrderId: number | string,
    input: PaymentInstructionsInput,
    actor: string
  ): Promise<{ url?: string; expiresAt?: string }> => {
    const orderId = Number(rawOrderId);
    const mode = input?.mode;
    if (mode !== 'MANUAL' && mode !== 'STRIPE') {
      throw new EcommerceValidationError('Invalid payment instructions', [
        { path: 'mode', code: 'invalid' },
      ]);
    }
    let instructions: string | undefined;
    if (mode === 'MANUAL') {
      instructions = clean((input as { instructions?: unknown }).instructions);
      if (!instructions) {
        throw new EcommerceValidationError('Invalid payment instructions', [
          { path: 'instructions', code: 'required' },
        ]);
      }
      if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
        throw new EcommerceValidationError('Invalid payment instructions', [
          { path: 'instructions', code: 'too_long' },
        ]);
      }
    }

    const before = await orders().computeOrderState(orderId);
    orders().assertAction(before, 'SEND_PAYMENT_INSTRUCTIONS');
    const supplementary = before.payments.some((p) => p.status === 'COMPLETED');

    // Stripe calls happen outside any transaction (getOrCreatePaymentLink manages its own).
    let link: { url: string; expiresAt: string; amount: number } | null = null;
    if (mode === 'STRIPE') {
      const stripePayments: {
        getOrCreatePaymentLink(
          orderId: number,
          opts: { purpose: 'CHECKOUT' | 'SUPPLEMENTARY'; actor: string }
        ): Promise<{ url: string; expiresAt: string; amount: number }>;
      } = service('EcommerceStripePaymentService');
      link = await stripePayments.getOrCreatePaymentLink(orderId, {
        purpose: supplementary ? 'SUPPLEMENTARY' : 'CHECKOUT',
        actor,
      });
    }

    const collector = events().collector();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const state = await orders().computeOrderState(orderId);
      orders().assertAction(state, 'SEND_PAYMENT_INSTRUCTIONS');
      // The link's amount is what the customer is asked to pay.
      const amountDue = link ? link.amount : state.summary.due;
      const payload: Record<string, unknown> = { mode };
      if (instructions !== undefined) payload.instructions = instructions;
      if (link) {
        payload.url = link.url;
        payload.expiresAt = link.expiresAt;
      }
      payload.amountDue = amountDue;
      payload.supplementary = supplementary;

      await history().record({
        orderId,
        type: 'PAYMENT_INSTRUCTIONS_SENT',
        description:
          mode === 'STRIPE' ? 'Stripe payment link sent' : 'Manual payment instructions sent',
        previousValue: null,
        newValue: payload,
        actor,
      });
      collector.emit({ type: 'PAYMENT_INSTRUCTIONS_SENT', orderId, payload });
    });
    await collector.flush();
    return link ? { url: link.url, expiresAt: link.expiresAt } : {};
  };

  return { addManualPayment, addStoreCreditPayment, sendPaymentInstructions };
};

export default EcommercePaymentService;
