import { describe, it, expect } from 'vitest';
import {
  conditionsMet,
  eligibilityMet,
  unmetPromotions,
  type Condition,
  type ConditionGroup,
  type ConditionContext,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const A = { productIds: [], variantIds: [1] };
const B = { productIds: [], variantIds: [2] };
const C = { productIds: [], variantIds: [3] };
const line = (variantId: number, productId: number, unitPrice: number, quantity: number) => ({
  variantId,
  productId,
  unitPrice,
  quantity,
});
const ctx = (lines: ConditionContext['lines'], email: string | null = null): ConditionContext => ({
  lines,
  email,
});
const g = (operator: 'AND' | 'OR', children: ConditionGroup['children']): ConditionGroup => ({
  type: 'GROUP',
  operator,
  children,
});
const contains = (target = A): Condition => ({
  type: 'CART_CONTAINS',
  match: 'ANY',
  target,
});
const sub: Condition = { type: 'SUBTOTAL', operator: 'gte', value: 10000 };

describe('conditionsMet', () => {
  const tree = g('AND', [g('OR', [contains(A), contains(B)]), sub]);
  it('(A OR B) AND subtotal >= 10000', () => {
    expect(conditionsMet(tree, ctx([line(2, 20, 12000, 1)]))).toBe(true);
    expect(conditionsMet(tree, ctx([line(2, 20, 9000, 1)]))).toBe(false);
    expect(conditionsMet(tree, ctx([line(3, 30, 20000, 1)]))).toBe(false);
  });
  it('AND with email, subtotal and A', () => {
    const t = g('AND', [
      { type: 'EMAIL', operator: 'eq', value: 'cliente@exemplo.pt' },
      sub,
      contains(A),
    ]);
    expect(conditionsMet(t, ctx([line(1, 10, 10000, 1)], 'cliente@exemplo.pt'))).toBe(true);
    expect(conditionsMet(t, ctx([line(1, 10, 10000, 1)], 'outro@exemplo.pt'))).toBe(false);
  });
  it('empty group is true; empty nested group is true', () => {
    expect(conditionsMet(g('AND', []), ctx([]))).toBe(true);
    expect(conditionsMet(g('OR', []), ctx([]))).toBe(true);
    expect(conditionsMet(g('AND', [g('OR', [])]), ctx([]))).toBe(true);
  });
  it('unknown condition type is false and never throws', () => {
    const t = g('AND', [{ type: 'WHATEVER' } as unknown as Condition]);
    expect(conditionsMet(t, ctx([]))).toBe(false);
    expect(conditionsMet(g('OR', [{ type: 'WHATEVER' } as unknown as Condition, sub]), ctx([line(1, 1, 10000, 1)]))).toBe(true);
  });
  it('CART_CONTAINS ALL / NONE', () => {
    const all: Condition = { type: 'CART_CONTAINS', match: 'ALL', target: { productIds: [], variantIds: [1, 2] } };
    expect(conditionsMet(g('AND', [all]), ctx([line(1, 10, 100, 1)]))).toBe(false);
    expect(conditionsMet(g('AND', [all]), ctx([line(1, 10, 100, 1), line(2, 11, 100, 1)]))).toBe(true);
    const none: Condition = { type: 'CART_CONTAINS', match: 'NONE', target: C };
    expect(conditionsMet(g('AND', [none]), ctx([line(3, 30, 100, 1)]))).toBe(false);
    expect(conditionsMet(g('AND', [none]), ctx([line(1, 10, 100, 1)]))).toBe(true);
  });
  it('PRODUCT_QUANTITY sums matching lines', () => {
    const t = g('AND', [
      {
        type: 'PRODUCT_QUANTITY',
        target: { productIds: [], variantIds: [1, 2, 3] },
        operator: 'gte',
        value: 5,
      },
    ]);
    expect(conditionsMet(t, ctx([line(1, 10, 100, 2), line(3, 30, 100, 3)]))).toBe(true);
    const eq3 = g('AND', [{ type: 'PRODUCT_QUANTITY', target: A, operator: 'eq', value: 3 }]);
    expect(conditionsMet(eq3, ctx([line(1, 10, 100, 4)]))).toBe(false);
  });
  it('product target matches any variant of the product', () => {
    const t = g('AND', [
      { type: 'PRODUCT_QUANTITY', target: { productIds: [10], variantIds: [] }, operator: 'gte', value: 2 },
    ]);
    expect(conditionsMet(t, ctx([line(1, 10, 100, 1), line(9, 10, 100, 1)]))).toBe(true);
  });
  it('TOTAL_QUANTITY and DISTINCT_PRODUCTS', () => {
    const lines = [line(1, 10, 100, 2), line(2, 10, 100, 1)];
    expect(conditionsMet(g('AND', [{ type: 'TOTAL_QUANTITY', operator: 'eq', value: 3 }]), ctx(lines))).toBe(true);
    expect(conditionsMet(g('AND', [{ type: 'DISTINCT_PRODUCTS', operator: 'gte', value: 2 }]), ctx(lines))).toBe(false);
    expect(
      conditionsMet(g('AND', [{ type: 'DISTINCT_PRODUCTS', operator: 'gte', value: 2 }]), ctx([...lines, line(3, 30, 1, 1)]))
    ).toBe(true);
  });
  it('SUBTOTAL_BETWEEN is inclusive', () => {
    const t = g('AND', [{ type: 'SUBTOTAL_BETWEEN', min: 10000, max: 20000 }]);
    expect(conditionsMet(t, ctx([line(1, 1, 10000, 1)]))).toBe(true);
    expect(conditionsMet(t, ctx([line(1, 1, 10000, 2)]))).toBe(true);
    expect(conditionsMet(t, ctx([line(1, 1, 9999, 1)]))).toBe(false);
    expect(conditionsMet(t, ctx([line(1, 1, 20001, 1)]))).toBe(false);
  });
  it('EMAIL operators; null email is always false', () => {
    const e = (operator: 'eq' | 'neq' | 'contains' | 'not_contains', value: string) =>
      g('AND', [{ type: 'EMAIL', operator, value }]);
    expect(conditionsMet(e('contains', '@empresa.pt'), ctx([], null))).toBe(false);
    expect(conditionsMet(e('neq', 'a@b.pt'), ctx([], null))).toBe(false);
    expect(conditionsMet(e('not_contains', 'x'), ctx([], null))).toBe(false);
    expect(conditionsMet(e('contains', '@empresa.pt'), ctx([], ' Ana@Empresa.pt '))).toBe(true);
    expect(conditionsMet(e('not_contains', '@empresa.pt'), ctx([], 'ana@empresa.pt'))).toBe(false);
    expect(conditionsMet(e('neq', 'a@b.pt'), ctx([], 'c@b.pt'))).toBe(true);
  });
});

describe('eligibilityMet', () => {
  it('ALL is always true; EMAILS needs a listed normalized email', () => {
    expect(eligibilityMet({ mode: 'ALL' }, null)).toBe(true);
    const e = { mode: 'EMAILS' as const, emails: ['a@b.pt'] };
    expect(eligibilityMet(e, null)).toBe(false);
    expect(eligibilityMet(e, ' A@B.pt ')).toBe(true);
    expect(eligibilityMet(e, 'c@b.pt')).toBe(false);
  });
});

describe('unmetPromotions', () => {
  it('returns promotions whose minimum is no longer met', () => {
    const snap = (value: number) => ({
      eligibility: { mode: 'ALL' as const },
      conditions: g('AND', [{ type: 'SUBTOTAL', operator: 'gte', value }]),
    });
    const res = unmetPromotions(
      [
        { promotionId: 1, name: 'P1', snapshot: snap(10000) },
        { promotionId: 2, name: 'P2', snapshot: snap(5000) },
      ],
      ctx([line(1, 1, 6000, 1)])
    );
    expect(res).toEqual([{ promotionId: 1, name: 'P1' }]);
  });
  it('flags an ineligible email', () => {
    const res = unmetPromotions(
      [
        {
          promotionId: 3,
          name: 'P3',
          snapshot: { eligibility: { mode: 'EMAILS', emails: ['a@b.pt'] }, conditions: g('AND', []) },
        },
      ],
      ctx([], 'z@b.pt')
    );
    expect(res).toEqual([{ promotionId: 3, name: 'P3' }]);
  });
});
