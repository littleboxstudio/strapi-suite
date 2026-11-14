import { describe, expect, it, vi } from 'vitest';
import {
  EcommerceBillingError,
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import createInvoices from '../../../server/src/controllers/modules/ecommerce/invoices';

const strapiWith = (svc: Record<string, any>) =>
  ({ plugin: () => ({ service: () => svc }) }) as any;

const mkCtx = (extra: any = {}): any => {
  const headers: Record<string, string> = {};
  return {
    params: { id: '5' },
    query: {},
    request: { body: {} },
    state: { user: { id: 7 } },
    badRequest: vi.fn(),
    notFound: vi.fn(),
    set: (k: string, v: string) => (headers[k] = v),
    headers,
    ...extra,
  };
};
const body = (b: any) => mkCtx({ request: { body: b } });
const VALID_ISSUE = {
  lines: [{ orderLineId: 3, quantity: 1 }],
  shippingLineIds: [],
  paymentIds: [4],
  expectedTotal: 2000,
  idempotencyKey: 'k',
};

describe('EcommerceInvoiceController', () => {
  it('selection passes the id', async () => {
    const selection = vi.fn().mockResolvedValue({ lines: [], shipping: [], payments: [], excess: 0 });
    const c = createInvoices({ strapi: strapiWith({ selection }) });
    const ctx = mkCtx();
    await c.selection(ctx);
    expect(selection).toHaveBeenCalledWith(5);
    expect(ctx.body).toEqual({ lines: [], shipping: [], payments: [], excess: 0 });
  });

  it('issue returns 201 and validates lines (positive integers), shippingLineIds and paymentIds (positive-integer arrays, at most 200), expectedTotal (cents) and idempotencyKey', async () => {
    const issue = vi.fn().mockResolvedValue({ id: 1, status: 'ISSUED' });
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const valid = {
      lines: [{ orderLineId: 3, quantity: 2 }],
      shippingLineIds: [1],
      paymentIds: [4, 5],
      expectedTotal: 4500,
      idempotencyKey: 'k',
    };
    const ctx = body(valid);
    await c.issue(ctx);
    expect(ctx.status).toBe(201);
    expect(issue).toHaveBeenCalledWith(5, valid, 'user:7');
    // A shipping-only invoice: no lines.
    await c.issue(body({ ...valid, lines: [], idempotencyKey: 'k2' }));
    expect(issue).toHaveBeenLastCalledWith(5, { ...valid, lines: [], idempotencyKey: 'k2' }, 'user:7');
    const many = Array.from({ length: 201 }, (_, i) => i + 1);
    for (const bad of [
      { ...valid, lines: [{ orderLineId: 0, quantity: 1 }] },
      { ...valid, lines: [{ orderLineId: 3, quantity: 1.5 }] },
      { ...valid, lines: [{ orderLineId: 3, quantity: 0 }] },
      { ...valid, lines: 'x' },
      { ...valid, lines: many.map((id) => ({ orderLineId: id, quantity: 1 })) },
      { ...valid, shippingLineIds: [0] },
      { ...valid, shippingLineIds: ['1'] },
      { ...valid, shippingLineIds: many },
      { ...valid, paymentIds: [1.5] },
      { ...valid, paymentIds: {} },
      { ...valid, paymentIds: many },
      { ...valid, expectedTotal: -1 },
      { ...valid, expectedTotal: 1.5 },
      { ...valid, expectedTotal: undefined },
      { ...valid, idempotencyKey: '' },
      { ...valid, idempotencyKey: 'x'.repeat(201) },
    ]) {
      const b = body(bad);
      await c.issue(b);
      expect(b.badRequest, JSON.stringify(bad).slice(0, 80)).toHaveBeenCalled();
    }
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it.each([
    'PAYMENT_NOT_INVOICEABLE',
    'INVOICE_EXCESS_UNRESOLVED',
    'QUANTITY_EXCEEDS_UNINVOICED',
    'SHIPPING_LINE_NOT_INVOICEABLE',
    'TOTAL_CHANGED',
  ])('%s is a 409', async (code) => {
    const issue = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body(VALID_ISSUE);
    await c.issue(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe(code);
  });

  it.each(['ACTION_NOT_AVAILABLE', 'INVOICE_TOTALS_DIFFER', 'duplicate'])('validation code %s is a 400 with code', async (code) => {
    const issue = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body(VALID_ISSUE);
    await c.issue(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
  });

  it('EcommerceBillingError is a 400 with the code and no secrets', async () => {
    const issue = vi.fn().mockRejectedValue(new EcommerceBillingError('BILLING_NOT_CONFIGURED'));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body(VALID_ISSUE);
    await c.issue(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'BILLING_NOT_CONFIGURED' });
    expect(JSON.stringify(ctx.badRequest.mock.calls)).not.toMatch(/secret|token|password/i);
  });

  it('reconcile defaults markFailed to false and validates it', async () => {
    const reconcile = vi.fn().mockResolvedValue({});
    const c = createInvoices({ strapi: strapiWith({ reconcile }) });
    await c.reconcile(body({}));
    expect(reconcile).toHaveBeenCalledWith(5, { markFailed: false }, 'user:7');
    await c.reconcile(body({ markFailed: true }));
    expect(reconcile).toHaveBeenLastCalledWith(5, { markFailed: true }, 'user:7');
    const bad = body({ markFailed: 'yes' });
    await c.reconcile(bad);
    expect(bad.badRequest).toHaveBeenCalled();
  });

  it('pdf sends the bytes with the right headers and nothing else', async () => {
    const getPdf = vi.fn().mockResolvedValue({ filename: 'FR_2026-1.pdf', content: Buffer.from('%PDF-1') });
    const c = createInvoices({ strapi: strapiWith({ getPdf }) });
    const ctx = mkCtx();
    await c.pdf(ctx);
    expect(ctx.type).toBe('application/pdf');
    expect(ctx.headers['Content-Disposition']).toBe('attachment; filename="FR_2026-1.pdf"');
    expect(ctx.headers['Cache-Control']).toBe('private, no-store');
    expect(ctx.body.equals(Buffer.from('%PDF-1'))).toBe(true);
  });

  it('pdf maps INVOICE_PDF_UNAVAILABLE and rejects bad ids', async () => {
    const getPdf = vi.fn().mockRejectedValue(new EcommerceBillingError('INVOICE_PDF_UNAVAILABLE' as any));
    const c = createInvoices({ strapi: strapiWith({ getPdf }) });
    const ctx = mkCtx();
    await c.pdf(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'INVOICE_PDF_UNAVAILABLE' });
    expect(ctx.body).toBeUndefined();
    const bad = mkCtx({ params: { id: '0' } });
    await c.pdf(bad);
    expect(bad.badRequest).toHaveBeenCalledWith('Invalid id');
  });

  it('credit note preview and issue', async () => {
    const creditNotePreview = vi.fn().mockResolvedValue({ lines: [], creditable: [], suggested: [] });
    const issueCreditNote = vi.fn().mockResolvedValue({ id: 2, kind: 'CREDIT_NOTE' });
    const c = createInvoices({ strapi: strapiWith({ creditNotePreview, issueCreditNote }) });
    const p = mkCtx();
    await c.creditNotePreview(p);
    expect(creditNotePreview).toHaveBeenCalledWith(5);
    const valid = { lines: [{ index: 0, value: 100 }], reason: 'Return', idempotencyKey: 'k' };
    const ctx = body(valid);
    await c.issueCreditNote(ctx);
    expect(ctx.status).toBe(201);
    expect(issueCreditNote).toHaveBeenCalledWith(5, valid, 'user:7');
    for (const bad of [
      { ...valid, lines: [] },
      { ...valid, lines: [{ index: -1, value: 1 }] },
      { ...valid, lines: [{ index: 0, value: 1.5 }] },
      { ...valid, lines: [{ index: 0.5, value: 1 }] },
      { ...valid, reason: '' },
      { ...valid, idempotencyKey: '' },
    ]) {
      const b = body(bad);
      await c.issueCreditNote(b);
      expect(b.badRequest).toHaveBeenCalled();
    }
    expect(issueCreditNote).toHaveBeenCalledTimes(1);
  });

  it('maps not found to 404 on every endpoint', async () => {
    const nf = () => vi.fn().mockRejectedValue(new EcommerceNotFoundError('x'));
    const svc = { selection: nf(), issue: nf(), reconcile: nf(), getPdf: nf(), creditNotePreview: nf(), issueCreditNote: nf() };
    const c = createInvoices({ strapi: strapiWith(svc) });
    const calls: [string, any][] = [
      ['selection', mkCtx()],
      ['issue', body(VALID_ISSUE)],
      ['reconcile', body({})],
      ['pdf', mkCtx()],
      ['creditNotePreview', mkCtx()],
      ['issueCreditNote', body({ lines: [{ index: 0, value: 1 }], reason: 'r', idempotencyKey: 'k' })],
    ];
    for (const [h, ctx] of calls) {
      await (c as any)[h](ctx);
      expect(ctx.notFound, h).toHaveBeenCalled();
    }
  });

  it('credit note rejects a 201-character idempotencyKey and a reason over 500 characters', async () => {
    const issueCreditNote = vi.fn();
    const c = createInvoices({ strapi: strapiWith({ issueCreditNote }) });
    const lines = [{ index: 0, value: 1 }];
    for (const bad of [
      { lines, reason: 'r', idempotencyKey: 'x'.repeat(201) },
      { lines, reason: 'x'.repeat(501), idempotencyKey: 'k' },
    ]) {
      const ctx = body(bad);
      await c.issueCreditNote(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errors: expect.any(Array) }));
    }
    expect(issueCreditNote).not.toHaveBeenCalled();
  });

  it('billing-side NOT_SUPPORTED is a 400 with the code (reconcile and credit note)', async () => {
    const err = () => vi.fn().mockRejectedValue(new EcommerceBillingError('NOT_SUPPORTED'));
    const c = createInvoices({ strapi: strapiWith({ reconcile: err(), issueCreditNote: err() }) });
    const a = body({ markFailed: true });
    await c.reconcile(a);
    expect(a.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'NOT_SUPPORTED' });
    const b = body({ lines: [{ index: 0, value: 1 }], reason: 'r', idempotencyKey: 'k' });
    await c.issueCreditNote(b);
    expect(b.badRequest).toHaveBeenCalledWith(expect.any(String), { code: 'NOT_SUPPORTED' });
  });

  it.each(['1e2', '0x10', ' 5', '-1', '0', '9'.repeat(30)])('rejects id %j strictly', async (id) => {
    const getPdf = vi.fn();
    const c = createInvoices({ strapi: strapiWith({ getPdf }) });
    const ctx = mkCtx({ params: { id } });
    await c.pdf(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('Invalid id');
    expect(getPdf).not.toHaveBeenCalled();
  });

  it('sanitises the invoice PDF filename (CR/LF, quotes, slashes, unicode) and ends in .pdf', async () => {
    const getPdf = vi.fn().mockResolvedValue({ filename: 'FR\r\n"a/b\\ç', content: Buffer.from('%PDF') });
    const c = createInvoices({ strapi: strapiWith({ getPdf }) });
    const ctx = mkCtx();
    await c.pdf(ctx);
    expect(ctx.headers['Content-Disposition']).toBe('attachment; filename="FR___a_b__.pdf"');
  });
});
