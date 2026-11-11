import { MAX_MONEY_CENTS, type FinancialSummary, type PaymentRecordStatus } from './orders';

export const refundableAmount = (summary: FinancialSummary, inFlightRefunds: number): number =>
  Math.max(0, summary.excess - inFlightRefunds);

const MONEY_HOLDING = ['PENDING', 'PROCESSING', 'COMPLETED'];

/**
 * Design 4.7: value paid by store credit is never given back as money. Money refunds
 * (MANUAL_TRANSFER, STRIPE) are capped by the completed payments other than STORE_CREDIT minus
 * the money refunds that hold part of them (in flight or completed).
 */
export const moneyCapacity = (
  payments: { method: string; status: string; amount: number }[],
  refunds: { kind: string; status: string; amount: number }[]
): number => {
  const received = payments
    .filter((p) => p.status === 'COMPLETED' && p.method !== 'STORE_CREDIT')
    .reduce((s, p) => s + p.amount, 0);
  const held = refunds
    .filter((r) => r.kind === 'MONEY' && MONEY_HOLDING.includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  return Math.max(0, received - held);
};

export type RefundSource = {
  paymentId: number;
  method: 'STRIPE' | 'MANUAL' | 'STORE_CREDIT';
  status: PaymentRecordStatus;
  amount: number;
  refundedOrInFlight: number;
  paymentIntentId: string | null;
  completedAt: string;
};

export type RefundAllocation = { paymentId: number; paymentIntentId: string; amount: number };

const stripeCapacity = (s: RefundSource): number =>
  s.method === 'STRIPE' && s.status === 'COMPLETED' && s.paymentIntentId
    ? Math.min(s.amount, Math.max(0, s.amount - s.refundedOrInFlight))
    : 0;

/** Allocates a Stripe refund newest payment first, capped per payment. Callers validate the amount first. */
export const allocateStripeRefund = (
  amount: number,
  sources: RefundSource[]
): { allocations: RefundAllocation[]; unallocated: number } => {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { allocations: [], unallocated: Math.max(0, Math.floor(amount) || 0) };
  }
  const ordered = sources
    .filter((s) => stripeCapacity(s) > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.completedAt) || 0;
      const tb = Date.parse(b.completedAt) || 0;
      if (ta !== tb) return tb - ta;
      return b.paymentId - a.paymentId;
    });
  const allocations: RefundAllocation[] = [];
  let remaining = amount;
  for (const s of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, stripeCapacity(s));
    allocations.push({ paymentId: s.paymentId, paymentIntentId: s.paymentIntentId as string, amount: take });
    remaining -= take;
  }
  return { allocations, unallocated: Math.max(0, remaining) };
};

export type RefundValidationIssue = { path: string; code: string };

export const validateRefundRequest = (
  input: { amount: number; method: string; reason: string | null | undefined },
  ctx: { refundable: number; stripeAvailable: number; moneyRefundable?: number }
): RefundValidationIssue[] => {
  const issues: RefundValidationIssue[] = [];
  const { amount } = input;
  const money = input.method === 'MANUAL_TRANSFER' || input.method === 'STRIPE';
  const moneyRefundable = ctx.moneyRefundable ?? Number.POSITIVE_INFINITY;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_MONEY_CENTS;
  let moneyExceeded = false;
  if (!validAmount) issues.push({ path: 'amount', code: 'invalid_amount' });
  else if (amount > ctx.refundable) issues.push({ path: 'amount', code: 'exceeds_refundable' });
  else if (money && amount > moneyRefundable) {
    moneyExceeded = true;
    issues.push({ path: 'amount', code: 'exceeds_money_refundable' });
  }
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    issues.push({ path: 'reason', code: 'required' });
  }
  if (
    input.method === 'STRIPE' &&
    validAmount &&
    (ctx.stripeAvailable <= 0 || (ctx.stripeAvailable < amount && !moneyExceeded))
  ) {
    issues.push({ path: 'method', code: 'stripe_unavailable' });
  }
  return issues;
};
