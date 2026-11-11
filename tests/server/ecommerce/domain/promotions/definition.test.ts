import { describe, it, expect } from 'vitest';
import {
  validatePromotionInput,
  normalizePromotionCode,
} from '../../../../../server/src/services/modules/ecommerce/domain/promotions';

const ctx = { locales: ['en', 'pt'], timeZone: 'Europe/Lisbon' };
const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
const valid = (over: Record<string, unknown> = {}): any => ({
  name: 'Verão',
  description: null,
  method: 'CODE',
  code: 'VERAO20',
  displayName: {},
  priority: 0,
  active: true,
  startsAt: '2026-07-01T10:00',
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  perOrderLimit: null,
  eligibility: { mode: 'ALL' },
  conditions: group(),
  benefits: [{ type: 'ORDER_PERCENT', percent: 10 }],
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  ...over,
});
const codes = (raw: unknown) =>
  validatePromotionInput(raw, ctx).errors.map((e) => `${e.path}:${e.code}`);

describe('normalizePromotionCode', () => {
  it('trims and uppercases', () => expect(normalizePromotionCode(' verao20 ')).toBe('VERAO20'));
  it('handles non strings', () => expect(normalizePromotionCode(null)).toBe(''));
});

describe('validatePromotionInput', () => {
  it('accepts a valid input, converting dates to UTC and normalising the code', () => {
    const r = validatePromotionInput(valid({ code: ' verao20 ' }), ctx);
    expect(r.errors).toEqual([]);
    expect(r.value?.code).toBe('VERAO20');
    expect(r.value?.startsAt).toBe('2026-07-01T09:00:00.000Z');
  });
  it('rejects voucher-shaped codes', () =>
    expect(codes(valid({ code: 'ABCD-EFGH-JKLM' }))).toContain('code:code_reserved_format'));
  it('requires a code for CODE, not for AUTOMATIC', () => {
    expect(codes(valid({ code: null }))).toContain('code:required');
    expect(codes(valid({ method: 'AUTOMATIC', code: null }))).toEqual([]);
  });
  it('rejects bad code chars', () => expect(codes(valid({ code: 'a b' }))).toContain('code:invalid_code'));
  it('validates name and method', () => {
    expect(codes(valid({ name: '' }))).toContain('name:required');
    expect(codes(valid({ name: 'x'.repeat(121) }))).toContain('name:too_long');
    expect(codes(valid({ method: 'X' }))).toContain('method:invalid');
  });
  it('validates percent', () => {
    for (const percent of [0, 100.5, 10.123]) {
      expect(codes(valid({ benefits: [{ type: 'ORDER_PERCENT', percent }] }))).toContain(
        'benefits.0.percent:invalid_percent'
      );
    }
    expect(codes(valid({ benefits: [{ type: 'ORDER_PERCENT', percent: 12.5 }] }))).toEqual([]);
  });
  it('validates amounts', () =>
    expect(codes(valid({ benefits: [{ type: 'ORDER_FIXED', amount: 0 }] }))).toContain(
      'benefits.0.amount:invalid_amount'
    ));
  it('requires 1-10 benefits', () => {
    expect(codes(valid({ benefits: [] }))).toContain('benefits:required');
  });
  it('rejects depth 4', () => {
    const deep = group([group([group([group([])])])]);
    expect(codes(valid({ conditions: deep }))).toContain('conditions:too_deep');
    expect(codes(valid({ conditions: group([group([group([])])]) }))).toEqual([]);
  });
  it('rejects disallowed operators', () =>
    expect(
      codes(valid({ conditions: group([{ type: 'TOTAL_QUANTITY', operator: 'contains', value: 1 }]) }))
    ).toContain('conditions.children.0.operator:invalid_operator'));
  it('validates condition values and ranges', () => {
    expect(
      codes(valid({ conditions: group([{ type: 'SUBTOTAL', operator: 'gte', value: -1 }]) }))
    ).toContain('conditions.children.0.value:invalid_value');
    expect(
      codes(valid({ conditions: group([{ type: 'SUBTOTAL_BETWEEN', min: 10, max: 5 }]) }))
    ).toContain('conditions.children.0.max:invalid_value');
    expect(
      codes(
        valid({
          conditions: group([
            { type: 'CART_CONTAINS', match: 'ANY', target: { productIds: [], variantIds: [] } },
          ]),
        })
      )
    ).toContain('conditions.children.0.target:required');
  });
  it('limits leaves to 50', () => {
    const leaves = Array.from({ length: 51 }, () => ({ type: 'TOTAL_QUANTITY', operator: 'gte', value: 1 }));
    expect(codes(valid({ conditions: group(leaves) }))).toContain('conditions:too_many');
  });
  it('validates emails with index', () => {
    expect(codes(valid({ eligibility: { mode: 'EMAILS', emails: ['a@b.pt', 'bad'] } }))).toContain(
      'eligibility.emails.1:invalid_email'
    );
    const r = validatePromotionInput(valid({ eligibility: { mode: 'EMAILS', emails: ['A@B.pt', 'a@b.pt'] } }), ctx);
    expect(r.value?.eligibility).toEqual({ mode: 'EMAILS', emails: ['a@b.pt'] });
    expect(
      codes(valid({ conditions: group([{ type: 'EMAIL', operator: 'eq', value: 'bad' }]) }))
    ).toContain('conditions.children.0.value:invalid_email');
  });
  it('rejects unknown locales and drops empty names', () => {
    expect(codes(valid({ displayName: { fr: 'x' } }))).toContain('displayName.fr:unknown_locale');
    const r = validatePromotionInput(valid({ displayName: { en: 'Hi', pt: '  ' } }), ctx);
    expect(r.value?.displayName).toEqual({ en: 'Hi' });
  });
  it('forces with* false when exclusive', () => {
    const r = validatePromotionInput(
      valid({ stacking: { exclusive: true, withProduct: true, withOrder: true, withShipping: true } }),
      ctx
    );
    expect(r.value?.stacking).toEqual({ exclusive: true, withProduct: false, withOrder: false, withShipping: false });
  });
  it('rejects endsAt not after startsAt and invalid dates', () => {
    expect(codes(valid({ endsAt: '2026-07-01T10:00' }))).toContain('endsAt:ends_before_start');
    expect(codes(valid({ startsAt: '2026-13-01T00:00' }))).toContain('startsAt:invalid_date');
  });
  it('validates priority and limits', () => {
    expect(codes(valid({ priority: 1001 }))).toContain('priority:invalid');
    expect(codes(valid({ usageLimit: 0 }))).toContain('usageLimit:invalid');
    expect(codes(valid({ perCustomerLimit: 1.5 }))).toContain('perCustomerLimit:invalid');
  });
  it('validates BUY_X_GET_Y gift list', () => {
    const b = {
      type: 'BUY_X_GET_Y',
      buy: { target: { productIds: [1], variantIds: [] }, quantity: 2, minAmount: null },
      get: { mode: 'GIFT', variantIds: [], quantity: 1 },
      reward: { kind: 'FREE' },
    };
    expect(codes(valid({ benefits: [b] }))).toContain('benefits.0.get.variantIds:required');
  });
  it('is strict about boolean flags', () => {
    expect(codes(valid({ active: 'yes' }))).toContain('active:invalid');
    expect(codes(valid({ stacking: { exclusive: 'true' } }))).toContain('stacking.exclusive:invalid');
    expect(codes(valid({ stacking: { exclusive: false, withOrder: 0 } }))).toContain('stacking.withOrder:invalid');
  });
  it('reports an unknown timezone explicitly', () => {
    const r = validatePromotionInput(valid(), { locales: ['en'], timeZone: 'Mars/Base' });
    expect(r.errors.map((e) => `${e.path}:${e.code}`)).toContain('timeZone:invalid_timezone');
    expect(r.errors.map((e) => e.code)).not.toContain('invalid_date');
  });
  it('stops recursion past the depth limit', () => {
    let g: any = group();
    for (let i = 0; i < 5000; i++) g = group([g]);
    const r = validatePromotionInput(valid({ conditions: g }), ctx);
    expect(r.errors.map((e) => e.code)).toContain('too_deep');
  });
});

describe('requireVerifiedEmail', () => {
  it('defaults to false, accepts a boolean and rejects other types', () => {
    expect(validatePromotionInput(valid(), ctx).value?.requireVerifiedEmail).toBe(false);
    expect(validatePromotionInput(valid({ requireVerifiedEmail: true }), ctx).value?.requireVerifiedEmail).toBe(true);
    expect(codes(valid({ requireVerifiedEmail: 'yes' }))).toContain('requireVerifiedEmail:invalid');
  });
});
