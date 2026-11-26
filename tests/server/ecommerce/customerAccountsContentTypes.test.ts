import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '../../../server/src/content-types/modules/ecommerce');
const load = (d: string) => JSON.parse(readFileSync(join(DIR, d, 'schema.json'), 'utf8'));

describe('customer account fields', () => {
  const s = load('customer');
  const a = s.attributes;

  it('declares the account attributes', () => {
    expect(a.accountType).toMatchObject({ type: 'enumeration', enum: ['GUEST', 'REGISTERED'], default: 'GUEST' });
    expect(a.emailVerified).toMatchObject({ type: 'boolean', default: false });
    expect(a.emailVerifiedAt.type).toBe('datetime');
    expect(a.passwordHash).toMatchObject({ type: 'string', private: true });
    expect(a.passwordPepperVersion.type).toBe('integer');
    expect(a.passwordChangedAt.type).toBe('datetime');
    expect(a.pendingEmail.type).toBe('string');
    expect(a.pendingEmailNormalized.type).toBe('string');
    expect(a.blocked).toMatchObject({ type: 'boolean', default: false });
    expect(a.blockedAt.type).toBe('datetime');
    expect(a.blockedNote.type).toBe('text');
    expect(a.blockedById.type).toBe('integer');
    expect(a.cart.type).toBe('json');
  });

  it('indexes pending e-mail and blocked/account type, and keeps emailNormalized non-unique', () => {
    const idx = s.indexes as any[];
    expect(idx.some((i) => i.columns.join() === 'pending_email_normalized' && !i.type)).toBe(true);
    expect(idx.some((i) => i.columns.join() === 'blocked,account_type' && !i.type)).toBe(true);
    expect(idx.some((i) => i.columns.join() === 'email_normalized' && i.type === 'unique')).toBe(false);
    expect(a.emailNormalized.unique).toBeUndefined();
  });
});

describe('customer session and token models', () => {
  const hidden = (s: any) => {
    expect(s.pluginOptions['content-manager'].visible).toBe(false);
    expect(s.pluginOptions['content-type-builder'].visible).toBe(false);
    expect(s.pluginOptions.i18n.localized).toBe(false);
  };

  it('customer session', () => {
    const s = load('customer-session');
    expect(s.collectionName).toBe('ltb_st_module_ecommerce_customer_sessions');
    expect(s.attributes.customer).toMatchObject({ type: 'relation', relation: 'manyToOne' });
    expect(s.attributes.expiresAt).toMatchObject({ type: 'datetime', required: true });
    expect(s.attributes.lastUsedAt.type).toBe('datetime');
    expect(s.attributes.revokedAt.type).toBe('datetime');
    expect(s.attributes.revokeReason.enum).toEqual([
      'LOGOUT', 'REVOKED_BY_CUSTOMER', 'PASSWORD_CHANGED', 'EMAIL_CHANGED', 'BLOCKED', 'ADMIN_PASSWORD', 'PASSWORD_RESET',
    ]);
    expect(s.attributes.userAgent.type).toBe('string');
    expect(s.attributes.ipPrefix.type).toBe('string');
    hidden(s);
  });

  it('customer token', () => {
    const s = load('customer-token');
    expect(s.collectionName).toBe('ltb_st_module_ecommerce_customer_tokens');
    expect(s.attributes.customer).toMatchObject({ type: 'relation', relation: 'manyToOne' });
    expect(s.attributes.purpose.enum).toEqual(['VERIFY_EMAIL', 'RESET_PASSWORD', 'CHANGE_EMAIL']);
    expect(s.attributes.tokenHash).toMatchObject({ type: 'string', required: true, unique: true });
    expect(s.attributes.email.type).toBe('string');
    expect(s.attributes.expiresAt).toMatchObject({ type: 'datetime', required: true });
    expect(s.attributes.usedAt.type).toBe('datetime');
    hidden(s);
  });
});
