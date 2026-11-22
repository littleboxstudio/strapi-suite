import { describe, it, expect } from 'vitest';
import en from '../../../admin/src/core/translations/en.json';
import pt from '../../../admin/src/core/translations/pt.json';
import { IntlMessageFormat } from 'intl-messageformat';
import {
  buildCollectionInput,
  collectionFormFromDetail,
  describeCollectionConditions,
  emptyCollectionCondition,
  emptyCollectionForm,
  operatorsForField,
  previewInput,
  setCollectionType,
  setConditionField,
  sortOptions,
  validateCollectionForm,
  COLLECTION_FIELDS,
  MAX_COLLECTION_CONDITIONS,
  type CollectionForm,
} from '../../../admin/src/ecommerce/utils/collectionForm';
import { markedParts, markValue } from '../../../admin/src/ecommerce/utils/promotionForm';
import { formatCents } from '../../../admin/src/ecommerce/utils/money';
import type { CollectionDetail } from '../../../admin/src/ecommerce/organizationTypes';

const PREFIX = 'littlebox-strapi-suite.';
const translator =
  (messages: Record<string, string>, locale: string) => (id: string, values?: Record<string, any>) => {
    const message = messages[PREFIX + id];
    if (message === undefined) throw new Error(`missing translation ${id} (${locale})`);
    return String(new IntlMessageFormat(message, locale).format(values));
  };
const tEn = translator(en as Record<string, string>, 'en');
const tPt = translator(pt as Record<string, string>, 'pt-PT');
const nbsp = (s: string) => s.replace(/ /g, ' ');

const LOCALES = ['en', 'pt'];

const detail = (over: Partial<CollectionDetail> = {}): CollectionDetail => ({
  id: 7,
  type: 'AUTOMATED',
  sortOrder: 'PRICE_ASC',
  active: false,
  image: 'https://cdn.example.com/sale.jpg',
  match: 'ANY',
  conditions: [
    { field: 'TITLE', operator: 'contains', value: 'linen' },
    { field: 'PRICE', operator: 'lte', value: 4999 },
    { field: 'COMPARE_AT_PRICE', operator: 'gt', value: 0 },
    { field: 'INVENTORY', operator: 'lt', value: -2 },
    { field: 'CATEGORY', operator: 'eq', value: 3 },
    { field: 'PRODUCT_TYPE', operator: 'neq', value: 4 },
    { field: 'TAG', operator: 'eq', value: 5 },
    { field: 'VENDOR', operator: 'starts_with', value: 'Acme' },
  ],
  translations: {
    en: { title: 'Sale', handle: 'sale', description: 'Cheap', seoTitle: null, seoDescription: 'SEO' },
  },
  productCount: 12,
  ...over,
});

const filled = (over: Partial<CollectionForm> = {}): CollectionForm => {
  const form = emptyCollectionForm(LOCALES);
  form.translations.en.title = 'Summer';
  return { ...form, ...over };
};

const automated = (conditions: CollectionForm['conditions'], over: Partial<CollectionForm> = {}) =>
  filled({ type: 'AUTOMATED', sortOrder: 'NEWEST', conditions, ...over });

const cond = (field: any, operator: any, value: string) => ({ ...emptyCollectionCondition(field), operator, value });

describe('operatorsForField (mirrors the server)', () => {
  it('text fields take the six text operators', () => {
    for (const field of ['TITLE', 'VENDOR'] as const) {
      expect(operatorsForField(field)).toEqual(['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with']);
    }
  });

  it('category, type and tag take equals / not equals', () => {
    for (const field of ['CATEGORY', 'PRODUCT_TYPE', 'TAG'] as const) {
      expect(operatorsForField(field)).toEqual(['eq', 'neq']);
    }
  });

  it('numbers take the six comparisons', () => {
    for (const field of ['PRICE', 'COMPARE_AT_PRICE', 'INVENTORY'] as const) {
      expect(operatorsForField(field)).toEqual(['eq', 'neq', 'gt', 'lt', 'gte', 'lte']);
    }
  });

  it('lists every field', () => {
    expect(COLLECTION_FIELDS).toEqual([
      'TITLE',
      'CATEGORY',
      'PRODUCT_TYPE',
      'TAG',
      'VENDOR',
      'PRICE',
      'COMPARE_AT_PRICE',
      'INVENTORY',
    ]);
  });
});

describe('conditions editing', () => {
  it('changing the field keeps a valid operator and clears the value', () => {
    const c = cond('TITLE', 'eq', 'x');
    expect(setConditionField(c, 'VENDOR')).toMatchObject({ field: 'VENDOR', operator: 'eq', value: '' });
    expect(setConditionField(cond('TITLE', 'contains', 'x'), 'PRICE')).toMatchObject({
      field: 'PRICE',
      operator: 'eq',
      value: '',
    });
    expect(setConditionField(cond('PRICE', 'gte', '1'), 'INVENTORY')).toMatchObject({ operator: 'gte', value: '' });
  });

  it('keeps the row key', () => {
    const c = cond('TITLE', 'eq', 'x');
    expect(setConditionField(c, 'TAG').key).toBe(c.key);
  });
});

describe('type and sorting', () => {
  it('a new collection is manual, sorted by hand, active', () => {
    const form = emptyCollectionForm(LOCALES);
    expect(form).toMatchObject({ type: 'MANUAL', sortOrder: 'MANUAL', active: true, match: 'ALL', conditions: [] });
    expect(Object.keys(form.translations)).toEqual(LOCALES);
  });

  it('switching to automated resets the manual sort to newest', () => {
    expect(setCollectionType(emptyCollectionForm(LOCALES), 'AUTOMATED').sortOrder).toBe('NEWEST');
    const priced = { ...emptyCollectionForm(LOCALES), sortOrder: 'PRICE_DESC' as const };
    expect(setCollectionType(priced, 'AUTOMATED').sortOrder).toBe('PRICE_DESC');
    expect(setCollectionType(priced, 'MANUAL').sortOrder).toBe('PRICE_DESC');
  });

  it('manual sort is offered only to manual collections', () => {
    expect(sortOptions('MANUAL')[0]).toBe('MANUAL');
    expect(sortOptions('MANUAL')).toHaveLength(8);
    expect(sortOptions('AUTOMATED')).not.toContain('MANUAL');
    expect(sortOptions('AUTOMATED')).toHaveLength(7);
  });
});

describe('form <-> input', () => {
  it('round-trips an automated collection (money in cents)', () => {
    const form = collectionFormFromDetail(detail(), LOCALES, 'en');
    expect(form.conditions.map((c) => c.value)).toEqual(['linen', '49.99', '0.00', '-2', '3', '4', '5', 'Acme']);
    expect(form.translations.pt).toEqual({ title: '', handle: '', description: '', seoTitle: '', seoDescription: '' });
    expect(buildCollectionInput(form)).toEqual({
      type: 'AUTOMATED',
      sortOrder: 'PRICE_ASC',
      active: false,
      image: 'https://cdn.example.com/sale.jpg',
      match: 'ANY',
      conditions: detail().conditions,
      translations: {
        en: { title: 'Sale', handle: 'sale', description: 'Cheap', seoTitle: null, seoDescription: 'SEO' },
        pt: { title: '', handle: '', description: null, seoTitle: null, seoDescription: null },
      },
    });
  });

  it('shows prices in the admin locale and reads them back', () => {
    const form = collectionFormFromDetail(detail(), LOCALES, 'pt-PT');
    expect(form.conditions[1].value).toBe('49,99');
    expect(buildCollectionInput(form).conditions?.[1]).toEqual({ field: 'PRICE', operator: 'lte', value: 4999 });
  });

  it('a manual collection sends no conditions', () => {
    const input = buildCollectionInput(filled({ image: '  ', conditions: [cond('TITLE', 'eq', 'x')] }));
    expect(input).toEqual({
      type: 'MANUAL',
      sortOrder: 'MANUAL',
      active: true,
      image: null,
      translations: {
        en: { title: 'Summer', handle: '', description: null, seoTitle: null, seoDescription: null },
        pt: { title: '', handle: '', description: null, seoTitle: null, seoDescription: null },
      },
    });
  });

  it('trims text values', () => {
    const input = buildCollectionInput(automated([cond('VENDOR', 'eq', '  Acme ')]));
    expect(input.conditions).toEqual([{ field: 'VENDOR', operator: 'eq', value: 'Acme' }]);
  });
});

describe('validateCollectionForm (paths as the server)', () => {
  it('accepts a complete form', () => {
    expect(validateCollectionForm(filled(), 'en')).toEqual({});
    expect(validateCollectionForm(automated([cond('PRICE', 'gt', '10,5')]), 'en')).toEqual({});
  });

  it('requires the default locale title', () => {
    const form = emptyCollectionForm(LOCALES);
    expect(validateCollectionForm(form, 'en')).toEqual({ 'translations.en.title': 'required' });
  });

  it('requires a title in another locale that has other texts (it would be dropped)', () => {
    const form = filled();
    form.translations.pt = { ...form.translations.pt, seoTitle: 'Verão' };
    expect(validateCollectionForm(form, 'en')).toEqual({ 'translations.pt.title': 'required' });
  });

  it('an automated collection needs a condition', () => {
    expect(validateCollectionForm(automated([]), 'en')).toEqual({ conditions: 'required' });
  });

  it('refuses more than the maximum of conditions', () => {
    const many = Array.from({ length: MAX_COLLECTION_CONDITIONS + 1 }, () => cond('TITLE', 'eq', 'x'));
    expect(validateCollectionForm(automated(many), 'en')).toEqual({ conditions: 'too_many' });
  });

  it('checks each value at conditions.<i>.value', () => {
    const errors = validateCollectionForm(
      automated([
        cond('TITLE', 'eq', '  '),
        cond('PRICE', 'gt', 'abc'),
        cond('PRICE', 'gt', ''),
        cond('INVENTORY', 'lt', '1.5'),
        cond('INVENTORY', 'lt', '-3'),
        cond('CATEGORY', 'eq', ''),
        cond('TAG', 'eq', '9'),
        cond('COMPARE_AT_PRICE', 'eq', '-1'),
      ]),
      'en'
    );
    expect(errors).toEqual({
      'conditions.0.value': 'required',
      'conditions.1.value': 'invalid',
      'conditions.2.value': 'required',
      'conditions.3.value': 'invalid',
      'conditions.5.value': 'required',
      'conditions.7.value': 'invalid',
    });
  });

  it('refuses an operator the field does not take', () => {
    expect(validateCollectionForm(automated([cond('TAG', 'contains', '1')]), 'en')).toEqual({
      'conditions.0.operator': 'invalid',
    });
  });

  it('refuses the manual sort on an automated collection', () => {
    expect(validateCollectionForm(automated([cond('TAG', 'eq', '1')], { sortOrder: 'MANUAL' }), 'en')).toEqual({
      sortOrder: 'invalid',
    });
  });

  it('ignores the conditions of a manual collection', () => {
    expect(validateCollectionForm(filled({ conditions: [cond('TITLE', 'eq', '')] }), 'en')).toEqual({});
  });
});

describe('previewInput', () => {
  it('is the parsed conditions when they are valid', () => {
    expect(previewInput(automated([cond('PRICE', 'gte', '5')], { match: 'ANY' }))).toEqual({
      match: 'ANY',
      conditions: [{ field: 'PRICE', operator: 'gte', value: 500 }],
    });
  });

  it('is null with no conditions or an invalid one', () => {
    expect(previewInput(automated([]))).toBeNull();
    expect(previewInput(automated([cond('PRICE', 'gte', 'x')]))).toBeNull();
  });
});

describe('describeCollectionConditions', () => {
  const labels = {
    categories: { 3: 'Clothing > Shirts' },
    productTypes: { 4: 'Gift card' },
    tags: { 5: 'Summer' },
  };
  const all = automated([
    cond('TITLE', 'contains', 'linen'),
    cond('PRICE', 'lte', '49,99'),
    cond('CATEGORY', 'eq', '3'),
    cond('TAG', 'neq', '5'),
  ]);

  it('says when there are no conditions', () => {
    expect(describeCollectionConditions(automated([]), tEn, { money: (c) => formatCents(c, 'en') })).toBe(
      'No conditions yet: the collection has no products.'
    );
  });

  it('describes every condition in English', () => {
    const text = describeCollectionConditions(all, tEn, { ...labels, money: (c) => formatCents(c, 'en') });
    expect(nbsp(text)).toBe(
      'Active products where the title contains “linen” and an active variant’s price is at most €49.99 and it is in the category Clothing > Shirts (or a subcategory) and it does not have the tag Summer.'
    );
  });

  it('joins with "or" for any condition', () => {
    const text = describeCollectionConditions(
      automated([cond('PRODUCT_TYPE', 'eq', '4'), cond('INVENTORY', 'gt', '0'), cond('VENDOR', 'neq', 'Acme')], {
        match: 'ANY',
      }),
      tEn,
      { ...labels, money: (c) => formatCents(c, 'en') }
    );
    expect(text).toBe(
      'Active products where its type is Gift card or an active variant’s inventory is greater than 0 or the vendor is not “Acme”.'
    );
  });

  it('describes every condition in Portuguese', () => {
    const text = describeCollectionConditions(all, tPt, { ...labels, money: (c) => formatCents(c, 'pt-PT') });
    expect(nbsp(text)).toBe(
      'Produtos ativos em que o título contém “linen” e o preço de uma variante ativa é no máximo 49,99 € e está na categoria Clothing > Shirts (ou numa subcategoria) e não tem a tag Summer.'
    );
  });

  it('shows "…" for a value not filled in and the id for an unknown name', () => {
    const text = describeCollectionConditions(
      automated([cond('PRICE', 'gt', ''), cond('TAG', 'eq', '9'), cond('COMPARE_AT_PRICE', 'gte', '10')]),
      tEn,
      { money: (c) => formatCents(c, 'en') }
    );
    expect(text).toBe(
      'Active products where an active variant’s price is greater than … and it has the tag #9 and an active variant’s compare-at price is at least €10.00.'
    );
  });

  it('marks the values filled in', () => {
    const form = automated([cond('TITLE', 'eq', 'Shirt'), cond('PRICE', 'gt', '')]);
    const parts = markedParts(describeCollectionConditions(form, tEn, { money: (c) => formatCents(c, 'en') }, markValue));
    expect(parts.filter((p) => p.value).map((p) => p.text)).toEqual(['is', '“Shirt”', 'is greater than']);
    expect(parts.map((p) => p.text).join('')).toBe(
      describeCollectionConditions(form, tEn, { money: (c) => formatCents(c, 'en') })
    );
  });
});
