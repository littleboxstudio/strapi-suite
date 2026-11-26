import { describe, it, expect } from 'vitest';
import { errors } from '@strapi/utils';
import {
  IMAGE_FIELD_UID,
  buildPopulate,
  collectEntryIds,
  collectIds,
  validateData,
  validateValue,
} from '../../../server/src/services/modules/image-field/domain/values';

const img = (id: number) => ({ id, url: `/uploads/${id}.webp` });
const single = (extra: any = {}) => ({ type: 'json', customField: IMAGE_FIELD_UID, ...extra });
const gallery = (extra: any = {}) => single({ options: { mode: 'gallery' }, ...extra });

const schemas: Record<string, any> = {
  'api::page.page': {
    attributes: {
      title: { type: 'string' },
      cover: single(),
      hero: { type: 'component', component: 'blocks.hero', repeatable: false },
      slides: { type: 'component', component: 'blocks.slide', repeatable: true },
      body: { type: 'dynamiczone', components: ['blocks.slide', 'blocks.text', 'blocks.nested'] },
    },
  },
  'api::plain.plain': { attributes: { title: { type: 'string' } } },
  'blocks.hero': { attributes: { image: single({ required: true }) } },
  'blocks.slide': {
    attributes: { photos: gallery({ options: { mode: 'gallery', maxImages: 2 } }) },
  },
  'blocks.text': { attributes: { text: { type: 'text' } } },
  'blocks.nested': {
    attributes: { inner: { type: 'component', component: 'blocks.hero', repeatable: false } },
  },
};
const lookup = (uid: string) => schemas[uid];

const throwsValidation = (fn: () => void) => {
  expect(fn).toThrow(errors.ValidationError);
};

describe('collectIds', () => {
  it('reads an object, an array or null', () => {
    expect(collectIds(img(3))).toEqual([3]);
    expect(collectIds([img(1), img(2), img(1)])).toEqual([1, 2]);
    expect(collectIds(null)).toEqual([]);
    expect(collectIds(undefined)).toEqual([]);
  });

  it('ignores malformed items', () => {
    expect(collectIds([{ id: 'x' }, 5, null, { id: -1 }, { id: 4 }])).toEqual([4]);
    expect(collectIds('{"id":1}')).toEqual([]);
  });
});

describe('validateValue', () => {
  it('single: object with numeric id or null', () => {
    expect(() => validateValue(img(1), {})).not.toThrow();
    expect(() => validateValue(null, {})).not.toThrow();
    throwsValidation(() => validateValue([img(1)], {}));
    throwsValidation(() => validateValue({ id: '1' }, {}));
    throwsValidation(() => validateValue('x', {}));
  });

  it('gallery: array of objects with numeric id', () => {
    const o = { mode: 'gallery' };
    expect(() => validateValue([img(1), img(2)], o)).not.toThrow();
    expect(() => validateValue([], o)).not.toThrow();
    expect(() => validateValue(null, o)).not.toThrow();
    throwsValidation(() => validateValue(img(1), o));
    throwsValidation(() => validateValue([img(1), { url: 'x' }], o));
  });

  it('gallery: maxImages enforced', () => {
    const o = { mode: 'gallery', maxImages: 2 };
    expect(() => validateValue([img(1), img(2)], o)).not.toThrow();
    throwsValidation(() => validateValue([img(1), img(2), img(3)], o));
    // A string option from the CTB counts too.
    throwsValidation(() => validateValue([img(1), img(2)], { mode: 'gallery', maxImages: '1' }));
  });

  it('required gallery rejects [] and required single rejects null when enforced', () => {
    const rules = { required: true, enforceRequired: true };
    throwsValidation(() => validateValue([], { mode: 'gallery' }, rules));
    throwsValidation(() => validateValue(null, { mode: 'gallery' }, rules));
    throwsValidation(() => validateValue(null, {}, rules));
    expect(() => validateValue([img(1)], { mode: 'gallery' }, rules)).not.toThrow();
    // Drafts may be incomplete.
    expect(() => validateValue([], { mode: 'gallery' }, { required: true })).not.toThrow();
  });
});

describe('buildPopulate', () => {
  it('loads every component / dynamic zone path leading to an image field', () => {
    expect(buildPopulate('api::page.page', lookup)).toEqual({
      hero: { populate: {} },
      slides: { populate: {} },
      body: {
        on: {
          'blocks.slide': { populate: {} },
          'blocks.nested': { populate: { inner: { populate: {} } } },
        },
      },
    });
  });

  it('is null for a schema without image fields', () => {
    expect(buildPopulate('api::plain.plain', lookup)).toBeNull();
  });
});

describe('collectEntryIds / validateData', () => {
  const row = {
    cover: img(1),
    hero: { image: img(2) },
    slides: [{ photos: [img(3), img(4)] }, { photos: null }],
    body: [
      { __component: 'blocks.slide', photos: [img(5)] },
      { __component: 'blocks.text', text: 'x' },
      { __component: 'blocks.nested', inner: { image: img(6) } },
    ],
  };

  it('collects ids through components, repeatables and dynamic zones', () => {
    expect([...collectEntryIds('api::page.page', [row, { cover: img(7) }], lookup)].sort()).toEqual(
      [1, 2, 3, 4, 5, 6, 7]
    );
  });

  it('validates nested values and skips absent attributes', () => {
    expect(() => validateData('api::page.page', row, lookup, true)).not.toThrow();
    expect(() => validateData('api::page.page', { title: 'only' }, lookup, true)).not.toThrow();
    throwsValidation(() =>
      validateData(
        'api::page.page',
        { body: [{ __component: 'blocks.slide', photos: [img(1), img(2), img(3)] }] },
        lookup,
        false
      )
    );
    throwsValidation(() => validateData('api::page.page', { hero: { image: null } }, lookup, true));
    expect(() =>
      validateData('api::page.page', { hero: { image: null } }, lookup, false)
    ).not.toThrow();
  });
});
