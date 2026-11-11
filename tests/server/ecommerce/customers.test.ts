import { describe, it, expect, vi } from 'vitest';
import EcommerceCustomerService from '../../../server/src/services/modules/ecommerce/customers';
import {
  EcommerceNotFoundError,
  EcommerceValidationError,
} from '../../../server/src/services/modules/ecommerce/errors';
import { createFakeDb } from './helpers/fakeDb';

const P = 'plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-';
const UIDS = { customer: `${P}customer`, order: `${P}order`, auditLog: `${P}audit-log` };

function setup() {
  const db = createFakeDb(Object.values(UIDS), {
    [UIDS.customer]: { orders: [UIDS.order, 'customer'] },
  });
  const log = vi.fn(async () => {});
  const strapi: any = {
    db: { query: db.query, transaction: db.transaction },
    config: { get: () => ({ uuid: { modules: { ecommerce: UIDS } } }) },
    plugin: () => ({ service: () => ({ log }) }),
  };
  return { service: EcommerceCustomerService({ strapi }), log, ...db };
}

const input = (email: string, extra = {}) => ({ firstName: 'Ana', lastName: 'Silva', email, ...extra });

const order = (customer: number, reference: number, extra = {}) => ({
  customer,
  reference,
  createdAt: `2026-01-0${reference % 9 || 1}T10:00:00.000Z`,
  total: 1000 + reference,
  orderStatus: 'OPEN',
  paymentStatus: 'PAID',
  fulfillmentStatus: 'UNFULFILLED',
  customerSnapshot: { email: 'ana@x.pt' },
  shippingAddress: { city: `S${reference}` },
  billingAddress: { city: `B${reference}` },
  ...extra,
});

describe('EcommerceCustomerService', () => {
  it('findOrCreate normalizes the e-mail and reuses the customer', async () => {
    const { service, tables } = setup();
    const a = await service.findOrCreate(input('Ana@X.pt '));
    const b = await service.findOrCreate(input('ana@x.pt', { firstName: 'Other' }));
    expect(a).toEqual({ id: 1, created: true });
    expect(b).toEqual({ id: 1, created: false });
    expect(tables[UIDS.customer]).toHaveLength(1);
    expect(tables[UIDS.customer][0]).toMatchObject({ email: 'Ana@X.pt', emailNormalized: 'ana@x.pt', firstName: 'Ana' });
  });

  it('findOrCreate picks the oldest of duplicates', async () => {
    const { service, tables } = setup();
    tables[UIDS.customer].push(
      { id: 5, firstName: 'B', lastName: 'B', email: 'a@x.pt', emailNormalized: 'a@x.pt' },
      { id: 2, firstName: 'A', lastName: 'A', email: 'a@x.pt', emailNormalized: 'a@x.pt' }
    );
    expect((await service.findOrCreate(input('a@x.pt'))).id).toBe(2);
  });

  it('rejects invalid input', async () => {
    const { service } = setup();
    await expect(service.findOrCreate(input('nope'))).rejects.toBeInstanceOf(EcommerceValidationError);
  });

  it('update rejects another customer\'s e-mail and audits changes', async () => {
    const { service, log } = setup();
    const a = await service.findOrCreate(input('a@x.pt'));
    const b = await service.findOrCreate(input('b@x.pt'));
    await expect(service.update(b.id, input(' A@x.pt'), 'user:1')).rejects.toMatchObject({
      errors: [{ path: 'email', code: 'duplicate_email' }],
    });
    // own e-mail (different case) is fine
    const res = await service.update(a.id, input('A@X.pt', { lastName: 'Costa' }), 'user:1');
    expect(res).toMatchObject({ lastName: 'Costa', email: 'A@X.pt' });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ area: 'customers', userId: 'user:1', details: { changedFields: ['lastName', 'email'] } })
    );
    await expect(service.update(a.id, input('', { firstName: '' }))).rejects.toMatchObject({
      errors: expect.arrayContaining([{ path: 'firstName', code: 'required' }, { path: 'email', code: 'required' }]),
    });
    await expect(service.update(99, input('z@x.pt'))).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('Review Focus 5: update keeps order snapshots and search finds the new e-mail', async () => {
    const { service, tables } = setup();
    const c = await service.findOrCreate(input('old@x.pt'));
    tables[UIDS.order].push({ id: 1, ...order(c.id, 1001, { customerSnapshot: { email: 'old@x.pt' } }) });
    await service.update(c.id, input('new@x.pt'), 'user:1');
    expect(tables[UIDS.order][0].customerSnapshot).toEqual({ email: 'old@x.pt' });
    expect((await service.list({ search: 'NEW@' })).results.map((r) => r.id)).toEqual([c.id]);
    expect((await service.list({ search: 'old@' })).results).toHaveLength(0);
  });

  it('list paginates 60 customers, newest first, with orders count', async () => {
    const { service, tables } = setup();
    for (let i = 1; i <= 60; i++) await service.findOrCreate({ firstName: 'N', lastName: 'L', email: `u${i}@x.pt` });
    tables[UIDS.order].push({ id: 1, ...order(60, 1001) }, { id: 2, ...order(60, 1002) });
    const p1 = await service.list({ page: 1 });
    expect(p1.results).toHaveLength(50);
    expect(p1.results[0]).toMatchObject({ id: 60, ordersCount: 2 });
    expect(p1.results[1].ordersCount).toBe(0);
    expect(p1.pagination).toEqual({ page: 1, pageSize: 50, total: 60, pageCount: 2 });
    const p2 = await service.list({ page: 2 });
    expect(p2.results.map((r) => r.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('get returns the customer or throws', async () => {
    const { service } = setup();
    const c = await service.findOrCreate(input('a@x.pt', { phone: '123' }));
    expect(await service.get(c.id)).toMatchObject({ email: 'a@x.pt', phone: '123' });
    await expect(service.get(9)).rejects.toBeInstanceOf(EcommerceNotFoundError);
  });

  it('listOrders searches by reference with or without #', async () => {
    const { service, tables } = setup();
    tables[UIDS.order].push(
      { id: 1, ...order(1, 1001) },
      { id: 2, ...order(1, 1002) },
      { id: 3, ...order(2, 1003) }
    );
    const all = await service.listOrders(1, {});
    expect(all.results.map((r) => r.reference)).toEqual([1002, 1001]);
    expect(all.results[0]).toEqual({
      id: 2, reference: 1002, createdAt: expect.any(String), total: 2002,
      orderStatus: 'OPEN', paymentStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED',
    });
    expect((await service.listOrders(1, { search: '#1001' })).results.map((r) => r.id)).toEqual([1]);
    expect((await service.listOrders(1, { search: '1001' })).results.map((r) => r.id)).toEqual([1]);
    expect((await service.listOrders(1, { search: '1003' })).results).toHaveLength(0);
    expect((await service.listOrders(1, { search: 'abc' })).results).toHaveLength(0);
  });

  it('lastOrderAddresses returns the latest order addresses or null', async () => {
    const { service, tables } = setup();
    expect(await service.lastOrderAddresses(1)).toBeNull();
    tables[UIDS.order].push({ id: 1, ...order(1, 1001) }, { id: 2, ...order(1, 1002) });
    expect(await service.lastOrderAddresses(1)).toEqual({
      shippingAddress: { city: 'S1002' },
      billingAddress: { city: 'B1002' },
    });
  });
});
