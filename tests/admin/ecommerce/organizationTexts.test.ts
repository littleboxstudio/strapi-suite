import { describe, it, expect } from 'vitest';
import {
  ORGANIZATION_CONFLICT_CODES,
  ORGANIZATION_FIELD_CODES,
  organizationErrorMessage,
  organizationFieldErrors,
  organizationIssues,
} from '../../../admin/src/ecommerce/utils/organizationErrors';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const PREFIX = 'littlebox-strapi-suite.ecommerce.organization.';

const keysOf = (json: Record<string, string>) => Object.keys(json).filter((k) => k.startsWith(PREFIX)).sort();

describe('organization translations', () => {
  it('has the same ecommerce.organization.* keys in en and pt, all non-empty', () => {
    const enKeys = keysOf(en);
    expect(enKeys.length).toBeGreaterThan(0);
    expect(keysOf(pt)).toEqual(enKeys);
    for (const key of enKeys) {
      expect(en[key]).toEqual(expect.any(String));
      expect(en[key].trim()).not.toBe('');
      expect(pt[key].trim()).not.toBe('');
    }
  });

  it.each([...ORGANIZATION_CONFLICT_CODES, ...ORGANIZATION_FIELD_CODES])('error %s has a text', (code) => {
    expect(en[`${PREFIX}errors.${code}`]).toEqual(expect.any(String));
    expect(pt[`${PREFIX}errors.${code}`]).toEqual(expect.any(String));
  });

  it.each(['categories', 'collections', 'types-tags'])('menu entry %s is translated', (key) => {
    expect(en[`littlebox-strapi-suite.ecommerce.menu.${key}`]).toEqual(expect.any(String));
    expect(pt[`littlebox-strapi-suite.ecommerce.menu.${key}`]).toEqual(expect.any(String));
  });

  it('shows the collection titles in the in-use text', () => {
    expect(en[`${PREFIX}errors.IN_USE_BY_COLLECTIONS`]).toContain('{collections}');
    expect(pt[`${PREFIX}errors.IN_USE_BY_COLLECTIONS`]).toContain('{collections}');
  });
});

const conflict = (code: string, errors: any[]) => ({
  response: { status: 409, data: { error: { status: 409, details: { code, errors } } } },
});
const badRequest = (errors: any[]) => ({ response: { status: 400, data: { error: { status: 400, details: { errors } } } } });

describe('organizationIssues', () => {
  it('reads the issues of an error answer', () => {
    expect(organizationIssues(badRequest([{ path: 'image', code: 'invalid_url' }]))).toEqual([
      { path: 'image', code: 'invalid_url' },
    ]);
  });

  it('is empty for anything else', () => {
    expect(organizationIssues(new Error('network'))).toEqual([]);
    expect(organizationIssues(undefined)).toEqual([]);
  });
});

describe('organizationErrorMessage', () => {
  it('names the collections that use the category', () => {
    const err = conflict('IN_USE_BY_COLLECTIONS', [
      { path: 'collections', code: 'IN_USE_BY_COLLECTIONS', detail: 'Summer' },
      { path: 'collections', code: 'IN_USE_BY_COLLECTIONS', detail: 'Sale' },
    ]);
    expect(organizationErrorMessage(err)).toEqual({
      id: 'ecommerce.organization.errors.IN_USE_BY_COLLECTIONS',
      values: { collections: 'Summer, Sale' },
    });
  });

  it('maps the other state conflicts to their text', () => {
    expect(organizationErrorMessage(conflict('CATEGORY_HAS_CHILDREN', [{ path: 'children', code: 'CATEGORY_HAS_CHILDREN' }]))).toEqual({
      id: 'ecommerce.organization.errors.CATEGORY_HAS_CHILDREN',
      values: { collections: '' },
    });
  });

  it('also finds a conflict code among 400 issues', () => {
    expect(organizationErrorMessage(badRequest([{ path: 'parentId', code: 'CATEGORY_TOO_DEEP' }]))?.id).toBe(
      'ecommerce.organization.errors.CATEGORY_TOO_DEEP'
    );
  });

  it('is null when no known conflict is in the answer', () => {
    expect(organizationErrorMessage(badRequest([{ path: 'image', code: 'invalid_url' }]))).toBeNull();
    expect(organizationErrorMessage(new Error('x'))).toBeNull();
  });
});

describe('organizationFieldErrors', () => {
  it('keeps the first code per path; unknown codes become invalid', () => {
    expect(
      organizationFieldErrors([
        { path: 'translations.en.name', code: 'NAME_TAKEN' },
        { path: 'translations.en.name', code: 'too_long' },
        { path: 'image', code: 'weird_code' },
      ])
    ).toEqual({ 'translations.en.name': 'NAME_TAKEN', image: 'invalid' });
  });
});
