import { describe, it, expect } from 'vitest';
import {
  refundableAmount,
  allocateStripeRefund,
  validateRefundRequest,
  type RefundSource,
} from '../../../../server/src/services/modules/ecommerce/domain/refunds';

const summary = (excess: number) =>
  ({ orderTotal: 0, total: 0, paid: 0, pendingPayments: 0, refunded: 0, net: 0, due: 0, excess }) as any;

const src = (o: Partial<RefundSource> & { paymentId: number }): RefundSource => ({
  method: 'STRIPE',
  status: 'COMPLETED',
  amount: 2000,
  refundedOrInFlight: 0,
  paymentIntentId: `pi_${o.paymentId}`,
  completedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

describe('refundableAmount', () => {
  it('subtracts in-flight refunds from excess', () => {
    expect(refundableAmount(summary(5000), 1500)).toBe(3500);
  });
  it('never goes negative', () => {
    expect(refundableAmount(summary(1000), 3000)).toBe(0);
  });
});

describe('allocateStripeRefund', () => {
  it('allocates newest first (30 over 20+20)', () => {
    const r = allocateStripeRefund(3000, [
      src({ paymentId: 1, completedAt: '2026-01-01T00:00:00.000Z' }),
      src({ paymentId: 2, completedAt: '2026-01-02T00:00:00.000Z' }),
    ]);
    expect(r.allocations).toEqual([
      { paymentId: 2, paymentIntentId: 'pi_2', amount: 2000 },
      { paymentId: 1, paymentIntentId: 'pi_1', amount: 1000 },
    ]);
    expect(r.unallocated).toBe(0);
  });
  it('breaks completedAt ties by paymentId desc', () => {
    const r = allocateStripeRefund(500, [src({ paymentId: 1 }), src({ paymentId: 5 })]);
    expect(r.allocations.map((a) => a.paymentId)).toEqual([5]);
  });
  it('respects already refunded or in-flight amounts', () => {
    const r = allocateStripeRefund(1500, [
      src({ paymentId: 1 }),
      src({ paymentId: 2, refundedOrInFlight: 1500, completedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(r.allocations).toEqual([
      { paymentId: 2, paymentIntentId: 'pi_2', amount: 500 },
      { paymentId: 1, paymentIntentId: 'pi_1', amount: 1000 },
    ]);
  });
  it('ignores MANUAL, STORE_CREDIT, non-completed and intent-less payments', () => {
    const r = allocateStripeRefund(1000, [
      src({ paymentId: 1, method: 'MANUAL' }),
      src({ paymentId: 2, method: 'STORE_CREDIT' }),
      src({ paymentId: 3, status: 'PENDING' }),
      src({ paymentId: 4, paymentIntentId: null }),
    ]);
    expect(r.allocations).toEqual([]);
    expect(r.unallocated).toBe(1000);
  });
  it('treats an unparseable completedAt as 0 without throwing', () => {
    const r = allocateStripeRefund(500, [
      src({ paymentId: 1, completedAt: 'garbage' }),
      src({ paymentId: 2, completedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(r.allocations.map((a) => a.paymentId)).toEqual([2]);
  });
  it('guards invalid amounts', () => {
    expect(allocateStripeRefund(NaN, [src({ paymentId: 1 })])).toEqual({ allocations: [], unallocated: 0 });
    expect(allocateStripeRefund(-5, [src({ paymentId: 1 })])).toEqual({ allocations: [], unallocated: 0 });
    expect(allocateStripeRefund(10.5, [src({ paymentId: 1 })])).toEqual({ allocations: [], unallocated: 10 });
  });
  it('ignores sources with negative or over-full refundedOrInFlight', () => {
    const r = allocateStripeRefund(500, [
      src({ paymentId: 1, refundedOrInFlight: 5000 }),
      src({ paymentId: 2, refundedOrInFlight: -100, completedAt: '2025-01-01T00:00:00.000Z' }),
    ]);
    expect(r.allocations.map((a) => a.paymentId)).toEqual([2]);
    expect(r.allocations[0].amount).toBe(500);
  });
  it('reports the unallocated remainder', () => {
    const r = allocateStripeRefund(5000, [src({ paymentId: 1 })]);
    expect(r.unallocated).toBe(3000);
  });
});

describe('validateRefundRequest', () => {
  const ctx = { refundable: 5000, stripeAvailable: 3000 };
  const ok = { amount: 1000, method: 'STRIPE', reason: 'damaged' };
  it('accepts a valid request', () => {
    expect(validateRefundRequest(ok, ctx)).toEqual([]);
  });
  it.each([0, -1, 1.5, NaN, 1_000_000_001])('invalid_amount for %s', (amount) => {
    expect(validateRefundRequest({ ...ok, amount }, ctx)).toEqual([{ path: 'amount', code: 'invalid_amount' }]);
  });
  it('exceeds_refundable', () => {
    expect(validateRefundRequest({ ...ok, amount: 5001, method: 'MANUAL' }, ctx)).toEqual([
      { path: 'amount', code: 'exceeds_refundable' },
    ]);
  });
  it('required reason', () => {
    expect(validateRefundRequest({ ...ok, reason: '   ' }, ctx)).toEqual([{ path: 'reason', code: 'required' }]);
  });
  it('accepts stripeAvailable equal to the amount', () => {
    expect(validateRefundRequest(ok, { refundable: 5000, stripeAvailable: 1000 })).toEqual([]);
  });
  it('stripe_unavailable when no balance or not enough', () => {
    expect(validateRefundRequest({ ...ok, amount: 4000 }, ctx)).toEqual([
      { path: 'method', code: 'stripe_unavailable' },
    ]);
    expect(validateRefundRequest(ok, { refundable: 5000, stripeAvailable: 0 })).toEqual([
      { path: 'method', code: 'stripe_unavailable' },
    ]);
  });
});
