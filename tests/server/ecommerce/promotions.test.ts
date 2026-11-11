import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';

import { __resetEventHandlersForTests } from '../../../server/src/services/modules/ecommerce/events';
import { EcommerceValidationError } from '../../../server/src/services/modules/ecommerce/errors';
import type { AppliedPromotion } from '../../../server/src/services/modules/ecommerce/domain/promotions';
import { UIDS, setupCommerce, type Commerce } from './helpers/commerceSetup';

const group = (children: any[] = []) => ({ type: 'GROUP', operator: 'AND', children });
const input = (over: Record<string, unknown> = {}): any => ({
  name: 'Verão',
  description: null,
  method: 'CODE',
  code: 'VERAO20',
  displayName: { pt: 'Verão 20' },
  priority: 0,
  active: true,
  startsAt: '2026-07-01T10:00',
  endsAt: '2026-08-31T23:59',
  usageLimit: null,
  perCustomerLimit: null,
  perOrderLimit: null,
  eligibility: { mode: 'ALL' },
  conditions: group(),
  benefits: [{ type: 'ORDER_PERCENT', percent: 10 }],
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  ...over,
});

const errorsOf = async (p: Promise<unknown>): Promise<{ path: string; code: string; detail?: string }[]> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EcommerceValidationError) return e.errors as any;
    throw e;
  }
  return [];
};
const codesOf = async (p: Promise<unknown>) => (await errorsOf(p)).map((e) => e.code);

const usageKey = (promotionId: number, email: string) =>
  `p${promotionId}:${createHash('sha256').update(email).digest('hex')}`;

/** A stored promotion row (as the admin service writes it). */
const row = (over: Record<string, unknown> = {}) => ({
  name: 'Promo',
  description: null,
  code: null,
  method: 'AUTOMATIC',
  active: true,
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  priority: 0,
  displayName: {},
  eligibility: { mode: 'ALL' },
  conditions: group(),
  benefits: { items: [{ type: 'ORDER_PERCENT', percent: 10 }] },
  stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
  usageLimit: null,
  perCustomerLimit: null,
  perOrderLimit: null,
  redemptions: 0,
  version: 1,
  ...over,
});

const applied = (promotionId: number, code: string | null, amount = 300): AppliedPromotion => ({
  promotionId,
  version: 1,
  name: 'Promo',
  displayName: {},
  code,
  method: code ? 'CODE' : 'AUTOMATIC',
  classes: ['ORDER_DISCOUNT'],
  amount,
  benefits: [],
  snapshot: {
    eligibility: { mode: 'ALL' },
    conditions: group() as any,
    stacking: { exclusive: false, withProduct: true, withOrder: true, withShipping: true },
    priority: 0,
    perOrderLimit: null,
  },
});

let c: Commerce;
let svc: any;

const addPromotion = (over: Record<string, unknown> = {}) => {
  const created = row(over);
  const id = Math.max(0, ...c.tables[UIDS.promotion].map((r) => r.id)) + 1;
  c.tables[UIDS.promotion].push({ id, ...created });
  return id;
};
const addOrder = (id: number, reference = 1000 + id) => {
  c.tables[UIDS.order].push({ id, reference });
  return id;
};
const promo = (id: number) => c.tables[UIDS.promotion].find((r) => r.id === id);

beforeEach(() => {
  __resetEventHandlersForTests();
  c = setupCommerce();
  svc = c.services.EcommercePromotionService;
});

describe('EcommercePromotionService admin', () => {
  it('creates, reads and lists; dates go back in Lisbon local time and are stored in UTC', async () => {
    const view = await svc.create(input(), 'user:1');
    expect(view).toMatchObject({
      name: 'Verão',
      code: 'VERAO20',
      method: 'CODE',
      startsAt: '2026-07-01T10:00',
      endsAt: '2026-08-31T23:59',
      benefits: [{ type: 'ORDER_PERCENT', percent: 10 }],
      redemptions: 0,
      version: 1,
      timezone: 'Europe/Lisbon',
      labels: { products: {}, variants: {} },
    });
    const stored = promo(view.id);
    expect(stored.startsAt).toBe('2026-07-01T09:00:00.000Z');
    expect(stored.endsAt).toBe('2026-08-31T22:59:00.000Z');
    expect(stored.benefits).toEqual({ items: [{ type: 'ORDER_PERCENT', percent: 10 }] });
    expect(stored.actor).toBe('user:1');

    expect(await svc.get(view.id)).toMatchObject({ id: view.id, startsAt: '2026-07-01T10:00' });

    await svc.create(input({ name: 'Black Friday', code: 'BF50' }), 'user:1');
    const all = await svc.list({});
    expect(all.results.map((r: any) => r.code)).toEqual(['BF50', 'VERAO20']);
    expect(all.pagination).toMatchObject({ page: 1, pageSize: 50, total: 2 });
    expect(all.results[1]).toMatchObject({
      name: 'Verão',
      method: 'CODE',
      startsAt: '2026-07-01T10:00',
      endsAt: '2026-08-31T23:59',
      redemptions: 0,
      usageLimit: null,
    });
    expect((await svc.list({ search: 'black' })).results.map((r: any) => r.code)).toEqual(['BF50']);
    expect((await svc.list({ search: 'verao' })).results.map((r: any) => r.code)).toEqual(['VERAO20']);
    expect((await svc.list({ search: 'bf5' })).results.map((r: any) => r.code)).toEqual(['BF50']);
  });

  it('labels every target and gift id from the catalogue', async () => {
    const view = await svc.create(
      input({
        benefits: [
          { type: 'PRODUCT_PERCENT', target: { productIds: [1], variantIds: [] }, percent: 10, maxQuantity: null },
          {
            type: 'BUY_X_GET_Y',
            buy: { target: { productIds: [], variantIds: [10] }, quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds: [10], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      }),
      'user:1'
    );
    expect(view.labels).toEqual({
      products: { 1: 'Shirt' },
      variants: { 10: { name: 'Shirt', option: null, sku: 'SH-M' } },
    });
  });

  it('rejects invalid input and a code already used by another promotion', async () => {
    expect(await codesOf(svc.create(input({ name: '' }), 'user:1'))).toContain('required');
    await svc.create(input(), 'user:1');
    expect(await errorsOf(svc.create(input({ code: ' verao20 ' }), 'user:1'))).toEqual([
      { path: 'code', code: 'code_taken' },
    ]);
  });

  it('turns a unique-index violation (race) into code_taken', async () => {
    const q = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const real = q(uid);
      if (uid !== UIDS.promotion) return real;
      // The pre-check misses the concurrent winner; the index catches it.
      return { ...real, findOne: async (p: any) => (p?.where?.code ? null : real.findOne(p)) };
    };
    await svc.create(input(), 'user:1');
    expect(await codesOf(svc.create(input(), 'user:1'))).toEqual(['code_taken']);
  });

  it('update bumps the version, audits field names only and rejects a stale version', async () => {
    const view = await svc.create(input(), 'user:1');
    const updated = await svc.update(
      view.id,
      { ...input({ benefits: [{ type: 'ORDER_PERCENT', percent: 50 }], name: 'Verão 50' }), version: 1 },
      'user:2'
    );
    expect(updated).toMatchObject({ version: 2, benefits: [{ type: 'ORDER_PERCENT', percent: 50 }] });
    expect(promo(view.id).version).toBe(2);

    const audit = c.tables[UIDS.auditLog];
    expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
    expect(audit[1]).toMatchObject({
      area: 'promotions',
      targetId: String(view.id),
      userId: 'user:2',
      details: { fields: ['benefits', 'name'] },
    });
    expect(JSON.stringify(audit)).not.toContain('VERAO20');

    expect(await codesOf(svc.update(view.id, { ...input(), version: 1 }, 'user:2'))).toEqual([
      'PROMOTION_VERSION_CONFLICT',
    ]);
    expect(promo(view.id).version).toBe(2);
  });

  it('update keeps its own code but rejects another promotion\'s', async () => {
    const a = await svc.create(input(), 'user:1');
    await svc.create(input({ code: 'BF50' }), 'user:1');
    await expect(svc.update(a.id, { ...input(), version: 1 }, 'user:1')).resolves.toMatchObject({ version: 2 });
    expect(await codesOf(svc.update(a.id, { ...input({ code: 'BF50' }), version: 2 }, 'user:1'))).toEqual([
      'code_taken',
    ]);
  });

  it('remove refuses a promotion with redemptions, otherwise deletes it', async () => {
    const used = await svc.create(input(), 'user:1');
    const free = await svc.create(input({ code: 'BF50' }), 'user:1');
    c.tables[UIDS.promotionRedemption].push({ id: 1, promotion: used.id, uniqueKey: `${used.id}:1` });
    expect(await codesOf(svc.remove(used.id, 'user:1'))).toEqual(['PROMOTION_IN_USE']);
    await svc.remove(free.id, 'user:1');
    expect(c.tables[UIDS.promotion].map((r) => r.id)).toEqual([used.id]);
    expect(c.tables[UIDS.auditLog].at(-1)).toMatchObject({ action: 'delete', targetId: String(free.id) });
  });

  it('remove locks the promotion row, then counts, in one transaction (a reserve that wins the lock is seen)', async () => {
    const view = await svc.create(input(), 'user:1');
    const conn = c.strapi.db.getConnection;
    const ops: string[] = [];
    // A checkout commits its redemption just before remove obtains the row lock.
    c.strapi.db.getConnection = (table: string) => {
      const b = conn(table);
      const forUpdate = b.forUpdate;
      b.forUpdate = () => {
        ops.push(`lock:${table === UIDS.promotion ? 'promotion' : table}`);
        c.tables[UIDS.promotionRedemption].push({ id: 1, promotion: view.id, uniqueKey: `${view.id}:1` });
        return forUpdate();
      };
      return b;
    };
    const q = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const real = q(uid);
      if (uid !== UIDS.promotionRedemption) return real;
      return { ...real, count: async (p: any) => (ops.push('count'), real.count(p)) };
    };
    expect(await codesOf(svc.remove(view.id, 'user:1'))).toEqual(['PROMOTION_IN_USE']);
    expect(ops).toEqual(['lock:promotion', 'count']);
    expect(c.db.locks).toEqual([expect.objectContaining({ table: UIDS.promotion, where: { id: view.id }, trx: c.db.trx })]);
    expect(c.tables[UIDS.promotion].map((r) => r.id)).toEqual([view.id]);
  });

  it('remove of an unknown promotion is not found', async () => {
    await expect(svc.remove(999, 'user:1')).rejects.toThrow('Promotion not found');
  });

  it('lists redemptions with the order reference', async () => {
    const id = addPromotion({ method: 'CODE', code: 'VERAO20' });
    addOrder(7, 1007);
    c.tables[UIDS.customer].push({ id: 3 });
    await svc.reserve([applied(id, 'VERAO20', 450)], { orderId: 7, customerId: 3, email: 'Ana@Example.pt', actor: 'user:1' });
    const page = await svc.listRedemptions(id, {});
    expect(page.results).toEqual([
      expect.objectContaining({ orderId: 7, orderReference: 1007, customerId: 3, maskedEmail: 'a***@example.pt', amount: 450, status: 'RESERVED', releasedAt: null }),
    ]);
    expect(page.pagination).toMatchObject({ total: 1 });
    expect(JSON.stringify(page)).not.toContain('ana@example.pt');
    expect(page.results[0]).not.toHaveProperty('email');
  });

  it('context gives the editor the locales and the store time zone', async () => {
    expect(await svc.context()).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', name: 'en' },
        { code: 'pt', name: 'pt' },
      ],
      timezone: 'Europe/Lisbon',
    });
  });
});

describe('searchLimit', () => {
  const withConfig = (cfg: any) => {
    c.strapi.config.get = () => ({ uuid: { modules: { ecommerce: UIDS } }, ...cfg });
  };
  it('falls back to 12 for out-of-range or non-integer values', () => {
    withConfig({ ecommerce: { promotionSearchLimit: 40 } });
    expect(svc.searchLimit()).toBe(12);
    withConfig({ ecommerce: { promotionSearchLimit: 'abc' } });
    expect(svc.searchLimit()).toBe(12);
    withConfig({ ecommerce: { promotionSearchLimit: 0 } });
    expect(svc.searchLimit()).toBe(12);
  });
  it('uses a valid value', () => {
    withConfig({ ecommerce: { promotionSearchLimit: 8 } });
    expect(svc.searchLimit()).toBe(8);
  });
  it('is 12 without the ecommerce key, without throwing', () => {
    expect(svc.searchLimit()).toBe(12);
    c.strapi.config.get = () => undefined;
    expect(svc.searchLimit()).toBe(12);
  });
});

describe('loadCandidates', () => {
  it('loads running automatic promotions and entered codes in any state', async () => {
    const running = addPromotion();
    addPromotion({ startsAt: '2999-01-01T00:00:00.000Z' }); // scheduled automatic: out
    addPromotion({ active: false }); // inactive automatic: out
    addPromotion({ endsAt: '2020-06-01T00:00:00.000Z' }); // expired automatic: out
    const expiredCode = addPromotion({ method: 'CODE', code: 'OLD10', endsAt: '2020-06-01T00:00:00.000Z' });
    addPromotion({ method: 'CODE', code: 'OTHER' }); // not entered: out

    const out = await svc.loadCandidates({ codes: [' old10 '], email: null });
    expect(out.map((p: any) => p.id)).toEqual([running, expiredCode]);
    expect(out[1]).toMatchObject({
      code: 'OLD10',
      method: 'CODE',
      endsAt: '2020-06-01T00:00:00.000Z',
      benefits: [{ type: 'ORDER_PERCENT', percent: 10 }],
      customerUses: 0,
      redemptions: 0,
      usageLimit: null,
    });
  });

  it('reads customerUses for the normalized e-mail; legacy [] benefits read as empty', async () => {
    const id = addPromotion({ benefits: [] });
    c.tables[UIDS.promotionCustomerUsage].push({
      id: 1,
      promotion: id,
      emailNormalized: 'ana@example.pt',
      uses: 2,
      uniqueKey: usageKey(id, 'ana@example.pt'),
    });
    const [p] = await svc.loadCandidates({ codes: [], email: ' ANA@example.pt ' });
    expect(p.customerUses).toBe(2);
    expect(p.benefits).toEqual([]);
    const [anon] = await svc.loadCandidates({ codes: [], email: null });
    expect(anon.customerUses).toBe(0);
  });
});

describe('giftOptions', () => {
  it('subtracts the cart units of the same variant from the stock', async () => {
    const id = addPromotion({
      benefits: {
        items: [
          {
            type: 'BUY_X_GET_Y',
            buy: { target: { productIds: [1], variantIds: [] }, quantity: 2, minAmount: null },
            get: { mode: 'GIFT', variantIds: [10, 99], quantity: 1 },
            reward: { kind: 'FREE' },
          },
        ],
      },
    });
    const candidates = await svc.loadCandidates({ codes: [], email: null });
    expect(candidates.map((p: any) => p.id)).toEqual([id]);
    const gifts = await svc.giftOptions(candidates, new Map([[10, 2]]));
    expect([...gifts.keys()]).toEqual([10]);
    expect(gifts.get(10)).toEqual({ variantId: 10, productId: 1, unitPrice: 2000, available: 3, active: true });
    // No stock entry from the stock service: nothing available (no fallback to the row).
    const stock = c.services.EcommerceStockService.available;
    c.services.EcommerceStockService.available = async () => new Map();
    expect((await svc.giftOptions(candidates, new Map())).get(10).available).toBe(0);
    c.services.EcommerceStockService.available = stock;
    const none = await svc.giftOptions(candidates, new Map([[10, 9]]));
    expect(none.get(10).available).toBe(0);
  });
});

describe('reserve and releaseForOrder', () => {
  const ctx = (orderId: number, email = 'ana@example.pt', customerId = 3) => ({
    orderId,
    customerId,
    email,
    actor: 'user:1',
  });

  it('without limits increments redemptions and uses, and records a RESERVED redemption', async () => {
    const id = addPromotion({ method: 'CODE', code: 'VERAO20' });
    addOrder(1);
    await svc.reserve([applied(id, 'VERAO20', 300)], ctx(1, 'Ana@Example.pt'));
    expect(promo(id).redemptions).toBe(1);
    const usage = c.tables[UIDS.promotionCustomerUsage];
    expect(usage).toEqual([
      expect.objectContaining({ promotion: id, emailNormalized: 'ana@example.pt', uses: 1, uniqueKey: usageKey(id, 'ana@example.pt') }),
    ]);
    expect(c.tables[UIDS.promotionRedemption]).toEqual([
      expect.objectContaining({
        promotion: id,
        order: 1,
        customer: 3,
        emailNormalized: 'ana@example.pt',
        promotionCode: 'VERAO20',
        amount: 300,
        status: 'RESERVED',
        uniqueKey: `${id}:1`,
        actor: 'user:1',
      }),
    ]);
    // Joins the caller's transaction and uses guarded knex increments.
    expect(c.db.increments.every((i) => i.trx === c.db.trx)).toBe(true);
  });

  it('fails with PROMOTION_UNAVAILABLE when the global limit is reached', async () => {
    const id = addPromotion({ method: 'CODE', code: 'VERAO20', usageLimit: 1, redemptions: 1 });
    addOrder(1);
    expect(await errorsOf(svc.reserve([applied(id, 'VERAO20')], ctx(1)))).toEqual([
      { path: `promotions.${id}`, code: 'PROMOTION_UNAVAILABLE', detail: 'VERAO20' },
    ]);
    expect(promo(id).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionRedemption]).toEqual([]);
  });

  it('ignores the snapshot limits: reads the promotion row in the transaction', async () => {
    // The candidates were loaded when redemptions was 0; the table now says 1 of 1.
    const id = addPromotion({ usageLimit: 1, redemptions: 0 });
    const [snapshot] = await svc.loadCandidates({ codes: [], email: null });
    expect(snapshot.redemptions).toBe(0);
    promo(id).redemptions = 1;
    addOrder(1);
    expect(await codesOf(svc.reserve([applied(id, null)], ctx(1)))).toEqual(['PROMOTION_UNAVAILABLE']);
    expect((await errorsOf(svc.reserve([applied(id, null)], ctx(1))))[0].detail).toBe('');
    promo(id).usageLimit = 2;
    await svc.reserve([applied(id, null)], ctx(1));
    expect(promo(id).redemptions).toBe(2);
  });

  it('reads the limits with a locking read in the transaction, not a possibly stale snapshot', async () => {
    const id = addPromotion({ usageLimit: 1, redemptions: 1 });
    addOrder(1);
    // A consistent (snapshot) read could still show the old, higher limit.
    const q = c.strapi.db.query;
    c.strapi.db.query = (uid: string) => {
      const real = q(uid);
      if (uid !== UIDS.promotion) return real;
      return { ...real, findOne: async (p: any) => ({ ...(await real.findOne(p)), usageLimit: 5 }) };
    };
    expect(await codesOf(svc.reserve([applied(id, null)], ctx(1)))).toEqual(['PROMOTION_UNAVAILABLE']);
    expect(promo(id).redemptions).toBe(1);
    expect(c.db.locks).toEqual([expect.objectContaining({ table: UIDS.promotion, where: { id }, trx: c.db.trx })]);
  });

  it('refuses a per-customer limited promotion for an order without e-mail', async () => {
    const limited = addPromotion({ perCustomerLimit: 1 });
    const open = addPromotion();
    addOrder(1);
    expect(await errorsOf(svc.reserve([applied(limited, null)], ctx(1, '  ')))).toEqual([
      { path: `promotions.${limited}`, code: 'PROMOTION_UNAVAILABLE', detail: '' },
    ]);
    expect(promo(limited).redemptions).toBe(0);
    await svc.reserve([applied(open, null)], ctx(1, ''));
    expect(promo(open).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionCustomerUsage]).toEqual([]);
  });

  it('fails when the promotion was deactivated or deleted', async () => {
    const id = addPromotion({ active: false });
    addOrder(1);
    expect(await codesOf(svc.reserve([applied(id, null)], ctx(1)))).toEqual(['PROMOTION_UNAVAILABLE']);
    expect(await codesOf(svc.reserve([applied(999, 'GONE')], ctx(1)))).toEqual(['PROMOTION_UNAVAILABLE']);
  });

  it('enforces the per-customer limit by e-mail across customers', async () => {
    const id = addPromotion({ method: 'CODE', code: 'ONCE', perCustomerLimit: 1 });
    addOrder(1);
    addOrder(2);
    await svc.reserve([applied(id, 'ONCE')], ctx(1, 'ana@example.pt', 3));
    expect(await errorsOf(svc.reserve([applied(id, 'ONCE')], ctx(2, 'ANA@example.pt', 4)))).toEqual([
      { path: `promotions.${id}`, code: 'PROMOTION_UNAVAILABLE', detail: 'ONCE' },
    ]);
    // Rolled back together: the global increment of the failed attempt is undone.
    expect(promo(id).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionCustomerUsage][0].uses).toBe(1);
    // Another e-mail is still fine.
    await svc.reserve([applied(id, 'ONCE')], ctx(2, 'rui@example.pt', 4));
    expect(promo(id).redemptions).toBe(2);
  });

  it('a failure on one promotion rolls back the others (all in one transaction)', async () => {
    const ok = addPromotion();
    const full = addPromotion({ usageLimit: 1, redemptions: 1 });
    addOrder(1);
    expect(await codesOf(svc.reserve([applied(full, null), applied(ok, null)], ctx(1)))).toEqual([
      'PROMOTION_UNAVAILABLE',
    ]);
    expect(promo(ok).redemptions).toBe(0);
    expect(c.tables[UIDS.promotionRedemption]).toEqual([]);
    expect(c.tables[UIDS.promotionCustomerUsage]).toEqual([]);
  });

  it('releaseForOrder gives the capacity back once (Review Focus 2)', async () => {
    const a = addPromotion({ method: 'CODE', code: 'VERAO20', usageLimit: 1, perCustomerLimit: 1 });
    const b = addPromotion();
    addOrder(1);
    await svc.reserve([applied(b, null), applied(a, 'VERAO20')], ctx(1));
    expect(promo(a).redemptions).toBe(1);

    const released = await svc.releaseForOrder(1, 'user:1', {});
    expect(released).toEqual([
      { promotionId: a, promotionCode: 'VERAO20' },
      { promotionId: b, promotionCode: null },
    ]);
    expect(promo(a).redemptions).toBe(0);
    expect(promo(b).redemptions).toBe(0);
    expect(c.tables[UIDS.promotionCustomerUsage].map((u) => u.uses)).toEqual([0, 0]);
    expect(c.tables[UIDS.promotionRedemption].every((r) => r.status === 'RELEASED' && r.releasedAt)).toBe(true);

    expect(await svc.releaseForOrder(1, 'user:1', {})).toEqual([]);
    expect(promo(a).redemptions).toBe(0);
    expect(c.tables[UIDS.promotionCustomerUsage].map((u) => u.uses)).toEqual([0, 0]);

    // The capacity is usable again.
    addOrder(2);
    await svc.reserve([applied(a, 'VERAO20')], ctx(2));
    expect(promo(a).redemptions).toBe(1);
  });

  it('release never decrements below zero and leaves other orders alone', async () => {
    const id = addPromotion();
    addOrder(1);
    addOrder(2);
    await svc.reserve([applied(id, null)], ctx(1));
    await svc.reserve([applied(id, null)], ctx(2, 'rui@example.pt'));
    promo(id).redemptions = 0; // e.g. an admin reset
    expect(await svc.releaseForOrder(1, 'user:1', {})).toEqual([{ promotionId: id, promotionCode: null }]);
    expect(promo(id).redemptions).toBe(0);
    expect(c.tables[UIDS.promotionRedemption].map((r) => r.status)).toEqual(['RELEASED', 'RESERVED']);
  });

  it('reserve is idempotent per promotion and order', async () => {
    const id = addPromotion();
    addOrder(1);
    await svc.reserve([applied(id, null)], ctx(1));
    await svc.reserve([applied(id, null)], ctx(1));
    expect(promo(id).redemptions).toBe(1);
    expect(c.tables[UIDS.promotionRedemption]).toHaveLength(1);
  });
});

describe('evaluate', () => {
  it('passes the configured search limit and logs condition errors without customer data', async () => {
    const id = addPromotion({
      conditions: group([{ type: 'EMAIL', operator: 'eq', value: 'x@example.pt' }]),
    });
    const candidates = await svc.loadCandidates({ codes: [], email: null });
    // Make the evaluator throw by handing it a malformed condition.
    candidates[0].conditions = group([{ type: 'SUBTOTAL', operator: 'gte', get value() { throw new Error('boom'); } }]);
    const result = svc.evaluate({
      lines: [{ variantId: 10, productId: 1, unitPrice: 2000, quantity: 1 }],
      email: 'ana@example.pt',
      shipping: null,
      codes: [],
      candidates,
      gifts: new Map(),
      now: new Date(),
    });
    expect(result.applied).toEqual([]);
    expect(c.log.warn).toHaveBeenCalled();
    const msg = String(c.log.warn.mock.calls[0][0]);
    expect(msg).toContain(String(id));
    expect(msg).toContain('SUBTOTAL');
    expect(msg).not.toContain('ana@example.pt');
  });
});

describe('unmet', () => {
  const ctxOf = (subtotal: number) => ({
    lines: [{ variantId: 10, productId: 1, unitPrice: subtotal, quantity: 1 }],
    email: 'ana@example.pt',
  });
  const withConditions = (promotionId: number, conditions: any): AppliedPromotion => ({
    ...applied(promotionId, null),
    name: `P${promotionId}`,
    snapshot: { ...applied(promotionId, null).snapshot, conditions },
  });

  it('lists the stored promotions whose conditions no longer hold', () => {
    const res = svc.unmet(
      [
        withConditions(1, group([{ type: 'SUBTOTAL', operator: 'gte', value: 10000 }])),
        withConditions(2, group([{ type: 'SUBTOTAL', operator: 'gte', value: 5000 }])),
      ],
      ctxOf(8000)
    );
    expect(res).toEqual([{ promotionId: 1, name: 'P1' }]);
  });

  it('a condition that throws is logged (id and type, no customer data) and fails closed', () => {
    const throwing = {
      type: 'SUBTOTAL',
      operator: 'gte',
      get value() {
        throw new Error('boom');
      },
    };
    // Inside an OR with a true sibling the group alone would still hold: an error still reports it.
    const res = svc.unmet(
      [withConditions(3, { type: 'GROUP', operator: 'OR', children: [throwing, { type: 'TOTAL_QUANTITY', operator: 'gte', value: 1 }] })],
      ctxOf(8000)
    );
    expect(res).toEqual([{ promotionId: 3, name: 'P3' }]);
    expect(c.log.warn).toHaveBeenCalled();
    const msg = String(c.log.warn.mock.calls[0][0]);
    expect(msg).toContain('3');
    expect(msg).toContain('SUBTOTAL');
    expect(msg).not.toContain('ana@example.pt');
  });

  it('a malformed snapshot is reported as unmet and logged', () => {
    const broken = { ...applied(4, null), name: 'P4', snapshot: null } as unknown as AppliedPromotion;
    expect(svc.unmet([broken], ctxOf(8000))).toEqual([{ promotionId: 4, name: 'P4' }]);
    expect(c.log.warn).toHaveBeenCalled();
  });
});

describe('requireVerifiedEmail', () => {
  it('is stored, returned by get and passed to the engine; legacy rows read as false', async () => {
    const created: any = await svc.create(input({ requireVerifiedEmail: true }));
    expect((await svc.get(created.id)).requireVerifiedEmail).toBe(true);
    const [cand] = await svc.loadCandidates({ codes: ['VERAO20'], email: null });
    expect(cand.requireVerifiedEmail).toBe(true);
    const legacy = addPromotion({ method: 'CODE', code: 'OLD' });
    const out = await svc.loadCandidates({ codes: ['OLD'], email: null });
    expect(out.find((x) => x.id === legacy)?.requireVerifiedEmail).toBe(false);
  });

  it('skips the per-customer usage lookup for an unverified e-mail', async () => {
    const id = addPromotion({ method: 'CODE', code: 'ONCE2', perCustomerLimit: 1 });
    c.tables[UIDS.promotionCustomerUsage].push({
      id: 9, promotion: id, emailNormalized: 'ana@example.pt', uses: 1, uniqueKey: usageKey(id, 'ana@example.pt'),
    });
    const [p] = await svc.loadCandidates({ codes: ['ONCE2'], email: 'ana@example.pt', emailVerified: false });
    expect(p.customerUses).toBe(0);
    const [q] = await svc.loadCandidates({ codes: ['ONCE2'], email: 'ana@example.pt', emailVerified: true });
    expect(q.customerUses).toBe(1);
  });
});
