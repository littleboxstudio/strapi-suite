import { describe, it, expect } from 'vitest';
import { collectTranslatableFields, fieldMaxLength } from '../../admin/src/core/utils/documentFields';

describe('Translate with AI: field limits', () => {
  it('a field accepts its maxLength, else 255 for a string; text without one has no limit', () => {
    expect(fieldMaxLength({ type: 'string', maxLength: 60 })).toBe(60);
    expect(fieldMaxLength({ type: 'string' })).toBe(255);
    expect(fieldMaxLength({ type: 'text' })).toBeUndefined();
    expect(fieldMaxLength({ type: 'text', maxLength: 160 })).toBe(160);
  });

  it('each text field carries its limit, in components too; slugs do not', () => {
    const attributes = {
      title: { type: 'string' },
      body: { type: 'text' },
      slug: { type: 'uid', maxLength: 30 },
      seo: { type: 'component', component: 'shared.seo' },
    };
    const components = { 'shared.seo': { attributes: { metaDescription: { type: 'text', maxLength: 160 } } } };
    const source = { title: 'Hello', body: 'Text', slug: 'hello', seo: { metaDescription: 'Description' } };
    const target = { title: '', body: '', slug: '', seo: { metaDescription: '' } };
    expect(collectTranslatableFields(attributes, components, target, source)).toEqual([
      { path: 'title', value: 'Hello', current: '', kind: 'text', maxLength: 255 },
      { path: 'body', value: 'Text', current: '', kind: 'text' },
      { path: 'slug', value: 'hello', current: '', kind: 'slug' },
      { path: 'seo.metaDescription', value: 'Description', current: '', kind: 'text', maxLength: 160 },
    ]);
  });
});
