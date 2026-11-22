export const MAX_COLLECTION_CONDITIONS = 60;

export type CollectionField =
  | 'TITLE'
  | 'CATEGORY'
  | 'PRODUCT_TYPE'
  | 'TAG'
  | 'PRICE'
  | 'COMPARE_AT_PRICE'
  | 'INVENTORY';
export type CollectionOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte';
export type CollectionCondition = { field: CollectionField; operator: CollectionOperator; value: string | number };
export type CollectionMatch = 'ALL' | 'ANY';
export const COLLECTION_SORTS = [
  'MANUAL',
  'BEST_SELLING',
  'TITLE_ASC',
  'TITLE_DESC',
  'PRICE_ASC',
  'PRICE_DESC',
  'NEWEST',
  'OLDEST',
] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

const FIELDS: CollectionField[] = [
  'TITLE',
  'CATEGORY',
  'PRODUCT_TYPE',
  'TAG',
  'PRICE',
  'COMPARE_AT_PRICE',
  'INVENTORY',
];
const TEXT_FIELDS: CollectionField[] = ['TITLE'];
const ID_FIELDS: CollectionField[] = ['CATEGORY', 'PRODUCT_TYPE', 'TAG'];

const TEXT_OPERATORS: CollectionOperator[] = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with'];
const ID_OPERATORS: CollectionOperator[] = ['eq', 'neq'];
const NUMERIC_OPERATORS: CollectionOperator[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];

export function operatorsForField(field: CollectionField): CollectionOperator[] {
  if (TEXT_FIELDS.includes(field)) return [...TEXT_OPERATORS];
  if (ID_FIELDS.includes(field)) return [...ID_OPERATORS];
  return [...NUMERIC_OPERATORS];
}

type ConditionError = { path: string; code: string };

const toInteger = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
};

/**
 * Shape validation only. Whether an AUTOMATED collection needs at least one condition
 * is the service's rule, not checked here.
 */
export function parseConditions(
  raw: unknown,
  match: unknown,
): { conditions: CollectionCondition[]; match: CollectionMatch; errors: ConditionError[] } {
  const errors: ConditionError[] = [];
  const conditions: CollectionCondition[] = [];

  let parsedMatch: CollectionMatch = 'ALL';
  if (match === 'ALL' || match === 'ANY') parsedMatch = match;
  else if (match !== undefined && match !== null) errors.push({ path: 'match', code: 'invalid' });

  if (!Array.isArray(raw)) {
    errors.push({ path: 'conditions', code: 'invalid' });
    return { conditions, match: parsedMatch, errors };
  }
  if (raw.length > MAX_COLLECTION_CONDITIONS) {
    errors.push({ path: 'conditions', code: 'too_many' });
    return { conditions, match: parsedMatch, errors };
  }

  raw.forEach((item, i) => {
    const base = `conditions.${i}`;
    const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const field = entry.field as CollectionField;
    if (typeof field !== 'string' || !FIELDS.includes(field)) {
      errors.push({ path: `${base}.field`, code: 'invalid_field' });
      return;
    }
    const operator = entry.operator as CollectionOperator;
    if (typeof operator !== 'string' || !operatorsForField(field).includes(operator)) {
      errors.push({ path: `${base}.operator`, code: 'invalid_operator' });
      return;
    }
    if (TEXT_FIELDS.includes(field)) {
      const text = typeof entry.value === 'string' ? entry.value.trim() : '';
      if (!text) {
        errors.push({ path: `${base}.value`, code: 'required' });
        return;
      }
      if (text.length > 255) {
        errors.push({ path: `${base}.value`, code: 'too_long' });
        return;
      }
      conditions.push({ field, operator, value: text });
      return;
    }
    const value = toInteger(entry.value);
    const min = ID_FIELDS.includes(field) ? 1 : field === 'INVENTORY' ? -Infinity : 0;
    if (value === null || value < min) {
      errors.push({ path: `${base}.value`, code: 'invalid_number' });
      return;
    }
    conditions.push({ field, operator, value });
  });

  return { conditions, match: parsedMatch, errors };
}

export type EvaluableProduct = {
  id: number;
  active: boolean;
  names: string[];
  categorySubtreeOf: (categoryId: number) => boolean;
  productTypeId: number | null;
  tagIds: number[];
  variants: { active: boolean; price: number; compareAtPrice: number | null; stock: number }[];
};

const lower = (s: string) => String(s ?? '').toLowerCase();

const textTest = (operator: CollectionOperator, candidate: string, value: string): boolean => {
  const a = lower(candidate);
  const b = lower(value);
  switch (operator) {
    case 'eq':
    case 'neq':
      return a === b;
    case 'contains':
    case 'not_contains':
      return a.includes(b);
    case 'starts_with':
      return a.startsWith(b);
    case 'ends_with':
      return a.endsWith(b);
    default:
      return false;
  }
};

const isNegative = (operator: CollectionOperator) => operator === 'neq' || operator === 'not_contains';

const numberTest = (operator: CollectionOperator, actual: number, value: number): boolean => {
  switch (operator) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'gt':
      return actual > value;
    case 'lt':
      return actual < value;
    case 'gte':
      return actual >= value;
    case 'lte':
      return actual <= value;
    default:
      return false;
  }
};

const conditionMatches = (p: EvaluableProduct, c: CollectionCondition): boolean => {
  switch (c.field) {
    case 'TITLE': {
      const value = String(c.value);
      const hit = p.names.some((name) => textTest(c.operator, name, value));
      return isNegative(c.operator) ? !hit : hit;
    }
    case 'CATEGORY':
      return c.operator === 'neq' ? !p.categorySubtreeOf(Number(c.value)) : p.categorySubtreeOf(Number(c.value));
    case 'PRODUCT_TYPE': {
      const same = p.productTypeId === Number(c.value);
      return c.operator === 'neq' ? !same : same;
    }
    case 'TAG': {
      const has = p.tagIds.includes(Number(c.value));
      return c.operator === 'neq' ? !has : has;
    }
    case 'PRICE':
    case 'COMPARE_AT_PRICE':
    case 'INVENTORY': {
      const value = Number(c.value);
      return p.variants
        .filter((v) => v.active)
        .some((v) => {
          const actual = c.field === 'PRICE' ? v.price : c.field === 'INVENTORY' ? v.stock : v.compareAtPrice;
          return actual !== null && numberTest(c.operator, actual, value);
        });
    }
    default:
      return false;
  }
};

/** An empty condition list matches nothing; the service decides what that means for a collection. */
export function productMatches(p: EvaluableProduct, conditions: CollectionCondition[], match: CollectionMatch): boolean {
  if (!p.active || !p.variants.some((v) => v.active)) return false;
  if (!conditions.length) return false;
  return match === 'ANY'
    ? conditions.some((c) => conditionMatches(p, c))
    : conditions.every((c) => conditionMatches(p, c));
}

export function referencedIds(conditions: CollectionCondition[]): {
  categoryIds: number[];
  productTypeIds: number[];
  tagIds: number[];
} {
  const collect = (field: CollectionField) => [
    ...new Set(conditions.filter((c) => c.field === field).map((c) => Number(c.value))),
  ];
  return { categoryIds: collect('CATEGORY'), productTypeIds: collect('PRODUCT_TYPE'), tagIds: collect('TAG') };
}

export type SortableEntry = {
  id: number;
  name: string;
  priceMin: number;
  priceMax: number;
  unitsSold: number;
  position: number;
};

export function sortEntries<T extends SortableEntry>(entries: T[], sort: CollectionSort, locale: string): T[] {
  const primary = (a: T, b: T): number => {
    switch (sort) {
      case 'MANUAL':
        return a.position - b.position;
      case 'BEST_SELLING':
        return b.unitsSold - a.unitsSold;
      case 'TITLE_ASC':
        return a.name.localeCompare(b.name, locale);
      case 'TITLE_DESC':
        return b.name.localeCompare(a.name, locale);
      case 'PRICE_ASC':
        return a.priceMin - b.priceMin;
      case 'PRICE_DESC':
        return b.priceMax - a.priceMax;
      case 'OLDEST':
        return a.id - b.id;
      case 'NEWEST':
      default:
        return b.id - a.id;
    }
  };
  return [...entries].sort((a, b) => primary(a, b) || b.id - a.id);
}
