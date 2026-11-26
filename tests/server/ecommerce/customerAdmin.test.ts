import { describe, it, expect, vi } from 'vitest';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import createOrders from '../../../server/src/controllers/modules/ecommerce/orders';
import createCustomers from '../../../server/src/controllers/modules/ecommerce/customers';
import { EcommerceAccountError } from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = { customer: `${P}customer`, order: `${P}order`, auditLog: `${P}audit-log` };
const ADMIN = 'admin::user';

function setup() {
  const db = createFakeDb([...Object.values(UIDS), ADMIN], {
    [UIDS.customer]: { orders: [UIDS.order, 'customer'] },
  });
  db.tables[ADMIN].push({ id: 3, firstname: 'Rita', lastname: 'Gomes', email: 'rita@admin.pt' });
  const revokeAll = vi.fn(async () => 1);
  const log = vi.fn(async () => {});
  const hash = vi.fn(async () => ({ hash: 'HASHED', pepperVersion: 2 }));
  const available = vi.fn(() => true);
  const issue = vi.fn(async () => ({ raw: 'RAW' }));
  const sendAccountVerification = vi.fn(async () => {});
  const sendPasswordChanged = vi.fn(async () => {});
  const rekeyCredits = vi.fn(async () => {});
  const rekeyPromos = vi.fn(async () => {});
  const services: Record<string, any> = {
    EcommerceAuditService: { log },
    EcommerceCustomerSessionService: { revokeAll },
    EcommercePasswordService: { hash, available },
    EcommerceCustomerTokenService: { issue },
    EcommerceAccountMailer: { sendAccountVerification, sendPasswordChanged },
    EcommerceStoreCreditService: { rekeyCustomerEmail: rekeyCredits },
    EcommercePromotionService: { rekeyCustomerEmail: rekeyPromos },
  };
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    log: { warn: vi.fn() },
    plugin: (id: string) =>
      id === 'i18n'
        ? { service: () => ({ getDefaultLocale: async () => 'en', find: async () => [{ code: 'en' }] }) }
        : { service: (n: string) => services[n] },
  };
  const service: any = EcommerceCustomerService({ strapi });
  const add = (row: any) => {
    db.tables[UIDS.customer].push({ blocked: false, accountType: 'GUEST', ...row });
  };
  return { service, add, revokeAll, log, hash, issue, sendAccountVerification, sendPasswordChanged, rekeyCredits, rekeyPromos, strapi, ...db };
}

const ana = (extra = {}) => ({
  id: 1,
  firstName: 'Ana',
  lastName: 'Silva',
  email: 'ana@x.pt',
  emailNormalized: 'ana@x.pt',
  accountType: 'REGISTERED',
  emailVerified: true,
  passwordHash: 'OLD',
  ...extra,
});
const input = (email: string) => ({ firstName: 'Ana', lastName: 'Silva', email });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('customer admin: block / unblock', () => {
  it('block revokes every session and get shows blocked with the admin name', async () => {
    const { service, add, revokeAll, log } = setup();
    add(ana());
    const view = await service.block(1, { note: 'chargeback abuse' }, { userId: 3 });
    expect(revokeAll).toHaveBeenCalledWith(1, 'BLOCKED');
    expect(view).toMatchObject({ blocked: true, blockedNote: 'chargeback abuse', blockedBy: 'Rita Gomes' });
    expect(view.blockedAt).toBeTruthy();
    expect(await service.get(1)).toMatchObject({ blocked: true, blockedBy: 'Rita Gomes', accountType: 'REGISTERED' });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.block', userId: 'user:3' }));
  });

  it('refuses a note over 1000 characters', async () => {
    const { service, add } = setup();
    add(ana());
    await expect(service.block(1, { note: 'x'.repeat(1001) }, { userId: 3 })).rejects.toMatchObject({
      errors: [{ path: 'note', code: 'too_long' }],
    });
  });

  it('unblock clears the flags and the note', async () => {
    const { service, add } = setup();
    add(ana());
    await service.block(1, { note: 'n' }, { userId: 3 });
    const view = await service.unblock(1, { userId: 3 });
    expect(view).toMatchObject({ blocked: false, blockedAt: null, blockedNote: null, blockedBy: null });
  });

  it('list filters by accountType and blocked, and never returns the hash', async () => {
    const { service, add } = setup();
    add(ana());
    add({ id: 2, firstName: 'B', lastName: 'B', email: 'b@x.pt', emailNormalized: 'b@x.pt', accountType: 'GUEST' });
    await service.block(1, {}, { userId: 3 });
    const blocked = await service.list({ blocked: true });
    expect(blocked.results.map((r: any) => r.id)).toEqual([1]);
    expect(blocked.results[0]).toMatchObject({ blocked: true, accountType: 'REGISTERED' });
    expect(JSON.stringify(blocked)).not.toContain('OLD');
    expect((await service.list({ blocked: false })).results.map((r: any) => r.id)).toEqual([2]);
    expect((await service.list({ accountType: 'GUEST' })).results.map((r: any) => r.id)).toEqual([2]);
  });
});

describe('customer admin: setPassword', () => {
  it('refuses a guest and a blocked customer', async () => {
    const { service, add } = setup();
    add({ id: 1, firstName: 'G', lastName: 'G', email: 'g@x.pt', emailNormalized: 'g@x.pt' });
    add(ana({ id: 2, email: 'r@x.pt', emailNormalized: 'r@x.pt', blocked: true }));
    const expected = { errors: [{ path: 'password', code: 'not_allowed' }] };
    await expect(service.setPassword(1, { password: 'a-long-password' }, { userId: 3 })).rejects.toMatchObject(expected);
    await expect(service.setPassword(2, { password: 'a-long-password' }, { userId: 3 })).rejects.toMatchObject(expected);
  });

  it('applies the password policy', async () => {
    const { service, add } = setup();
    add(ana());
    const code = (password: unknown) =>
      service.setPassword(1, { password }, { userId: 3 }).catch((e: any) => e.errors[0]);
    expect(await code('short')).toEqual({ path: 'password', code: 'TOO_SHORT' });
    expect(await code('x'.repeat(129))).toEqual({ path: 'password', code: 'TOO_LONG' });
    expect(await code('x'.repeat(2000))).toEqual({ path: 'password', code: 'TOO_LONG' });
    expect(await code('ANA@X.PT')).toEqual({ path: 'password', code: 'TOO_SHORT' });
  });

  it('rejects a password equal to the e-mail', async () => {
    const { service, add } = setup();
    add(ana({ email: 'anaanaana@x.pt', emailNormalized: 'anaanaana@x.pt' }));
    await expect(service.setPassword(1, { password: 'AnaAnaAna@x.pt' }, { userId: 3 })).rejects.toMatchObject({
      errors: [{ path: 'password', code: 'EQUALS_EMAIL' }],
    });
  });

  it('stores the hash, revokes sessions, mails and never exposes the hash', async () => {
    const { service, add, tables, hash, revokeAll, sendPasswordChanged, log, uids } = setup() as any;
    add(ana());
    await service.setPassword(1, { password: 'a-long-password' }, { userId: 3 });
    expect(hash).toHaveBeenCalledWith('a-long-password');
    expect(tables[UIDS.customer][0]).toMatchObject({ passwordHash: 'HASHED', passwordPepperVersion: 2 });
    expect(tables[UIDS.customer][0].passwordChangedAt).toBeTruthy();
    expect(revokeAll).toHaveBeenCalledWith(1, 'ADMIN_PASSWORD');
    await flush();
    expect(sendPasswordChanged).toHaveBeenCalledWith('ana@x.pt', null, { firstName: 'Ana' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('a-long-password');
    expect(JSON.stringify(await service.get(1))).not.toMatch(/HASHED|passwordHash/);
    void uids;
  });
});

describe('customer admin: e-mail edit rules', () => {
  it('refuses another customer\'s pending e-mail', async () => {
    const { service, add } = setup();
    add(ana());
    add(ana({ id: 2, email: 'b@x.pt', emailNormalized: 'b@x.pt', pendingEmail: 'new@x.pt', pendingEmailNormalized: 'new@x.pt' }));
    await expect(service.update(1, input(' NEW@x.pt '), 'user:3')).rejects.toMatchObject({
      errors: [{ path: 'email', code: 'duplicate_email' }],
    });
    await expect(service.update(1, input('b@x.pt'), 'user:3')).rejects.toMatchObject({
      errors: [{ path: 'email', code: 'duplicate_email' }],
    });
  });

  it('a registered customer\'s e-mail change unverifies, revokes, re-keys and sends the verification', async () => {
    const { service, add, tables, revokeAll, rekeyCredits, rekeyPromos, issue, sendAccountVerification, inTransaction } = setup() as any;
    add(ana({ locale: 'en', pendingEmail: 'p@x.pt', pendingEmailNormalized: 'p@x.pt' }));
    await service.update(1, input('New@X.pt'), 'user:3');
    expect(tables[UIDS.customer][0]).toMatchObject({
      email: 'New@X.pt',
      emailNormalized: 'new@x.pt',
      emailVerified: false,
      pendingEmail: null,
      pendingEmailNormalized: null,
    });
    expect(rekeyCredits).toHaveBeenCalledWith('ana@x.pt', 'new@x.pt');
    expect(rekeyPromos).toHaveBeenCalledWith('ana@x.pt', 'new@x.pt');
    expect(revokeAll).toHaveBeenCalledWith(1, 'EMAIL_CHANGED');
    await flush();
    expect(issue).toHaveBeenCalledWith(1, 'VERIFY_EMAIL', 'New@X.pt');
    expect(sendAccountVerification).toHaveBeenCalledWith('New@X.pt', 'en', { firstName: 'Ana', raw: 'RAW' });
    void inTransaction;
  });

  it('a guest e-mail change touches no account state', async () => {
    const { service, add, revokeAll, issue } = setup();
    add({ id: 1, firstName: 'Ana', lastName: 'Silva', email: 'g@x.pt', emailNormalized: 'g@x.pt' });
    await service.update(1, input('h@x.pt'), 'user:3');
    await flush();
    expect(revokeAll).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });
});

describe('admin controllers', () => {
  const ctxOf = (extra: any = {}): any => ({
    params: { id: '1' },
    query: {},
    request: { body: {} },
    state: { user: { id: 7 } },
    badRequest: vi.fn(),
    notFound: vi.fn(),
    ...extra,
  });
  const strapiWith = (services: Record<string, any>) =>
    ({ plugin: () => ({ service: (n: string) => services[n] }) }) as any;

  it('maps CUSTOMER_BLOCKED on admin order creation to customer.email / customer_blocked', async () => {
    const create = vi.fn().mockRejectedValue(new EcommerceAccountError('CUSTOMER_BLOCKED', 403));
    const c: any = createOrders({ strapi: strapiWith({ EcommerceOrderService: { create } }) });
    const ctx = ctxOf({ request: { body: { idempotencyKey: 'k' } } });
    await c.create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith(expect.any(String), {
      code: 'customer_blocked',
      errors: [{ path: 'customer.email', code: 'customer_blocked' }],
    });
  });

  it('block, unblock and setPassword pass the admin actor', async () => {
    const block = vi.fn().mockResolvedValue({ id: 1 });
    const unblock = vi.fn().mockResolvedValue({ id: 1 });
    const setPassword = vi.fn().mockResolvedValue(undefined);
    const c: any = createCustomers({ strapi: strapiWith({ EcommerceCustomerService: { block, unblock, setPassword } }) });
    await c.block(ctxOf({ request: { body: { note: 'n' } } }));
    expect(block).toHaveBeenCalledWith(1, { note: 'n' }, { userId: 7 });
    await c.unblock(ctxOf());
    expect(unblock).toHaveBeenCalledWith(1, { userId: 7 });
    const ctx = ctxOf({ request: { body: { password: 'pw' } } });
    await c.setPassword(ctx);
    expect(setPassword).toHaveBeenCalledWith(1, { password: 'pw' }, { userId: 7 });
    expect(ctx.body).toEqual({ ok: true });
  });
});
