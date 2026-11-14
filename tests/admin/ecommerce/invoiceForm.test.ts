import { describe, it, expect } from 'vitest';
import {
  MAX_CREDIT_NOTE_REASON,
  buildCreditNoteInput,
  creditNoteTotal,
  emptyCreditNoteForm,
  invoiceActions,
  invoiceHasDetails,
  isDetailAction,
  invoiceFailureMessageId,
  invoiceStatusTone,
  isFailedReplay,
  isUncertainResult,
  issuedWarnings,
  canMarkFailed,
  hasReturnable,
  validateCreditNoteForm,
  type CreditNoteForm,
} from '../../../admin/src/ecommerce/utils/invoiceForm';
import type { CreditNoteOptions } from '../../../admin/src/ecommerce/orderTypes';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');
const P = 'littlebox-strapi-suite.';

const options = (overrides: Partial<CreditNoteOptions> = {}): CreditNoteOptions => ({
  lines: [],
  creditable: [1000, 500],
  correction: { lines: [], total: 1500 },
  returnable: [{ index: 0, units: 1, unitsLeft: 3, valueLeft: 1000 }],
  shipping: [{ index: 1, value: 500 }],
  ...overrides,
});

const form = (overrides: Partial<CreditNoteForm> = {}): CreditNoteForm => ({
  creditType: 'RETURN',
  quantities: { 0: 1 },
  shipping: [],
  reason: 'Returned item',
  ...overrides,
});

describe('emptyCreditNoteForm', () => {
  it('starts on RETURN when some returnable line has units, with nothing chosen', () => {
    expect(emptyCreditNoteForm(options())).toEqual({
      creditType: 'RETURN',
      quantities: {},
      shipping: [],
      reason: '',
    });
  });

  it('starts on CORRECTION when nothing is returnable (no entries, or all with 0 units)', () => {
    expect(emptyCreditNoteForm(options({ returnable: [] })).creditType).toBe('CORRECTION');
    expect(
      emptyCreditNoteForm(
        options({ returnable: [{ index: 0, units: 0, unitsLeft: 3, valueLeft: 1000 }] })
      ).creditType
    ).toBe('CORRECTION');
  });
});

describe('hasReturnable', () => {
  it('is true only when some returnable entry has units > 0', () => {
    expect(hasReturnable(options())).toBe(true);
    expect(hasReturnable(options({ returnable: [] }))).toBe(false);
    expect(
      hasReturnable(
        options({ returnable: [{ index: 0, units: 0, unitsLeft: 3, valueLeft: 1000 }] })
      )
    ).toBe(false);
  });
});

describe('validateCreditNoteForm', () => {
  it('accepts a valid RETURN', () => {
    expect(validateCreditNoteForm(form(), options())).toEqual({});
    expect(validateCreditNoteForm(form({ quantities: {}, shipping: [1] }), options())).toEqual({});
  });

  it('refuses a quantity above the returnable units of its line', () => {
    expect(validateCreditNoteForm(form({ quantities: { 0: 2 } }), options())).toEqual({
      'quantities.0': 'exceeds_creditable',
    });
  });

  it('a RETURN with nothing chosen → lines: required', () => {
    expect(validateCreditNoteForm(form({ quantities: {} }), options())).toEqual({
      lines: 'required',
    });
    expect(validateCreditNoteForm(form({ quantities: { 0: 0 } }), options())).toEqual({
      lines: 'required',
    });
  });

  it('a CORRECTION needs only the reason', () => {
    expect(
      validateCreditNoteForm(
        form({ creditType: 'CORRECTION', quantities: { 0: 9 } }),
        options({ returnable: [] })
      )
    ).toEqual({});
    expect(
      validateCreditNoteForm(form({ creditType: 'CORRECTION', reason: '' }), options())
    ).toEqual({
      reason: 'required',
    });
  });

  it('an empty reason → required; a reason over 500 characters → too_long', () => {
    expect(validateCreditNoteForm(form({ reason: '   ' }), options())).toEqual({
      reason: 'required',
    });
    expect(
      validateCreditNoteForm(form({ reason: 'x'.repeat(MAX_CREDIT_NOTE_REASON) }), options())
    ).toEqual({});
    expect(
      validateCreditNoteForm(form({ reason: 'x'.repeat(MAX_CREDIT_NOTE_REASON + 1) }), options())
    ).toEqual({
      reason: 'too_long',
    });
  });
});

describe('creditNoteTotal', () => {
  it('RETURN: the value of the chosen units (as the server) plus the ticked shipping lines', () => {
    expect(creditNoteTotal(form({ quantities: { 0: 1 }, shipping: [1] }), options())).toBe(833);
    expect(
      creditNoteTotal(
        form({ quantities: { 0: 3 } }),
        options({ returnable: [{ index: 0, units: 3, unitsLeft: 3, valueLeft: 1000 }] })
      )
    ).toBe(1000);
  });

  it('RETURN: a quantity above the returnable units counts nothing', () => {
    expect(creditNoteTotal(form({ quantities: { 0: 2 } }), options())).toBe(0);
  });

  it('CORRECTION: the whole creditable value', () => {
    expect(creditNoteTotal(form({ creditType: 'CORRECTION' }), options())).toBe(1500);
  });
});

describe('buildCreditNoteInput', () => {
  it('CORRECTION sends no lines or shipping indexes', () => {
    expect(
      buildCreditNoteInput(
        form({ creditType: 'CORRECTION', shipping: [1], reason: '  Wrong NIF ' }),
        'key-1'
      )
    ).toEqual({ creditType: 'CORRECTION', reason: 'Wrong NIF', idempotencyKey: 'key-1' });
  });

  it('RETURN sends the lines with a quantity (0 left out) and the ticked shipping indexes', () => {
    expect(
      buildCreditNoteInput(
        form({ quantities: { 2: 1, 0: 0, 1: 2 }, shipping: [3], reason: ' Damaged ' }),
        'key-2'
      )
    ).toEqual({
      creditType: 'RETURN',
      lines: [
        { index: 1, quantity: 2 },
        { index: 2, quantity: 1 },
      ],
      shippingIndexes: [3],
      reason: 'Damaged',
      idempotencyKey: 'key-2',
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

describe('issue results', () => {
  it('a FAILED row returned by a replay is a failure, not a success', () => {
    expect(isFailedReplay({ status: 'FAILED' })).toBe(true);
    expect(isFailedReplay({ status: 'ISSUED' })).toBe(false);
    expect(isFailedReplay({ status: 'UNCERTAIN' })).toBe(false);
  });

  it('UNCERTAIN and PENDING results are uncertain', () => {
    expect(isUncertainResult({ status: 'UNCERTAIN' })).toBe(true);
    expect(isUncertainResult({ status: 'PENDING' })).toBe(true);
    expect(isUncertainResult({ status: 'ISSUED' })).toBe(false);
    expect(isUncertainResult({ status: 'FAILED' })).toBe(false);
  });

  it('issuedWarnings keeps the warnings the admin must act on after issuing', () => {
    expect(issuedWarnings({ warnings: ['TOTAL_MISMATCH', 'RECEIPT_FAILED', 'OTHER'] })).toEqual([
      'TOTAL_MISMATCH',
      'RECEIPT_FAILED',
    ]);
    expect(issuedWarnings({ warnings: [] })).toEqual([]);
  });
});

describe('canMarkFailed', () => {
  const uncertain = { status: 'UNCERTAIN' as const, reconcilable: true };
  it('needs a reconcilable row and the explicit confirmation', () => {
    expect(canMarkFailed(uncertain, true)).toBe(true);
    expect(canMarkFailed(uncertain, false)).toBe(false);
    expect(canMarkFailed({ status: 'PENDING', reconcilable: false }, true)).toBe(false);
    expect(canMarkFailed({ status: 'PENDING', reconcilable: true }, true)).toBe(true);
    expect(canMarkFailed({ status: 'ISSUED', reconcilable: true }, true)).toBe(false);
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

  it('the fallback for unknown codes has an en and a pt message', () => {
    expect(en[`${P}ecommerce.orders.invoices.failure.unknown`]).toEqual(expect.any(String));
    expect(pt[`${P}ecommerce.orders.invoices.failure.unknown`]).toEqual(expect.any(String));
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

describe('invoice details', () => {
  const doc = { status: 'ISSUED' as const, error: null, warnings: [] as string[] };

  it('Reconcile and Mark as failed live in the modal; PDF and credit note stay in the row', () => {
    expect(isDetailAction('RECONCILE')).toBe(true);
    expect(isDetailAction('MARK_FAILED')).toBe(true);
    expect(isDetailAction('PDF')).toBe(false);
    expect(isDetailAction('CREDIT_NOTE')).toBe(false);
  });

  it('an issued document with no warning has nothing more than its badge', () => {
    expect(invoiceHasDetails(doc, ['PDF', 'CREDIT_NOTE'])).toBe(false);
  });

  it('uncertain, pending, a failure with a reason or a warning have an explanation', () => {
    expect(invoiceHasDetails({ ...doc, status: 'UNCERTAIN' }, [])).toBe(true);
    expect(invoiceHasDetails({ ...doc, status: 'PENDING' }, [])).toBe(true);
    expect(invoiceHasDetails({ ...doc, status: 'FAILED', error: 'MOLONI_ERROR' }, [])).toBe(true);
    expect(invoiceHasDetails({ ...doc, status: 'FAILED' }, [])).toBe(false);
    expect(invoiceHasDetails({ ...doc, warnings: ['TOTAL_MISMATCH'] }, ['PDF'])).toBe(true);
  });
});
