import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createFakeDb } from './helpers/fakeDb';
import EcommerceCustomerSessionService, {
  deriveCustomerJwtSecret,
} from '../../../server/src/services/modules/ecommerce/customerSessions';
import { EcommerceAccountsUnavailableError } from '../../../server/src/services/modules/ecommerce/errors';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const CUSTOMER = `${P}customer`;
const SESSION = `${P}customer-session`;
const KEY = 'test-encryption-key';
const NOW = new Date('2026-11-26T10:00:00.000Z');
const DAY = 86_400_000;

const setup = (key: string | null = KEY) => {
  const db = createFakeDb([CUSTOMER, SESSION], {
    [SESSION]: { customer: [CUSTOMER, 'customer', 'manyToOne'] },
  });
  const strapi = {
    db,
    log: { warn: vi.fn(), error: vi.fn() },
    config: {
      get: () => ({
        uuid: { modules: { ecommerce: { customer: CUSTOMER, customerSession: SESSION } } },
        ecommerce: { encryptionKey: key },
      }),
    },
  };
  const svc = EcommerceCustomerSessionService({ strapi } as never);
  const addCustomer = (extra: Record<string, unknown> = {}) =>
    db.query(CUSTOMER).create({
      data: {
        email: 'Ana@Example.pt',
        emailNormalized: 'ana@example.pt',
        firstName: 'Ana',
        lastName: 'Silva',
        phone: null,
        locale: 'pt',
        accountType: 'REGISTERED',
        emailVerified: true,
        blocked: false,
        passwordChangedAt: null,
        pendingEmail: null,
        ...extra,
      },
    });
  return { db, svc, addCustomer, rows: () => db.tables[SESSION] };
};

const client = { ip: '203.0.113.77', userAgent: 'UA/1' };
const sign = (claims: Record<string, unknown>, opts: { aud?: string; exp?: number; iat?: number; alg?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'HS256' })
    .setIssuer('ltb-ecommerce')
    .setAudience(opts.aud ?? 'ltb-storefront')
    .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
    .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(deriveCustomerJwtSecret(KEY));

describe('EcommerceCustomerSessionService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('derives a 32-byte HKDF key', () => {
    expect(deriveCustomerJwtSecret(KEY)).toHaveLength(32);
    expect(deriveCustomerJwtSecret(KEY).equals(deriveCustomerJwtSecret('other'))).toBe(false);
  });

  it('opens a session and resolves its token', async () => {
    const { svc, addCustomer, rows } = setup();
    const c = await addCustomer();
    const o = await svc.open(c.id, client);
    expect(o.expiresAt).toBe(new Date(NOW.getTime() + 90 * DAY).toISOString());
    expect(rows()[0]).toMatchObject({ userAgent: 'UA/1', ipPrefix: '203.0.113.0/24' });
    expect(JSON.stringify(rows())).not.toContain(o.token);
    const r = await svc.resolve(o.token);
    expect(r?.sessionId).toBe(o.sessionId);
    expect(r?.customer).toMatchObject({
      id: c.id,
      email: 'Ana@Example.pt',
      emailNormalized: 'ana@example.pt',
      accountType: 'REGISTERED',
    });
  });

  it('throws unavailable without a key source', async () => {
    const { svc, addCustomer } = setup(null);
    const c = await addCustomer();
    await expect(svc.open(c.id, client)).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
    await expect(svc.resolve('x.y.z')).rejects.toBeInstanceOf(EcommerceAccountsUnavailableError);
  });

  describe('resolve returns null for', () => {
    it('garbage and a tampered signature', async () => {
      const { svc, addCustomer } = setup();
      const o = await svc.open((await addCustomer()).id, client);
      expect(await svc.resolve('garbage')).toBeNull();
      expect(await svc.resolve(o.token.slice(0, -3) + 'AAA')).toBeNull();
      expect(await svc.resolve(undefined as never)).toBeNull();
    });

    it('alg none, another audience and an expired exp', async () => {
      const { svc, addCustomer, rows } = setup();
      const o = await svc.open((await addCustomer()).id, client);
      const claims = { sub: '1', sid: String(o.sessionId) };
      const none = [
        Buffer.from('{"alg":"none"}').toString('base64url'),
        Buffer.from(JSON.stringify({ ...claims, iss: 'ltb-ecommerce', aud: 'ltb-storefront', exp: 9999999999 })).toString('base64url'),
        '',
      ].join('.');
      expect(await svc.resolve(none)).toBeNull();
      expect(await svc.resolve(await sign(claims, { aud: 'other' }))).toBeNull();
      const now = Math.floor(Date.now() / 1000);
      expect(await svc.resolve(await sign(claims, { exp: now - 10, iat: now - 100 }))).toBeNull();
      expect(await svc.resolve(await sign(claims))).not.toBeNull();
      expect(rows()).toHaveLength(1);
    });

    it('a revoked row', async () => {
      const { svc, addCustomer } = setup();
      const c = await addCustomer();
      const o = await svc.open(c.id, client);
      expect(await svc.revoke(c.id, o.sessionId, 'LOGOUT')).toBe(true);
      expect(await svc.resolve(o.token)).toBeNull();
    });

    it('a row past its expiresAt', async () => {
      const { svc, addCustomer, rows } = setup();
      const o = await svc.open((await addCustomer()).id, client);
      rows()[0].expiresAt = new Date(NOW.getTime() - 1000);
      expect(await svc.resolve(o.token)).toBeNull();
    });

    it('idle for more than 30 days', async () => {
      const { svc, addCustomer } = setup();
      const o = await svc.open((await addCustomer()).id, client);
      vi.setSystemTime(NOW.getTime() + 30 * DAY - 1000);
      expect(await svc.resolve(o.token)).not.toBeNull();
      vi.setSystemTime(NOW.getTime() + 30 * DAY - 1000 + 30 * DAY + 1000);
      expect(await svc.resolve(o.token)).toBeNull();
    });

    it.each([
      ['blocked', { blocked: true }],
      ['guest', { accountType: 'GUEST' }],
      ['unverified', { emailVerified: false }],
    ])('a %s customer', async (_n, extra) => {
      const { svc, addCustomer, db } = setup();
      const c = await addCustomer();
      const o = await svc.open(c.id, client);
      expect(await svc.resolve(o.token)).not.toBeNull();
      await db.query(CUSTOMER).update({ where: { id: c.id }, data: extra });
      expect(await svc.resolve(o.token)).toBeNull();
    });

    it('an iat earlier than passwordChangedAt', async () => {
      const { svc, addCustomer, db } = setup();
      const c = await addCustomer();
      const o = await svc.open(c.id, client);
      await db.query(CUSTOMER).update({
        where: { id: c.id },
        data: { passwordChangedAt: new Date(NOW.getTime() + 5000) },
      });
      expect(await svc.resolve(o.token)).toBeNull();
    });
  });

  it('a token whose sid is another customer session resolves to null', async () => {
    const { svc, addCustomer } = setup();
    const a = await addCustomer();
    const b = await addCustomer({ emailNormalized: 'b@example.pt' });
    const ob = await svc.open(b.id, client);
    const forged = await sign({ sub: String(a.id), sid: String(ob.sessionId) });
    expect(await svc.resolve(forged)).toBeNull();
  });

  it('a malformed passwordChangedAt fails closed', async () => {
    const { svc, addCustomer, db } = setup();
    const c = await addCustomer();
    const o = await svc.open(c.id, client);
    await db.query(CUSTOMER).update({ where: { id: c.id }, data: { passwordChangedAt: 'not a date' } });
    expect(await svc.resolve(o.token)).toBeNull();
  });

  it('reissue gives the current session a token that survives its own password change', async () => {
    const { svc, addCustomer, db } = setup();
    const c = await addCustomer();
    const o = await svc.open(c.id, client);
    vi.setSystemTime(NOW.getTime() + 10_000);
    await db.query(CUSTOMER).update({ where: { id: c.id }, data: { passwordChangedAt: new Date() } });
    expect(await svc.resolve(o.token)).toBeNull();
    const fresh = await svc.reissue(c.id, o.sessionId);
    expect(fresh).not.toBeNull();
    expect(fresh!.expiresAt).toBe(o.expiresAt);
    expect((await svc.resolve(fresh!.token))?.sessionId).toBe(o.sessionId);
    const other = await addCustomer({ emailNormalized: 'b@example.pt' });
    expect(await svc.reissue(other.id, o.sessionId)).toBeNull();
    await svc.revoke(c.id, o.sessionId, 'LOGOUT');
    expect(await svc.reissue(c.id, o.sessionId)).toBeNull();
  });

  it('refreshes lastUsedAt only when older than 60s', async () => {
    const { svc, addCustomer, rows } = setup();
    const o = await svc.open((await addCustomer()).id, client);
    vi.setSystemTime(NOW.getTime() + 30_000);
    await svc.resolve(o.token);
    expect(new Date(rows()[0].lastUsedAt).getTime()).toBe(NOW.getTime());
    vi.setSystemTime(NOW.getTime() + 61_000);
    await svc.resolve(o.token);
    expect(new Date(rows()[0].lastUsedAt).getTime()).toBe(NOW.getTime() + 61_000);
  });

  it('revoke refuses another customer session and leaves it intact', async () => {
    const { svc, addCustomer, rows } = setup();
    const a = await addCustomer();
    const b = await addCustomer({ emailNormalized: 'b@example.pt' });
    const o = await svc.open(a.id, client);
    expect(await svc.revoke(b.id, o.sessionId, 'REVOKED_BY_CUSTOMER')).toBe(false);
    expect(rows()[0].revokedAt ?? null).toBeNull();
    expect(await svc.resolve(o.token)).not.toBeNull();
  });

  it('revokeAll keeps the excepted session and counts the others', async () => {
    const { svc, addCustomer } = setup();
    const a = await addCustomer();
    const s1 = await svc.open(a.id, client);
    const s2 = await svc.open(a.id, client);
    const s3 = await svc.open(a.id, client);
    expect(await svc.revokeAll(a.id, 'PASSWORD_CHANGED', s2.sessionId)).toBe(2);
    expect(await svc.resolve(s1.token)).toBeNull();
    expect(await svc.resolve(s3.token)).toBeNull();
    expect(await svc.resolve(s2.token)).not.toBeNull();
    expect(await svc.revokeAll(a.id, 'LOGOUT')).toBe(1);
  });

  it('list marks current and excludes revoked and expired rows', async () => {
    const { svc, addCustomer, rows } = setup();
    const a = await addCustomer();
    const s1 = await svc.open(a.id, client);
    const s2 = await svc.open(a.id, { ip: null, userAgent: null });
    const s3 = await svc.open(a.id, client);
    const s4 = await svc.open(a.id, client);
    await svc.revoke(a.id, s3.sessionId, 'LOGOUT');
    rows().find((r) => r.id === s4.sessionId)!.expiresAt = new Date(NOW.getTime() - 1);
    const l = await svc.list(a.id, s2.sessionId);
    expect(l.map((v) => [v.id, v.current])).toEqual([
      [s1.sessionId, false],
      [s2.sessionId, true],
    ]);
    expect(l[0]).toMatchObject({ userAgent: 'UA/1', ipPrefix: '203.0.113.0/24' });
    expect(Object.keys(l[0]).sort()).toEqual(
      ['createdAt', 'current', 'id', 'ipPrefix', 'lastUsedAt', 'userAgent'].sort()
    );
  });

  it('purgeExpired deletes at most 100 expired rows per call', async () => {
    const { svc, addCustomer, rows, db } = setup();
    const a = await addCustomer();
    const live = await svc.open(a.id, client);
    for (let i = 0; i < 101; i++)
      await db.query(SESSION).create({ data: { customer: a.id, expiresAt: new Date(NOW.getTime() - 2 * DAY) } });
    expect(await svc.purgeExpired()).toBe(100);
    expect(await svc.purgeExpired()).toBe(1);
    expect(rows().map((r) => r.id)).toEqual([live.sessionId]);
  });
});
