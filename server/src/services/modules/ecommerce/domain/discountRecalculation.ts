/**
 * Recalculate discounts (plan 10, spec 7.1): classify the order's promotions and manual discounts
 * against today's promotions, and price a selection of them. Pure domain: no I/O. Money is
 * integer cents. Pricing reuses the checkout engine (`evaluatePromotions`, `applyCombination`).
 */
import type { ManualDiscount } from './manualDiscounts';
import type { ModificationTotals } from './orderModification';
import {
  computeTotals,
  financialSummary,
  type LineAmounts,
  type OrderTotals,
  type PaymentLike,
  type RefundLike,
} from './orders';
import {
  appliedPromotionOf,
  applyCombination,
  compatible,
  evaluatePromotions,
  type AppliedPromotion,
  type BenefitRef,
  type DiscountClass,
  type EvaluationLine,
  type PromotionCandidate,
  type PromotionDefinition,
  type PromotionEvaluation,
  type RejectionReason,
} from './promotions';

export type DiscountLine = LineAmounts & {
  id: number;
  variantId: number;
  productId: number;
  isGift: boolean;
  shipped: number;
  refs: BenefitRef[];
};

export type DiscountContext = {
  lines: DiscountLine[];
  applied: AppliedPromotion[];
  manual: ManualDiscount[];
  orderDiscount: number;
  /** Σ shipping lines. */
  shippingGross: number;
  shippingDiscount: number;
  email: string | null;
  codes: string[];
  candidates: PromotionCandidate[];
  now: Date;
  searchLimit: number;
  payments: PaymentLike[];
  refunds: RefundLike[];
};

export type DiscountRow = {
  /** `p:<promotionId>` | `m:<manualId>` */
  key: string;
  kind: 'APPLIED_VALID' | 'APPLIED_INVALID' | 'NEW' | 'MANUAL';
  promotionId: number | null;
  manualId: number | null;
  name: string;
  displayName: Record<string, string>;
  code: string | null;
  method: 'AUTOMATIC' | 'CODE' | 'MANUAL';
  classes: DiscountClass[];
  /** Stored amount (applied, manual); null for NEW. */
  currentAmount: number | null;
  /** Value under the priced selection (unselected: the value it would give). */
  amount: number;
  invalidReason: RejectionReason | 'NOT_FOUND' | null;
  /** Initial selection. */
  selected: boolean;
  locked: 'GIFT_SHIPPED' | null;
};

export type DiscountPricing = {
  /** Changed lines only. */
  lines: { id: number; unitDiscount: number; refs: BenefitRef[] }[];
  removedGiftLines: { id: number; variantId: number; quantity: number }[];
  applied: AppliedPromotion[];
  manual: ManualDiscount[];
  orderDiscount: number;
  shippingDiscount: number;
  before: ModificationTotals;
  after: ModificationTotals;
  conflicts: [string, string][];
  /** Promotion ids. */
  added: number[];
  removed: number[];
};

export type DiscountRecalculation = {
  rows: DiscountRow[];
  selection: string[];
  exhaustive: boolean;
} & DiscountPricing;

const promotionKey = (id: number) => `p:${id}`;
const manualKey = (id: number) => `m:${id}`;

const effective = (l: LineAmounts) => l.quantity - l.returnedQuantity;

const withMoney = (totals: OrderTotals, ctx: DiscountContext): ModificationTotals => {
  const s = financialSummary(totals.total, ctx.payments, ctx.refunds);
  return { ...totals, paid: s.paid, due: s.due, excess: s.excess };
};

/** The stored entry as a definition, for the stacking check of a kept-invalid promotion. */
const definitionOf = (a: AppliedPromotion): PromotionDefinition => ({
  id: a.promotionId,
  name: a.name,
  code: a.code,
  method: a.method,
  displayName: a.displayName,
  priority: a.snapshot.priority,
  eligibility: a.snapshot.eligibility,
  conditions: a.snapshot.conditions,
  benefits: a.benefits.map((b) => b.params),
  stacking: a.snapshot.stacking,
  perOrderLimit: a.snapshot.perOrderLimit,
  requireVerifiedEmail: false,
  version: a.version,
});

const sumOf = (values: number[] | undefined) => (values ?? []).reduce((s, v) => s + v, 0);

/** Refs of the same benefit merged, in order of appearance. */
const mergeRefs = (refs: BenefitRef[]): BenefitRef[] => {
  const out: BenefitRef[] = [];
  for (const r of refs) {
    const same = out.find(
      (o) => o.promotionId === r.promotionId && o.benefitIndex === r.benefitIndex
    );
    if (same) same.amount += r.amount;
    else out.push({ ...r });
  }
  return out;
};

const sameRefs = (a: BenefitRef[], b: BenefitRef[]) =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.promotionId === b[i].promotionId &&
      r.benefitIndex === b[i].benefitIndex &&
      r.amount === b[i].amount
  );

type Classified = {
  rows: DiscountRow[];
  evaluation: PromotionEvaluation;
  evaluationLines: { line: DiscountLine; input: EvaluationLine }[];
  candidates: Map<number, PromotionCandidate>;
  stored: Map<number, AppliedPromotion>;
  /** Per promotion id, the realised amount by benefit index on its kept gift lines. */
  giftAmounts: Map<number, number[]>;
};

const classify = (ctx: DiscountContext): Classified => {
  const evaluationLines = ctx.lines
    .filter((l) => !l.isGift && effective(l) > 0)
    .map((line) => ({
      line,
      input: {
        variantId: line.variantId,
        productId: line.productId,
        unitPrice: line.unitPrice,
        quantity: effective(line),
      },
    }));
  const evaluation = evaluatePromotions({
    lines: evaluationLines.map((e) => e.input),
    email: ctx.email,
    shipping: ctx.shippingGross,
    codes: ctx.codes,
    candidates: ctx.candidates,
    gifts: new Map(),
    now: ctx.now,
    searchLimit: ctx.searchLimit,
  });
  const candidates = new Map<number, PromotionCandidate>();
  for (const c of ctx.candidates) if (!candidates.has(c.id)) candidates.set(c.id, c);
  const stored = new Map<number, AppliedPromotion>();
  for (const a of ctx.applied) if (!stored.has(a.promotionId)) stored.set(a.promotionId, a);

  const giftAmounts = new Map<number, number[]>();
  const giftShipped = new Set<number>();
  for (const l of ctx.lines) {
    if (!l.isGift) continue;
    for (const r of l.refs) {
      if (l.shipped > 0) giftShipped.add(r.promotionId);
      if (effective(l) <= 0) continue;
      const amounts = giftAmounts.get(r.promotionId) ?? [];
      amounts[r.benefitIndex] = (amounts[r.benefitIndex] ?? 0) + r.amount;
      giftAmounts.set(r.promotionId, amounts);
    }
  }

  const eligible = new Set(evaluation.eligible);
  const rejected = new Map(evaluation.rejected.map((r) => [r.promotionId, r.reason]));
  const rows: DiscountRow[] = [];
  for (const a of stored.values()) {
    const valid = candidates.has(a.promotionId) && eligible.has(a.promotionId);
    rows.push({
      key: promotionKey(a.promotionId),
      kind: valid ? 'APPLIED_VALID' : 'APPLIED_INVALID',
      promotionId: a.promotionId,
      manualId: null,
      name: a.name,
      displayName: a.displayName,
      code: a.code,
      method: a.method,
      classes: a.classes,
      currentAmount: a.amount,
      amount: a.amount,
      // A candidate the evaluation did not consider (its code changed) reads as not found.
      invalidReason: valid
        ? null
        : (candidates.has(a.promotionId) && rejected.get(a.promotionId)) || 'NOT_FOUND',
      selected: true,
      locked: giftShipped.has(a.promotionId) ? 'GIFT_SHIPPED' : null,
    });
  }
  for (const a of evaluation.applied) {
    if (stored.has(a.promotionId)) continue;
    rows.push({
      key: promotionKey(a.promotionId),
      kind: 'NEW',
      promotionId: a.promotionId,
      manualId: null,
      name: a.name,
      displayName: a.displayName,
      code: a.code,
      method: a.method,
      classes: a.classes,
      currentAmount: null,
      amount: a.amount,
      invalidReason: null,
      selected: false,
      locked: null,
    });
  }
  for (const m of ctx.manual) {
    rows.push({
      key: manualKey(m.id),
      kind: 'MANUAL',
      promotionId: null,
      manualId: m.id,
      name: m.reason,
      displayName: {},
      code: null,
      method: 'MANUAL',
      classes: ['ORDER_DISCOUNT'],
      currentAmount: m.amount,
      amount: m.amount,
      invalidReason: null,
      selected: true,
      locked: null,
    });
  }
  return { rows, evaluation, evaluationLines, candidates, stored, giftAmounts };
};

/** Benefit amounts plus the kept gift amounts, by benefit index. */
const withGifts = (amounts: number[], gifts: number[] | undefined): number[] => {
  const out = [...amounts];
  (gifts ?? []).forEach((v, i) => {
    out[i] = (out[i] ?? 0) + (v ?? 0);
  });
  return out;
};

export function recalculateDiscounts(
  ctx: DiscountContext,
  selection?: string[]
): DiscountRecalculation {
  const { rows, evaluation, evaluationLines, candidates, stored, giftAmounts } = classify(ctx);

  const wanted = new Set(selection ?? rows.filter((r) => r.selected).map((r) => r.key));
  const isSelected = (r: DiscountRow) => r.locked !== null || wanted.has(r.key);
  const selectedRows = rows.filter(isSelected);
  const keptInvalid = new Set(
    selectedRows.filter((r) => r.kind === 'APPLIED_INVALID').map((r) => r.promotionId as number)
  );
  const priced = selectedRows
    .filter((r) => r.kind === 'APPLIED_VALID' || r.kind === 'NEW')
    .map((r) => candidates.get(r.promotionId as number) as PromotionCandidate);
  const pricedIds = new Set(priced.map((p) => p.id));
  const keptIds = new Set([...keptInvalid, ...pricedIds]);

  // Frozen lines keep their discount: they enter the combination at their net price, taking no
  // line-level benefit but counting in the order-level bases and the buy thresholds.
  const isFrozen = (l: DiscountLine) => l.refs.some((r) => keptInvalid.has(r.promotionId));
  const combination = applyCombination(priced, {
    lines: evaluationLines.map(({ line, input }) =>
      isFrozen(line)
        ? { ...input, unitPrice: line.unitPrice - line.unitDiscount, frozen: true }
        : input
    ),
    shipping: ctx.shippingGross,
    gifts: new Map(),
    giftChoices: {},
  });

  const lines: DiscountPricing['lines'] = [];
  const newDiscount = new Map<number, number>();
  let remainders = 0;
  evaluationLines.forEach(({ line }, index) => {
    if (isFrozen(line)) return;
    const groups = combination.lines.filter((l) => l.sourceIndex === index);
    const q = effective(line);
    const discount = groups.reduce((s, g) => s + g.unitDiscount * g.quantity, 0);
    const unitDiscount = Math.floor(discount / q);
    remainders += discount - unitDiscount * q;
    const refs = mergeRefs(groups.flatMap((g) => g.refs));
    newDiscount.set(line.id, unitDiscount);
    if (unitDiscount !== line.unitDiscount || !sameRefs(refs, line.refs))
      lines.push({ id: line.id, unitDiscount, refs });
  });

  const removedGiftLines: DiscountPricing['removedGiftLines'] = ctx.lines
    .filter(
      (l) =>
        l.isGift &&
        l.shipped === 0 &&
        effective(l) > 0 &&
        l.refs.some((r) => stored.has(r.promotionId) && !keptIds.has(r.promotionId))
    )
    .map((l) => ({ id: l.id, variantId: l.variantId, quantity: effective(l) }));
  const removedGiftIds = new Set(removedGiftLines.map((l) => l.id));

  const amountsOf = (id: number) =>
    withGifts(combination.benefitAmounts.get(id) ?? [], giftAmounts.get(id));
  const fresh = priced.map((p) => appliedPromotionOf(p, amountsOf(p.id)));
  const kept = [...keptInvalid].map((id) => stored.get(id) as AppliedPromotion);
  const applied = [...kept, ...fresh].sort(
    (a, b) => b.snapshot.priority - a.snapshot.priority || a.promotionId - b.promotionId
  );

  const keptAmount = (cls: DiscountClass) =>
    kept.reduce(
      (s, a) => s + a.benefits.filter((b) => b.class === cls).reduce((t, b) => t + b.amount, 0),
      0
    );
  const manual = ctx.manual.filter((m) => wanted.has(manualKey(m.id)));
  const storedOrderDiscount =
    combination.orderDiscount +
    keptAmount('ORDER_DISCOUNT') +
    manual.reduce((s, m) => s + m.amount, 0) +
    remainders;
  const shippingDiscount = Math.min(
    ctx.shippingGross,
    combination.shippingDiscount + keptAmount('SHIPPING_DISCOUNT')
  );

  const definitions = new Map<number, PromotionDefinition>([
    ...kept.map((a) => [a.promotionId, definitionOf(a)] as const),
    ...priced.map((p) => [p.id, p] as const),
  ]);
  const promotionRows = selectedRows.filter((r) => r.promotionId !== null);
  const conflicts: [string, string][] = [];
  promotionRows.forEach((a, i) => {
    for (const b of promotionRows.slice(i + 1)) {
      const da = definitions.get(a.promotionId as number) as PromotionDefinition;
      const db = definitions.get(b.promotionId as number) as PromotionDefinition;
      if (!compatible(da, db)) conflicts.push([a.key, b.key]);
    }
  });

  // Unselected promotion rows: the value they would give (evaluation, else alone).
  const evaluated = new Map(evaluation.applied.map((a) => [a.promotionId, a.amount]));
  const evaluationCtx = {
    lines: evaluationLines.map((e) => e.input),
    shipping: ctx.shippingGross,
    gifts: new Map(),
    giftChoices: {},
  };
  const wouldGive = (id: number) => {
    const alone =
      evaluated.get(id) ??
      sumOf(
        applyCombination(
          [candidates.get(id) as PromotionCandidate],
          evaluationCtx
        ).benefitAmounts.get(id)
      );
    return alone + sumOf(giftAmounts.get(id));
  };
  const finalRows = rows.map((r) => {
    const selected = isSelected(r);
    if (r.kind === 'MANUAL' || r.kind === 'APPLIED_INVALID') return { ...r, selected };
    const id = r.promotionId as number;
    return { ...r, selected, amount: selected ? sumOf(amountsOf(id)) : wouldGive(id) };
  });

  const stateFor = { shippingOriginal: ctx.shippingGross };
  const before = withMoney(
    computeTotals(ctx.lines, {
      ...stateFor,
      orderDiscount: ctx.orderDiscount,
      shippingDiscount: ctx.shippingDiscount,
    }),
    ctx
  );
  const afterLines = ctx.lines
    .filter((l) => !removedGiftIds.has(l.id))
    .map((l) => ({ ...l, unitDiscount: newDiscount.get(l.id) ?? l.unitDiscount }));
  const after = withMoney(
    computeTotals(afterLines, {
      ...stateFor,
      orderDiscount: storedOrderDiscount,
      shippingDiscount,
    }),
    ctx
  );
  // The value to persist: clamped to the new subtotal, as the totals read it.
  const orderDiscount = after.orderDiscount;

  return {
    rows: finalRows,
    selection: selectedRows.map((r) => r.key),
    exhaustive: evaluation.exhaustive,
    lines,
    removedGiftLines,
    applied,
    manual,
    orderDiscount,
    shippingDiscount,
    before,
    after,
    conflicts,
    added: selectedRows.filter((r) => r.kind === 'NEW').map((r) => r.promotionId as number),
    removed: [...stored.keys()].filter((id) => !keptIds.has(id)),
  };
}
