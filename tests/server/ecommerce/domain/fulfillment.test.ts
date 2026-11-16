import { describe, it, expect } from 'vitest';
import {
  reservedQuantities,
  validateShipmentRequest,
  orderDeliveryStatus,
  validateDeliveryDate,
  normalizeDeliveryDate,
  returnableQuantities,
  validateReturnRequest,
} from '../../../../server/src/services/modules/ecommerce/domain/fulfillment';

const sh = (status: any, qty: number, over: any = {}) => ({
  status,
  items: [{ orderLineId: 1, quantity: qty }],
  delivered: false,
  ...over,
});
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('shipment request', () => {
  const lines = [{ id: 1, quantity: 10 }];
  const reserved = reservedQuantities([sh('ACTIVE', 4), sh('PENDING', 3), sh('CANCELLED', 2), sh('FAILED', 1)]);

  it('reserves ACTIVE and PENDING only', () => {
    expect(reserved.get(1)).toBe(7);
  });

  it('4 exceeds pending (3 left), 3 passes', () => {
    const over = validateShipmentRequest(lines, reserved, [{ orderLineId: 1, quantity: 4 }]);
    expect(over).toEqual([{ path: 'lines.0.quantity', code: 'QUANTITY_EXCEEDS_PENDING' }]);
    expect(validateShipmentRequest(lines, reserved, [{ orderLineId: 1, quantity: 3 }])).toEqual([]);
  });

  it('validation codes', () => {
    expect(codes(validateShipmentRequest(lines, new Map(), []))).toContain('required');
    expect(
      codes(
        validateShipmentRequest(lines, new Map(), [
          { orderLineId: 1, quantity: 1 },
          { orderLineId: 1, quantity: 1 },
        ]),
      ),
    ).toContain('duplicate_line');
    expect(codes(validateShipmentRequest(lines, new Map(), [{ orderLineId: 9, quantity: 1 }]))).toContain(
      'unknown_line',
    );
    for (const q of [0, -1, 1.5]) {
      expect(codes(validateShipmentRequest(lines, new Map(), [{ orderLineId: 1, quantity: q }]))).toEqual([
        'invalid_quantity',
      ]);
    }
  });
});

describe('orderDeliveryStatus', () => {
  const a = (d: any) => ({ status: 'ACTIVE' as const, deliveryStatus: d });
  it('NONE without ACTIVE', () => {
    expect(orderDeliveryStatus('UNFULFILLED', [])).toBe('NONE');
    expect(orderDeliveryStatus('PARTIALLY_FULFILLED', [{ status: 'PENDING', deliveryStatus: null }])).toBe('NONE');
  });
  it('IN_TRANSIT when none delivered', () => {
    expect(orderDeliveryStatus('PARTIALLY_FULFILLED', [a('IN_TRANSIT')])).toBe('IN_TRANSIT');
  });
  it('PARTIALLY_DELIVERED with one of two delivered', () => {
    expect(orderDeliveryStatus('FULFILLED', [a('DELIVERED'), a('IN_TRANSIT')])).toBe('PARTIALLY_DELIVERED');
  });
  it('all delivered but not FULFILLED is PARTIALLY_DELIVERED', () => {
    expect(orderDeliveryStatus('PARTIALLY_FULFILLED', [a('DELIVERED'), a('DELIVERED')])).toBe(
      'PARTIALLY_DELIVERED',
    );
  });
  it('all delivered and FULFILLED is DELIVERED', () => {
    expect(orderDeliveryStatus('FULFILLED', [a('DELIVERED'), a('DELIVERED')])).toBe('DELIVERED');
  });
});

describe('validateDeliveryDate', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  const shippedAt = '2026-06-05T10:00:00.000Z';
  it('accepts a date between shipment and now', () => {
    expect(validateDeliveryDate('2026-06-08T10:00:00.000Z', shippedAt, now)).toEqual([]);
  });
  it('invalid_date', () => {
    expect(codes(validateDeliveryDate('abc', shippedAt, now))).toEqual(['invalid_date']);
    expect(codes(validateDeliveryDate(undefined, shippedAt, now))).toEqual(['invalid_date']);
  });
  it('before_shipment', () => {
    expect(codes(validateDeliveryDate('2026-06-01T10:00:00.000Z', shippedAt, now))).toEqual(['before_shipment']);
  });
  it('a date up to 5 minutes before the shipment is accepted (clock skew) and clamped to it', () => {
    expect(codes(validateDeliveryDate('2026-06-05T09:56:00.000Z', shippedAt, now))).toEqual([]);
    expect(codes(validateDeliveryDate('2026-06-05T09:54:00.000Z', shippedAt, now))).toEqual(['before_shipment']);
    expect(normalizeDeliveryDate('2026-06-05T09:56:00.000Z', shippedAt)).toBe(shippedAt);
    expect(normalizeDeliveryDate('2026-06-08T10:00:00Z', shippedAt)).toBe('2026-06-08T10:00:00.000Z');
  });
  it('in_future with 5 minute tolerance', () => {
    expect(codes(validateDeliveryDate('2026-06-10T12:04:00.000Z', shippedAt, now))).toEqual([]);
    expect(codes(validateDeliveryDate('2026-06-10T12:06:00.000Z', shippedAt, now))).toEqual(['in_future']);
  });
});

describe('returns', () => {
  it('returnableQuantities = shipped - returned, floored at 0', () => {
    const r = returnableQuantities(
      [
        { id: 1, returnedQuantity: 2 },
        { id: 2, returnedQuantity: 5 },
      ],
      new Map([
        [1, 5],
        [2, 3],
      ]),
    );
    expect(r.get(1)).toBe(3);
    expect(r.get(2)).toBe(0);
  });

  it('QUANTITY_EXCEEDS_RETURNABLE when returning 4 of 3', () => {
    const issues = validateReturnRequest(new Map([[1, 3]]), [{ orderLineId: 1, quantity: 4, restock: true }]);
    expect(issues).toEqual([{ path: 'lines.0.quantity', code: 'QUANTITY_EXCEEDS_RETURNABLE' }]);
    expect(validateReturnRequest(new Map([[1, 3]]), [{ orderLineId: 1, quantity: 3, restock: false }])).toEqual([]);
  });

  it('validation codes', () => {
    const ret = new Map([[1, 3]]);
    expect(codes(validateReturnRequest(ret, []))).toContain('required');
    expect(
      codes(
        validateReturnRequest(ret, [
          { orderLineId: 1, quantity: 1, restock: true },
          { orderLineId: 1, quantity: 1, restock: true },
        ]),
      ),
    ).toContain('duplicate_line');
    expect(codes(validateReturnRequest(ret, [{ orderLineId: 9, quantity: 1, restock: true }]))).toContain(
      'unknown_line',
    );
    for (const q of [0, -1, 1.5]) {
      expect(codes(validateReturnRequest(ret, [{ orderLineId: 1, quantity: q, restock: true }]))).toEqual([
        'invalid_quantity',
      ]);
    }
    expect(codes(validateReturnRequest(ret, [{ orderLineId: 1, quantity: 1, restock: 'yes' as any }]))).toEqual([
      'invalid_restock',
    ]);
  });
});

describe('input hardening', () => {
  const lines = [{ id: 1, quantity: 10 }];

  it('malformed request entries and non-integer orderLineId become issues, not TypeErrors', () => {
    expect(validateShipmentRequest(lines, new Map(), [null as any])).toEqual([
      { path: 'lines.0', code: 'invalid_line' },
    ]);
    expect(validateShipmentRequest(lines, new Map(), ['x' as any])).toEqual([
      { path: 'lines.0', code: 'invalid_line' },
    ]);
    expect(codes(validateShipmentRequest(lines, new Map(), [{ orderLineId: '1' as any, quantity: 1 }]))).toEqual([
      'unknown_line',
    ]);
    expect(codes(validateShipmentRequest(lines, new Map(), [{ orderLineId: 1.5, quantity: 1 }]))).toEqual([
      'unknown_line',
    ]);
    expect(validateReturnRequest(new Map([[1, 3]]), [null as any])).toEqual([
      { path: 'lines.0', code: 'invalid_line' },
    ]);
  });

  it('invalid shippedAt is an explicit issue', () => {
    expect(codes(validateDeliveryDate('2026-06-08T10:00:00.000Z', 'garbage', new Date('2026-06-10T12:00:00Z')))).toEqual([
      'invalid_shipped_at',
    ]);
  });

  it('accepts a Date instance for deliveredAt', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    expect(validateDeliveryDate(new Date('2026-06-08T10:00:00.000Z'), '2026-06-05T10:00:00.000Z', now)).toEqual([]);
    expect(codes(validateDeliveryDate(new Date('invalid'), '2026-06-05T10:00:00.000Z', now))).toEqual([
      'invalid_date',
    ]);
  });

  it('EXCEPTION counts as undelivered', () => {
    expect(orderDeliveryStatus('FULFILLED', [{ status: 'ACTIVE', deliveryStatus: 'EXCEPTION' }])).toBe('IN_TRANSIT');
    expect(
      orderDeliveryStatus('FULFILLED', [
        { status: 'ACTIVE', deliveryStatus: 'DELIVERED' },
        { status: 'ACTIVE', deliveryStatus: 'EXCEPTION' },
      ]),
    ).toBe('PARTIALLY_DELIVERED');
  });
});
