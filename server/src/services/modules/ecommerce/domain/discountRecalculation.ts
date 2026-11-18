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
  type GiftOption,
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
  /** Units held by ACTIVE or PENDING shipments: the line is frozen like a shipped one. */
  reserved?: number;
  refs: BenefitRef[];
  /** The manual discount percent (spec 4.1): the line is frozen at its net price. */
  manualDiscountPercent?: number | null;
  /** Units held by invoices: the line is frozen at its net price (never re-priced). */
  invoiced?: number;
};

/**
 * Frozen at its net price, taking no new line discount: a line with a manual percent (spec 4.1),
 * with invoiced units (an invoiced line is never modified), or with units held by a shipment,
 * ACTIVE or PENDING (its shipments reference its units: it is never split).
 */
const isManual = (l: DiscountLine) =>
  (l.manualDiscountPercent !== undefined && l.manualDiscountPercent !== null) ||
  (l.invoiced ?? 0) > 0 ||
  l.shipped > 0 ||
  (l.reserved ?? 0) > 0;

export type DiscountContext = {
  lines: DiscountLine[];
  applied: AppliedPromotion[];
  manual: ManualDiscount[];
  orderDiscount: number;
  /** Σ shipping lines. */
  shippingGross: number;
  shippingDiscount: number;
  /** What the order's INVOICED refunds take off its total (`invoicedRefundAdjustment`). */
  creditAdjustment?: number;
  email: string | null;
  codes: string[];
  candidates: PromotionCandidate[];
  now: Date;
  searchLimit: number;
  payments: PaymentLike[];
  refunds: RefundLike[];
  /**
   * Gift variants on offer (Create order's applicable promotions): a GIFT promotion is then priced
   * at its gift. Absent (the order detail): no gift is offered.
   */
  gifts?: Map<number, GiftOption>;
  /** Per promotion id, the chosen gift variant (with `gifts`). */
  giftChoices?: Record<number, number>;
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
  /**
   * Never unselected: `APPLIED` (an applied promotion or a manual discount: the recalculation
   * never removes a discount, it only adds new ones), `GIFT_SHIPPED` (its gift has shipped).
   */
  locked: 'APPLIED' | 'GIFT_SHIPPED' | null;
};

/** Part of a line at one unit discount (checkout's model: one priced line per unit discount). */
export type DiscountSplit = { quantity: number; unitDiscount: number; refs: BenefitRef[] };

export type DiscountLineChange = {
  id: number;
  unitDiscount: number;
  refs: BenefitRef[];
  /**
   * Several distinct unit discounts on the line, by unit discount ascending: the first stays on
   * the line (its `unitDiscount`/`refs`), each further one becomes a new line of the same variant.
   * Σ quantity = the line's effective units. Absent when the line keeps a single unit discount.
   */
  splits?: DiscountSplit[];
};

export type DiscountPricing = {
  /** Changed lines only. */
  lines: DiscountLineChange[];
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
      input: isManual(line)
        ? {
            variantId: line.variantId,
            productId: line.productId,
            unitPrice: line.unitPrice - line.unitDiscount,
            quantity: effective(line),
            frozen: true,
          }
        : {
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
    gifts: ctx.gifts ?? new Map(),
    giftChoices: ctx.giftChoices ?? {},
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
      locked: giftShipped.has(a.promotionId) ? 'GIFT_SHIPPED' : 'APPLIED',
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
      locked: 'APPLIED',
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
  // The applied promotions are kept as stored (never removed nor re-priced, valid or not): their
  // lines keep their discount, their order and shipping amounts stay. Only NEW ones are priced.
  const keptApplied = new Set(
    selectedRows
      .filter((r) => r.kind === 'APPLIED_VALID' || r.kind === 'APPLIED_INVALID')
      .map((r) => r.promotionId as number)
  );
  const priced = selectedRows
    .filter((r) => r.kind === 'NEW')
    .map((r) => candidates.get(r.promotionId as number) as PromotionCandidate);
  const pricedIds = new Set(priced.map((p) => p.id));
  const keptIds = new Set([...keptApplied, ...pricedIds]);

  // Frozen lines keep their discount: they enter the combination at their net price, taking no
  // line-level benefit but counting in the order-level bases and the buy thresholds. A line with
  // a manual percent is always frozen (its evaluation input already is).
  const isFrozen = (l: DiscountLine) =>
    isManual(l) || l.refs.some((r) => keptApplied.has(r.promotionId));
  const combination = applyCombination(priced, {
    lines: evaluationLines.map(({ line, input }) =>
      isFrozen(line)
        ? { ...input, unitPrice: line.unitPrice - line.unitDiscount, frozen: true }
        : input
    ),
    shipping: ctx.shippingGross,
    gifts: ctx.gifts ?? new Map(),
    giftChoices: ctx.giftChoices ?? {},
  });

  // Exact line discounts (no remainders): one part per distinct unit discount, as checkout does.
  const lines: DiscountPricing['lines'] = [];
  const newParts = new Map<number, DiscountSplit[]>();
  evaluationLines.forEach(({ line }, index) => {
    if (isFrozen(line)) return;
    const byDiscount = new Map<number, { quantity: number; refs: BenefitRef[] }>();
    for (const g of combination.lines) {
      if (g.sourceIndex !== index || g.quantity <= 0) continue;
      const part = byDiscount.get(g.unitDiscount) ?? { quantity: 0, refs: [] };
      part.quantity += g.quantity;
      part.refs.push(...g.refs);
      byDiscount.set(g.unitDiscount, part);
    }
    const parts: DiscountSplit[] = [...byDiscount]
      .sort(([a], [b]) => a - b)
      .map(([unitDiscount, p]) => ({
        quantity: p.quantity,
        unitDiscount,
        refs: mergeRefs(p.refs),
      }));
    if (!parts.length) parts.push({ quantity: effective(line), unitDiscount: 0, refs: [] });
    newParts.set(line.id, parts);
    const [first] = parts;
    if (parts.length > 1) {
      lines.push({
        id: line.id,
        unitDiscount: first.unitDiscount,
        refs: first.refs,
        splits: parts,
      });
    } else if (first.unitDiscount !== line.unitDiscount || !sameRefs(first.refs, line.refs)) {
      lines.push({ id: line.id, unitDiscount: first.unitDiscount, refs: first.refs });
    }
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
  const kept = [...keptApplied].map((id) => stored.get(id) as AppliedPromotion);
  const applied = [...kept, ...fresh].sort(
    (a, b) => b.snapshot.priority - a.snapshot.priority || a.promotionId - b.promotionId
  );

  const selectedKeys = new Set(selectedRows.map((r) => r.key));
  const manual = ctx.manual.filter((m) => selectedKeys.has(manualKey(m.id)));
  // Every applied promotion and manual discount is kept: the stored order and shipping discounts
  // stay, and only the new promotions add to them. No line remainder ever reaches it.
  const storedOrderDiscount = ctx.orderDiscount + combination.orderDiscount;
  const shippingDiscount = Math.min(
    ctx.shippingGross,
    ctx.shippingDiscount + combination.shippingDiscount
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
    gifts: ctx.gifts ?? new Map(),
    giftChoices: ctx.giftChoices ?? {},
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
    if (r.kind !== 'NEW') return { ...r, selected };
    const id = r.promotionId as number;
    return { ...r, selected, amount: selected ? sumOf(amountsOf(id)) : wouldGive(id) };
  });

  const stateFor = { shippingOriginal: ctx.shippingGross, creditAdjustment: ctx.creditAdjustment };
  const before = withMoney(
    computeTotals(ctx.lines, {
      ...stateFor,
      orderDiscount: ctx.orderDiscount,
      shippingDiscount: ctx.shippingDiscount,
    }),
    ctx
  );
  // A split line keeps its first part (and its returned units); each further part is a new line.
  const afterLines = ctx.lines
    .filter((l) => !removedGiftIds.has(l.id))
    .flatMap((l): LineAmounts[] => {
      const parts = newParts.get(l.id);
      if (!parts) return [l];
      const [first, ...rest] = parts;
      return [
        { ...l, quantity: first.quantity + l.returnedQuantity, unitDiscount: first.unitDiscount },
        ...rest.map((p) => ({
          ...l,
          quantity: p.quantity,
          returnedQuantity: 0,
          unitDiscount: p.unitDiscount,
        })),
      ];
    });
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
