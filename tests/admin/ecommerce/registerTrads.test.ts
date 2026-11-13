import { describe, it, expect } from 'vitest';
import { mergeTranslations } from '../../../admin/src/core/utils/mergeTranslations';

describe('mergeTranslations', () => {
  it('overrides base keys with locale keys and keeps the rest', () => {
    expect(mergeTranslations({ a: 'A', b: 'B' }, { a: 'Á' })).toEqual({ a: 'Á', b: 'B' });
  });
});

describe('ecommerce settings error translations', () => {
  const en = require('../../../admin/src/core/translations/en.json');
  const pt = require('../../../admin/src/core/translations/pt.json');
  it.each(['invalid_locale', 'invalid_email', 'required'])('%s is translated in en and pt', (code) => {
    const key = `littlebox-strapi-suite.ecommerce.settings.errors.${code}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });
});

describe('order review and balance translations', () => {
  const en = require('../../../admin/src/core/translations/en.json');
  const pt = require('../../../admin/src/core/translations/pt.json');
  it.each([
    'review.SHIPPING_REVIEW',
    'review.DISCOUNTS_REVIEW',
    'review.goTo',
    'review.locked',
    'review.dismiss',
    'balance.due',
    'balance.refundable',
  ])('%s is translated in en and pt', (suffix) => {
    const key = `littlebox-strapi-suite.ecommerce.orders.${suffix}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });
  it('has no MODIFY toolbar action text left', () => {
    expect(en['littlebox-strapi-suite.ecommerce.orders.detail.actions.MODIFY']).toBeUndefined();
    expect(pt['littlebox-strapi-suite.ecommerce.orders.detail.actions.MODIFY']).toBeUndefined();
  });
});
