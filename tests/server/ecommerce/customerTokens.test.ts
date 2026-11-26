import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb';
import EcommerceCustomerTokenService, {
  TOKEN_TTL_MS,
} from '../../../server/src/services/modules/ecommerce/customerTokens';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const CUSTOMER = `${P}customer`;
const TOKEN = `${P}customer-token`;
const NOW = new Date('2026-11-26T10:00:00.000Z');
const HOUR = 3_600_000;

const setup = () => {
  const db = createFakeDb([CUSTOMER, TOKEN], {
    [TOKEN]: { customer: [CUSTOMER, 'customer', 'manyToOne'] },
  });
  const strapi = {
    db,
    config: { get: () => ({ uuid: { modules: { ecommerce: { customer: CUSTOMER, customerToken: TOKEN } } } }) },
  };
  // Customers 7 and 8 exist.
  db.tables[CUSTOMER].push({ id: 7 }, { id: 8 });
  return { db, svc: EcommerceCustomerTokenService({ strapi } as never), rows: () => db.tables[TOKEN] };
};

describe('EcommerceCustomerTokenService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('uses the agreed TTLs', () => {
    expect(TOKEN_TTL_MS).toEqual({
      VERIFY_EMAIL: 24 * HOUR,
      RESET_PASSWORD: HOUR,
      CHANGE_EMAIL: 24 * HOUR,
    });
  });

  it('issues then consumes once', async () => {
    const { svc } = setup();
    const t = await svc.issue(7, 'VERIFY_EMAIL', 'a@x.pt');
    expect(t.expiresAt).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString());
    expect(t.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await svc.consume(t.raw, 'VERIFY_EMAIL')).toEqual({ customerId: 7, email: 'a@x.pt' });
    expect(await svc.consume(t.raw, 'VERIFY_EMAIL')).toBeNull();
  });

  it('issuing again invalidates the earlier token of that purpose only', async () => {
    const { svc } = setup();
    const a = await svc.issue(7, 'RESET_PASSWORD', 'a@x.pt');
    const other = await svc.issue(7, 'VERIFY_EMAIL', 'a@x.pt');
    const otherCustomer = await svc.issue(8, 'RESET_PASSWORD', 'b@x.pt');
    const b = await svc.issue(7, 'RESET_PASSWORD', 'a@x.pt');
    expect(await svc.consume(a.raw, 'RESET_PASSWORD')).toBeNull();
    expect(await svc.consume(b.raw, 'RESET_PASSWORD')).toMatchObject({ customerId: 7 });
    expect(await svc.consume(other.raw, 'VERIFY_EMAIL')).not.toBeNull();
    expect(await svc.consume(otherCustomer.raw, 'RESET_PASSWORD')).not.toBeNull();
  });

  it('rejects expired, wrong-purpose, unknown and malformed tokens', async () => {
    const { svc } = setup();
    const t = await svc.issue(7, 'RESET_PASSWORD', 'a@x.pt');
    expect(await svc.consume(t.raw, 'VERIFY_EMAIL')).toBeNull();
    expect(await svc.consume('nope', 'RESET_PASSWORD')).toBeNull();
    expect(await svc.consume(undefined, 'RESET_PASSWORD')).toBeNull();
    expect(await svc.consume(42, 'RESET_PASSWORD')).toBeNull();
    expect(await svc.consume('', 'RESET_PASSWORD')).toBeNull();
    vi.setSystemTime(new Date(NOW.getTime() + HOUR + 1));
    expect(await svc.consume(t.raw, 'RESET_PASSWORD')).toBeNull();
  });

  it('a wrong-purpose attempt does not burn the token', async () => {
    const { svc } = setup();
    const t = await svc.issue(7, 'CHANGE_EMAIL', 'n@x.pt');
    await svc.consume(t.raw, 'VERIFY_EMAIL');
    expect(await svc.consume(t.raw, 'CHANGE_EMAIL')).toEqual({ customerId: 7, email: 'n@x.pt' });
  });

  it('two parallel consumes: exactly one wins', async () => {
    const { svc } = setup();
    const t = await svc.issue(7, 'VERIFY_EMAIL', 'a@x.pt');
    const r = await Promise.all([svc.consume(t.raw, 'VERIFY_EMAIL'), svc.consume(t.raw, 'VERIFY_EMAIL')]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('stores only the sha256 hex of the raw token', async () => {
    const { svc, rows } = setup();
    const t = await svc.issue(7, 'VERIFY_EMAIL', 'a@x.pt');
    expect(JSON.stringify(rows())).not.toContain(t.raw);
    expect(rows()[0].tokenHash).toBe(createHash('sha256').update(t.raw).digest('hex'));
  });
});
