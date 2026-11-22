import { COLLECTION_SORTS } from '../organizationTypes';
import type {
  CollectionCondition,
  CollectionDetail,
  CollectionField,
  CollectionInput,
  CollectionMatch,
  CollectionOperator,
  CollectionSort,
  CollectionType,
} from '../organizationTypes';
import { formatAmountInput, parseMoneyToCents } from './money';
import type { Mark, Translate } from './promotionForm';

/** Mirrors the server (domain/collections.ts). */
export const MAX_COLLECTION_CONDITIONS = 60;
const MAX_CONDITION_TEXT_LENGTH = 255;

export const COLLECTION_FIELDS: CollectionField[] = [
  'TITLE',
  'CATEGORY',
  'PRODUCT_TYPE',
  'TAG',
  'VENDOR',
  'PRICE',
  'COMPARE_AT_PRICE',
  'INVENTORY',
];

const TEXT_FIELDS: CollectionField[] = ['TITLE', 'VENDOR'];
const ID_FIELDS: CollectionField[] = ['CATEGORY', 'PRODUCT_TYPE', 'TAG'];
const MONEY_FIELDS: CollectionField[] = ['PRICE', 'COMPARE_AT_PRICE'];
const TEXT_OPERATORS: CollectionOperator[] = ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with'];
const ID_OPERATORS: CollectionOperator[] = ['eq', 'neq'];
const NUMERIC_OPERATORS: CollectionOperator[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];

export const isTextField = (field: CollectionField) => TEXT_FIELDS.includes(field);
export const isIdField = (field: CollectionField) => ID_FIELDS.includes(field);
export const isMoneyField = (field: CollectionField) => MONEY_FIELDS.includes(field);

/** The operators a field takes (as the server's `operatorsForField`). */
export function operatorsForField(field: CollectionField): CollectionOperator[] {
  if (isTextField(field)) return [...TEXT_OPERATORS];
  if (isIdField(field)) return [...ID_OPERATORS];
  return [...NUMERIC_OPERATORS];
}

/**
 * One condition row as typed: `value` is the text (TITLE, VENDOR), euros as typed (PRICE,
 * COMPARE_AT_PRICE), an integer (INVENTORY) or the chosen id ('' = none chosen).
 */
export type CollectionConditionForm = {
  key: string;
  field: CollectionField;
  operator: CollectionOperator;
  value: string;
};

export type CollectionTextForm = {
  title: string;
  handle: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

export type CollectionForm = {
  type: CollectionType;
  sortOrder: CollectionSort;
  active: boolean;
  image: string;
  match: CollectionMatch;
  conditions: CollectionConditionForm[];
  translations: Record<string, CollectionTextForm>;
};

let keySeq = 0;
const nextKey = () => `c${++keySeq}`;

export const emptyCollectionText = (): CollectionTextForm => ({
  title: '',
  handle: '',
  description: '',
  seoTitle: '',
  seoDescription: '',
});

export function emptyCollectionCondition(field: CollectionField = 'TITLE'): CollectionConditionForm {
  return { key: nextKey(), field, operator: operatorsForField(field)[0], value: '' };
}

export function emptyCollectionForm(localeCodes: string[]): CollectionForm {
  return {
    type: 'MANUAL',
    sortOrder: 'MANUAL',
    active: true,
    image: '',
    match: 'ALL',
    conditions: [],
    translations: Object.fromEntries(localeCodes.map((code) => [code, emptyCollectionText()])),
  };
}

const valueText = (c: CollectionCondition, amountLocale: string): string => {
  if (isMoneyField(c.field)) {
    const cents = Number(c.value);
    return Number.isFinite(cents) ? formatAmountInput(cents, amountLocale) : String(c.value ?? '');
  }
  return String(c.value ?? '');
};

/** The form of a saved collection; prices are shown as amounts in `amountLocale` ("49,99"). */
export function collectionFormFromDetail(
  detail: CollectionDetail,
  localeCodes: string[],
  amountLocale = 'en'
): CollectionForm {
  return {
    type: detail.type,
    sortOrder: detail.sortOrder,
    active: detail.active,
    image: detail.image ?? '',
    match: detail.match === 'ANY' ? 'ANY' : 'ALL',
    conditions: (detail.conditions ?? []).map((c) => ({
      key: nextKey(),
      field: c.field,
      operator: c.operator,
      value: valueText(c, amountLocale),
    })),
    translations: Object.fromEntries(
      localeCodes.map((code) => {
        const tr = detail.translations?.[code];
        return [
          code,
          tr
            ? {
                title: tr.title ?? '',
                handle: tr.handle ?? '',
                description: tr.description ?? '',
                seoTitle: tr.seoTitle ?? '',
                seoDescription: tr.seoDescription ?? '',
              }
            : emptyCollectionText(),
        ];
      })
    ),
  };
}

/** A new field keeps the operator when it still applies (else the first one) and clears the value. */
export function setConditionField(c: CollectionConditionForm, field: CollectionField): CollectionConditionForm {
  const operators = operatorsForField(field);
  return { ...c, field, operator: operators.includes(c.operator) ? c.operator : operators[0], value: '' };
}

/** The sorts a collection type can use: Manual only for manual collections. */
export function sortOptions(type: CollectionType): CollectionSort[] {
  return COLLECTION_SORTS.filter((s) => type === 'MANUAL' || s !== 'MANUAL');
}

/** On create: an automated collection cannot keep the manual sort (it becomes Newest). */
export function setCollectionType(form: CollectionForm, type: CollectionType): CollectionForm {
  const sortOrder = sortOptions(type).includes(form.sortOrder) ? form.sortOrder : 'NEWEST';
  return { ...form, type, sortOrder };
}

/** The stored value of a row, or null when blank / unreadable ('required' vs 'invalid' in `valueError`). */
function parseValue(c: CollectionConditionForm): string | number | null {
  const raw = (c.value ?? '').trim();
  if (!raw) return null;
  if (isTextField(c.field)) return raw;
  if (isMoneyField(c.field)) return parseMoneyToCents(raw);
  if (c.field === 'INVENTORY') return /^-?\d+$/.test(raw) ? Number(raw) : null;
  return /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null;
}

function valueError(c: CollectionConditionForm): string | null {
  const raw = (c.value ?? '').trim();
  if (!raw) return 'required';
  if (isTextField(c.field) && raw.length > MAX_CONDITION_TEXT_LENGTH) return 'too_long';
  return parseValue(c) === null ? 'invalid' : null;
}

/** Per-row errors (path -> code), paths as the server's `conditions.<i>.operator|value`. */
function conditionErrors(conditions: CollectionConditionForm[]): Record<string, string> {
  const errors: Record<string, string> = {};
  conditions.forEach((c, i) => {
    if (!operatorsForField(c.field).includes(c.operator)) {
      errors[`conditions.${i}.operator`] = 'invalid';
      return;
    }
    const code = valueError(c);
    if (code) errors[`conditions.${i}.value`] = code;
  });
  return errors;
}

/** The conditions to store, or null when any row is not valid. */
function toConditions(conditions: CollectionConditionForm[]): CollectionCondition[] | null {
  if (Object.keys(conditionErrors(conditions)).length) return null;
  return conditions.map((c) => ({ field: c.field, operator: c.operator, value: parseValue(c) as string | number }));
}

/** The body to save (a manual collection sends no match or conditions). */
export function buildCollectionInput(form: CollectionForm): CollectionInput {
  const input: CollectionInput = {
    type: form.type,
    sortOrder: form.sortOrder,
    active: form.active,
    image: form.image.trim() || null,
    translations: Object.fromEntries(
      Object.entries(form.translations).map(([code, tr]) => [
        code,
        {
          title: tr.title,
          handle: tr.handle.trim(),
          description: tr.description || null,
          seoTitle: tr.seoTitle || null,
          seoDescription: tr.seoDescription || null,
        },
      ])
    ),
  };
  if (form.type === 'AUTOMATED') {
    input.match = form.match;
    input.conditions = form.conditions.map((c) => {
      const value = parseValue(c);
      return { field: c.field, operator: c.operator, value: value === null ? c.value : value };
    });
  }
  return input;
}

const OTHER_TEXTS = ['handle', 'description', 'seoTitle', 'seoDescription'] as const;

/**
 * Field errors (path -> code) before saving, with the server's paths. A non-default locale with
 * texts but no title needs one: the server drops a translation whose title is blank.
 */
export function validateCollectionForm(form: CollectionForm, defaultLocale: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.translations[defaultLocale]?.title?.trim()) errors[`translations.${defaultLocale}.title`] = 'required';
  for (const [locale, tr] of Object.entries(form.translations)) {
    if (locale === defaultLocale || tr?.title?.trim()) continue;
    if (OTHER_TEXTS.some((field) => !!tr?.[field]?.trim())) errors[`translations.${locale}.title`] = 'required';
  }
  if (!sortOptions(form.type).includes(form.sortOrder)) errors.sortOrder = 'invalid';
  if (form.type === 'AUTOMATED') {
    if (form.conditions.length === 0) errors.conditions = 'required';
    else if (form.conditions.length > MAX_COLLECTION_CONDITIONS) errors.conditions = 'too_many';
    else Object.assign(errors, conditionErrors(form.conditions));
  }
  return errors;
}

/** What the preview asks for, or null while the conditions are empty or not valid. */
export function previewInput(form: CollectionForm): { match: CollectionMatch; conditions: CollectionCondition[] } | null {
  if (!form.conditions.length || form.conditions.length > MAX_COLLECTION_CONDITIONS) return null;
  const conditions = toConditions(form.conditions);
  return conditions ? { match: form.match, conditions } : null;
}

export type CollectionLabels = {
  /** Category id -> full path ("Clothing > Shirts"). */
  categories?: Record<number, string>;
  productTypes?: Record<number, string>;
  tags?: Record<number, string>;
  /** Cents to a price text. */
  money: (cents: number) => string;
};

const plain: Mark = (v) => v;
const D = 'ecommerce.organization.collection.describe';

/** One condition in plain words; a value not filled in (or unreadable) shows as "…". */
function describeCondition(c: CollectionConditionForm, t: Translate, labels: CollectionLabels, mark: Mark): string {
  const value = parseValue(c);
  const kind = isTextField(c.field) ? 'text' : 'number';
  const operator = mark(t(`${D}.operators.${kind}.${c.operator}`));
  const named = (names: Record<number, string> | undefined) =>
    value === null ? '…' : mark(names?.[value as number] ?? `#${value}`);
  switch (c.field) {
    case 'TITLE':
    case 'VENDOR':
      return t(`${D}.fields.${c.field}`, { operator, value: value === null ? '…' : mark(`“${value}”`) });
    case 'PRICE':
    case 'COMPARE_AT_PRICE':
      return t(`${D}.fields.${c.field}`, { operator, value: value === null ? '…' : mark(labels.money(value as number)) });
    case 'INVENTORY':
      return t(`${D}.fields.${c.field}`, { operator, value: value === null ? '…' : mark(String(value)) });
    case 'CATEGORY':
      return t(`${D}.fields.CATEGORY.${c.operator === 'neq' ? 'neq' : 'eq'}`, { value: named(labels.categories) });
    case 'PRODUCT_TYPE':
      return t(`${D}.fields.PRODUCT_TYPE.${c.operator === 'neq' ? 'neq' : 'eq'}`, { value: named(labels.productTypes) });
    case 'TAG':
      return t(`${D}.fields.TAG.${c.operator === 'neq' ? 'neq' : 'eq'}`, { value: named(labels.tags) });
    default:
      return '…';
  }
}

/** Which products the collection holds, in plain words; `mark` wraps the values filled in. */
export function describeCollectionConditions(
  form: Pick<CollectionForm, 'match' | 'conditions'>,
  t: Translate,
  labels: CollectionLabels,
  mark: Mark = plain
): string {
  if (!form.conditions.length) return t(`${D}.none`);
  const joiner = ` ${t(form.match === 'ANY' ? `${D}.or` : `${D}.and`)} `;
  return t(`${D}.sentence`, {
    conditions: form.conditions.map((c) => describeCondition(c, t, labels, mark)).join(joiner),
  });
}
