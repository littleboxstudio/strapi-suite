import { describe, it, expect, vi, beforeEach } from 'vitest';

const rnd = vi.hoisted(() => ({ queue: [] as Buffer[] }));
vi.mock('crypto', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: actual,
    randomBytes: (n: number) => rnd.queue.shift() ?? actual.randomBytes(n),
  };
});

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  createRefund: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  retrieveRefund: vi.fn(),
}));
vi.mock('../../../server/src/services/modules/ecommerce/providers/payments/stripeClient', () => ({
  createStripeClient: () => stripe,
}));

import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import {
  UIDS,
  setupCommerce,
  createOrder,
  customerIdOf,
  type Commerce,
} from './helpers/commerceSetup';

beforeEach(() => {
  __resetEventHandlersForTests();
  rnd.queue = [];
});

const codesOf = async (p: Promise<unknown>): Promise<string[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors.map((x) => x.code);
    throw e;
  }
  return [];
};

const issueFor = async (c: Commerce, orderId: number, amount: number, key = 'k1') =>
  c.storeCredits.issue({
    customerId: customerIdOf(c, orderId),
    amount,
    actor: 'user:1',
    operationKey: key,
  });

const credit = (c: Commerce, id: number) => c.tables[UIDS.storeCredit].find((x) => x.id === id);
const movements = (c: Commerce) => c.tables[UIDS.storeCreditMovement];

describe('EcommerceStoreCreditService.issue', () => {
  it('creates an ACTIVE credit for the customer e-mail with an ISSUE movement and an event', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const before = Date.now();
    const issued = await issueFor(c, orderId, 2500);

    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const row = credit(c, issued.id);
    expect(row).toMatchObject({
      initialAmount: 2500,
      balance: 2500,
      status: 'ACTIVE',
      emailNormalized: 'ana@example.pt',
      currency: 'EUR',
      actor: 'user:1',
    });
    // Default validity: +12 months.
    const expires = new Date(row.expiresAt);
    const expected = new Date(before);
    expected.setMonth(expected.getMonth() + 12);
    expect(Math.abs(expires.getTime() - expected.getTime())).toBeLessThan(60_000);
    expect(movements(c)).toEqual([
      expect.objectContaining({ type: 'ISSUE', amount: 2500, operationKey: 'k1', storeCredit: issued.id }),
    ]);
    const ev = c.events.filter((e) => e.type === 'STORE_CREDIT_ISSUED');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ storeCreditId: issued.id, code: issued.code, amount: 2500 });
  });

  it('is idempotent by operationKey', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const a = await issueFor(c, orderId, 2500);
    const b = await issueFor(c, orderId, 2500);
    expect(b.id).toBe(a.id);
    expect(c.tables[UIDS.storeCredit]).toHaveLength(1);
    expect(c.events.filter((e) => e.type === 'STORE_CREDIT_ISSUED')).toHaveLength(1);
  });

  it('retries with a new code when the generated code already exists', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const zeros = Buffer.alloc(12, 0); // AAAA-AAAA-AAAA
    c.tables[UIDS.storeCredit].push({ id: 99, code: 'AAAA-AAAA-AAAA', balance: 0, status: 'ACTIVE' });
    rnd.queue = [zeros, Buffer.alloc(12, 1)]; // then BBBB-BBBB-BBBB
    const issued = await issueFor(c, orderId, 1000);
    expect(issued.code).toBe('BBBB-BBBB-BBBB');
  });

  it('rejects invalid amounts and unknown customers', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    expect(await codesOf(issueFor(c, orderId, 0))).toEqual(['invalid_amount']);
    expect(await codesOf(issueFor(c, orderId, 12.5))).toEqual(['invalid_amount']);
    expect(
      await codesOf(
        c.storeCredits.issue({ customerId: 777, amount: 100, actor: 'user:1', operationKey: 'x' })
      )
    ).toEqual(['customer_not_found']);
    expect(c.tables[UIDS.storeCredit]).toHaveLength(0);
  });
});

describe('EcommerceStoreCreditService.consume / restore', () => {
  it('consumes with a conditional decrement and records a CONSUME movement once', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 2500);
    const input = {
      code: issued.code.toLowerCase(),
      email: ' ANA@example.pt ',
      amount: 1000,
      orderId,
      paymentId: null,
      operationKey: 'consume:x',
    };
    await c.storeCredits.consume(input);
    await c.storeCredits.consume(input);
    expect(credit(c, issued.id).balance).toBe(1500);
    expect(movements(c).filter((m) => m.type === 'CONSUME')).toEqual([
      expect.objectContaining({ amount: -1000, operationKey: 'consume:x', order: orderId }),
    ]);
    expect(c.db.increments.at(-1)).toMatchObject({ column: 'balance', amount: -1000, trx: c.db.trx });
  });

  it('refuses a different e-mail, an unknown code, an expired or void credit', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 2500);
    const base = { amount: 100, orderId, paymentId: null };
    expect(
      await codesOf(c.storeCredits.consume({ ...base, code: issued.code, email: 'x@y.pt', operationKey: 'a' }))
    ).toEqual(['STORE_CREDIT_EMAIL_MISMATCH']);
    expect(
      await codesOf(c.storeCredits.consume({ ...base, code: 'ZZZZ-ZZZZ-ZZZZ', email: 'ana@example.pt', operationKey: 'b' }))
    ).toEqual(['STORE_CREDIT_NOT_FOUND']);
    credit(c, issued.id).expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(
      await codesOf(c.storeCredits.consume({ ...base, code: issued.code, email: 'ana@example.pt', operationKey: 'c' }))
    ).toEqual(['STORE_CREDIT_EXPIRED']);
    expect(credit(c, issued.id).balance).toBe(2500);
    expect(movements(c).filter((m) => m.type === 'CONSUME')).toHaveLength(0);
  });

  it('a concurrent consumption (UPDATE affects 0 rows) is refused with STORE_CREDIT_INSUFFICIENT', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 2500);
    // Another request spends 2000 between the read and the conditional UPDATE.
    const original = c.strapi.db.getConnection;
    c.strapi.db.getConnection = (table: string) => {
      if (table === UIDS.storeCredit) credit(c, issued.id).balance = 500;
      return original(table);
    };
    expect(
      await codesOf(
        c.storeCredits.consume({
          code: issued.code,
          email: 'ana@example.pt',
          amount: 1000,
          orderId,
          paymentId: null,
          operationKey: 'race',
        })
      )
    ).toEqual(['STORE_CREDIT_INSUFFICIENT']);
    c.strapi.db.getConnection = original;
    // The conditional decrement ran and matched no row (500 < 1000): nothing was overdrawn.
    // (The fake DB's rollback also undoes the simulated concurrent write.)
    expect(c.db.increments.at(-1)).toMatchObject({ table: UIDS.storeCredit, amount: -1000 });
    expect(credit(c, issued.id).balance).toBeGreaterThanOrEqual(0);
    expect(movements(c).filter((m) => m.type === 'CONSUME')).toHaveLength(0);
  });

  it('restore increments the balance with a RESTORE movement, once per operationKey', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 2500);
    await c.storeCredits.consume({
      code: issued.code,
      email: 'ana@example.pt',
      amount: 2000,
      orderId,
      paymentId: null,
      operationKey: 'consume:1',
    });
    const r1 = await c.storeCredits.restore({ storeCreditId: issued.id, amount: 2000, refundId: null, operationKey: 'r:1' });
    const r2 = await c.storeCredits.restore({ storeCreditId: issued.id, amount: 2000, refundId: null, operationKey: 'r:1' });
    expect(r1).toEqual({ applied: true, storeCreditId: issued.id, code: issued.code, reissuedFrom: null });
    expect(r2).toMatchObject({ applied: false, storeCreditId: issued.id });
    expect(credit(c, issued.id).balance).toBe(2500);
    expect(movements(c).filter((m) => m.type === 'RESTORE')).toEqual([
      expect.objectContaining({ amount: 2000, operationKey: 'r:1' }),
    ]);
  });

  it('F7: a credit voided between the read and the increment is never topped up: a new credit is issued', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 2500);
    await c.storeCredits.consume({
      code: issued.code,
      email: 'ana@example.pt',
      amount: 2000,
      orderId,
      paymentId: null,
      operationKey: 'consume:1',
    });
    // A concurrent void commits right after `restore` read the credit as ACTIVE.
    const original = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = original(uid);
      if (uid !== UIDS.storeCredit) return q;
      return {
        ...q,
        findOne: async (args: any) => {
          const row = await q.findOne(args);
          const snapshot = row ? { ...row } : row;
          if (row && row.id === issued.id) {
            const stored = credit(c, issued.id);
            stored.status = 'VOID';
          }
          return snapshot;
        },
      };
    };
    const res = await c.storeCredits.restore({
      storeCreditId: issued.id,
      amount: 2000,
      refundId: null,
      operationKey: 'r:void-race',
    });
    c.strapi.db.query = original;
    expect(res.applied).toBe(true);
    expect(res.reissuedFrom).toMatchObject({ id: issued.id });
    expect(res.storeCreditId).not.toBe(issued.id);
    expect(credit(c, issued.id)).toMatchObject({ status: 'VOID', balance: 500 });
    expect(credit(c, res.storeCreditId)).toMatchObject({ status: 'ACTIVE', balance: 2000 });
    expect(movements(c).filter((m) => m.type === 'RESTORE')).toHaveLength(0);
  });
});

describe('EcommercePaymentService.addStoreCreditPayment', () => {
  it('pays min(due, balance) with a COMPLETED STORE_CREDIT payment that has coverage', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c); // total 4500
    const issued = await issueFor(c, orderId, 3000);

    const payment = await c.payments.addStoreCreditPayment(
      orderId,
      { code: issued.code, idempotencyKey: 'pay-1' },
      'user:1'
    );
    expect(payment).toMatchObject({ method: 'STORE_CREDIT', status: 'COMPLETED', amount: 3000 });
    const row = c.tables[UIDS.payment].find((p) => p.id === payment.id);
    expect(row.coverage.coveredValue).toBe(3000);
    expect(row.metadata).toMatchObject({ storeCreditId: issued.id, code: issued.code });
    expect(credit(c, issued.id).balance).toBe(0);
    expect(movements(c).find((m) => m.type === 'CONSUME')).toMatchObject({
      amount: -3000,
      payment: payment.id,
      order: orderId,
    });
    expect(c.tables[UIDS.order][0].paymentStatus).toBe('PARTIALLY_PAID');
    expect(c.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toEqual([
      expect.objectContaining({ orderId, payload: expect.objectContaining({ method: 'STORE_CREDIT', amount: 3000 }) }),
    ]);
    const types = c.tables[UIDS.orderHistory].map((h) => h.type);
    expect(types).toEqual(expect.arrayContaining(['PAYMENT_CREATED', 'PAYMENT_COMPLETED']));

    // A replay returns the stored payment and consumes nothing more.
    const again = await c.payments.addStoreCreditPayment(
      orderId,
      { code: issued.code, idempotencyKey: 'pay-1' },
      'user:1'
    );
    expect(again.id).toBe(payment.id);
    expect(movements(c).filter((m) => m.type === 'CONSUME')).toHaveLength(1);
  });

  it('a larger balance pays only what is due', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 10000);
    const payment = await c.payments.addStoreCreditPayment(
      orderId,
      { code: issued.code, idempotencyKey: 'pay-1' },
      'user:1'
    );
    expect(payment.amount).toBe(4500);
    expect(credit(c, issued.id).balance).toBe(5500);
    expect(c.tables[UIDS.order][0].paymentStatus).toBe('PAID');
  });

  describe('Review Focus 4: refused without changing the balance or the payments', () => {
    it('a credit of another e-mail (the order snapshot e-mail is used)', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const otherOrder = await createOrder(c, 'bruno@example.pt');
      const issued = await issueFor(c, otherOrder, 3000);
      const paymentsBefore = c.tables[UIDS.payment].length;

      expect(
        await codesOf(
          c.payments.addStoreCreditPayment(orderId, { code: issued.code, idempotencyKey: 'p' }, 'user:1')
        )
      ).toEqual(['STORE_CREDIT_EMAIL_MISMATCH']);
      expect(credit(c, issued.id).balance).toBe(3000);
      expect(c.tables[UIDS.payment]).toHaveLength(paymentsBefore);
      expect(c.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(0);
    });

    it('an insufficient balance (concurrent consumption)', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const issued = await issueFor(c, orderId, 3000);
      const original = c.strapi.db.getConnection;
      c.strapi.db.getConnection = (table: string) => {
        if (table === UIDS.storeCredit) credit(c, issued.id).balance = 100;
        return original(table);
      };
      expect(
        await codesOf(
          c.payments.addStoreCreditPayment(orderId, { code: issued.code, idempotencyKey: 'p' }, 'user:1')
        )
      ).toEqual(['STORE_CREDIT_INSUFFICIENT']);
      c.strapi.db.getConnection = original;
      expect(c.db.increments.at(-1)).toMatchObject({ table: UIDS.storeCredit, amount: -3000 });
      expect(credit(c, issued.id).balance).toBeGreaterThanOrEqual(0);
      expect(movements(c).filter((m) => m.type === 'CONSUME')).toHaveLength(0);
      expect(c.tables[UIDS.payment]).toHaveLength(0);
      expect(c.tables[UIDS.order][0].paymentStatus).toBe('PENDING');
    });

    it('an empty credit', async () => {
      const c = setupCommerce();
      const orderId = await createOrder(c);
      const issued = await issueFor(c, orderId, 3000);
      credit(c, issued.id).balance = 0;
      expect(
        await codesOf(
          c.payments.addStoreCreditPayment(orderId, { code: issued.code, idempotencyKey: 'p' }, 'user:1')
        )
      ).toEqual(['STORE_CREDIT_EMPTY']);
      expect(c.tables[UIDS.payment]).toHaveLength(0);
    });
  });

  it('requires a code and a key, and ADD_PAYMENT', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    expect(
      await codesOf(c.payments.addStoreCreditPayment(orderId, { code: 'X', idempotencyKey: '' }, 'user:1'))
    ).toEqual(['required']);
    expect(
      await codesOf(c.payments.addStoreCreditPayment(orderId, { code: ' ', idempotencyKey: 'k' }, 'user:1'))
    ).toEqual(['required']);
    const issued = await issueFor(c, orderId, 10000);
    await c.payments.addStoreCreditPayment(orderId, { code: issued.code, idempotencyKey: 'a' }, 'user:1');
    expect(
      await codesOf(c.payments.addStoreCreditPayment(orderId, { code: issued.code, idempotencyKey: 'b' }, 'user:1'))
    ).toEqual(['ACTION_NOT_AVAILABLE']);
    expect(credit(c, issued.id).balance).toBe(5500);
  });
});

describe('EcommercePaymentService.applyStoreCredit', () => {
  it("joins the caller's transaction and leaves the events to the caller's collector", async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c); // total 4500
    const issued = await issueFor(c, orderId, 3000);
    c.events.length = 0;
    const emitted: any[] = [];
    const collector = { emit: (e: any) => emitted.push(e) };

    const err = await c.strapi.db
      .transaction(async () => {
        const view = await c.payments.applyStoreCredit({
          orderId,
          code: issued.code,
          idempotencyKey: 'outer:store-credit',
          actor: 'user:1',
          operationId: 'op-1',
          collector,
        });
        expect(view).toMatchObject({ method: 'STORE_CREDIT', status: 'COMPLETED', amount: 3000 });
        expect(credit(c, issued.id).balance).toBe(0);
        throw new Error('caller failed after the payment');
      })
      .catch((e: Error) => e);

    expect(err.message).toBe('caller failed after the payment');
    // The caller's rollback undoes the payment and the consumption.
    expect(c.tables[UIDS.payment]).toHaveLength(0);
    expect(credit(c, issued.id).balance).toBe(3000);
    expect(movements(c).filter((m) => m.type === 'CONSUME')).toHaveLength(0);
    // Emitted into the caller's collector, never flushed by applyStoreCredit.
    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'PAYMENT_COMPLETED',
        orderId,
        payload: expect.objectContaining({ amount: 3000 }),
      }),
    ]);
    expect(c.events).toHaveLength(0);
    const ops = c.tables[UIDS.orderHistory].filter((h) => h.operationId === 'op-1');
    expect(ops).toHaveLength(0);
  });

  it('records its history with the given operationId', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const issued = await issueFor(c, orderId, 1000);
    const collector = c.services.EcommerceEventBus.collector();
    await c.strapi.db.transaction(() =>
      c.payments.applyStoreCredit({
        orderId,
        code: issued.code,
        idempotencyKey: 'k:store-credit',
        actor: 'user:1',
        operationId: 'op-2',
        collector,
      })
    );
    await collector.flush();
    expect(
      c.tables[UIDS.orderHistory].filter((h) => h.operationId === 'op-2').map((h) => h.type)
    ).toEqual(expect.arrayContaining(['PAYMENT_CREATED', 'PAYMENT_COMPLETED']));
    expect(c.events.filter((e) => e.type === 'PAYMENT_COMPLETED')).toHaveLength(1);
  });
});

describe('EcommerceStoreCreditService queries and void', () => {
  it('lists by customer, searches by code or e-mail, gets with movements and voids', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const other = await createOrder(c, 'bruno@example.pt');
    const a = await issueFor(c, orderId, 1000, 'a');
    const b = await issueFor(c, other, 2000, 'b');

    const mine = await c.storeCredits.listForCustomer(customerIdOf(c, orderId));
    expect(mine.map((x: any) => x.id)).toEqual([a.id]);

    const byEmail = await c.storeCredits.list({ search: 'bruno' });
    expect(byEmail.results.map((x: any) => x.id)).toEqual([b.id]);
    expect(byEmail.pagination).toMatchObject({ page: 1, total: 1 });
    const byCode = await c.storeCredits.list({ search: a.code.toLowerCase() });
    expect(byCode.results.map((x: any) => x.id)).toEqual([a.id]);
    expect((await c.storeCredits.list({})).results).toHaveLength(2);

    const detail = await c.storeCredits.get(a.id);
    expect(detail).toMatchObject({ id: a.id, code: a.code, balance: 1000, status: 'ACTIVE' });
    expect(detail.movements).toEqual([expect.objectContaining({ type: 'ISSUE', amount: 1000 })]);

    const voided = await c.storeCredits.void(a.id, 'user:2');
    expect(voided).toMatchObject({ status: 'VOID', balance: 0 });
    expect(movements(c).filter((m) => m.type === 'ADJUST')).toEqual([
      expect.objectContaining({ amount: -1000, operationKey: `void:${a.id}`, actor: 'user:2' }),
    ]);
    // Voiding twice changes nothing.
    await c.storeCredits.void(a.id, 'user:2');
    expect(movements(c).filter((m) => m.type === 'ADJUST')).toHaveLength(1);
    expect(
      await codesOf(
        c.storeCredits.consume({ code: a.code, email: 'ana@example.pt', amount: 1, orderId, paymentId: null, operationKey: 'v' })
      )
    ).toEqual(['STORE_CREDIT_VOID']);
  });

  it('void writes off exactly the balance it read: a concurrent change is re-read and retried', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const a = await issueFor(c, orderId, 1000, 'a');
    // A consumption of 400 commits between void's read and its write, once.
    const query = c.strapi.db.query;
    let raced = false;
    c.strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.storeCredit) return q;
      return {
        ...q,
        updateMany: async (p: any) => {
          if (!raced) {
            raced = true;
            credit(c, a.id).balance = 600;
          }
          return q.updateMany(p);
        },
      };
    };
    const voided = await c.storeCredits.void(a.id, 'user:2');
    c.strapi.db.query = query;
    expect(voided).toMatchObject({ status: 'VOID', balance: 0 });
    expect(movements(c).filter((m) => m.type === 'ADJUST')).toEqual([
      expect.objectContaining({ amount: -600, operationKey: `void:${a.id}` }),
    ]);
  });

  it('void gives up with STORE_CREDIT_CONFLICT when the balance keeps changing', async () => {
    const c = setupCommerce();
    const orderId = await createOrder(c);
    const a = await issueFor(c, orderId, 1000, 'a');
    const query = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const q = query(uid);
      if (uid !== UIDS.storeCredit) return q;
      return {
        ...q,
        updateMany: async (p: any) => {
          credit(c, a.id).balance -= 1;
          return q.updateMany(p);
        },
      };
    };
    expect(await codesOf(c.storeCredits.void(a.id, 'user:2'))).toEqual(['STORE_CREDIT_CONFLICT']);
    c.strapi.db.query = query;
    expect(movements(c).filter((m) => m.type === 'ADJUST')).toHaveLength(0);
  });
});
