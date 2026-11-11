import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const resend = vi.hoisted(() => ({ sendWithResend: vi.fn() }));
vi.mock('../../../server/src/services/modules/ecommerce/providers/email/resendSender', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, sendWithResend: resend.sendWithResend };
});

import {
  __resetEventHandlersForTests,
  createEventBus,
  type DomainEvent,
} from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceEmailError, EcommerceNotFoundError } from '../../../server/src/services/modules/ecommerce/errors';
import {
  subscribeNotifications,
  __drainNotificationsForTests,
} from '../../../server/src/services/modules/ecommerce/notifications';
import { UIDS, setupCommerce, createOrder, type Commerce } from './helpers/commerceSetup';
import {
  __resetBillingProvidersForTests,
  registerBillingProvider,
  type InvoiceDraft,
} from '../../../server/src/services/modules/ecommerce/providers/billing';
import { buildTemplateData } from '../../../server/src/services/modules/ecommerce/notificationData';
import { renderTemplate } from '../../../server/src/services/modules/ecommerce/email/templateEngine';
import { DEFAULT_TEMPLATES } from '../../../server/src/services/modules/ecommerce/email/defaults';

beforeEach(() => {
  __resetEventHandlersForTests();
  resend.sendWithResend.mockReset();
  resend.sendWithResend.mockResolvedValue({ id: 'msg_1' });
});

const actor = 'user:1';

const setup = (opts: { resendActive?: boolean } = { resendActive: true }) => {
  const c = setupCommerce(opts);
  c.bus.subscribe('*', (e) => c.notifications.handle(e));
  return c;
};

const notifs = (c: Commerce) => c.tables[UIDS.notification];
const historyTypes = (c: Commerce, orderId: number) =>
  c.tables[UIDS.orderHistory].filter((h) => h.order === orderId).map((h) => h.type);

describe('EcommerceNotificationService.handle', () => {
  it('sends the order confirmation to the snapshot e-mail with idempotencyKey = uniqueKey', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const event = c.events.find((e) => e.type === 'ORDER_CREATED');

    expect(resend.sendWithResend).toHaveBeenCalledTimes(1);
    const [rt, msg] = resend.sendWithResend.mock.calls[0];
    expect(rt.secrets.apiKey).toBe('re_test_x');
    expect(msg.to).toBe('Ana@Example.pt');
    expect(msg.idempotencyKey).toBe(`notif:${event.id}:ORDER_CONFIRMATION`);
    expect(msg.subject).toBe('ORDER_CONFIRMATION:en');

    const [row] = notifs(c);
    expect(row).toMatchObject({
      order: orderId,
      type: 'ORDER_CONFIRMATION',
      eventId: event.id,
      uniqueKey: `notif:${event.id}:ORDER_CONFIRMATION`,
      recipient: 'Ana@Example.pt',
      locale: 'en',
      status: 'SENT',
      providerMessageId: 'msg_1',
      attempts: 1,
      error: null,
    });
    expect(row.sentAt).toEqual(expect.any(String));
    expect(row.payload.order.total).toBe('€45.00');
    expect(historyTypes(c, orderId)).toContain('NOTIFICATION_SENT');
  });

  it('Review Focus 5: Resend down → the operation completes, the notification is FAILED, and resend sends it', async () => {
    const c = setup();
    resend.sendWithResend.mockRejectedValue(new EcommerceEmailError('EMAIL_SEND_FAILED', 'Could not reach Resend.'));
    const orderId = await createOrder(c);
    const payment = await c.payments.addManualPayment(orderId, { amount: 4500, idempotencyKey: 'p1' }, actor);
    expect(payment.status).toBe('COMPLETED');
    expect(c.tables[UIDS.order].find((o) => o.id === orderId).paymentStatus).toBe('PAID');

    const failed = notifs(c).find((n) => n.type === 'PAYMENT_CONFIRMATION');
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1, providerMessageId: null });
    expect(failed.error).toBe('EMAIL_SEND_FAILED: Could not reach Resend.');
    expect(historyTypes(c, orderId)).toContain('NOTIFICATION_FAILED');

    resend.sendWithResend.mockReset();
    resend.sendWithResend.mockResolvedValue({ id: 'msg_2' });
    const view = await c.notifications.resend(failed.id, actor);
    expect(view).toMatchObject({ id: failed.id, status: 'SENT', attempts: 2, error: null });
    expect(resend.sendWithResend).toHaveBeenCalledTimes(1);
    expect(resend.sendWithResend.mock.calls[0][1].idempotencyKey).toBe(failed.uniqueKey);
    // Same payload as the first attempt.
    const render = c.services.EcommerceEmailTemplateService.render;
    expect(render).toHaveBeenLastCalledWith('PAYMENT_CONFIRMATION', 'en', failed.payload);
    const sent = c.tables[UIDS.orderHistory].filter((h) => h.order === orderId && h.type === 'NOTIFICATION_SENT');
    expect(sent.at(-1).actor).toBe(actor);
  });

  it('a duplicate event does not send twice', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const event: DomainEvent = c.events.find((e) => e.type === 'ORDER_CREATED');
    await c.notifications.handle(event);
    await c.notifications.handle({ ...event });
    expect(resend.sendWithResend).toHaveBeenCalledTimes(1);
    expect(notifs(c).filter((n) => n.order === orderId)).toHaveLength(1);
  });

  it('a redelivered event retries a FAILED notification without a second row', async () => {
    const c = setup();
    resend.sendWithResend.mockRejectedValueOnce(new EcommerceEmailError('EMAIL_SEND_FAILED'));
    await createOrder(c);
    const event: DomainEvent = c.events.find((e) => e.type === 'ORDER_CREATED');
    expect(notifs(c)[0].status).toBe('FAILED');
    await c.notifications.handle(event);
    expect(notifs(c)).toHaveLength(1);
    expect(notifs(c)[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('SKIPPED without an active Resend, and resending a SKIPPED one once Resend is active sends it', async () => {
    const c = setup({ resendActive: false });
    const orderId = await createOrder(c);
    expect(resend.sendWithResend).not.toHaveBeenCalled();
    const [row] = notifs(c);
    expect(row).toMatchObject({ status: 'SKIPPED', error: 'EMAIL_NOT_CONFIGURED', attempts: 0 });
    expect(row.payload.customer.firstName).toBe('Ana');
    expect(historyTypes(c, orderId)).not.toContain('NOTIFICATION_SENT');

    c.services.EcommerceSettingsService.getRuntime = async () => ({
      config: { fromEmail: 'shop@example.pt' },
      secrets: { apiKey: 're_x' },
      active: true,
    });
    expect((await c.notifications.resend(row.id, actor)).status).toBe('SENT');
  });

  it('SKIPPED when Resend is not configured at all', async () => {
    const c = setup({});
    await createOrder(c);
    expect(notifs(c)[0]).toMatchObject({ status: 'SKIPPED', error: 'EMAIL_NOT_CONFIGURED' });
  });

  it('SKIPPED when the order has no customer e-mail', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const order = c.tables[UIDS.order].find((o) => o.id === orderId);
    order.customerSnapshot = { ...order.customerSnapshot, email: '' };
    await c.payments.addManualPayment(orderId, { amount: 100, idempotencyKey: 'p1' }, actor);
    const row = notifs(c).find((n) => n.type === 'PAYMENT_CONFIRMATION');
    expect(row).toMatchObject({ status: 'SKIPPED', error: 'NO_RECIPIENT' });
  });

  it('a template render error is recorded as FAILED, never thrown', async () => {
    const c = setup();
    c.services.EcommerceEmailTemplateService.render.mockRejectedValueOnce(new Error('boom: ana@example.pt'));
    await createOrder(c);
    const [row] = notifs(c);
    expect(row.status).toBe('FAILED');
    expect(row.error).toBe('Error');
    expect(resend.sendWithResend).not.toHaveBeenCalled();
  });

  it('never throws, even when the order cannot be loaded', async () => {
    const c = setup();
    await expect(
      c.notifications.handle({ id: 'e1', type: 'ORDER_CREATED', orderId: 999, occurredAt: '', payload: {} })
    ).resolves.toBeUndefined();
    expect(c.log.error).toHaveBeenCalled();
  });

  it('REFUND_FAILED marked by an admin creates no notification', async () => {
    const c = setup();
    await c.notifications.handle({
      id: 'e-admin',
      type: 'REFUND_FAILED',
      orderId: 1,
      occurredAt: '',
      payload: { source: 'ADMIN_MARKED', kind: 'MONEY', method: 'STRIPE' },
    });
    expect(notifs(c)).toHaveLength(0);
    // F1: a refund Stripe reversed after completion is not e-mailed either.
    await c.notifications.handle({
      id: 'e-reversed',
      type: 'REFUND_FAILED',
      orderId: 1,
      occurredAt: '',
      payload: { source: 'STRIPE_REVERSED', kind: 'MONEY', method: 'STRIPE' },
    });
    expect(notifs(c)).toHaveLength(0);
  });

  it('ignores events without a template (store-credit refunds, modifications)', async () => {
    const c = setup();
    await c.notifications.handle({ id: 'e1', type: 'REFUND_COMPLETED', orderId: 1, occurredAt: '', payload: { kind: 'STORE_CREDIT' } });
    await c.notifications.handle({ id: 'e2', type: 'ORDER_MODIFIED', orderId: 1, occurredAt: '', payload: {} });
    expect(notifs(c)).toHaveLength(0);
  });

  it('sends payment instructions with the event link, and a cancellation', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    await c.payments.sendPaymentInstructions(orderId, { mode: 'MANUAL', instructions: 'IBAN PT50' }, actor);
    const instr = notifs(c).find((n) => n.type === 'PAYMENT_INSTRUCTIONS');
    expect(instr.payload.payment).toMatchObject({ instructions: 'IBAN PT50', amountDue: '€45.00', link: '' });
    await c.orders.cancel(orderId, actor);
    const cancel = notifs(c).find((n) => n.type === 'CANCELLATION');
    expect(cancel.status).toBe('SENT');
    expect(cancel.payload.order.amountPaid).toBe('');
  });

  it('a manual-transfer refund sends REFUND_COMPLETED with its reference and description', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    await c.payments.addManualPayment(orderId, { amount: 5000, idempotencyKey: 'p1' }, actor);
    await c.refunds.create(
      orderId,
      {
        method: 'MANUAL_TRANSFER',
        amount: 500,
        reason: 'overpaid',
        description: 'Overpayment returned',
        reference: 'TRF-9',
        idempotencyKey: 'r1',
      },
      actor
    );
    const row = notifs(c).find((n) => n.type === 'REFUND_COMPLETED');
    expect(row.payload.refund).toMatchObject({
      amount: '€5.00',
      reference: 'TRF-9',
      description: 'Overpayment returned',
      isPartial: 'yes',
    });
  });

  it('a store-credit refund sends STORE_CREDIT_ISSUED (and no REFUND_COMPLETED)', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    await c.payments.addManualPayment(orderId, { amount: 5000, idempotencyKey: 'p1' }, actor);
    await c.refunds.create(
      orderId,
      { method: 'STORE_CREDIT', amount: 500, reason: 'overpaid', idempotencyKey: 'r1' },
      actor
    );
    const types = notifs(c).map((n) => n.type);
    expect(types).toContain('STORE_CREDIT_ISSUED');
    expect(types).not.toContain('REFUND_COMPLETED');
    const credit = c.tables[UIDS.storeCredit][0];
    const row = notifs(c).find((n) => n.type === 'STORE_CREDIT_ISSUED');
    expect(row.payload.credit).toMatchObject({ code: credit.code, amount: '€5.00' });
    expect(row.order).toBe(orderId);
  });
});


describe('fix round 1', () => {
  it('two concurrent handlers of the same event send once (the insert loser returns)', async () => {
    const c = setup();
    await createOrder(c);
    const event: DomainEvent = c.events.find((e) => e.type === 'ORDER_CREATED');
    c.tables[UIDS.notification].length = 0;
    resend.sendWithResend.mockClear();
    await Promise.all([c.notifications.handle(event), c.notifications.handle({ ...event })]);
    expect(resend.sendWithResend).toHaveBeenCalledTimes(1);
    expect(notifs(c)).toHaveLength(1);
    expect(notifs(c)[0].status).toBe('SENT');
  });

  it('skips a row that another sender has in progress', async () => {
    const c = setup();
    await createOrder(c);
    const event: DomainEvent = c.events.find((e) => e.type === 'ORDER_CREATED');
    Object.assign(notifs(c)[0], { status: 'FAILED', error: 'IN_PROGRESS' });
    resend.sendWithResend.mockClear();
    await c.notifications.handle(event);
    expect(resend.sendWithResend).not.toHaveBeenCalled();
    expect(notifs(c)[0].error).toBe('IN_PROGRESS');
  });

  it('REFUND_COMPLETED from the Stripe webhook sends the e-mail (reference = Stripe refund id)', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    c.tables[UIDS.payment].push({
      id: 900, order: orderId, method: 'STRIPE', status: 'COMPLETED', amount: 4500, currency: 'EUR',
      externalId: 'pi_1', idempotencyKey: 'stripe:900', coverage: null,
      completedAt: '2026-11-11T10:00:00.000Z', actor: 'webhook:stripe', metadata: null,
    });
    c.tables[UIDS.refund].push({
      id: 50, order: orderId, payment: 900, method: 'STRIPE', kind: 'MONEY', status: 'PROCESSING',
      amount: 1000, currency: 'EUR', reason: 'OTHER', description: 'Damaged item', reference: null,
      externalId: 're_abc', idempotencyKey: 'k:900', storeCredit: null, completedAt: null,
      metadata: { paymentIntentId: 'pi_1' }, actor: 'user:1',
    });
    const raw = Buffer.from(JSON.stringify({
      id: 'evt_r', object: 'event', type: 'refund.updated',
      data: { object: { id: 're_abc', object: 'refund', status: 'succeeded' } },
    }));
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', 'whsec_test_123').update(`${t}.`).update(raw).digest('hex')}`;
    expect(await c.webhooks.handle(raw, sig)).toEqual({ duplicate: false, status: 'PROCESSED' });
    const row = notifs(c).find((n) => n.type === 'REFUND_COMPLETED');
    expect(row).toMatchObject({ status: 'SENT', order: orderId });
    expect(row.payload.refund).toMatchObject({
      amount: '€10.00',
      reference: 're_abc',
      description: 'Damaged item',
      method: 'Card / original payment method',
      isPartial: 'yes',
    });
  });

  it('a failure loading the order still records a resendable FAILED row', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const real = c.orders.get;
    c.orders.get = vi.fn().mockRejectedValueOnce(new Error('db down'));
    resend.sendWithResend.mockClear();
    await c.payments.addManualPayment(orderId, { amount: 100, idempotencyKey: 'p1' }, actor);
    const row = notifs(c).find((n) => n.type === 'PAYMENT_CONFIRMATION');
    expect(row).toMatchObject({ status: 'FAILED', error: 'PREPARE_FAILED', order: orderId });
    expect(resend.sendWithResend).not.toHaveBeenCalled();
    c.orders.get = real;
    const view = await c.notifications.resend(row.id, actor);
    expect(view).toMatchObject({ status: 'SENT', recipient: 'Ana@Example.pt', locale: 'en', error: null });
    const stored = notifs(c).find((n) => n.id === row.id);
    expect(stored.payload.payment.amount).toBe('€1.00');
    expect(resend.sendWithResend.mock.calls[0][1].idempotencyKey).toBe(row.uniqueKey);
  });

  it('resend that corrects the recipient also updates the payload e-mail', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const order = c.tables[UIDS.order].find((o) => o.id === orderId);
    const original = order.customerSnapshot.email;
    order.customerSnapshot = { ...order.customerSnapshot, email: '' };
    await c.payments.addManualPayment(orderId, { amount: 100, idempotencyKey: 'p1' }, actor);
    const row = notifs(c).find((n) => n.type === 'PAYMENT_CONFIRMATION');
    expect(row.status).toBe('SKIPPED');
    order.customerSnapshot = { ...order.customerSnapshot, email: original };
    expect((await c.notifications.resend(row.id, actor)).status).toBe('SENT');
    const stored = notifs(c).find((n) => n.id === row.id);
    expect(stored.recipient).toBe(original);
    expect(stored.payload.customer.email).toBe(original);
  });

  it('manual payment instructions carry the selected manual method name', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    await c.payments.sendPaymentInstructions(
      orderId,
      { mode: 'MANUAL', instructions: 'Pay by MB WAY to 912345678', methodLabel: 'MB WAY' },
      actor
    );
    const row = notifs(c).find((n) => n.type === 'PAYMENT_INSTRUCTIONS');
    expect(row.payload.payment.method).toBe('MB WAY');
  });
});

describe('EcommerceNotificationService.resend / listForOrder', () => {
  it('resending a SENT notification returns it without sending', async () => {
    const c = setup();
    await createOrder(c);
    const [row] = notifs(c);
    resend.sendWithResend.mockClear();
    const view = await c.notifications.resend(row.id, actor);
    expect(view.status).toBe('SENT');
    expect(resend.sendWithResend).not.toHaveBeenCalled();
  });

  it('resend of an unknown id → not found', async () => {
    const c = setup();
    await expect(c.notifications.resend(999, actor)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('lists the notifications of an order, newest first, without the payload', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    await c.payments.addManualPayment(orderId, { amount: 100, idempotencyKey: 'p1' }, actor);
    const other = await createOrder(c);
    const list = await c.notifications.listForOrder(orderId);
    expect(list.map((n: any) => n.type)).toEqual(['PAYMENT_CONFIRMATION', 'ORDER_CONFIRMATION']);
    expect(list[0]).not.toHaveProperty('payload');
    expect(list[0]).toMatchObject({ status: 'SENT', recipient: 'Ana@Example.pt', attempts: 1 });
    expect(await c.notifications.listForOrder(other)).toHaveLength(1);
  });
});

describe('subscribeNotifications', () => {
  const event: DomainEvent = { id: 'e1', type: 'ORDER_CREATED', orderId: 1, occurredAt: '', payload: {} };

  const fakeStrapi = (active: string | null) => {
    const handle = vi.fn(async (_e: DomainEvent) => undefined);
    const bus = createEventBus(() => undefined);
    const strapi: any = {
      log: { error: vi.fn() },
      config: { get: () => ({ uuid: { app: { setting: 'setting' } } }) },
      db: {
        query: () => ({
          findOne: async () => (active === null ? null : { value: active }),
        }),
      },
      plugin: () => ({
        service: (name: string) =>
          name === 'EcommerceEventBus' ? { subscribe: bus.subscribe } : { handle },
      }),
    };
    return { strapi, bus, handle };
  };

  it('handles events only while the e-commerce module is active', async () => {
    for (const [active, calls] of [['true', 1], ['false', 0], [null, 0]] as const) {
      __resetEventHandlersForTests();
      const { strapi, bus, handle } = fakeStrapi(active);
      subscribeNotifications(strapi);
      const col = bus.collector();
      col.emit(event);
      await col.flush();
      await __drainNotificationsForTests();
      expect(handle).toHaveBeenCalledTimes(calls);
    }
  });

  it('does not block the flush: events queue and are handled one at a time, in order', async () => {
    __resetEventHandlersForTests();
    const { strapi, bus, handle } = fakeStrapi('true');
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    handle.mockImplementation(async (e: DomainEvent) => {
      order.push(`start:${e.id}`);
      if (e.id === 'a') await gate;
      order.push(`end:${e.id}`);
    });
    subscribeNotifications(strapi);
    const col = bus.collector();
    col.emit({ ...event, id: 'a' });
    col.emit({ ...event, id: 'b' });
    await col.flush(); // returns although 'a' is still sending
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['start:a']);
    release();
    await __drainNotificationsForTests();
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('a failing item does not stop the queue', async () => {
    __resetEventHandlersForTests();
    const { strapi, bus, handle } = fakeStrapi('true');
    handle.mockRejectedValueOnce(new Error('x'));
    subscribeNotifications(strapi);
    const col = bus.collector();
    col.emit({ ...event, id: 'a' });
    col.emit({ ...event, id: 'b' });
    await col.flush();
    await __drainNotificationsForTests();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(strapi.log.error).toHaveBeenCalled();
  });

  it('F8: an error handler that throws never stalls the queue', async () => {
    __resetEventHandlersForTests();
    const { strapi, bus, handle } = fakeStrapi('true');
    handle.mockRejectedValueOnce(new Error('x'));
    strapi.log.error = vi.fn(() => {
      throw new Error('logger down');
    });
    subscribeNotifications(strapi);
    const col = bus.collector();
    col.emit({ ...event, id: 'a' });
    col.emit({ ...event, id: 'b' });
    await col.flush();
    await expect(__drainNotificationsForTests()).resolves.toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(2);
    // Later events still go through.
    col.emit({ ...event, id: 'c' });
    await col.flush();
    await __drainNotificationsForTests();
    expect(handle).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Shipment, delivery and invoice e-mails (plan 5, Task 10)
// ---------------------------------------------------------------------------

const address = {
  firstName: 'Ana',
  lastName: 'Silva',
  line1: 'Rua A 1',
  postalCode: '1000-001',
  city: 'Lisboa',
  country: 'PT',
  nif: '123456789',
};

let docSeq = 0;

function fulfilmentSetup() {
  __resetBillingProvidersForTests();
  const c = setup();
  const provider: any = {
    id: 'fakebill',
    capabilities: { creditNotes: true, findByReference: true },
    maxIssueDurationMs: 300000,
    issue: vi.fn(async (draft: InvoiceDraft) => {
      docSeq += 1;
      return {
        externalId: `ext-${docSeq}`,
        number: draft.kind === 'CREDIT_NOTE' ? `NC 2026/${docSeq}` : `FR 2026/${docSeq}`,
        series: '2026',
        documentType: draft.kind === 'CREDIT_NOTE' ? 'NC' : 'FR',
        total: draft.total,
        issuedAt: '2026-03-01T10:00:00.000Z',
        warnings: [] as string[],
      };
    }),
    getDocument: vi.fn(),
    getPdf: vi.fn(async () => Buffer.from('%PDF-1.4 fake')),
    findByReference: vi.fn(async () => null),
  };
  registerBillingProvider(provider);
  const settings = c.services.EcommerceSettingsService;
  const baseRuntime = settings.getRuntime;
  settings.getActiveProviders = async (cat: string) => (cat === 'billing' ? ['fakebill'] : []);
  settings.getRuntime = async (id: string) =>
    id === 'fakebill' ? { config: {}, secrets: {}, active: true } : baseRuntime(id);
  settings.getStoreSettings = async () => ({
    shippingCountries: ['PT'],
    storefrontUrl: 'https://shop.example/',
    timezone: 'Europe/Lisbon',
  });
  c.tables[UIDS.variant].find((v) => v.id === 10).stock = 50;
  return { c, provider, ships: c.services.EcommerceShipmentService, inv: c.services.EcommerceInvoiceService };
}

const paid = async (c: Commerce, quantity = 2) => {
  const order = await c.orders.create(
    {
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      shippingAddress: address,
      billingAddress: address,
      locale: 'en',
      lines: [{ variantId: 10, quantity }],
      shipping: { providerId: 'manual', serviceId: 'express' },
    },
    { actor: 'user:1', source: 'admin' }
  );
  await c.payments.addManualPayment(
    order.id,
    { amount: quantity * 2000 + 500, idempotencyKey: `pay-${order.id}` },
    actor
  );
  const lineId = c.tables[UIDS.orderLine].find((l) => l.order === order.id).id as number;
  resend.sendWithResend.mockClear();
  c.tables[UIDS.notification].length = 0; // only what the test provokes from here on
  return { id: order.id as number, lineId };
};

const ship = (lineId: number, quantity: number, key: string, extra: Record<string, unknown> = {}) => ({
  lines: [{ orderLineId: lineId, quantity }],
  method: { mode: 'MANUAL' as const, carrierName: 'CTT', trackingCode: `RR-${key}`, trackingUrl: `https://ctt.pt/${key}` },
  shippingCost: 0,
  notifyCustomer: true,
  idempotencyKey: key,
  ...extra,
});

const types = (c: Commerce) => notifs(c).map((n) => n.type);

describe('shipment, delivery and invoice e-mails', () => {
  it('two partial shipments send two PARTIAL_SHIPMENT; the one that completes sends FULL_SHIPMENT', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 3);
    await ships.create(id, ship(lineId, 1, 's1'), actor);
    await ships.create(id, ship(lineId, 1, 's2'), actor);
    expect(types(c)).toEqual(['PARTIAL_SHIPMENT', 'PARTIAL_SHIPMENT']);
    expect(new Set(notifs(c).map((n) => n.eventId)).size).toBe(2);
    await ships.create(id, ship(lineId, 1, 's3'), actor);
    expect(types(c)).toEqual(['PARTIAL_SHIPMENT', 'PARTIAL_SHIPMENT', 'FULL_SHIPMENT']);
    const full = notifs(c)[2];
    expect(full).toMatchObject({ status: 'SENT', recipient: 'ana@example.pt' });
    expect(full.payload.shipment.allTracking).toHaveLength(3);
    expect(notifs(c)[0].payload.shipment.pendingItems).toEqual([
      { name: 'Shirt', option: '', sku: 'SH-M', quantity: 2 },
    ]);
  });

  it('notify: false sends no shipment e-mail and no delivery e-mail', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 1);
    const s = await ships.create(id, ship(lineId, 1, 's1', { notifyCustomer: false }), actor);
    await ships.confirmDelivery(s.id, { deliveredAt: new Date().toISOString(), notifyCustomer: false }, actor);
    expect(notifs(c)).toHaveLength(0);
  });

  it('delivery: not everything delivered sends nothing; the last delivery sends DELIVERY_CONFIRMATION', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 2);
    const a = await ships.create(id, ship(lineId, 1, 's1'), actor);
    const b = await ships.create(id, ship(lineId, 1, 's2'), actor);
    const at = new Date().toISOString();
    await ships.confirmDelivery(a.id, { deliveredAt: at, notifyCustomer: true }, actor);
    expect(types(c)).not.toContain('DELIVERY_CONFIRMATION');
    await ships.confirmDelivery(b.id, { deliveredAt: at, notifyCustomer: true }, actor);
    expect(types(c).filter((t) => t === 'DELIVERY_CONFIRMATION')).toHaveLength(1);
    expect(notifs(c).at(-1)).toMatchObject({ status: 'SENT' });
  });

  it('tracking edits never send an e-mail', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 1);
    const s = await ships.create(id, ship(lineId, 1, 's1'), actor);
    const before = notifs(c).length;
    await ships.updateTracking(s.id, { trackingCode: 'NEW', trackingUrl: 'https://ctt.pt/NEW' }, actor);
    expect(notifs(c)).toHaveLength(before);
  });

  it('the invoice e-mail carries the PDF fetched with getPdf; the credit note sends nothing', async () => {
    const { c, inv, provider } = fulfilmentSetup();
    const { id } = await paid(c, 2);
    const payment = c.tables[UIDS.payment].find((p) => p.order === id);
    const view = await inv.issue(id, { type: 'PAYMENT', paymentId: payment.id }, { idempotencyKey: 'i1' }, actor);
    expect(notifs(c)).toHaveLength(1);
    expect(notifs(c)[0]).toMatchObject({ type: 'INVOICE_AVAILABLE', status: 'SENT' });
    const msg = resend.sendWithResend.mock.calls[0][1];
    expect(msg.attachments).toEqual([
      { filename: expect.stringMatching(/\.pdf$/), content: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' },
    ]);
    expect(provider.getPdf).toHaveBeenCalledTimes(1);
    expect(notifs(c)[0].payload.invoice.number).toBe(view.number);
    expect(JSON.stringify(notifs(c)[0].payload)).not.toContain('PDF-1.4');

    await inv.issueCreditNote(view.id, { idempotencyKey: 'c1', reason: 'x', lines: [{ index: 0, value: 1000 }] }, actor);
    expect(c.events.some((e) => e.type === 'INVOICE_ISSUED' && e.payload.kind === 'CREDIT_NOTE')).toBe(true);
    expect(notifs(c)).toHaveLength(1);
  });

  it('Review Focus 5: PDF unavailable at notification time leaves the invoice ISSUED, the e-mail FAILED, and resend attaches the PDF', async () => {
    const { c, inv, provider } = fulfilmentSetup();
    const { id } = await paid(c, 2);
    const payment = c.tables[UIDS.payment].find((p) => p.order === id);
    provider.getPdf.mockRejectedValueOnce(new Error('down'));
    const view = await inv.issue(id, { type: 'PAYMENT', paymentId: payment.id }, { idempotencyKey: 'i1' }, actor);
    expect(c.tables[UIDS.invoice].find((i) => i.id === view.id).status).toBe('ISSUED');
    const row = notifs(c)[0];
    expect(row).toMatchObject({ type: 'INVOICE_AVAILABLE', status: 'FAILED', error: 'INVOICE_PDF_UNAVAILABLE' });
    expect(resend.sendWithResend).not.toHaveBeenCalled();
    expect(historyTypes(c, id)).toContain('NOTIFICATION_FAILED');

    const resent = await c.notifications.resend(row.id, actor);
    expect(resent).toMatchObject({ status: 'SENT', error: null });
    expect(resend.sendWithResend.mock.calls[0][1].attachments).toHaveLength(1);
    expect(resend.sendWithResend.mock.calls[0][1].idempotencyKey).toBe(row.uniqueKey);
  });

  it('an invoice with DUPLICATE_INVOICE is never sent, not even on resend', async () => {
    const { c, inv } = fulfilmentSetup();
    const { id } = await paid(c, 2);
    const payment = c.tables[UIDS.payment].find((p) => p.order === id);
    const view = await inv.issue(id, { type: 'PAYMENT', paymentId: payment.id }, { idempotencyKey: 'i1' }, actor);
    const row = notifs(c)[0];
    // Reset to a not-yet-sent state and flag the invoice as duplicated.
    const invRow = c.tables[UIDS.invoice].find((i) => i.id === view.id);
    invRow.metadata = { ...(invRow.metadata ?? {}), warnings: ['DUPLICATE_INVOICE'] };
    row.status = 'FAILED';
    row.error = 'INVOICE_PDF_UNAVAILABLE';
    resend.sendWithResend.mockClear();
    const resent = await c.notifications.resend(row.id, actor);
    expect(resent).toMatchObject({ status: 'SKIPPED', error: 'DUPLICATE_INVOICE' });
    expect(resend.sendWithResend).not.toHaveBeenCalled();
    expect((await c.notifications.resend(row.id, actor)).status).toBe('SKIPPED');
  });

  it('a late event for an order that is no longer OPEN leaves a SKIPPED ORDER_NOT_OPEN row; resend still skips', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 1);
    const orderRow = c.tables[UIDS.order].find((o) => o.id === id);
    await ships.create(id, ship(lineId, 1, 's1'), actor);
    notifs(c).length = 0;
    resend.sendWithResend.mockClear();
    orderRow.orderStatus = 'CANCELLED';
    const event = c.events.find((e) => e.type === 'SHIPMENT_CREATED');
    await c.notifications.handle({ ...event, id: 'late-1' });
    expect(notifs(c)).toHaveLength(1);
    expect(notifs(c)[0]).toMatchObject({ status: 'SKIPPED', error: 'ORDER_NOT_OPEN' });
    expect((await c.notifications.resend(notifs(c)[0].id, actor)).error).toBe('ORDER_NOT_OPEN');
    // notify false: no row at all
    await c.notifications.handle({ ...event, id: 'late-2', payload: { ...event.payload, notify: false } });
    expect(notifs(c)).toHaveLength(1);
    expect(resend.sendWithResend).not.toHaveBeenCalled();
  });

  it('resend after the order was cancelled skips a FAILED shipment e-mail', async () => {
    const { c, ships } = fulfilmentSetup();
    const { id, lineId } = await paid(c, 1);
    resend.sendWithResend.mockRejectedValueOnce(new EcommerceEmailError('EMAIL_SEND_FAILED'));
    await ships.create(id, ship(lineId, 1, 's1'), actor);
    expect(notifs(c)[0].status).toBe('FAILED');
    c.tables[UIDS.order].find((o) => o.id === id).orderStatus = 'CANCELLED';
    resend.sendWithResend.mockClear();
    const view = await c.notifications.resend(notifs(c)[0].id, actor);
    expect(view).toMatchObject({ status: 'SKIPPED', error: 'ORDER_NOT_OPEN' });
    expect(resend.sendWithResend).not.toHaveBeenCalled();
  });

  it('an invoice that is no longer ISSUED is SKIPPED INVOICE_NOT_ISSUED, not a failure loop', async () => {
    const { c, inv } = fulfilmentSetup();
    const { id } = await paid(c, 2);
    const payment = c.tables[UIDS.payment].find((p) => p.order === id);
    const view = await inv.issue(id, { type: 'PAYMENT', paymentId: payment.id }, { idempotencyKey: 'i1' }, actor);
    const row = notifs(c)[0];
    c.tables[UIDS.invoice].find((i) => i.id === view.id).status = 'UNCERTAIN';
    row.status = 'FAILED';
    row.error = 'INVOICE_PDF_UNAVAILABLE';
    resend.sendWithResend.mockClear();
    expect(await c.notifications.resend(row.id, actor)).toMatchObject({
      status: 'SKIPPED',
      error: 'INVOICE_NOT_ISSUED',
    });
    expect(resend.sendWithResend).not.toHaveBeenCalled();
  });

  it('hostile carrier name and tracking code are HTML-escaped in the rendered e-mail', () => {
    const store: any = { storeName: 'Loja', brandColor: '#111', storefrontUrl: 'https://shop.example', timezone: 'UTC' };
    const order: any = { reference: 1, locale: 'en', customer: { firstName: 'A', lastName: 'B', email: 'a@b.pt' }, lines: [] };
    const hostile = (n: number) => ({
      id: n,
      carrierName: '<script>alert(1)</script>',
      trackingCode: '"><img src=x onerror=alert(1)>',
      trackingUrl: 'https://www.ctt.pt/t',
      items: { lines: [] },
    });
    const data = buildTemplateData('FULL_SHIPMENT', {
      order,
      store,
      event: { id: 'e', type: 'SHIPMENT_CREATED', orderId: 1, occurredAt: '', payload: { full: true } },
      extra: { shipment: hostile(1), shipments: [hostile(1), hostile(2)] },
    });
    const html = renderTemplate(DEFAULT_TEMPLATES.FULL_SHIPMENT.html, data);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('the rendered e-mails of this plan carry no Strapi URL; links go to the store, the carrier or Stripe', () => {
    const store: any = {
      storeName: 'Loja',
      // Admin-configured, accepted as it is (the only URL we do not control).
      logo: { url: 'https://cdn.example.com/logo.png', width: 480, height: 96 },
      brandColor: '#111111',
      storefrontUrl: 'https://shop.example',
      supportEmail: 'help@shop.example',
      timezone: 'Europe/Lisbon',
    };
    const order: any = {
      reference: 1042,
      locale: 'en',
      createdAt: '2026-11-11T10:00:00.000Z',
      customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt' },
      lines: [{ id: 1, sku: 'SH-M', name: 'Shirt', option: 'M', quantity: 2 }],
    };
    const row = (n: number) => ({
      id: n,
      carrierName: 'CTT',
      trackingCode: `RR${n}`,
      trackingUrl: `https://www.ctt.pt/track?code=RR${n}`,
      items: { lines: [{ orderLineId: 1, sku: 'SH-M', name: 'Shirt', option: 'M', quantity: 1 }] },
    });
    const ev = (type: any, payload: any) => ({ id: 'e', type, orderId: 1, occurredAt: '2026-11-12T10:00:00.000Z', payload });
    const cases: [any, any][] = [
      ['PARTIAL_SHIPMENT', ev('SHIPMENT_CREATED', { full: false, pending: [{ orderLineId: 1, quantity: 1 }] })],
      ['FULL_SHIPMENT', ev('SHIPMENT_CREATED', { full: true, pending: [] })],
      ['DELIVERY_CONFIRMATION', ev('SHIPMENT_DELIVERED', { deliveredAt: '2026-11-12T10:00:00.000Z' })],
      ['INVOICE_AVAILABLE', ev('INVOICE_ISSUED', { invoiceId: 9, kind: 'INVOICE' })],
    ];
    for (const [type, event] of cases) {
      const data = buildTemplateData(type, {
        order,
        store,
        event,
        extra: { shipment: row(1), shipments: [row(1), row(2)], invoice: { id: 9, number: 'FR 2026/1' } },
      });
      const html = renderTemplate(DEFAULT_TEMPLATES[type as 'FULL_SHIPMENT'].html, data);
      expect(html, type).not.toMatch(/\/admin|\/api\/|\/uploads|littlebox-strapi-suite|localhost:1337/);
      expect(html, type).toContain('width="240" height="48"');
      const urls = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
      for (const u of urls) {
        let ok = u === store.logo.url;
        if (!ok && u.startsWith('mailto:')) ok = true;
        if (!ok) {
          const origin = new URL(u).origin;
          ok = ['https://shop.example', 'https://www.ctt.pt', 'https://checkout.stripe.com'].includes(origin);
        }
        expect(ok, `${type}: ${u}`).toBe(true);
      }
      if (type === 'INVOICE_AVAILABLE') {
        expect(urls.filter((u) => u !== store.logo.url && !u.startsWith('mailto:'))).toEqual(['https://shop.example']);
      }
      if (type === 'FULL_SHIPMENT') {
        expect(html).toContain('RR1');
        expect(html).toContain('RR2');
      }
    }
  });
});

describe('order confirmation promotions', () => {
  it('prepare passes the store default locale, so the name resolves in it', async () => {
    const c = setup();
    const orderId = await createOrder(c);
    const row = c.tables[UIDS.order].find((o) => o.id === orderId);
    row.locale = 'pt';
    row.promotions = {
      applied: [
        { promotionId: 1, name: 'Internal', displayName: { en: 'Summer' }, code: null, amount: 500 },
      ],
      codes: [],
      exhaustive: true,
    };
    resend.sendWithResend.mockClear();
    const event = c.events.find((e) => e.type === 'ORDER_CREATED');
    await c.notifications.handle({ ...event, id: 'evt-promo' });
    const sent = c.tables[UIDS.notification].find((n) => n.uniqueKey === 'notif:evt-promo:ORDER_CONFIRMATION');
    expect(sent.payload.order.promotions).toEqual([{ name: 'Summer', amount: expect.stringContaining('5') }]);
  });
});
