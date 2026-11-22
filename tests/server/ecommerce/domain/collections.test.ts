import { describe, expect, it } from 'vitest';
import {
  COLLECTION_SORTS,
  MAX_COLLECTION_CONDITIONS,
  operatorsForField,
  parseConditions,
  productMatches,
  referencedIds,
  sortEntries,
  type CollectionCondition,
  type CollectionField,
  type CollectionOperator,
  type EvaluableProduct,
  type SortableEntry,
} from '../../../../server/src/services/modules/ecommerce/domain/collections';
import { subtreeIds, type CategoryNode } from '../../../../server/src/services/modules/ecommerce/domain/organization';

const product = (over: Partial<EvaluableProduct> = {}): EvaluableProduct => ({
  id: 1,
  active: true,
  names: ['Linen Shirt', 'Camisa de Linho'],
  vendor: 'Acme',
  categorySubtreeOf: (id) => id === 5,
  productTypeId: 7,
  tagIds: [3, 4],
  variants: [{ active: true, price: 2000, compareAtPrice: 2500, stock: 5 }],
  ...over,
});

const cond = (field: CollectionField, operator: CollectionOperator, value: string | number): CollectionCondition => ({
  field,
  operator,
  value,
});
const matches = (c: CollectionCondition, p = product()) => productMatches(p, [c], 'ALL');

describe('operatorsForField', () => {
  it('lists operators per field kind', () => {
    expect(operatorsForField('TITLE')).toEqual(['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with']);
    expect(operatorsForField('VENDOR')).toEqual(operatorsForField('TITLE'));
    for (const f of ['CATEGORY', 'PRODUCT_TYPE', 'TAG'] as const) expect(operatorsForField(f)).toEqual(['eq', 'neq']);
    for (const f of ['PRICE', 'COMPARE_AT_PRICE', 'INVENTORY'] as const)
      expect(operatorsForField(f)).toEqual(['eq', 'neq', 'gt', 'lt', 'gte', 'lte']);
  });
});

describe('productMatches', () => {
  it('TITLE operators (case-insensitive, any name)', () => {
    expect(matches(cond('TITLE', 'eq', 'LINEN shirt'))).toBe(true);
    expect(matches(cond('TITLE', 'eq', 'linen'))).toBe(false);
    expect(matches(cond('TITLE', 'neq', 'linen'))).toBe(true);
    expect(matches(cond('TITLE', 'neq', 'camisa de linho'))).toBe(false);
    expect(matches(cond('TITLE', 'contains', 'LINHO'))).toBe(true);
    expect(matches(cond('TITLE', 'contains', 'wool'))).toBe(false);
    expect(matches(cond('TITLE', 'not_contains', 'wool'))).toBe(true);
    expect(matches(cond('TITLE', 'not_contains', 'linho'))).toBe(false);
    expect(matches(cond('TITLE', 'starts_with', 'camisa'))).toBe(true);
    expect(matches(cond('TITLE', 'starts_with', 'shirt'))).toBe(false);
    expect(matches(cond('TITLE', 'ends_with', 'SHIRT'))).toBe(true);
    expect(matches(cond('TITLE', 'ends_with', 'linen'))).toBe(false);
  });

  it('VENDOR operators; null behaves as empty', () => {
    expect(matches(cond('VENDOR', 'eq', 'acme'))).toBe(true);
    expect(matches(cond('VENDOR', 'eq', 'other'))).toBe(false);
    expect(matches(cond('VENDOR', 'neq', 'other'))).toBe(true);
    expect(matches(cond('VENDOR', 'neq', 'ACME'))).toBe(false);
    expect(matches(cond('VENDOR', 'contains', 'cm'))).toBe(true);
    expect(matches(cond('VENDOR', 'contains', 'zz'))).toBe(false);
    expect(matches(cond('VENDOR', 'not_contains', 'zz'))).toBe(true);
    expect(matches(cond('VENDOR', 'not_contains', 'cm'))).toBe(false);
    expect(matches(cond('VENDOR', 'starts_with', 'ac'))).toBe(true);
    expect(matches(cond('VENDOR', 'starts_with', 'me'))).toBe(false);
    expect(matches(cond('VENDOR', 'ends_with', 'me'))).toBe(true);
    expect(matches(cond('VENDOR', 'ends_with', 'ac'))).toBe(false);
    const none = product({ vendor: null });
    expect(matches(cond('VENDOR', 'neq', 'acme'), none)).toBe(true);
    expect(matches(cond('VENDOR', 'contains', 'a'), none)).toBe(false);
    expect(matches(cond('VENDOR', 'not_contains', 'a'), none)).toBe(true);
  });

  it('CATEGORY / PRODUCT_TYPE / TAG eq and neq', () => {
    expect(matches(cond('CATEGORY', 'eq', 5))).toBe(true);
    expect(matches(cond('CATEGORY', 'eq', 6))).toBe(false);
    expect(matches(cond('CATEGORY', 'neq', 6))).toBe(true);
    expect(matches(cond('CATEGORY', 'neq', 5))).toBe(false);
    expect(matches(cond('PRODUCT_TYPE', 'eq', 7))).toBe(true);
    expect(matches(cond('PRODUCT_TYPE', 'eq', 8))).toBe(false);
    expect(matches(cond('PRODUCT_TYPE', 'neq', 8))).toBe(true);
    expect(matches(cond('PRODUCT_TYPE', 'neq', 7))).toBe(false);
    expect(matches(cond('TAG', 'eq', 3))).toBe(true);
    expect(matches(cond('TAG', 'eq', 9))).toBe(false);
    expect(matches(cond('TAG', 'neq', 9))).toBe(true);
    expect(matches(cond('TAG', 'neq', 3))).toBe(false);
    expect(matches(cond('PRODUCT_TYPE', 'neq', 7), product({ productTypeId: null }))).toBe(true);
  });

  it.each([
    ['PRICE', 2000],
    ['COMPARE_AT_PRICE', 2500],
    ['INVENTORY', 5],
  ] as const)('numeric field %s with every operator', (field, v) => {
    expect(matches(cond(field, 'eq', v))).toBe(true);
    expect(matches(cond(field, 'eq', v + 1))).toBe(false);
    expect(matches(cond(field, 'neq', v + 1))).toBe(true);
    expect(matches(cond(field, 'neq', v))).toBe(false);
    expect(matches(cond(field, 'gt', v - 1))).toBe(true);
    expect(matches(cond(field, 'gt', v))).toBe(false);
    expect(matches(cond(field, 'lt', v + 1))).toBe(true);
    expect(matches(cond(field, 'lt', v))).toBe(false);
    expect(matches(cond(field, 'gte', v))).toBe(true);
    expect(matches(cond(field, 'gte', v + 1))).toBe(false);
    expect(matches(cond(field, 'lte', v))).toBe(true);
    expect(matches(cond(field, 'lte', v - 1))).toBe(false);
  });

  it('COMPARE_AT_PRICE null never matches', () => {
    const p = product({ variants: [{ active: true, price: 2000, compareAtPrice: null, stock: 1 }] });
    expect(matches(cond('COMPARE_AT_PRICE', 'lt', 99999), p)).toBe(false);
    expect(matches(cond('COMPARE_AT_PRICE', 'neq', 1), p)).toBe(false);
  });

  it('numeric fields match when at least one active variant matches', () => {
    const p = product({
      variants: [
        { active: true, price: 5000, compareAtPrice: null, stock: 0 },
        { active: true, price: 1000, compareAtPrice: null, stock: 9 },
      ],
    });
    expect(matches(cond('PRICE', 'lt', 2000), p)).toBe(true);
    expect(matches(cond('INVENTORY', 'lte', 0), p)).toBe(true);
    expect(matches(cond('PRICE', 'gt', 6000), p)).toBe(false);
  });

  it('Review focus 1: a product whose only matching variant is inactive does not match', () => {
    const p = product({
      variants: [
        { active: true, price: 5000, compareAtPrice: null, stock: 3 },
        { active: false, price: 1000, compareAtPrice: null, stock: 0 },
      ],
    });
    expect(matches(cond('PRICE', 'lt', 2000), p)).toBe(false);
    expect(matches(cond('INVENTORY', 'lte', 0), p)).toBe(false);
  });

  it('inactive products and products without active variants never match', () => {
    expect(matches(cond('TITLE', 'contains', 'linen'), product({ active: false }))).toBe(false);
    expect(matches(cond('TITLE', 'contains', 'linen'), product({ variants: [] }))).toBe(false);
    expect(
      matches(
        cond('TITLE', 'contains', 'linen'),
        product({ variants: [{ active: false, price: 1, compareAtPrice: null, stock: 1 }] }),
      ),
    ).toBe(false);
  });

  it('ALL vs ANY', () => {
    const yes = cond('TITLE', 'contains', 'linen');
    const no = cond('VENDOR', 'eq', 'other');
    expect(productMatches(product(), [yes, no], 'ALL')).toBe(false);
    expect(productMatches(product(), [yes, no], 'ANY')).toBe(true);
    expect(productMatches(product(), [yes, yes], 'ALL')).toBe(true);
    expect(productMatches(product(), [no, no], 'ANY')).toBe(false);
  });

  it('Review focus 3: CATEGORY eq includes a depth-4 descendant', () => {
    const nodes: CategoryNode[] = [
      { id: 1, parentId: null, position: 0 },
      { id: 2, parentId: 1, position: 0 },
      { id: 3, parentId: 2, position: 0 },
      { id: 4, parentId: 3, position: 0 },
    ];
    const inCategory = (productCategory: number) => (id: number) => subtreeIds(nodes, id).includes(productCategory);
    const deep = product({ categorySubtreeOf: inCategory(4) });
    expect(matches(cond('CATEGORY', 'eq', 1), deep)).toBe(true);
    expect(matches(cond('CATEGORY', 'neq', 1), deep)).toBe(false);
    const sibling = product({ categorySubtreeOf: inCategory(1) });
    expect(matches(cond('CATEGORY', 'eq', 4), sibling)).toBe(false);
  });
});

describe('parseConditions', () => {
  it('accepts a valid list and normalises values', () => {
    const r = parseConditions(
      [
        { field: 'TITLE', operator: 'contains', value: '  shirt ' },
        { field: 'PRICE', operator: 'lt', value: 2000 },
        { field: 'TAG', operator: 'eq', value: 3 },
      ],
      'ANY',
    );
    expect(r.errors).toEqual([]);
    expect(r.match).toBe('ANY');
    expect(r.conditions).toEqual([
      { field: 'TITLE', operator: 'contains', value: 'shirt' },
      { field: 'PRICE', operator: 'lt', value: 2000 },
      { field: 'TAG', operator: 'eq', value: 3 },
    ]);
  });

  it('an empty list is shape-valid (required is a service rule); non-arrays are invalid', () => {
    expect(parseConditions([], 'ALL').errors).toEqual([]);
    expect(parseConditions('x', 'ALL').errors).toEqual([{ path: 'conditions', code: 'invalid' }]);
  });

  it('61 conditions is too_many; 60 is fine', () => {
    const one = { field: 'TITLE', operator: 'eq', value: 'a' };
    expect(MAX_COLLECTION_CONDITIONS).toBe(60);
    expect(parseConditions(Array(61).fill(one), 'ALL').errors).toEqual([{ path: 'conditions', code: 'too_many' }]);
    expect(parseConditions(Array(60).fill(one), 'ALL').errors).toEqual([]);
  });

  it('field, operator and value errors with indexed paths', () => {
    const r = parseConditions(
      [
        { field: 'NOPE', operator: 'eq', value: 'a' },
        { field: 'PRICE', operator: 'contains', value: 1 },
        { field: 'PRICE', operator: 'eq', value: 'abc' },
        { field: 'TITLE', operator: 'eq', value: '   ' },
        { field: 'TAG', operator: 'eq', value: 0 },
        { field: 'CATEGORY', operator: 'eq', value: 1.5 },
        { field: 'PRICE', operator: 'eq', value: -1 },
        { field: 'INVENTORY', operator: 'lte', value: -3 },
        'junk',
      ],
      'ALL',
    );
    expect(r.errors).toEqual([
      { path: 'conditions.0.field', code: 'invalid_field' },
      { path: 'conditions.1.operator', code: 'invalid_operator' },
      { path: 'conditions.2.value', code: 'invalid_number' },
      { path: 'conditions.3.value', code: 'required' },
      { path: 'conditions.4.value', code: 'invalid_number' },
      { path: 'conditions.5.value', code: 'invalid_number' },
      { path: 'conditions.6.value', code: 'invalid_number' },
      { path: 'conditions.8.field', code: 'invalid_field' },
    ]);
  });

  it('match must be ALL or ANY; defaults to ALL when absent', () => {
    expect(parseConditions([], 'SOME').errors).toEqual([{ path: 'match', code: 'invalid' }]);
    expect(parseConditions([], undefined)).toMatchObject({ match: 'ALL', errors: [] });
  });
});

describe('referencedIds', () => {
  it('collects distinct ids per kind', () => {
    expect(
      referencedIds([
        cond('CATEGORY', 'eq', 2),
        cond('CATEGORY', 'neq', 2),
        cond('CATEGORY', 'eq', 3),
        cond('PRODUCT_TYPE', 'eq', 7),
        cond('TAG', 'eq', 1),
        cond('TITLE', 'eq', 'x'),
        cond('PRICE', 'gt', 100),
      ]),
    ).toEqual({ categoryIds: [2, 3], productTypeIds: [7], tagIds: [1] });
  });
});

describe('sortEntries', () => {
  const e = (id: number, name: string, over: Partial<SortableEntry> = {}): SortableEntry => ({
    id,
    name,
    priceMin: 100,
    priceMax: 100,
    unitsSold: 0,
    position: 0,
    ...over,
  });
  const ids = (list: SortableEntry[]) => list.map((x) => x.id);

  it('lists the sort keys', () => {
    expect([...COLLECTION_SORTS]).toEqual([
      'MANUAL', 'BEST_SELLING', 'TITLE_ASC', 'TITLE_DESC', 'PRICE_ASC', 'PRICE_DESC', 'NEWEST', 'OLDEST',
    ]);
  });
  it('MANUAL by position asc, ties newest first', () => {
    expect(ids(sortEntries([e(1, 'a', { position: 2 }), e(2, 'b', { position: 1 }), e(3, 'c', { position: 1 })], 'MANUAL', 'en'))).toEqual([3, 2, 1]);
  });
  it('BEST_SELLING by unitsSold desc', () => {
    expect(ids(sortEntries([e(1, 'a', { unitsSold: 1 }), e(2, 'b', { unitsSold: 9 }), e(3, 'c', { unitsSold: 1 })], 'BEST_SELLING', 'en'))).toEqual([2, 3, 1]);
  });
  it('TITLE_ASC / TITLE_DESC with locale compare', () => {
    const list = [e(1, 'banana'), e(2, 'Apple'), e(3, 'cherry')];
    expect(ids(sortEntries(list, 'TITLE_ASC', 'en'))).toEqual([2, 1, 3]);
    expect(ids(sortEntries(list, 'TITLE_DESC', 'en'))).toEqual([3, 1, 2]);
    expect(ids(sortEntries([e(1, 'z'), e(2, 'ä')], 'TITLE_ASC', 'sv'))).toEqual([1, 2]);
    expect(ids(sortEntries([e(1, 'z'), e(2, 'ä')], 'TITLE_ASC', 'de'))).toEqual([2, 1]);
  });
  it('PRICE_ASC by priceMin, PRICE_DESC by priceMax', () => {
    const list = [e(1, 'a', { priceMin: 300, priceMax: 400 }), e(2, 'b', { priceMin: 100, priceMax: 900 }), e(3, 'c', { priceMin: 200, priceMax: 500 })];
    expect(ids(sortEntries(list, 'PRICE_ASC', 'en'))).toEqual([2, 3, 1]);
    expect(ids(sortEntries(list, 'PRICE_DESC', 'en'))).toEqual([2, 3, 1]);
  });
  it('NEWEST / OLDEST by id', () => {
    const list = [e(2, 'a'), e(3, 'b'), e(1, 'c')];
    expect(ids(sortEntries(list, 'NEWEST', 'en'))).toEqual([3, 2, 1]);
    expect(ids(sortEntries(list, 'OLDEST', 'en'))).toEqual([1, 2, 3]);
  });
  it('does not mutate the input', () => {
    const list = [e(1, 'b'), e(2, 'a')];
    sortEntries(list, 'TITLE_ASC', 'en');
    expect(ids(list)).toEqual([1, 2]);
  });
});
