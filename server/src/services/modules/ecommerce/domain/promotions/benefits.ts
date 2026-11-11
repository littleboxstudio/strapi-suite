/**
 * Benefits of a fixed combination of promotions (no Strapi imports). Money is integer cents.
 *
 * Order of calculation (requirements 1.25 and 2.6): Buy X Get Y -> per-unit product discounts ->
 * subtotal -> order discounts (common base) -> shipping -> one shipping discount -> total.
 * Every split is exact: per-unit discounts are integers and Σ lines === the amounts reported.
 */
import { allocateProportionally } from '../orders';
import {
  percentOf,
  targetMatches,
  type Benefit,
  type EvaluationLine,
  type PromotionCandidate,
  type Reward,
} from './types';

export type GiftOption = {
  variantId: number;
  productId: number;
  unitPrice: number;
  /** Stock minus the cart units of this variant. */
  available: number;
  active: boolean;
};

export type BenefitRef = { promotionId: number; benefitIndex: number; amount: number };

export type PricedLine = {
  /** Cart line index; null for GIFT lines. */
  sourceIndex: number | null;
  variantId: number;
  productId: number;
  unitPrice: number;
  quantity: number;
  unitDiscount: number;
  isGift: boolean;
  refs: BenefitRef[];
};

export type CombinationResult = {
  lines: PricedLine[];
  /** Per promotion id, the realised amount of each benefit (by benefit index). */
  benefitAmounts: Map<number, number[]>;
  itemsOriginal: number;
  productDiscount: number;
  subtotal: number;
  orderDiscount: number;
  shippingOriginal: number | null;
  shippingDiscount: number;
  total: number;
};

export type CombinationContext = {
  lines: EvaluationLine[];
  shipping: number | null;
  gifts: Map<number, GiftOption>;
  giftChoices: Record<number, number>;
};

type Claim = { promotionId: number; benefitIndex: number; order: number; amount: number };

type Unit = {
  lineIndex: number;
  /** Position in the flattened unit list (line order, then unit order): the tie-breaker. */
  seq: number;
  price: number;
  variantId: number;
  productId: number;
  /** The single product benefit this unit received (requirement 2.7). */
  claim: Claim | null;
  /** Used as purchase by a Buy X Get Y: excluded from other Buy X Get Y only (requirement 2.12). */
  buyReserved: boolean;
};

type OrderedBenefit = {
  promotionId: number;
  benefitIndex: number;
  /** Position in processing order (priority desc, id asc, benefit index asc). */
  order: number;
  benefit: Benefit;
  perOrderLimit: number | null;
};

const orderBenefits = (promotions: PromotionCandidate[]): OrderedBenefit[] => {
  const sorted = [...promotions].sort((a, b) => b.priority - a.priority || a.id - b.id);
  const out: OrderedBenefit[] = [];
  for (const p of sorted) {
    p.benefits.forEach((benefit, benefitIndex) => {
      out.push({
        promotionId: p.id,
        benefitIndex,
        order: out.length,
        benefit,
        perOrderLimit: p.perOrderLimit,
      });
    });
  }
  return out;
};

const rewardPerUnit = (reward: Reward, price: number): number => {
  if (reward.kind === 'FREE') return price;
  if (reward.kind === 'PERCENT') return Math.min(percentOf(price, reward.percent), price);
  return Math.min(Math.max(reward.amount, 0), price);
};

const byPriceDesc = (a: Unit, b: Unit) => b.price - a.price || a.seq - b.seq;
const byPriceAsc = (a: Unit, b: Unit) => a.price - b.price || a.seq - b.seq;

type GiftAccumulator = Map<string, PricedLine>;

const applyBuyXGetY = (
  ob: OrderedBenefit,
  units: Unit[],
  ctx: CombinationContext,
  giftUsed: Map<number, number>,
  giftLines: GiftAccumulator
): number => {
  const benefit = ob.benefit;
  if (benefit.type !== 'BUY_X_GET_Y') return 0;
  const { buy, get, reward } = benefit;
  if (buy.quantity <= 0 || get.quantity <= 0) return 0;
  if (buy.minAmount !== null) {
    const buyValue = ctx.lines
      .filter((l) => targetMatches(buy.target, l))
      .reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    if (buyValue < buy.minAmount) return 0;
  }

  const giftLeft = (g: GiftOption) => g.available - (giftUsed.get(g.variantId) ?? 0);
  let gift: GiftOption | null = null;
  if (get.mode === 'GIFT') {
    const usable = (variantId: number | undefined): GiftOption | null => {
      if (variantId === undefined || !get.variantIds.includes(variantId)) return null;
      const g = ctx.gifts.get(variantId);
      return g && g.active && giftLeft(g) >= get.quantity ? g : null;
    };
    gift = usable(ctx.giftChoices[ob.promotionId]);
    for (const id of get.variantIds) {
      if (gift) break;
      gift = usable(id);
    }
    if (!gift) return 0;
  }

  let total = 0;
  let repetitions = 0;
  while (ob.perOrderLimit === null || repetitions < ob.perOrderLimit) {
    const buyUnits = units
      .filter((u) => !u.claim && !u.buyReserved && targetMatches(buy.target, u))
      .sort(byPriceDesc)
      .slice(0, buy.quantity);
    if (buyUnits.length < buy.quantity) break;

    if (get.mode === 'IN_CART') {
      const taken = new Set(buyUnits);
      const prizeUnits = units
        .filter((u) => !u.claim && !u.buyReserved && !taken.has(u) && targetMatches(get.target, u))
        .sort(byPriceAsc)
        .slice(0, get.quantity);
      if (prizeUnits.length < get.quantity) break;
      for (const u of buyUnits) u.buyReserved = true;
      for (const u of prizeUnits) {
        const amount = rewardPerUnit(reward, u.price);
        u.claim = {
          promotionId: ob.promotionId,
          benefitIndex: ob.benefitIndex,
          order: ob.order,
          amount,
        };
        total += amount;
      }
    } else {
      const g = gift as GiftOption;
      if (giftLeft(g) < get.quantity) break;
      for (const u of buyUnits) u.buyReserved = true;
      giftUsed.set(g.variantId, (giftUsed.get(g.variantId) ?? 0) + get.quantity);
      const unitDiscount = rewardPerUnit(reward, g.unitPrice);
      const key = `${ob.order}:${g.variantId}`;
      let gl = giftLines.get(key);
      if (!gl) {
        gl = {
          sourceIndex: null,
          variantId: g.variantId,
          productId: g.productId,
          unitPrice: g.unitPrice,
          quantity: 0,
          unitDiscount,
          isGift: true,
          refs: [{ promotionId: ob.promotionId, benefitIndex: ob.benefitIndex, amount: 0 }],
        };
        giftLines.set(key, gl);
      }
      gl.quantity += get.quantity;
      gl.refs[0].amount += unitDiscount * get.quantity;
      total += unitDiscount * get.quantity;
    }
    repetitions += 1;
  }
  return total;
};

type Rational = { num: number; den: number };
const greater = (a: Rational, b: Rational) => a.num * b.den > b.num * a.den;

/** Step 3: each still-unclaimed unit takes the product benefit worth most per unit. */
const applyUnitDiscounts = (benefits: OrderedBenefit[], units: Unit[], amounts: number[]): void => {
  type State = {
    ob: OrderedBenefit;
    quota: number;
    /** SET only: eligible units E. */
    eligible: number;
    won: Unit[];
  };
  const free = units.filter((u) => !u.claim);
  const states: State[] = benefits.map((ob) => {
    const b = ob.benefit as Extract<Benefit, { type: 'PRODUCT_PERCENT' | 'PRODUCT_FIXED' }>;
    const quota = b.maxQuantity ?? Number.POSITIVE_INFINITY;
    const matching = free.filter((u) => targetMatches(b.target, u)).length;
    return { ob, quota, eligible: Math.min(matching, quota), won: [] };
  });

  const valueFor = (s: State, u: Unit): Rational => {
    const b = s.ob.benefit;
    if (b.type === 'PRODUCT_PERCENT')
      return { num: Math.min(percentOf(u.price, b.percent), u.price), den: 1 };
    if (b.type === 'PRODUCT_FIXED' && b.per === 'UNIT')
      return { num: Math.min(Math.max(b.amount, 0), u.price), den: 1 };
    if (b.type === 'PRODUCT_FIXED')
      return { num: Math.max(b.amount, 0), den: Math.max(s.eligible, 1) };
    return { num: 0, den: 1 };
  };

  for (const u of [...free].sort(byPriceDesc)) {
    let best: State | null = null;
    let bestValue: Rational = { num: 0, den: 1 };
    for (const s of states) {
      const b = s.ob.benefit as Extract<Benefit, { type: 'PRODUCT_PERCENT' | 'PRODUCT_FIXED' }>;
      if (s.won.length >= s.quota || !targetMatches(b.target, u)) continue;
      const v = valueFor(s, u);
      if (greater(v, bestValue)) {
        best = s;
        bestValue = v;
      }
    }
    if (!best) continue;
    best.won.push(u);
    u.claim = {
      promotionId: best.ob.promotionId,
      benefitIndex: best.ob.benefitIndex,
      order: best.ob.order,
      amount:
        best.ob.benefit.type === 'PRODUCT_FIXED' && best.ob.benefit.per === 'SET'
          ? 0
          : bestValue.num,
    };
  }

  for (const s of states) {
    const b = s.ob.benefit;
    if (b.type === 'PRODUCT_FIXED' && b.per === 'SET' && s.won.length > 0) {
      const won = [...s.won].sort((x, y) => x.seq - y.seq);
      const prices = won.map((u) => u.price);
      const ceiling = prices.reduce((sum, p) => sum + p, 0);
      const realised = Math.min(Math.floor((b.amount * won.length) / s.eligible), ceiling);
      const parts = allocateProportionally(realised, prices);
      won.forEach((u, i) => {
        (u.claim as Claim).amount = parts[i];
      });
    }
    amounts[s.ob.order] = s.won.reduce((sum, u) => sum + (u.claim as Claim).amount, 0);
  }
};

/** Step 4: group each cart line's units by (unit discount, ref). */
const buildCartLines = (lines: EvaluationLine[], units: Unit[]): PricedLine[] => {
  const out: PricedLine[] = [];
  lines.forEach((line, lineIndex) => {
    const groups = new Map<string, { claim: Claim | null; quantity: number }>();
    for (const u of units) {
      if (u.lineIndex !== lineIndex) continue;
      const claim = u.claim && u.claim.amount > 0 ? u.claim : null;
      const key = claim ? `${claim.amount}:${claim.order}` : 'none';
      const g = groups.get(key);
      if (g) g.quantity += 1;
      else groups.set(key, { claim, quantity: 1 });
    }
    const sorted = [...groups.values()].sort((a, b) => {
      if (!a.claim) return -1;
      if (!b.claim) return 1;
      return a.claim.amount - b.claim.amount || a.claim.order - b.claim.order;
    });
    for (const g of sorted) {
      out.push({
        sourceIndex: lineIndex,
        variantId: line.variantId,
        productId: line.productId,
        unitPrice: line.unitPrice,
        quantity: g.quantity,
        unitDiscount: g.claim ? g.claim.amount : 0,
        isGift: false,
        refs: g.claim
          ? [
              {
                promotionId: g.claim.promotionId,
                benefitIndex: g.claim.benefitIndex,
                amount: g.claim.amount * g.quantity,
              },
            ]
          : [],
      });
    }
  });
  return out;
};

const shippingValue = (b: Benefit, shipping: number): number => {
  if (b.type === 'SHIPPING_FREE') return Math.min(shipping, b.maxAmount ?? shipping);
  if (b.type === 'SHIPPING_PERCENT') return Math.min(percentOf(shipping, b.percent), shipping);
  if (b.type === 'SHIPPING_FIXED') return Math.min(Math.max(b.amount, 0), shipping);
  return 0;
};

/**
 * Applies a fixed combination of promotions to the cart. It does not check conditions, stacking
 * or availability: the caller chooses the combination.
 */
export const applyCombination = (
  promotions: PromotionCandidate[],
  ctx: CombinationContext
): CombinationResult => {
  const ordered = orderBenefits(promotions);
  const amounts: number[] = ordered.map(() => 0);

  const units: Unit[] = [];
  ctx.lines.forEach((line, lineIndex) => {
    for (let i = 0; i < line.quantity; i += 1) {
      units.push({
        lineIndex,
        seq: units.length,
        price: line.unitPrice,
        variantId: line.variantId,
        productId: line.productId,
        claim: null,
        buyReserved: false,
      });
    }
  });

  // Step 2: Buy X Get Y.
  const giftUsed = new Map<number, number>();
  const giftLines: GiftAccumulator = new Map();
  for (const ob of ordered) {
    if (ob.benefit.type === 'BUY_X_GET_Y')
      amounts[ob.order] = applyBuyXGetY(ob, units, ctx, giftUsed, giftLines);
  }

  // Step 3: per-unit product discounts.
  applyUnitDiscounts(
    ordered.filter(
      (ob) => ob.benefit.type === 'PRODUCT_PERCENT' || ob.benefit.type === 'PRODUCT_FIXED'
    ),
    units,
    amounts
  );

  // Step 4: output lines.
  const lines = [...buildCartLines(ctx.lines, units), ...giftLines.values()];
  const itemsOriginal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const productDiscount = lines.reduce((s, l) => s + l.unitDiscount * l.quantity, 0);
  const subtotal = itemsOriginal - productDiscount;

  // Step 5: order discounts on a common base, capped cumulatively.
  let orderDiscount = 0;
  for (const ob of ordered) {
    const b = ob.benefit;
    let value = 0;
    if (b.type === 'ORDER_PERCENT') value = percentOf(subtotal, b.percent);
    else if (b.type === 'ORDER_FIXED') value = Math.max(b.amount, 0);
    else continue;
    const applied = Math.max(Math.min(value, subtotal - orderDiscount), 0);
    amounts[ob.order] = applied;
    orderDiscount += applied;
  }

  // Step 6: only the largest shipping discount.
  let shippingDiscount = 0;
  if (ctx.shipping !== null) {
    let best: OrderedBenefit | null = null;
    let bestValue = 0;
    for (const ob of ordered) {
      const v = shippingValue(ob.benefit, ctx.shipping);
      if (v > bestValue) {
        best = ob;
        bestValue = v;
      }
    }
    if (best) {
      amounts[best.order] = bestValue;
      shippingDiscount = bestValue;
    }
  }

  const benefitAmounts = new Map<number, number[]>();
  for (const p of promotions)
    benefitAmounts.set(
      p.id,
      p.benefits.map(() => 0)
    );
  for (const ob of ordered)
    (benefitAmounts.get(ob.promotionId) as number[])[ob.benefitIndex] = amounts[ob.order];

  return {
    lines,
    benefitAmounts,
    itemsOriginal,
    productDiscount,
    subtotal,
    orderDiscount,
    shippingOriginal: ctx.shipping,
    shippingDiscount,
    total: subtotal - orderDiscount + (ctx.shipping ?? 0) - shippingDiscount,
  };
};
