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

describe('EcommerceInvoiceController', () => {
  it('preview translates the query into the service scope', async () => {
    const preview = vi.fn().mockResolvedValue({ lines: [], total: 0, paymentIds: [] });
    const c = createInvoices({ strapi: strapiWith({ preview }) });
    await c.preview(mkCtx({ query: { scope: 'PAYMENT', paymentId: '12' } }));
    expect(preview).toHaveBeenCalledWith(5, { type: 'PAYMENT', paymentId: 12 });
    await c.preview(mkCtx({ query: { scope: 'TOTAL' } }));
    expect(preview).toHaveBeenLastCalledWith(5, { type: 'TOTAL' });
    for (const query of [{}, { scope: 'X' }, { scope: 'PAYMENT' }, { scope: 'PAYMENT', paymentId: 'a' }, { scope: 'PAYMENT', paymentId: '0' }]) {
      const ctx = mkCtx({ query });
      await c.preview(ctx);
      expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ errors: expect.any(Array) }));
    }
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('issue returns 201 and requires scope and idempotencyKey', async () => {
    const issue = vi.fn().mockResolvedValue({ id: 1, status: 'ISSUED' });
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body({ scope: 'PAYMENT', paymentId: 3, idempotencyKey: 'k' });
    await c.issue(ctx);
    expect(ctx.status).toBe(201);
    expect(issue).toHaveBeenCalledWith(5, { type: 'PAYMENT', paymentId: 3 }, { idempotencyKey: 'k' }, 'user:7');
    await c.issue(body({ scope: 'TOTAL', idempotencyKey: 'k2' }));
    expect(issue).toHaveBeenLastCalledWith(5, { type: 'TOTAL' }, { idempotencyKey: 'k2' }, 'user:7');
    for (const bad of [
      { scope: 'TOTAL' },
      { scope: 'TOTAL', idempotencyKey: 'x'.repeat(201) },
      { scope: 'PAYMENT', idempotencyKey: 'k' },
      { scope: 'PAYMENT', paymentId: 1.5, idempotencyKey: 'k' },
      { idempotencyKey: 'k' },
    ]) {
      const b = body(bad);
      await c.issue(b);
      expect(b.badRequest).toHaveBeenCalled();
    }
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('PAYMENT_NOT_INVOICEABLE is a 409', async () => {
    const issue = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'paymentId', code: 'PAYMENT_NOT_INVOICEABLE' }]));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body({ scope: 'TOTAL', idempotencyKey: 'k' });
    await c.issue(ctx);
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.details.code).toBe('PAYMENT_NOT_INVOICEABLE');
  });

  it.each(['ACTION_NOT_AVAILABLE', 'NOTHING_TO_INVOICE', 'coverage_mismatch'])('validation code %s is a 400 with code', async (code) => {
    const issue = vi.fn().mockRejectedValue(new EcommerceValidationError('x', [{ path: 'p', code }]));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body({ scope: 'TOTAL', idempotencyKey: 'k' });
    await c.issue(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code }));
  });

  it('EcommerceBillingError is a 400 with the code and no secrets', async () => {
    const issue = vi.fn().mockRejectedValue(new EcommerceBillingError('BILLING_NOT_CONFIGURED'));
    const c = createInvoices({ strapi: strapiWith({ issue }) });
    const ctx = body({ scope: 'TOTAL', idempotencyKey: 'k' });
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
    const svc = { preview: nf(), issue: nf(), reconcile: nf(), getPdf: nf(), creditNotePreview: nf(), issueCreditNote: nf() };
    const c = createInvoices({ strapi: strapiWith(svc) });
    const calls: [string, any][] = [
      ['preview', mkCtx({ query: { scope: 'TOTAL' } })],
      ['issue', body({ scope: 'TOTAL', idempotencyKey: 'k' })],
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
