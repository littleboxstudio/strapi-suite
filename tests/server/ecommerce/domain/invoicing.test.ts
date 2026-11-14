import { describe, it, expect } from 'vitest';
import {
  invoiceCustomer,
  issueDate,
  paymentMethodName,
  STORE_CREDIT_METHOD_NAME,
} from '../../../../server/src/services/modules/ecommerce/domain/invoicing';

describe('invoiceCustomer', () => {
  const customer = { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.com' };
  const billing = {
    firstName: 'Ana',
    lastName: 'Silva',
    line1: 'Rua A, 1',
    line2: '2º Esq',
    postalCode: '1000-001',
    city: 'Lisboa',
    country: 'PT',
  };

  it('without NIF → nif null and person name', () => {
    expect(invoiceCustomer(billing, customer)).toEqual({
      name: 'Ana Silva',
      nif: null,
      address: 'Rua A, 1, 2º Esq',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
      email: 'ana@example.com',
    });
  });

  it('with company → company name and NIF', () => {
    expect(
      invoiceCustomer({ ...billing, company: 'ACME Lda', nif: '501234567' }, customer)
    ).toMatchObject({
      name: 'ACME Lda',
      nif: '501234567',
    });
  });

  it('no billing address → customer name, empty address, nif null', () => {
    expect(invoiceCustomer(null, customer)).toEqual({
      name: 'Ana Silva',
      nif: null,
      address: '',
      postalCode: '',
      city: '',
      country: '',
      email: 'ana@example.com',
    });
  });
});

describe('issueDate', () => {
  it('23:30 UTC on 31/12 in Europe/Lisbon (winter) → 12-31', () => {
    expect(issueDate(new Date('2026-12-31T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-12-31');
  });

  it('uses the store time zone', () => {
    expect(issueDate(new Date('2026-12-31T23:30:00Z'), 'Europe/Madrid')).toBe('2027-01-01');
    expect(issueDate(new Date('2026-07-01T23:30:00Z'), 'Europe/Lisbon')).toBe('2026-07-02');
  });

  it('falls back to UTC for an invalid time zone', () => {
    expect(issueDate(new Date('2026-07-01T23:30:00Z'), 'Not/AZone')).toBe('2026-07-01');
  });
});

describe('paymentMethodName', () => {
  it('Stripe, store credit and manual payments name their Moloni method', () => {
    expect(paymentMethodName('STRIPE', 'x')).toBe('Stripe');
    expect(paymentMethodName('STORE_CREDIT', null)).toBe('Crédito em carteira');
    expect(STORE_CREDIT_METHOD_NAME).toBe('Crédito em carteira');
    expect(paymentMethodName('MANUAL', '  MB WAY ')).toBe('MB WAY');
    expect(paymentMethodName('MANUAL', null)).toBe('');
    expect(paymentMethodName('MANUAL', 42)).toBe('');
  });
});
