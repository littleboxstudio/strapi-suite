import { describe, it, expect } from 'vitest';
import { nextPickupPoint } from '../../../server/src/services/modules/ecommerce/domain/pickupPoints';
import { planLineChange, readShippingLines } from '../../../server/src/services/modules/ecommerce/domain/shippingLines';

const customer = { firstName: 'Ana', lastName: 'Silva', line1: 'Rua 1', postalCode: '1000-001', city: 'Lisboa', country: 'PT' };
const point = (id: string) => ({ id, name: id, address: 'R', address2: null, postalCode: '1000-100', city: 'Lisboa', country: 'PT' });
const DPD = { providerId: 'dpd-portugal', serviceId: 'PICKUP', name: 'DPD Pickup', tax: 23 };
const STORE = { providerId: 'store-pickup', serviceId: 'STORE', name: 'Store', tax: 23 };
const line = (id: number, m: typeof DPD, extra: Record<string, unknown> = {}) => ({
  id,
  origin: id === 1 ? 'CHECKOUT' : 'MANUAL',
  amount: 100,
  ...m,
  createdAt: '2026-01-01T00:00:00Z',
  actor: 'u',
  ...extra,
});
const order = (method: typeof DPD, lines: unknown[], own: unknown = null) => ({
  createdAt: '2026-01-01T00:00:00Z',
  shippingOriginal: 100,
  shippingTax: 23,
  shippingMethod: method,
  shippingAddress: customer,
  shippingLines: { lines },
  pickupPoint: own,
});

describe('nextPickupPoint', () => {
  it('never takes the order point of another kind (a store for DPD)', () => {
    const o = order(DPD, [line(1, DPD)], { ...point('st_lisboa0001'), customerAddress: customer });
    expect(nextPickupPoint(o)).toBeNull();
  });

  it('takes the latest line point of the method kind, of any origin', () => {
    const o = order(DPD, [
      line(1, DPD),
      line(2, STORE, { pickupPoint: point('st_lisboa0001') }),
      { ...line(3, DPD, { pickupPoint: point('PT2') }), origin: 'RECALCULATION' },
    ], { ...point('PT1'), customerAddress: customer });
    expect(nextPickupPoint(o)).toMatchObject({ id: 'PT2', customerAddress: customer });
  });

  it('falls back to the order point of the same kind', () => {
    const o = order(STORE, [line(1, STORE)], { ...point('st_lisboa0001'), customerAddress: customer });
    expect(nextPickupPoint(o)).toMatchObject({ id: 'st_lisboa0001' });
  });
});

describe('planLineChange', () => {
  it('a replaced line drops the point it carried', () => {
    const lines = readShippingLines(order(DPD, [line(1, DPD), line(2, DPD, { pickupPoint: point('PT2') })]) as any);
    const views = lines.map((l) => ({ ...l, paid: false, invoiced: false, spent: false }));
    const plan = planLineChange(views, 2, { method: STORE, amount: 0 }, { at: 'now', actor: 'u' });
    expect(plan.mode).toBe('REPLACED');
    expect(plan.lines.find((l) => l.id === 2)).not.toHaveProperty('pickupPoint');
  });
});
