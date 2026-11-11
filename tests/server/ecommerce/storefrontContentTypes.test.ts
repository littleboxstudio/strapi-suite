import { describe, it, expect } from 'vitest';
import contentTypes from '../../../server/src/content-types';
import config from '../../../server/src/config';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const get = (n: string): any => (contentTypes as any)[`ltb-st-module-ecommerce-${n}`]?.schema;
const RESERVED = ['createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'publishedAt', 'id', 'documentId', 'locale'];

describe('ecommerce storefront content-types', () => {
  it('checkout-session is registered, hidden and well formed', () => {
    const s = get('checkout-session');
    expect(s).toBeDefined();
    expect(s.info.singularName).toBe('ltb-st-module-ecommerce-checkout-session');
    expect(s.collectionName).toBe('ltb_st_module_ecommerce_checkout_sessions');
    expect(s.pluginOptions['content-manager'].visible).toBe(false);
    expect(s.pluginOptions['content-type-builder'].visible).toBe(false);
    expect(s.pluginOptions.i18n.localized).toBe(false);
    expect(s.options.draftAndPublish).toBe(false);
    expect(Object.keys(s.attributes).sort()).toEqual(
      ['tokenHash', 'status', 'expiresAt', 'lastUsedAt', 'cart', 'emailVerification', 'verificationAttempts', 'verifiedEmail'].sort()
    );
    for (const r of RESERVED) expect(s.attributes[r]).toBeUndefined();
    const a = s.attributes;
    expect(a.tokenHash).toMatchObject({ type: 'string', required: true, unique: true });
    expect(a.status).toMatchObject({ type: 'enumeration', enum: ['ACTIVE', 'EXPIRED'], default: 'ACTIVE' });
    expect(a.expiresAt).toMatchObject({ type: 'datetime', required: true });
    expect(a.lastUsedAt.type).toBe('datetime');
    expect(a.cart.type).toBe('json');
    expect(a.emailVerification.type).toBe('json');
    expect(a.verificationAttempts).toMatchObject({ type: 'integer', default: 0 });
    expect(a.verifiedEmail.type).toBe('string');
    expect(s.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ecommerce_checkout_session_token_unique', columns: ['token_hash'], type: 'unique' }),
        // The purge on every new session filters by status and sorts by expiry.
        { name: 'ecommerce_checkout_session_status_expires', columns: ['status', 'expires_at'] },
      ])
    );
    for (const i of s.indexes) expect(i.name.length).toBeLessThanOrEqual(60);
  });

  it('registers the UID', () => {
    expect((config as any).default.uuid.modules.ecommerce.checkoutSession).toBe(`${P}checkout-session`);
  });

  it('order links to the checkout session (manyToOne, unidirectional)', () => {
    const r = get('order').attributes.checkoutSession;
    expect(r).toMatchObject({ type: 'relation', relation: 'manyToOne', target: `${P}checkout-session` });
    expect(r.inversedBy).toBeUndefined();
  });

  it('promotion.requireVerifiedEmail defaults to false', () => {
    expect(get('promotion').attributes.requireVerifiedEmail).toMatchObject({ type: 'boolean', default: false });
  });
});
