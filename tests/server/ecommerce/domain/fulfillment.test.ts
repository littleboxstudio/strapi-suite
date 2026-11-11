import { describe, it, expect } from 'vitest';
import {
  reservedQuantities,
  validateShipmentRequest,
  remainingShippingCost,
  previousShipmentsCost,
  orderDeliveryStatus,
  validateDeliveryDate,
  normalizeDeliveryDate,
  returnableQuantities,
  validateReturnRequest,
  computeReturn,
} from '../../../../server/src/services/modules/ecommerce/domain/fulfillment';
import { EcommerceValidationError } from '../../../../server/src/services/modules/ecommerce/errors';

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

describe('shipping cost', () => {
  it('remainingShippingCost counts only ACTIVE', () => {
    expect(
      remainingShippingCost(500, [
        { status: 'ACTIVE', shippingCost: 300 },
        { status: 'CANCELLED', shippingCost: 200 },
      ]),
    ).toBe(200);
    expect(remainingShippingCost(100, [{ status: 'ACTIVE', shippingCost: 300 }])).toBe(0);
  });

  it('previousShipmentsCost', () => {
    expect(
      previousShipmentsCost([
        { status: 'ACTIVE', shippingCost: 300 },
        { status: 'ACTIVE', shippingCost: 200 },
        { status: 'CANCELLED', shippingCost: 900 },
      ]),
    ).toBe(500);
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

  it('computeReturn: 10 EUR order discount over 100 EUR, returning 20 EUR', () => {
    const r = computeReturn(
      [{ id: 1, unitPrice: 1000, unitDiscount: 0, quantity: 10, returnedQuantity: 0 }],
      1000,
      [{ orderLineId: 1, quantity: 2 }],
    );
    expect(r).toEqual({
      items: [{ orderLineId: 1, quantity: 2, value: 2000 }],
      grossValue: 2000,
      discountShare: 200,
      refundableValue: 1800,
    });
  });

  it('computeReturn uses unit price minus unit discount', () => {
    const r = computeReturn(
      [{ id: 1, unitPrice: 1000, unitDiscount: 100, quantity: 3, returnedQuantity: 0 }],
      0,
      [{ orderLineId: 1, quantity: 2 }],
    );
    expect(r.grossValue).toBe(1800);
    expect(r.discountShare).toBe(0);
    expect(r.refundableValue).toBe(1800);
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

  it('computeReturn throws on an unknown orderLineId', () => {
    expect(() =>
      computeReturn([{ id: 1, unitPrice: 100, unitDiscount: 0, quantity: 1, returnedQuantity: 0 }], 0, [
        { orderLineId: 9, quantity: 1 },
      ]),
    ).toThrow(EcommerceValidationError);
  });

  it('computeReturn rounds the discount share half-up across multiple lines', () => {
    // net subtotal 3000 (1000 + 2000), discount 100, returning 1000 net -> 100*1000/3000 = 33.33 -> 33
    const lns = [
      { id: 1, unitPrice: 1000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      { id: 2, unitPrice: 1000, unitDiscount: 0, quantity: 2, returnedQuantity: 0 },
    ];
    const a = computeReturn(lns, 100, [{ orderLineId: 1, quantity: 1 }]);
    expect(a.discountShare).toBe(33);
    expect(a.refundableValue).toBe(967);
    // returning 2000 net -> 66.67 -> 67 ; plus multi-line request 1000+1000 = 2000
    const b = computeReturn(lns, 100, [
      { orderLineId: 1, quantity: 1 },
      { orderLineId: 2, quantity: 1 },
    ]);
    expect(b.items.map((i) => i.value)).toEqual([1000, 1000]);
    expect(b.grossValue).toBe(2000);
    expect(b.discountShare).toBe(67);
    expect(b.refundableValue).toBe(1933);
  });
});
