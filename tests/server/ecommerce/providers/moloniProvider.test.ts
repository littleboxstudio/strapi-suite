import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetMoloniTokensForTests } from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/client';
import {
  __resetMoloniLookupsForTests,
  moloniProvider,
} from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/provider';
import {
  __resetBillingProvidersForTests,
  getBillingProvider,
  registerBillingProvider,
} from '../../../../server/src/services/modules/ecommerce/providers/billing';
import type { InvoiceDraft } from '../../../../server/src/services/modules/ecommerce/providers/billing/types';
import { EcommerceBillingError } from '../../../../server/src/services/modules/ecommerce/errors';
import { json, moloniFake } from './moloniFake';

const rt = (config: Record<string, unknown> = {}) => ({
  config: { clientId: 'cid', username: 'u', companyId: 42, ...config },
  secrets: { clientSecret: 'CS', password: 'PW' },
});

const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  kind: 'INVOICE',
  ourReference: 'LB-INV-7',
  orderReference: '#1001',
  date: '2026-11-11',
  locale: 'pt',
  customer: {
    name: 'Ana Silva',
    nif: '123456789',
    address: 'Rua A, 1',
    postalCode: '1000-001',
    city: 'Lisboa',
    country: 'PT',
    email: 'ana@x.pt',
  },
  lines: [
    { orderLineId: 1, kind: 'ITEM', sku: 'SKU-1', name: 'Mug', quantity: 2, total: 2460, tax: 23, partial: false },
    { orderLineId: null, kind: 'SHIPPING', sku: 'PORTES', name: 'Shipping', quantity: 1, total: 615, tax: 23, partial: false },
  ],
  total: 3075,
  payments: [{ method: 'STRIPE', amount: 3075, date: '2026-11-10' }],
  ...over,
});

/** A Moloni account where everything already exists. */
function happyRoutes(over: Record<string, (b: any, q: URLSearchParams) => unknown> = {}) {
  return {
    'taxes/getAll': () => [
      { tax_id: 11, value: '23' },
      { tax_id: 12, value: 6 },
    ],
    'countries/getAll': () => [
      { country_id: 1, iso_3166_1: 'pt' },
      { country_id: 70, iso_3166_1: 'es' },
    ],
    'documentSets/getAll': () => [{ document_set_id: 5, name: 'A' }, { document_set_id: 6, name: 'B' }],
    'paymentMethods/getAll': () => [{ payment_method_id: 31 }, { payment_method_id: 32 }],
    'productCategories/getAll': () => [{ category_id: 41 }],
    'measurementUnits/getAll': () => [{ unit_id: 51 }],
    'customers/getByVat': (b: any) => [{ customer_id: b.vat === '999999990' ? 900 : 100, vat: b.vat }],
    'products/getByReference': (b: any) => [{ product_id: b.reference === 'PORTES' ? 201 : 200 }],
    'invoiceReceipts/insert': () => ({ valid: 1, document_id: 777 }),
    'invoices/insert': () => ({ valid: 1, document_id: 778 }),
    'receipts/insert': () => ({ valid: 1, document_id: 779 }),
    'creditNotes/insert': () => ({ valid: 1, document_id: 780 }),
    'documents/getUnrelatedProducts': () => [
      { document_product_id: 9001, product_id: 200, reference: 'SKU-1', qty: 2 },
      { document_product_id: 9002, product_id: 201, reference: 'PORTES', qty: 1 },
    ],
    'documents/getOne': (b: any) => ({
      document_id: b.document_id,
      number: 12,
      document_set_name: 'A',
      net_value: 30.75,
      date: '2026-11-11T00:00:00+0000',
      document_type: { saft_code: 'FR' },
    }),
    ...over,
  };
}

beforeEach(() => {
  __resetMoloniTokensForTests();
  __resetMoloniLookupsForTests();
  __resetBillingProvidersForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e);
const writes = (paths: string[]) => paths.filter((p) => p.endsWith('/insert'));

describe('billing registry', () => {
  it('importing the index registers moloni', () => {
    expect(getBillingProvider('moloni')).toBe(moloniProvider);
    expect(moloniProvider.capabilities).toEqual({ creditNotes: true, findByReference: true });
  });

  it('register rejects duplicates; reset restores the built-ins', () => {
    const fake = { ...moloniProvider, id: 'other' };
    registerBillingProvider(fake);
    expect(getBillingProvider('other')).toBe(fake);
    expect(() => registerBillingProvider(fake)).toThrow();
    __resetBillingProvidersForTests();
    expect(getBillingProvider('other')).toBeUndefined();
    expect(getBillingProvider('moloni')).toBe(moloniProvider);
  });
});

describe('moloniProvider.issue (FR, default)', () => {
  it('issues an invoice-receipt with our_reference, notes, lines and payments', async () => {
    const m = moloniFake(happyRoutes());
    const doc = await moloniProvider.issue(draft(), rt());
    expect(doc).toEqual({
      externalId: '777',
      number: 'A/12',
      series: 'A',
      documentType: 'FR',
      total: 3075,
      issuedAt: '2026-11-11',
      warnings: [],
    });
    const ins = m.of('invoiceReceipts/insert');
    expect(ins).toHaveLength(1);
    const b = ins[0].body;
    expect(b.company_id).toBe(42);
    expect(b.status).toBe(1);
    expect(b.our_reference).toBe('LB-INV-7');
    expect(b.notes).toBe('Order #1001');
    expect(b.date).toBe('2026-11-11');
    expect(b.document_set_id).toBe(5);
    expect(b.customer_id).toBe(100);
    expect(b.products).toEqual([
      { product_id: 200, name: 'Mug', qty: 2, price: 10, taxes: [{ tax_id: 11 }] },
      { product_id: 201, name: 'Shipping', qty: 1, price: 5, taxes: [{ tax_id: 11 }] },
    ]);
    expect(b.payments).toEqual([{ payment_method_id: 31, date: '2026-11-10', value: 30.75 }]);
    expect(m.of('documents/getOne')[0].body).toEqual({ company_id: 42, document_id: 777 });
    expect(m.of('customers/getByVat')[0].body.vat).toBe('123456789');
    expect(m.of('products/getByReference')[0].body).toEqual({ company_id: 42, reference: 'SKU-1', exact: 1 });
  });

  it('net unit price uses 4 decimal places', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(
      draft({
        lines: [{ orderLineId: 1, kind: 'ITEM', sku: 'SKU-1', name: 'Mug', quantity: 3, total: 1000, tax: 23, partial: false }],
        total: 1000,
        payments: [{ method: 'STRIPE', amount: 1000, date: '2026-11-10' }],
      }),
      rt()
    );
    // 1000 × 100 / 123 / 3 / 100 = 2.71002710...
    expect(m.of('invoiceReceipts/insert')[0].body.products[0].price).toBe(2.71);
  });

  it('uses the configured document set and payment methods; store credit uses its own method', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(
      draft({
        payments: [
          { method: 'STORE_CREDIT', amount: 1000, date: '2026-11-09' },
          { method: 'MANUAL', amount: 2075, date: '2026-11-10' },
        ],
      }),
      rt({ documentSetId: 6, paymentMethodId: 32, storeCreditPaymentMethodId: 99 })
    );
    const b = m.of('invoiceReceipts/insert')[0].body;
    expect(b.document_set_id).toBe(6);
    expect(b.payments).toEqual([
      { payment_method_id: 99, date: '2026-11-09', value: 10 },
      { payment_method_id: 32, date: '2026-11-10', value: 20.75 },
    ]);
  });

  it('store credit falls back to paymentMethodId', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(
      draft({ payments: [{ method: 'STORE_CREDIT', amount: 3075, date: '2026-11-09' }] }),
      rt({ paymentMethodId: 32 })
    );
    expect(m.of('invoiceReceipts/insert')[0].body.payments[0].payment_method_id).toBe(32);
  });

  it('customer without NIF uses Consumidor Final 999999990', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(draft({ customer: { ...draft().customer, nif: null } }), rt());
    expect(m.of('customers/getByVat')[0].body.vat).toBe('999999990');
    expect(m.of('invoiceReceipts/insert')[0].body.customer_id).toBe(900);
    expect(m.of('customers/insert')).toHaveLength(0);
  });

  it('creates Consumidor Final when missing (never invents a NIF)', async () => {
    const m = moloniFake(
      happyRoutes({
        'customers/getByVat': () => [],
        'customers/getNextNumber': () => ({ number: 'C-9' }),
        'customers/insert': () => ({ valid: 1, customer_id: 901 }),
      })
    );
    await moloniProvider.issue(draft({ customer: { ...draft().customer, nif: '' } }), rt());
    const c = m.of('customers/insert')[0].body;
    expect(c.vat).toBe('999999990');
    expect(c.name).toBe('Consumidor Final');
    expect(m.of('invoiceReceipts/insert')[0].body.customer_id).toBe(901);
  });

  it('creates a missing customer with getNextNumber + insert', async () => {
    const m = moloniFake(
      happyRoutes({
        'customers/getByVat': () => [],
        'customers/getNextNumber': () => ({ number: 'C-10' }),
        'customers/insert': () => ({ valid: 1, customer_id: 102 }),
      })
    );
    await moloniProvider.issue(draft({ customer: { ...draft().customer, country: 'ES' } }), rt());
    const c = m.of('customers/insert')[0];
    expect(c.body).toMatchObject({
      company_id: 42,
      vat: '123456789',
      number: 'C-10',
      name: 'Ana Silva',
      address: 'Rua A, 1',
      zip_code: '1000-001',
      city: 'Lisboa',
      country_id: 70,
      email: 'ana@x.pt',
      payment_method_id: 31,
    });
    expect(m.paths().indexOf('customers/getNextNumber')).toBeLessThan(m.paths().indexOf('customers/insert'));
    expect(m.of('invoiceReceipts/insert')[0].body.customer_id).toBe(102);
  });

  it('missing article -> products/insert before the document', async () => {
    const m = moloniFake(
      happyRoutes({
        'products/getByReference': () => [],
        'products/insert': (b: any) => ({ valid: 1, product_id: b.reference === 'PORTES' ? 301 : 300 }),
      })
    );
    await moloniProvider.issue(draft(), rt());
    const inserts = m.of('products/insert').map((c) => c.body);
    expect(inserts).toEqual([
      expect.objectContaining({
        company_id: 42,
        category_id: 41,
        type: 1,
        name: 'Mug',
        reference: 'SKU-1',
        price: 10,
        unit_id: 51,
        has_stock: 0,
        taxes: [{ tax_id: 11, value: 23, order: 1, cumulative: 0 }],
      }),
      expect.objectContaining({ type: 2, reference: 'PORTES', price: 5 }),
    ]);
    const p = m.paths();
    expect(p.lastIndexOf('products/insert')).toBeLessThan(p.indexOf('invoiceReceipts/insert'));
    expect(m.of('invoiceReceipts/insert')[0].body.products.map((x: any) => x.product_id)).toEqual([300, 301]);
  });

  it('configured category and unit are used for new articles', async () => {
    const m = moloniFake(
      happyRoutes({
        'products/getByReference': () => [],
        'products/insert': () => ({ valid: 1, product_id: 300 }),
      })
    );
    await moloniProvider.issue(draft(), rt({ productCategoryId: 49, measurementUnitId: 59 }));
    expect(m.of('products/insert')[0].body).toMatchObject({ category_id: 49, unit_id: 59 });
    expect(m.of('productCategories/getAll')).toHaveLength(0);
  });

  it('shipping lines use the configured shippingReference', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(draft(), rt({ shippingReference: 'ENVIO' }));
    expect(m.of('products/getByReference').map((c) => c.body.reference)).toEqual(['SKU-1', 'ENVIO']);
  });

  it('0% line without exemptionReason -> BILLING_EXEMPTION_REASON_MISSING, nothing inserted', async () => {
    const m = moloniFake(happyRoutes({ 'customers/getByVat': () => [] }));
    const err: any = await fail(
      moloniProvider.issue(
        draft({
          lines: [{ orderLineId: 1, kind: 'ITEM', sku: 'BOOK', name: 'Book', quantity: 1, total: 1000, tax: 0, partial: false }],
          total: 1000,
          payments: [{ method: 'STRIPE', amount: 1000, date: '2026-11-10' }],
        }),
        rt()
      )
    );
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_EXEMPTION_REASON_MISSING');
    expect(writes(m.paths())).toEqual([]);
  });

  it('0% line with exemptionReason uses exemption_reason (articles and document)', async () => {
    const m = moloniFake(
      happyRoutes({
        'products/getByReference': () => [],
        'products/insert': () => ({ valid: 1, product_id: 300 }),
      })
    );
    await moloniProvider.issue(
      draft({
        lines: [{ orderLineId: 1, kind: 'ITEM', sku: 'BOOK', name: 'Book', quantity: 1, total: 1000, tax: 0, partial: false }],
        total: 1000,
        payments: [{ method: 'STRIPE', amount: 1000, date: '2026-11-10' }],
      }),
      rt({ exemptionReason: 'M07' })
    );
    const p = m.of('products/insert')[0].body;
    expect(p.exemption_reason).toBe('M07');
    expect(p.taxes).toBeUndefined();
    const line = m.of('invoiceReceipts/insert')[0].body.products[0];
    expect(line).toEqual({ product_id: 300, name: 'Book', qty: 1, price: 10, exemption_reason: 'M07' });
  });

  it('unknown tax rate -> BILLING_TAX_NOT_FOUND, nothing inserted', async () => {
    const m = moloniFake(happyRoutes());
    const err: any = await fail(
      moloniProvider.issue(
        draft({
          lines: [{ orderLineId: 1, kind: 'ITEM', sku: 'X', name: 'X', quantity: 1, total: 1130, tax: 13, partial: false }],
          total: 1130,
          payments: [{ method: 'STRIPE', amount: 1130, date: '2026-11-10' }],
        }),
        rt()
      )
    );
    expect(err.code).toBe('BILLING_TAX_NOT_FOUND');
    expect(writes(m.paths())).toEqual([]);
  });

  it('empty lookup list -> BILLING_CONFIG_MISSING', async () => {
    moloniFake(happyRoutes({ 'documentSets/getAll': () => [] }));
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err.code).toBe('BILLING_CONFIG_MISSING');
  });

  it('a rejected insert (Moloni string errors) is a plain failure, saying which field and why', async () => {
    moloniFake(happyRoutes({ 'invoiceReceipts/insert': () => ['10 associated_documents', '1 document_set_id'] }));
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(err.uncertain).toBe(false);
    expect(err.message).toContain('associated_documents:10 (invalid document association)');
    expect(err.message).toContain('document_set_id:1 (required)');
  });

  it('an accepted insert without a document id is uncertain and names the shape of the answer', async () => {
    moloniFake(happyRoutes({ 'invoiceReceipts/insert': () => ({ valid: 1 }) }));
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err.uncertain).toBe(true);
    expect(err.message).toBe(
      'Moloni accepted invoiceReceipts/insert but its answer had no document id (it returned an object with valid).'
    );
  });

  it('FR payments not adding up to the total -> BILLING_REQUEST_FAILED, nothing inserted', async () => {
    const m = moloniFake(happyRoutes());
    const err: any = await fail(
      moloniProvider.issue(draft({ payments: [{ method: 'STRIPE', amount: 3000, date: '2026-11-10' }] }), rt())
    );
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(err.uncertain).toBe(false);
    expect(writes(m.paths())).toEqual([]);
    expect(m.of('customers/getByVat')).toHaveLength(0);
  });

  it('FT receipt payments not adding up to the total -> BILLING_REQUEST_FAILED, nothing inserted', async () => {
    const m = moloniFake(happyRoutes());
    const err: any = await fail(
      moloniProvider.issue(
        draft({
          payments: [
            { method: 'STRIPE', amount: 3000, date: '2026-11-10' },
            { method: 'MANUAL', amount: 100, date: '2026-11-10' },
          ],
        }),
        rt({ documentType: 'FT' })
      )
    );
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(writes(m.paths())).toEqual([]);
  });

  it('prefers the Portuguese VAT tax when several share the rate', async () => {
    const m = moloniFake(
      happyRoutes({
        'taxes/getAll': () => [
          { tax_id: 13, value: 23, fiscal_zone: 'ES', saft_type: 1 },
          { tax_id: 14, value: 23, fiscal_zone: 'PT', saft_type: 3 },
          { tax_id: 11, value: 23, fiscal_zone: 'PT', saft_type: 1 },
        ],
      })
    );
    await moloniProvider.issue(draft(), rt());
    expect(m.of('invoiceReceipts/insert')[0].body.products[0].taxes).toEqual([{ tax_id: 11 }]);
  });

  it('falls back to the first tax with the rate', async () => {
    const m = moloniFake(
      happyRoutes({
        'taxes/getAll': () => [
          { tax_id: 13, value: 23, fiscal_zone: 'ES' },
          { tax_id: 14, value: 23, fiscal_zone: 'FR' },
        ],
      })
    );
    await moloniProvider.issue(draft(), rt());
    expect(m.of('invoiceReceipts/insert')[0].body.products[0].taxes).toEqual([{ tax_id: 13 }]);
  });

  it('a returned total different from the draft adds TOTAL_MISMATCH:<diff>', async () => {
    moloniFake(
      happyRoutes({
        'documents/getOne': () => ({ document_id: 777, number: 12, document_set_name: 'A', net_value: 30.76 }),
      })
    );
    const doc = await moloniProvider.issue(draft(), rt());
    expect(doc.total).toBe(3076);
    expect(doc.warnings).toEqual(['TOTAL_MISMATCH:1']);
  });

  it('a timeout on the document insert is uncertain', async () => {
    moloniFake(
      happyRoutes({
        'invoiceReceipts/insert': () => {
          throw new Error('timeout');
        },
      })
    );
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err.code).toBe('BILLING_UNREACHABLE');
    expect(err.uncertain).toBe(true);
  });

  it('a timeout creating an article is not uncertain (no document was sent)', async () => {
    const m = moloniFake(
      happyRoutes({
        'products/getByReference': () => [],
        'products/insert': () => {
          throw new Error('timeout');
        },
      })
    );
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err.code).toBe('BILLING_UNREACHABLE');
    expect(err.uncertain).toBe(false);
    expect(m.of('invoiceReceipts/insert')).toHaveLength(0);
  });

  it('a failure reading the document back after insert is uncertain (it was issued)', async () => {
    moloniFake(happyRoutes({ 'documents/getOne': () => json(502, {}) }));
    const err: any = await fail(moloniProvider.issue(draft(), rt()));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.uncertain).toBe(true);
  });

  it('lookups are cached per company for 1 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(draft(), rt());
    await moloniProvider.issue(draft(), rt());
    expect(m.of('taxes/getAll')).toHaveLength(1);
    expect(m.of('documentSets/getAll')).toHaveLength(1);
    await moloniProvider.issue(draft(), rt({ companyId: 43 }));
    expect(m.of('taxes/getAll')).toHaveLength(2);
    vi.setSystemTime(new Date('2026-11-11T11:00:01Z'));
    await moloniProvider.issue(draft(), rt());
    expect(m.of('taxes/getAll')).toHaveLength(3);
  });
});

describe('moloniProvider.issue (FT)', () => {
  it('invoices/insert then receipts/insert with associated_documents', async () => {
    const m = moloniFake(happyRoutes());
    const doc = await moloniProvider.issue(draft(), rt({ documentType: 'FT' }));
    expect(m.of('invoiceReceipts/insert')).toHaveLength(0);
    const inv = m.of('invoices/insert')[0].body;
    expect(inv).toMatchObject({ status: 1, our_reference: 'LB-INV-7', notes: 'Order #1001', customer_id: 100 });
    expect(inv.payments).toBeUndefined();
    const rec = m.of('receipts/insert')[0].body;
    expect(rec).toMatchObject({
      company_id: 42,
      customer_id: 100,
      document_set_id: 5,
      date: '2026-11-11',
      net_value: 30.75,
      status: 1,
      associated_documents: [{ associated_id: 778, value: 30.75 }],
      payments: [{ payment_method_id: 31, date: '2026-11-10', value: 30.75 }],
    });
    expect(m.paths().indexOf('invoices/insert')).toBeLessThan(m.paths().indexOf('receipts/insert'));
    expect(doc.externalId).toBe('778');
    expect(doc.warnings).toEqual([]);
  });

  it('a failed receipt keeps the invoice issued with RECEIPT_FAILED', async () => {
    moloniFake(happyRoutes({ 'receipts/insert': () => [{ code: '1', field: 'payments' }] }));
    const doc = await moloniProvider.issue(draft(), rt({ documentType: 'FT' }));
    expect(doc.externalId).toBe('778');
    expect(doc.warnings).toEqual(['RECEIPT_FAILED']);
  });
});

describe('moloniProvider.issue (CREDIT_NOTE)', () => {
  it('creditNotes/insert with associated_documents', async () => {
    const m = moloniFake(
      happyRoutes({
        'documents/getOne': () => ({ document_id: 780, number: 3, document_set_name: 'A', net_value: 12.3, document_type: { saft_code: 'NC' } }),
      })
    );
    const doc = await moloniProvider.issue(
      draft({
        kind: 'CREDIT_NOTE',
        ourReference: 'LB-INV-9',
        lines: [{ orderLineId: 1, kind: 'ITEM', sku: 'SKU-1', name: 'Mug', quantity: 1, total: 1230, tax: 23, partial: false }],
        total: 1230,
        payments: [],
        original: { externalId: '777', total: 3075 },
        reason: 'Return',
      }),
      rt()
    );
    const b = m.of('creditNotes/insert')[0].body;
    expect(b).toMatchObject({
      status: 1,
      our_reference: 'LB-INV-9',
      notes: 'Order #1001 — Return',
      associated_documents: [{ associated_id: 777, value: 12.3 }],
    });
    expect(b.products).toEqual([
      { product_id: 200, name: 'Mug', qty: 1, price: 10, taxes: [{ tax_id: 11 }], related_id: 9001 },
    ]);
    expect(m.of('documents/getUnrelatedProducts')[0].body).toMatchObject({ document_id: 777 });
    expect(b.payments).toBeUndefined();
    expect(doc).toMatchObject({ externalId: '780', number: 'A/3', documentType: 'NC', total: 1230, warnings: [] });
  });
});

describe('moloniProvider.issue (CREDIT_NOTE) — related lines', () => {
  const credit = (lines: any[], total: number) =>
    draft({ kind: 'CREDIT_NOTE', lines, total, payments: [], original: { externalId: '777', total: 3075 } });
  const mug = (quantity: number, total: number) => ({
    orderLineId: 1, kind: 'ITEM', sku: 'SKU-1', name: 'Mug', quantity, total, tax: 23, partial: false,
  });
  const shipping = { orderLineId: null, kind: 'SHIPPING', sku: 'PORTES', name: 'Shipping', quantity: 1, total: 615, tax: 23, partial: false };

  it('each line points at its original line, shipping included', async () => {
    const m = moloniFake(happyRoutes());
    await moloniProvider.issue(credit([mug(2, 2460), shipping], 3075), rt());
    expect(m.of('creditNotes/insert')[0].body.products.map((p: any) => p.related_id)).toEqual([9001, 9002]);
  });

  it('matches by reference when the product id differs', async () => {
    const m = moloniFake(
      happyRoutes({
        'documents/getUnrelatedProducts': () => ({
          products: [{ document_product_id: 7, product_id: 999, reference: 'SKU-1', qty: 2 }],
        }),
      })
    );
    await moloniProvider.issue(credit([mug(1, 1230)], 1230), rt());
    expect(m.of('creditNotes/insert')[0].body.products[0].related_id).toBe(7);
  });

  it('a quantity already credited refuses the credit note before any write', async () => {
    const m = moloniFake(
      happyRoutes({
        'documents/getUnrelatedProducts': () => [{ document_product_id: 9001, product_id: 200, reference: 'SKU-1', qty: 1 }],
      })
    );
    const err: any = await fail(moloniProvider.issue(credit([mug(2, 2460)], 2460), rt()));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(err.uncertain).toBe(false);
    expect(err.message).toBe('Line 1 is not on the original Moloni document, or that quantity was already credited.');
    expect(m.of('creditNotes/insert')).toHaveLength(0);
  });
});

describe('moloniProvider.getDocument / findByReference', () => {
  it('getDocument maps documents/getOne', async () => {
    moloniFake(happyRoutes());
    expect(await moloniProvider.getDocument('777', rt())).toEqual({
      externalId: '777',
      number: 'A/12',
      series: 'A',
      documentType: 'FR',
      total: 3075,
      issuedAt: '2026-11-11',
      warnings: [],
    });
  });

  it('findByReference: a match -> getDocument', async () => {
    const m = moloniFake(happyRoutes({ 'documents/getAll': () => [{ document_id: 777 }] }));
    const doc = await moloniProvider.findByReference('LB-INV-7', rt());
    expect(m.of('documents/getAll')[0].body).toEqual({ company_id: 42, our_reference: 'LB-INV-7' });
    expect(m.of('documents/getOne')[0].body.document_id).toBe(777);
    expect(doc?.number).toBe('A/12');
  });

  it('findByReference: no match -> null', async () => {
    moloniFake(happyRoutes({ 'documents/getAll': () => [] }));
    expect(await moloniProvider.findByReference('LB-INV-7', rt())).toBeNull();
  });
});

describe('moloniProvider.getPdf', () => {
  const pdf = Buffer.from('%PDF-1.4 hello');
  it('returns the PDF bytes from the protocol-relative link', async () => {
    const m = moloniFake({
      'documents/getPDFLink': () => ({ url: '//www.moloni.pt/downloads/index.php?h=abc' }),
      'https://www.moloni.pt/downloads/index.php?h=abc': () => new Response(pdf, { status: 200 }),
    });
    const out = await moloniProvider.getPdf('777', rt());
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('%PDF-1.4 hello');
    expect(m.of('documents/getPDFLink')[0].body).toEqual({ company_id: 42, document_id: 777 });
    const dl = m.calls.find((c) => c.path === 'downloads/index.php')!;
    expect(dl.init.method).toBe('GET');
  });

  it('an HTML response -> BILLING_REQUEST_FAILED', async () => {
    moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://www.moloni.pt/dl?h=abc' }),
      'https://www.moloni.pt/dl?h=abc': () => new Response('<html>login</html>', { status: 200 }),
    });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(err.message).not.toContain('h=abc');
  });

  it("follows the download page's meta refresh to the file (Moloni's getPDFLink lands on a page)", async () => {
    const page =
      '<html><head><meta http-equiv="refresh" content="URL=index.php?action=getDownload&amp;h=abc&amp;d=777&amp;i=1"></head></html>';
    const m = moloniFake({
      'documents/getPDFLink': () => ({ url: '//www.moloni.pt/downloads/index.php?action=getDownload&h=abc&d=777' }),
      'https://www.moloni.pt/downloads/index.php?action=getDownload&h=abc&d=777': () =>
        new Response(page, { status: 200 }),
      'https://www.moloni.pt/downloads/index.php?action=getDownload&h=abc&d=777&i=1': () =>
        new Response(pdf, { status: 200 }),
    });
    expect((await moloniProvider.getPdf('777', rt())).toString()).toBe('%PDF-1.4 hello');
    expect(m.calls.filter((c) => c.path === 'downloads/index.php')).toHaveLength(2);
  });

  it('a meta refresh off moloni.pt is not followed', async () => {
    const m = moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://www.moloni.pt/dl?h=abc' }),
      'https://www.moloni.pt/dl?h=abc': () =>
        new Response('<meta http-equiv="refresh" content="0; URL=https://evil.example/x.pdf">', { status: 200 }),
      'https://evil.example/x.pdf': () => new Response(pdf, { status: 200 }),
    });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err.message).toBe('Moloni did not return a PDF (HTTP 200, an HTML page).');
    expect(m.calls.some((c) => c.path === 'x.pdf')).toBe(false);
  });

  it('a link outside moloni.pt -> BILLING_REQUEST_FAILED, never fetched', async () => {
    const m = moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://evil.example/moloni.pt/x.pdf' }),
      'https://evil.example/moloni.pt/x.pdf': () => new Response(pdf, { status: 200 }),
    });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
    expect(m.calls.some((c) => c.path === 'moloni.pt/x.pdf')).toBe(false);
  });

  it('a lookalike host (notmoloni.pt) is refused', async () => {
    moloniFake({ 'documents/getPDFLink': () => ({ url: 'https://notmoloni.pt/x.pdf' }) });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
  });

  it('moloni.pt itself is accepted', async () => {
    moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://moloni.pt/x.pdf' }),
      'https://moloni.pt/x.pdf': () => new Response(pdf, { status: 200 }),
    });
    expect((await moloniProvider.getPdf('777', rt())).toString()).toBe('%PDF-1.4 hello');
  });

  it('a PDF over 10 MB -> BILLING_REQUEST_FAILED', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20);
    big.write('%PDF');
    moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://www.moloni.pt/dl?h=big' }),
      'https://www.moloni.pt/dl?h=big': () => new Response(big, { status: 200 }),
    });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err.code).toBe('BILLING_REQUEST_FAILED');
  });

  it('download failure -> BILLING_UNREACHABLE', async () => {
    moloniFake({
      'documents/getPDFLink': () => ({ url: 'https://www.moloni.pt/dl?h=abc' }),
      'https://www.moloni.pt/dl?h=abc': () => {
        throw new Error('down');
      },
    });
    const err: any = await fail(moloniProvider.getPdf('777', rt()));
    expect(err.code).toBe('BILLING_UNREACHABLE');
  });
});
