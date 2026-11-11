import { describe, it, expect } from 'vitest';
import {
  generateStoreCreditCode,
  storeCreditUsable,
} from '../../../../server/src/services/modules/ecommerce/domain/storeCredit';

describe('generateStoreCreditCode', () => {
  it('matches the format', () => {
    const random = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => i * 37 + 11));
    expect(generateStoreCreditCode(random)).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it('maps bytes with byte % 32', () => {
    const random = (n: number) => Buffer.alloc(n, 0);
    expect(generateStoreCreditCode(random)).toBe('AAAA-AAAA-AAAA');
    const r2 = (n: number) => Buffer.alloc(n, 255);
    expect(generateStoreCreditCode(r2)).toBe('9999-9999-9999');
  });
});

describe('storeCreditUsable', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const base = { status: 'ACTIVE', balance: 1000, expiresAt: null as any, emailNormalized: 'a@b.pt' };
  it('ok', () => {
    expect(storeCreditUsable(base, ' A@B.pt ', now)).toEqual({ ok: true });
  });
  it('email mismatch', () => {
    expect(storeCreditUsable(base, 'x@b.pt', now)).toEqual({ ok: false, code: 'STORE_CREDIT_EMAIL_MISMATCH' });
  });
  it('expired', () => {
    expect(storeCreditUsable({ ...base, expiresAt: '2026-05-31T00:00:00Z' }, 'a@b.pt', now)).toEqual({
      ok: false,
      code: 'STORE_CREDIT_EXPIRED',
    });
    expect(storeCreditUsable({ ...base, expiresAt: '2026-07-01T00:00:00Z' }, 'a@b.pt', now)).toEqual({ ok: true });
  });
  it('empty', () => {
    expect(storeCreditUsable({ ...base, balance: 0 }, 'a@b.pt', now)).toEqual({
      ok: false,
      code: 'STORE_CREDIT_EMPTY',
    });
  });
  it('void', () => {
    expect(storeCreditUsable({ ...base, status: 'VOID' }, 'a@b.pt', now)).toEqual({
      ok: false,
      code: 'STORE_CREDIT_VOID',
    });
  });
});
