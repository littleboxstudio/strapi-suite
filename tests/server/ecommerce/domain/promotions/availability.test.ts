import { describe, it, expect } from 'vitest';
import {
  promotionStatus,
  candidateBlock,
  percentOf,
  displayNameFor,
  targetMatches,
  requiresVerifiedEmail,
  type PromotionCandidate,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const now = new Date('2026-06-01T12:00:00.000Z');
const base = (over: Partial<PromotionCandidate> = {}): PromotionCandidate => ({
  id: 1,
  name: 'P',
  code: null,
  method: 'AUTOMATIC',
  displayName: {},
  priority: 0,
  eligibility: { mode: 'ALL' },
  conditions: { type: 'GROUP', operator: 'AND', children: [] },
  benefits: [],
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  perOrderLimit: null,
  version: 1,
  active: true,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  requireVerifiedEmail: false,
  redemptions: 0,
  customerUses: 0,
  ...over,
});

describe('promotionStatus', () => {
  it('orders the checks', () => {
    expect(promotionStatus({ active: false, startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-02-01T00:00:00.000Z' }, now)).toBe('INACTIVE');
    expect(promotionStatus({ active: true, startsAt: '2026-07-01T00:00:00.000Z', endsAt: null }, now)).toBe('SCHEDULED');
    expect(promotionStatus({ active: true, startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-06-01T12:00:00.000Z' }, now)).toBe('EXPIRED');
    expect(promotionStatus({ active: true, startsAt: '2026-01-01T00:00:00.000Z', endsAt: null }, now)).toBe('ACTIVE');
  });
});

describe('candidateBlock', () => {
  const ctx = { now, email: 'a@b.pt' };
  it('returns null when available', () => expect(candidateBlock(base(), ctx)).toBeNull());
  it('state first', () => expect(candidateBlock(base({ active: false }), ctx)).toBe('INACTIVE'));
  it('usage limit', () =>
    expect(candidateBlock(base({ redemptions: 100, usageLimit: 100 }), ctx)).toBe('USAGE_LIMIT_REACHED'));
  it('customer limit only with email', () => {
    const c = base({ customerUses: 1, perCustomerLimit: 1 });
    expect(candidateBlock(c, ctx)).toBe('CUSTOMER_LIMIT_REACHED');
    expect(candidateBlock(c, { now, email: null })).toBeNull();
  });
  it('EMAILS eligibility', () => {
    const c = base({ eligibility: { mode: 'EMAILS', emails: ['a@b.pt'] } });
    expect(candidateBlock(c, { now, email: null })).toBe('EMAIL_NOT_ELIGIBLE');
    expect(candidateBlock(c, { now, email: 'x@b.pt' })).toBe('EMAIL_NOT_ELIGIBLE');
    expect(candidateBlock(c, ctx)).toBeNull();
  });
});

describe('hardening', () => {
  it('checks the customer limit before e-mail eligibility', () => {
    const c = base({
      customerUses: 1,
      perCustomerLimit: 1,
      eligibility: { mode: 'EMAILS', emails: ['x@b.pt'] },
    });
    expect(candidateBlock(c, { now, email: 'a@b.pt' })).toBe('CUSTOMER_LIMIT_REACHED');
  });
  it('treats unparseable stored dates as INACTIVE', () => {
    expect(promotionStatus({ active: true, startsAt: 'garbage', endsAt: null }, now)).toBe('INACTIVE');
    expect(promotionStatus({ active: true, startsAt: '2026-01-01T00:00:00.000Z', endsAt: 'garbage' }, now)).toBe('INACTIVE');
  });
});

describe('helpers', () => {
  it('percentOf rounds half up', () => {
    expect(percentOf(1999, 10)).toBe(200);
    expect(percentOf(1005, 12.5)).toBe(126);
    expect(percentOf(1000, 33.33)).toBe(333);
  });
  it('displayNameFor falls back', () => {
    const p = { name: 'N', displayName: { pt: 'Verão' } };
    expect(displayNameFor(p, 'pt', 'en')).toBe('Verão');
    expect(displayNameFor({ name: 'N', displayName: { en: 'Summer' } }, 'pt', 'en')).toBe('Summer');
    expect(displayNameFor(p, 'fr', 'de')).toBe('N');
  });
  it('targetMatches variant or product', () => {
    const t = { productIds: [1], variantIds: [9] };
    expect(targetMatches(t, { productId: 1, variantId: 2 })).toBe(true);
    expect(targetMatches(t, { productId: 2, variantId: 9 })).toBe(true);
    expect(targetMatches(t, { productId: 2, variantId: 3 })).toBe(false);
  });
});

describe('requiresVerifiedEmail', () => {
  const deep = {
    type: 'GROUP',
    operator: 'AND',
    children: [
      { type: 'GROUP', operator: 'OR', children: [{ type: 'EMAIL', operator: 'contains', value: '@empresa.pt' }] },
    ],
  } as any;
  it('is true for the flag, an e-mail list, a nested EMAIL condition and a per-customer limit', () => {
    expect(requiresVerifiedEmail(base({ requireVerifiedEmail: true }))).toBe(true);
    expect(requiresVerifiedEmail(base({ eligibility: { mode: 'EMAILS', emails: ['a@x.pt'] } }))).toBe(true);
    expect(requiresVerifiedEmail(base({ conditions: { type: 'GROUP', operator: 'AND', children: [deep] } }))).toBe(true);
    expect(requiresVerifiedEmail(base({ perCustomerLimit: 1 }))).toBe(true);
  });
  it('is false otherwise', () => {
    expect(requiresVerifiedEmail(base())).toBe(false);
  });
});
