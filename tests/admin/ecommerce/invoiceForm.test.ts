import { describe, it, expect } from 'vitest';
import {
  MAX_CREDIT_NOTE_REASON,
  buildCreditNoteInput,
  creditNoteTotal,
  emptyCreditNoteForm,
  hasUninvoicedPayments,
  invoiceActions,
  invoiceFailureMessageId,
  invoiceStatusTone,
  validateCreditNoteForm,
  type CreditNoteForm,
} from '../../../admin/src/ecommerce/utils/invoiceForm';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const form = (overrides: Partial<CreditNoteForm> = {}): CreditNoteForm => ({
  lines: [
    { index: 0, amount: '10,00' },
    { index: 1, amount: '' },
  ],
  reason: 'Returned item',
  ...overrides,
});

const creditable = [1500, 300];

describe('emptyCreditNoteForm', () => {
  it('prefills each line with the server suggestion (empty when 0)', () => {
    expect(
      emptyCreditNoteForm({ lines: [{}, {}] as any, creditable: [1500, 300], suggested: [1234, 0] }, 'pt-PT')
    ).toEqual({
      lines: [
        { index: 0, amount: '12,34' },
        { index: 1, amount: '' },
      ],
      reason: '',
    });
  });

  it('never prefills more than the creditable value', () => {
    expect(
      emptyCreditNoteForm({ lines: [{}] as any, creditable: [500], suggested: [900] }, 'en').lines[0].amount
    ).toBe('5.00');
  });
});

describe('validateCreditNoteForm', () => {
  it('accepts a valid credit note', () => {
    expect(validateCreditNoteForm(form(), creditable)).toEqual({});
  });

  it('refuses an amount above the creditable value of its line', () => {
    expect(validateCreditNoteForm(form({ lines: [{ index: 0, amount: '15,01' }] }), creditable)).toEqual({
      'lines.0': 'exceeds_creditable',
    });
    expect(validateCreditNoteForm(form({ lines: [{ index: 0, amount: '15,00' }] }), creditable)).toEqual({});
  });

  it('refuses an amount that is not money', () => {
    expect(validateCreditNoteForm(form({ lines: [{ index: 1, amount: 'abc' }] }), creditable)).toEqual({
      'lines.1': 'invalid_amount',
    });
  });

  it('a total of 0 → required', () => {
    expect(
      validateCreditNoteForm(
        form({
          lines: [
            { index: 0, amount: '' },
            { index: 1, amount: '0,00' },
          ],
        }),
        creditable
      )
    ).toEqual({ lines: 'required' });
  });

  it('an empty reason → required; a reason over 500 characters → too_long', () => {
    expect(validateCreditNoteForm(form({ reason: '   ' }), creditable)).toEqual({ reason: 'required' });
    expect(validateCreditNoteForm(form({ reason: 'x'.repeat(MAX_CREDIT_NOTE_REASON) }), creditable)).toEqual({});
    expect(
      validateCreditNoteForm(form({ reason: 'x'.repeat(MAX_CREDIT_NOTE_REASON + 1) }), creditable)
    ).toEqual({ reason: 'too_long' });
  });
});

describe('creditNoteTotal', () => {
  it('sums the valid amounts', () => {
    expect(
      creditNoteTotal(
        form({
          lines: [
            { index: 0, amount: '10,50' },
            { index: 1, amount: '2' },
            { index: 2, amount: 'x' },
          ],
        })
      )
    ).toBe(1250);
    expect(creditNoteTotal(form({ lines: [] }))).toBe(0);
  });
});

describe('buildCreditNoteInput', () => {
  it('sends the lines with a value, the trimmed reason and the key', () => {
    expect(buildCreditNoteInput(form({ reason: '  Damaged ' }), 'key-1')).toEqual({
      lines: [{ index: 0, value: 1000 }],
      reason: 'Damaged',
      idempotencyKey: 'key-1',
    });
  });
});

describe('invoiceStatusTone', () => {
  it('maps each status to a badge variant', () => {
    expect(invoiceStatusTone('ISSUED')).toBe('success');
    expect(invoiceStatusTone('PENDING')).toBe('secondary');
    expect(invoiceStatusTone('UNCERTAIN')).toBe('warning');
    expect(invoiceStatusTone('FAILED')).toBe('danger');
    expect(invoiceStatusTone('SOMETHING_ELSE')).toBe('neutral');
  });
});

describe('invoiceActions', () => {
  const invoice = {
    kind: 'INVOICE' as const,
    status: 'ISSUED' as const,
    total: 1000,
    credited: 0,
    reconcilable: false,
  };

  it('an issued invoice: PDF and a credit note while something is left to credit', () => {
    expect(invoiceActions(invoice, true)).toEqual(['PDF', 'CREDIT_NOTE']);
    expect(invoiceActions({ ...invoice, credited: 1000 }, true)).toEqual(['PDF']);
  });

  it('without invoicing.manage only the PDF', () => {
    expect(invoiceActions(invoice, false)).toEqual(['PDF']);
    expect(invoiceActions({ ...invoice, status: 'UNCERTAIN', reconcilable: true }, false)).toEqual([]);
  });

  it('a credit note is never credited', () => {
    expect(invoiceActions({ ...invoice, kind: 'CREDIT_NOTE' }, true)).toEqual(['PDF']);
  });

  it('reconcile and mark as failed only when the server says the row is reconcilable', () => {
    expect(invoiceActions({ ...invoice, status: 'UNCERTAIN', reconcilable: true }, true)).toEqual([
      'RECONCILE',
      'MARK_FAILED',
    ]);
    expect(invoiceActions({ ...invoice, status: 'PENDING', reconcilable: false }, true)).toEqual([]);
    expect(invoiceActions({ ...invoice, status: 'PENDING', reconcilable: true }, true)).toEqual([
      'RECONCILE',
      'MARK_FAILED',
    ]);
    expect(invoiceActions({ ...invoice, status: 'FAILED' }, true)).toEqual([]);
  });
});

describe('hasUninvoicedPayments', () => {
  it('is true when a payment still has an invoiceable amount', () => {
    expect(hasUninvoicedPayments([{ invoice: { invoiceable: 0 } }, { invoice: { invoiceable: 100 } }])).toBe(true);
    expect(hasUninvoicedPayments([{ invoice: { invoiceable: 0 } }, {}])).toBe(false);
  });
});

describe('invoiceFailureMessageId', () => {
  it('translates stored failure codes and API codes; null for unknown codes', () => {
    expect(invoiceFailureMessageId('MARKED_FAILED')).toBe('ecommerce.orders.invoices.failure.MARKED_FAILED');
    expect(invoiceFailureMessageId('NOT_FOUND_AT_PROVIDER')).toBe(
      'ecommerce.orders.invoices.failure.NOT_FOUND_AT_PROVIDER'
    );
    expect(invoiceFailureMessageId('BILLING_TAX_NOT_FOUND')).toBe('ecommerce.orders.errors.BILLING_TAX_NOT_FOUND');
    expect(invoiceFailureMessageId('coverage_mismatch')).toBe('ecommerce.orders.errors.coverage_mismatch');
    expect(invoiceFailureMessageId('WHATEVER')).toBeNull();
  });

  it.each(['MARKED_FAILED', 'NOT_FOUND_AT_PROVIDER'])('%s has an en and a pt message', (code) => {
    const key = `${P}ecommerce.orders.invoices.failure.${code}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });

  it.each(['TOTAL_MISMATCH', 'RECEIPT_FAILED', 'ISSUED_AFTER_FAILED', 'DUPLICATE_INVOICE'])(
    'warning %s has an en and a pt message',
    (code) => {
      const key = `${P}ecommerce.orders.invoices.warnings.${code}`;
      expect(en[key]).toEqual(expect.any(String));
      expect(pt[key]).toEqual(expect.any(String));
    }
  );

  it('DUPLICATE_INVOICE asks to cancel the duplicate at the provider', () => {
    expect(en[`${P}ecommerce.orders.invoices.warnings.DUPLICATE_INVOICE`]).toMatch(/cancel/i);
    expect(pt[`${P}ecommerce.orders.invoices.warnings.DUPLICATE_INVOICE`]).toMatch(/anule/i);
  });
});

describe('Moloni settings labels', () => {
  it.each(['paymentMethodId', 'storeCreditPaymentMethodId', 'productCategoryId', 'measurementUnitId', 'shippingReference'])(
    '%s has an en and a pt label',
    (field) => {
      const key = `${P}ecommerce.settings.providers.moloni.fields.${field}`;
      expect(en[key]).toEqual(expect.any(String));
      expect(pt[key]).toEqual(expect.any(String));
    }
  );
});
