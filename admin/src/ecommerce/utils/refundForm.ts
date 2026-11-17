import { MAX_MONEY_CENTS, formatAmountInput, formatCents, parseMoneyToCents } from './money';
import type {
  CreateRefundInput,
  FieldError,
  NotificationView,
  RefundLimits,
  RefundMethod,
  RefundPreview,
  RefundScope,
  StoreCredit,
} from '../orderTypes';

/** Refund reasons offered by the refund modal (stored as the code; translated on display). */
export const REFUND_REASONS = [
  'CANCELLATION',
  'PRODUCT_REMOVED',
  'QUANTITY_REDUCED',
  'UNAVAILABLE',
  'RETURN',
  'OTHER',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_METHODS: RefundMethod[] = ['MANUAL_TRANSFER', 'STORE_CREDIT', 'STRIPE'];

/** Mirrors the server limits (references/labels 255, free text 5000). */
export const MAX_SHORT_TEXT = 255;
export const MAX_LONG_TEXT = 5000;
export const STORE_CREDIT_VALIDITY_MONTHS = 12;

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `now` + `months` as a local `YYYY-MM-DD` (clamped to the month's last day: 31 Jan + 1 → 28 Feb). */
export function addMonthsDate(now: Date, months = STORE_CREDIT_VALIDITY_MONTHS): string {
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return toDateInput(target);
}

/** A `YYYY-MM-DD` date input as the ISO instant of the end of that local day; null when invalid. */
export function dateInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date.toISOString();
}

/** A future expiry date, or the `invalid_date` error. */
function futureDate(value: string, now: Date): string | null {
  const iso = dateInputToIso(value);
  return iso && Date.parse(iso) > now.getTime() ? iso : null;
}

const tooLong = (value: string, max: number) => value.trim().length > max;

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

export type RefundForm = {
  /** EXCESS (money paid above the total) or INVOICED (invoiced value, lowers the total). */
  scope: RefundScope;
  /** Decimal text in the admin's locale. */
  amount: string;
  reason: RefundReason | '';
  description: string;
  method: RefundMethod;
  /** MANUAL_TRANSFER: transfer reference. */
  reference: string;
  /** STORE_CREDIT: `YYYY-MM-DD`. */
  expiresAt: string;
  /** STORE_CREDIT. */
  conditions: string;
};

export type RefundDraft = Omit<CreateRefundInput, 'idempotencyKey'>;

/** Prefill of a refund opened from another action (e.g. "Refund now" after a return). */
export type RefundInitial = { reason: RefundReason; amount?: number };

export const REFUND_SCOPES: RefundScope[] = ['EXCESS', 'INVOICED'];

const NO_LIMITS: RefundLimits = { refundable: 0, moneyRefundable: 0, stripeRefundable: 0 };

/** The limits of `scope` (plan 15); an older server without `limits` only knows EXCESS (top level). */
export function scopeLimits(preview: RefundPreview, scope: RefundScope): RefundLimits {
  const limits = preview.limits?.[scope];
  if (limits) return limits;
  if (scope === 'INVOICED') return NO_LIMITS;
  return {
    refundable: preview.refundable,
    moneyRefundable: preview.moneyRefundable,
    stripeRefundable: preview.stripeRefundable,
  };
}

/** The preview as seen by one scope: its limits in place of the top-level (EXCESS) ones. */
export function previewForScope(preview: RefundPreview, scope: RefundScope): RefundPreview {
  return { ...preview, ...scopeLimits(preview, scope) };
}

/** The scopes with something to refund, EXCESS first. */
export function refundScopes(preview: RefundPreview): RefundScope[] {
  return REFUND_SCOPES.filter((scope) => scopeLimits(preview, scope).refundable > 0);
}

/** EXCESS when there is an excess, else INVOICED when there is invoiced value (else EXCESS). */
export function defaultRefundScope(preview: RefundPreview): RefundScope {
  return refundScopes(preview)[0] ?? 'EXCESS';
}

/** The default amount of a scope: its maximum, or the hand-off amount capped by it. */
function defaultAmount(p: RefundPreview, initial?: RefundInitial): number {
  if (initial?.amount === undefined) return p.refundable;
  const cap = p.moneyRefundable > 0 ? Math.min(p.moneyRefundable, p.refundable) : p.refundable;
  return Math.max(0, Math.min(initial.amount, cap));
}

/**
 * Another scope chosen: its maximum (or the hand-off amount capped by it); the method stays while
 * the new scope allows it, else the default one.
 */
export function switchRefundScope(
  form: RefundForm,
  preview: RefundPreview,
  scope: RefundScope,
  locale: string,
  initial?: RefundInitial
): RefundForm {
  const p = previewForScope(preview, scope);
  const allowed =
    form.method === 'STORE_CREDIT' ||
    (form.method === 'STRIPE' ? p.hasStripe && p.stripeRefundable > 0 : p.moneyRefundable > 0);
  return {
    ...form,
    scope,
    amount: formatAmountInput(defaultAmount(p, initial), locale),
    method: allowed ? form.method : p.moneyRefundable > 0 ? 'MANUAL_TRANSFER' : 'STORE_CREDIT',
  };
}

/**
 * Defaults: the scope (EXCESS when there is an excess, else INVOICED) and its maximum refundable, a manual transfer (store credit when nothing can go back as
 * money), a store credit valid for 12 months. `initial` sets the reason and an amount, capped by
 * the preview: by the money refundable when the default method returns money (store-credit-paid
 * orders), else by the refundable.
 */
export function emptyRefundForm(
  preview: RefundPreview,
  locale: string,
  now = new Date(),
  initial?: RefundInitial
): RefundForm {
  const scope = defaultRefundScope(preview);
  const p = previewForScope(preview, scope);
  return {
    scope,
    amount: formatAmountInput(defaultAmount(p, initial), locale),
    reason: initial?.reason ?? '',
    description: '',
    method: p.moneyRefundable > 0 ? 'MANUAL_TRANSFER' : 'STORE_CREDIT',
    reference: '',
    expiresAt: addMonthsDate(now),
    conditions: '',
  };
}

/**
 * Checks the refund form against the preview (requirement 15.5) and builds the request body
 * (without the idempotency key). Only the fields of the chosen method are sent.
 */
export function validateRefundForm(
  form: RefundForm,
  fullPreview: RefundPreview,
  now = new Date()
): { errors: FieldError[]; input: RefundDraft | null } {
  const errors: FieldError[] = [];
  const preview = previewForScope(fullPreview, form.scope ?? 'EXCESS');
  const cents = parseMoneyToCents(form.amount);
  const stripe = form.method === 'STRIPE';
  // Store-credit value never goes back as money (design 4.7).
  const money = stripe || form.method === 'MANUAL_TRANSFER';

  if (stripe && !preview.hasStripe) errors.push({ path: 'method', code: 'stripe_unavailable' });
  if (cents === null || cents <= 0 || cents > MAX_MONEY_CENTS) {
    errors.push({ path: 'amount', code: 'invalid_amount' });
  } else if (cents > preview.refundable) {
    errors.push({ path: 'amount', code: 'exceeds_refundable' });
  } else if (money && cents > preview.moneyRefundable) {
    errors.push({ path: 'amount', code: 'exceeds_money_refundable' });
  } else if (stripe && preview.hasStripe && cents > preview.stripeRefundable) {
    errors.push({ path: 'amount', code: 'exceeds_stripe_refundable' });
  }
  if (!REFUND_REASONS.includes(form.reason as RefundReason)) {
    errors.push({ path: 'reason', code: 'required' });
  }
  if (tooLong(form.description, MAX_LONG_TEXT)) errors.push({ path: 'description', code: 'too_long' });

  let expiresAt: string | null = null;
  if (form.method === 'MANUAL_TRANSFER' && tooLong(form.reference, MAX_SHORT_TEXT)) {
    errors.push({ path: 'reference', code: 'too_long' });
  }
  if (form.method === 'STORE_CREDIT') {
    expiresAt = futureDate(form.expiresAt, now);
    if (!expiresAt) errors.push({ path: 'expiresAt', code: 'invalid_date' });
    if (tooLong(form.conditions, MAX_LONG_TEXT)) errors.push({ path: 'conditions', code: 'too_long' });
  }

  if (errors.length) return { errors, input: null };

  const input: RefundDraft = { method: form.method, amount: cents as number, reason: form.reason };
  // EXCESS is the server's default: only INVOICED is sent.
  if (form.scope === 'INVOICED') input.scope = 'INVOICED';
  const description = form.description.trim();
  if (description) input.description = description;
  if (form.method === 'MANUAL_TRANSFER') {
    const reference = form.reference.trim();
    if (reference) input.reference = reference;
  }
  if (form.method === 'STORE_CREDIT') {
    input.expiresAt = expiresAt as string;
    const conditions = form.conditions.trim();
    if (conditions) input.conditions = conditions;
  }
  return { errors: [], input };
}

/**
 * A Stripe refund whose outcome is unknown (PROCESSING, never answered by Stripe): the admin can
 * resume it or mark it as failed.
 */
export function isStuckStripeRefund(r: { method: string; status: string; externalId: string | null }): boolean {
  return r.method === 'STRIPE' && r.status === 'PROCESSING' && !r.externalId;
}

/**
 * A Stripe refund Stripe has (PROCESSING with a Stripe id) whose final answer has not arrived:
 * the admin can read its status back from Stripe.
 */
export function isRefreshableStripeRefund(r: { method: string; status: string; externalId: string | null }): boolean {
  return r.method === 'STRIPE' && r.status === 'PROCESSING' && !!r.externalId;
}

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

/** Example manual instructions (requirement 10.9): reference and amount due, editable by the admin. */
export function defaultInstructionsText(
  t: (id: string, values?: Record<string, string | number>) => string,
  p: { reference: number; due: number; locale: string }
): string {
  return t('ecommerce.orders.instructions.defaultText', {
    reference: p.reference,
    amount: formatCents(p.due, p.locale),
  });
}

/**
 * The newest notification of one of `types` with an id above `afterId` (the e-mail an action
 * just queued), or null while it is not there yet.
 */
export function findNewNotification(
  list: NotificationView[],
  afterId: number,
  types: string[]
): NotificationView | null {
  return (
    list
      .filter((n) => n.id > afterId && types.includes(n.type))
      .sort((a, b) => b.id - a.id)[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Store credit
// ---------------------------------------------------------------------------

export type StoreCreditForm = { amount: string; expiresAt: string; conditions: string };

export function emptyStoreCreditForm(now = new Date()): StoreCreditForm {
  return { amount: '', expiresAt: addMonthsDate(now), conditions: '' };
}

export function validateStoreCreditForm(
  form: StoreCreditForm,
  now = new Date()
): { errors: FieldError[]; input: { amount: number; expiresAt: string; conditions?: string } | null } {
  const errors: FieldError[] = [];
  const cents = parseMoneyToCents(form.amount);
  if (cents === null || cents <= 0 || cents > MAX_MONEY_CENTS) {
    errors.push({ path: 'amount', code: 'invalid_amount' });
  }
  const expiresAt = futureDate(form.expiresAt, now);
  if (!expiresAt) errors.push({ path: 'expiresAt', code: 'invalid_date' });
  if (tooLong(form.conditions, MAX_LONG_TEXT)) errors.push({ path: 'conditions', code: 'too_long' });
  if (errors.length) return { errors, input: null };
  const conditions = form.conditions.trim();
  return {
    errors: [],
    input: { amount: cents as number, expiresAt: expiresAt as string, ...(conditions ? { conditions } : {}) },
  };
}

export type StoreCreditDisplayStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'VOID';

export function storeCreditDisplayStatus(
  credit: Pick<StoreCredit, 'status' | 'balance' | 'expiresAt'>,
  now = new Date()
): StoreCreditDisplayStatus {
  if (credit.status === 'VOID') return 'VOID';
  if (credit.expiresAt && Date.parse(credit.expiresAt) <= now.getTime()) return 'EXPIRED';
  if (credit.balance <= 0) return 'USED';
  return 'ACTIVE';
}

/** The edit form of a credit still valid: its total value, expiry date and conditions. */
export function storeCreditEditForm(
  credit: Pick<StoreCredit, 'initialAmount' | 'expiresAt' | 'conditions'>,
  locale: string
): StoreCreditForm {
  return {
    amount: formatAmountInput(credit.initialAmount, locale),
    expiresAt: credit.expiresAt ? toDateInput(new Date(credit.expiresAt)) : '',
    conditions: credit.conditions ?? '',
  };
}

/**
 * The edit form checked: as an issue, and the total never below what was already used
 * (`STORE_CREDIT_BELOW_USED`).
 */
export function validateStoreCreditEdit(
  form: StoreCreditForm,
  credit: Pick<StoreCredit, 'initialAmount' | 'balance'>,
  now = new Date()
): ReturnType<typeof validateStoreCreditForm> {
  const result = validateStoreCreditForm(form, now);
  const used = Math.max(0, credit.initialAmount - credit.balance);
  if (result.input && result.input.amount < used) {
    return { errors: [{ path: 'amount', code: 'STORE_CREDIT_BELOW_USED' }], input: null };
  }
  return result;
}
