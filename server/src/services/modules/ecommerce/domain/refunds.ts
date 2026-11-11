import { MAX_MONEY_CENTS, type FinancialSummary, type PaymentRecordStatus } from './orders';

export const refundableAmount = (summary: FinancialSummary, inFlightRefunds: number): number =>
  Math.max(0, summary.excess - inFlightRefunds);

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
    ? Math.max(0, s.amount - s.refundedOrInFlight)
    : 0;

/** Allocates a Stripe refund newest payment first, capped per payment. */
export const allocateStripeRefund = (
  amount: number,
  sources: RefundSource[]
): { allocations: RefundAllocation[]; unallocated: number } => {
  const ordered = sources
    .filter((s) => stripeCapacity(s) > 0)
    .sort((a, b) => {
      const ta = Date.parse(a.completedAt);
      const tb = Date.parse(b.completedAt);
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
  ctx: { refundable: number; stripeAvailable: number }
): RefundValidationIssue[] => {
  const issues: RefundValidationIssue[] = [];
  const { amount } = input;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_MONEY_CENTS;
  if (!validAmount) issues.push({ path: 'amount', code: 'invalid_amount' });
  else if (amount > ctx.refundable) issues.push({ path: 'amount', code: 'exceeds_refundable' });
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    issues.push({ path: 'reason', code: 'required' });
  }
  if (input.method === 'STRIPE' && validAmount && (ctx.stripeAvailable <= 0 || ctx.stripeAvailable < amount)) {
    issues.push({ path: 'method', code: 'stripe_unavailable' });
  }
  return issues;
};
