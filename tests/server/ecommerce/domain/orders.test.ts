import { describe, it, expect } from 'vitest';
import {
  allocateProportionally,
  computeTotals,
  orderDiscountShareForReturn,
  financialSummary,
  derivePaymentStatus,
  shippedQuantities,
  deriveFulfillmentStatus,
  canTransition,
  availableActions,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  FULFILLMENT_STATUSES,
  PAYMENT_RECORD_STATUSES,
  type OrderStatus,
  type ShipmentLike,
} from '../../../../server/src/services/modules/ecommerce/domain/orders';

const line = (over: Partial<{ unitPrice: number; unitDiscount: number; quantity: number; returnedQuantity: number }> = {}) => ({
  unitPrice: 5000,
  unitDiscount: 0,
  quantity: 1,
  returnedQuantity: 0,
  ...over,
});

describe('status constants', () => {
  it('exports the stable identifiers', () => {
    expect(ORDER_STATUSES).toEqual(['OPEN', 'ARCHIVED', 'CANCELLED']);
    expect(PAYMENT_STATUSES).toEqual([
      'PENDING',
      'PARTIALLY_PAID',
      'PAID',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
      'REFUND_DUE',
    ]);
    expect(FULFILLMENT_STATUSES).toEqual(['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED']);
    expect(PAYMENT_RECORD_STATUSES).toEqual(['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']);
  });
});

describe('computeTotals', () => {
  it('computes the full breakdown', () => {
    const t = computeTotals([line({ unitPrice: 5000, unitDiscount: 1000, quantity: 2 })], {
      orderDiscount: 1300,
      shippingOriginal: 800,
      shippingDiscount: 800,
    });
    expect(t).toEqual({
      itemsOriginal: 10000,
      productDiscount: 2000,
      subtotal: 8000,
      orderDiscount: 1300,
      shippingTotal: 0,
      total: 6700,
    });
  });

  it('caps orderDiscount at the subtotal', () => {
    const t = computeTotals([line({ unitPrice: 5000, quantity: 1 })], {
      orderDiscount: 9000,
      shippingOriginal: 500,
      shippingDiscount: 0,
    });
    expect(t.subtotal).toBe(5000);
    expect(t.orderDiscount).toBe(5000);
    expect(t.total).toBe(500);
  });

  it('counts only the non-returned quantity', () => {
    const t = computeTotals([line({ unitPrice: 5000, unitDiscount: 500, quantity: 2, returnedQuantity: 1 })], {
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
    });
    expect(t.itemsOriginal).toBe(5000);
    expect(t.productDiscount).toBe(500);
    expect(t.subtotal).toBe(4500);
    expect(t.total).toBe(4500);
  });
});

describe('financialSummary / derivePaymentStatus', () => {
  it('ignores pending payments', () => {
    const s = financialSummary(
      12500,
      [
        { status: 'COMPLETED', amount: 10000 },
        { status: 'PENDING', amount: 2500 },
      ],
      [],
    );
    expect(s.paid).toBe(10000);
    expect(s.pendingPayments).toBe(2500);
    expect(s.due).toBe(2500);
    expect(s.excess).toBe(0);
    expect(derivePaymentStatus(s)).toBe('PARTIALLY_PAID');
  });

  it('ignores cancelled and failed payments', () => {
    const s = financialSummary(
      1000,
      [
        { status: 'CANCELLED', amount: 1000 },
        { status: 'FAILED', amount: 1000 },
      ],
      [],
    );
    expect(s.paid).toBe(0);
    expect(s.pendingPayments).toBe(0);
    expect(derivePaymentStatus(s)).toBe('PENDING');
  });

  it('REFUNDED when fully refunded', () => {
    const s = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 10000, kind: 'MONEY' },
    ]);
    expect(s.refunded).toBe(10000);
    expect(s.net).toBe(0);
    expect(derivePaymentStatus(s)).toBe('REFUNDED');
  });

  it('F4: a refund promoted from FAILED beyond the excess is over-refunded, never an amount due', () => {
    // total 7000, paid 10000 (excess 3000), refunded 3000 by transfer + 3000 Stripe promoted.
    const s = financialSummary(7000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY' },
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY', promoted: true },
    ]);
    expect(s.refunded).toBe(6000);
    expect(s.net).toBe(4000);
    expect(s.overRefunded).toBe(3000);
    expect(s.due).toBe(0);
    expect(s.excess).toBe(0);
    // A promotion within the excess is not an over-refund.
    const ok = financialSummary(7000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY', promoted: true },
    ]);
    expect(ok.overRefunded).toBe(0);
    // Without a promotion a refund followed by a total increase is a real amount due.
    const due = financialSummary(9000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY' },
    ]);
    expect(due.overRefunded).toBe(0);
    expect(due.due).toBe(2000);
  });

  it('PAID when only the excess was refunded (what is kept covers the order)', () => {
    const s = financialSummary(7000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY' },
    ]);
    expect(s.due).toBe(0);
    expect(s.excess).toBe(0);
    expect(derivePaymentStatus(s)).toBe('PAID');
  });

  it('a cancelled order refunded in part is PARTIALLY_REFUNDED while money is still held', () => {
    // orderTotal is the real total (10000); the customer got 4000 back of 10000 paid.
    const s = financialSummary(
      10000,
      [{ status: 'COMPLETED', amount: 10000 }],
      [{ status: 'COMPLETED', amount: 4000, kind: 'MONEY' }],
      { orderCancelled: true }
    );
    expect(s.excess).toBe(6000);
    expect(derivePaymentStatus(s)).toBe('PARTIALLY_REFUNDED');
  });

  it('refunded in part with nothing more owed back stays PARTIALLY_REFUNDED', () => {
    expect(
      derivePaymentStatus({ paid: 10000, refunded: 4000, net: 6000, orderTotal: 10000, excess: 0 })
    ).toBe('PARTIALLY_REFUNDED');
  });

  it('REFUND_DUE stays until a processing refund completes, then PAID', () => {
    const payments = [{ status: 'COMPLETED' as const, amount: 10000 }];
    const processing = financialSummary(9000, payments, [
      { status: 'PROCESSING', amount: 1000, kind: 'MONEY' },
    ]);
    expect(derivePaymentStatus(processing)).toBe('REFUND_DUE');
    // Part of the excess went back, part is still owed: PARTIALLY_REFUNDED.
    const half = financialSummary(9000, payments, [
      { status: 'COMPLETED', amount: 500, kind: 'MONEY' },
    ]);
    expect(half.excess).toBe(500);
    expect(derivePaymentStatus(half)).toBe('PARTIALLY_REFUNDED');
    const done = financialSummary(9000, payments, [
      { status: 'COMPLETED', amount: 1000, kind: 'MONEY' },
    ]);
    expect(derivePaymentStatus(done)).toBe('PAID');
  });

  it('store-credit refunds count; non-completed refunds do not', () => {
    const s = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 2000, kind: 'STORE_CREDIT' },
      { status: 'PENDING', amount: 5000, kind: 'MONEY' },
    ]);
    expect(s.refunded).toBe(2000);
    expect(s.net).toBe(8000);
    expect(derivePaymentStatus(s)).toBe('PARTIALLY_REFUNDED');
  });

  it('PAID becomes PARTIALLY_PAID when the total grows (Review Focus 4)', () => {
    const before = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], []);
    expect(derivePaymentStatus(before)).toBe('PAID');
    const after = financialSummary(12500, [{ status: 'COMPLETED', amount: 10000 }], []);
    expect(after.due).toBe(2500);
    expect(derivePaymentStatus(after)).toBe('PARTIALLY_PAID');
  });

  it('reports excess when net exceeds total', () => {
    const s = financialSummary(8000, [{ status: 'COMPLETED', amount: 10000 }], []);
    expect(s.excess).toBe(2000);
    expect(s.due).toBe(0);
    expect(derivePaymentStatus(s)).toBe('REFUND_DUE');
  });

  it('cancelled order: effective total 0, original kept as orderTotal', () => {
    const s = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], [], {
      orderCancelled: true,
    });
    expect(s.orderTotal).toBe(10000);
    expect(s.total).toBe(0);
    expect(s.due).toBe(0);
    expect(s.excess).toBe(10000);
    expect(derivePaymentStatus(s)).toBe('REFUND_DUE');
  });

  it('cancelled unpaid order owes nothing', () => {
    const s = financialSummary(10000, [], [], { orderCancelled: true });
    expect(s.due).toBe(0);
    expect(s.excess).toBe(0);
    expect(derivePaymentStatus(s)).toBe('PENDING');
  });

  it('zero-total order with nothing refunded is PAID (nothing to pay)', () => {
    const s = financialSummary(0, [], []);
    expect(s.due).toBe(0);
    expect(derivePaymentStatus(s)).toBe('PAID');
    // Cancelled zero-total order: still nothing owed.
    expect(derivePaymentStatus(financialSummary(0, [], [], { orderCancelled: true }))).toBe('PAID');
  });

  it('non-cancelled: orderTotal equals total', () => {
    const s = financialSummary(5000, [], []);
    expect(s.orderTotal).toBe(5000);
    expect(s.total).toBe(5000);
    expect(s.due).toBe(5000);
  });
});

describe('fulfillment', () => {
  const ship = (qty: number, over: Partial<ShipmentLike> = {}): ShipmentLike => ({
    status: 'ACTIVE',
    items: [{ orderLineId: 1, quantity: qty }],
    delivered: false,
    ...over,
  });

  it('PARTIALLY_FULFILLED when 4 of 10 shipped', () => {
    const shipped = shippedQuantities([ship(4)]);
    expect(shipped.get(1)).toBe(4);
    expect(deriveFulfillmentStatus([{ id: 1, quantity: 10 }], shipped)).toBe('PARTIALLY_FULFILLED');
  });

  it('FULFILLED when 10 of 10 shipped, PARTIALLY_FULFILLED after adding a line', () => {
    const shipped = shippedQuantities([ship(4), ship(6)]);
    expect(deriveFulfillmentStatus([{ id: 1, quantity: 10 }], shipped)).toBe('FULFILLED');
    expect(
      deriveFulfillmentStatus(
        [
          { id: 1, quantity: 10 },
          { id: 2, quantity: 1 },
        ],
        shipped,
      ),
    ).toBe('PARTIALLY_FULFILLED');
  });

  it('ignores CANCELLED shipments', () => {
    const shipped = shippedQuantities([ship(4, { status: 'CANCELLED' })]);
    expect(shipped.get(1) ?? 0).toBe(0);
    expect(deriveFulfillmentStatus([{ id: 1, quantity: 10 }], shipped)).toBe('UNFULFILLED');
  });

  it('ignores PENDING and FAILED shipments (only ACTIVE counts as shipped)', () => {
    const shipped = shippedQuantities([
      ship(4, { status: 'PENDING' }),
      ship(2, { status: 'FAILED' }),
      ship(1),
    ]);
    expect(shipped.get(1)).toBe(1);
  });

  it('UNFULFILLED without lines', () => {
    expect(deriveFulfillmentStatus([], new Map())).toBe('UNFULFILLED');
  });
});

describe('canTransition', () => {
  const allowed: Record<string, boolean> = {
    'OPEN->OPEN': false,
    'OPEN->ARCHIVED': true,
    'OPEN->CANCELLED': true,
    'ARCHIVED->OPEN': false,
    'ARCHIVED->ARCHIVED': false,
    'ARCHIVED->CANCELLED': false,
    'CANCELLED->OPEN': false,
    'CANCELLED->ARCHIVED': false,
    'CANCELLED->CANCELLED': false,
  };
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      it(`${from} -> ${to}`, () => {
        expect(canTransition(from as OrderStatus, to as OrderStatus)).toBe(allowed[`${from}->${to}`]);
      });
    }
  }
});

describe('availableActions', () => {
  const base = {
    orderStatus: 'OPEN' as const,
    paymentStatus: 'PENDING' as const,
    fulfillmentStatus: 'UNFULFILLED' as const,
    summary: financialSummary(10000, [], []),
    hasUnshippedQuantity: true,
    hasShippedUnreturned: false,
    allShipmentsDelivered: false,
    hasPendingPayments: false,
    hasPendingRefunds: false,
    canIssueInvoice: false,
  };

  it('new unpaid order (no MODIFY: orders are edited by section)', () => {
    expect(availableActions(base)).toEqual([
      'CANCEL',
      'ADD_PAYMENT',
      'SEND_PAYMENT_INSTRUCTIONS',
    ]);
  });

  it('paid and not shipped', () => {
    const summary = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], []);
    const actions = availableActions({ ...base, paymentStatus: 'PAID', summary });
    expect(actions).toContain('SHIP');
    expect(actions).not.toContain('ADD_PAYMENT');
    expect(actions).toEqual(['SHIP', 'CANCEL']);
  });

  it('paid with something to invoice offers ISSUE_INVOICE', () => {
    const summary = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], []);
    const actions = availableActions({
      ...base,
      paymentStatus: 'PAID',
      summary,
      canIssueInvoice: true,
    });
    expect(actions).toEqual(['SHIP', 'CANCEL', 'ISSUE_INVOICE']);
  });

  const fulfilled = {
    ...base,
    paymentStatus: 'PAID' as const,
    fulfillmentStatus: 'FULFILLED' as const,
    summary: financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], []),
    hasUnshippedQuantity: false,
    hasShippedUnreturned: true,
  };

  it('FULFILLED without all deliveries has no ARCHIVE', () => {
    const actions = availableActions({ ...fulfilled, allShipmentsDelivered: false });
    expect(actions).not.toContain('ARCHIVE');
    expect(actions).toEqual(['CANCEL', 'REGISTER_RETURN']);
  });

  it('FULFILLED, all delivered and zero balance offers ARCHIVE', () => {
    const actions = availableActions({ ...fulfilled, allShipmentsDelivered: true });
    expect(actions).toContain('ARCHIVE');
    expect(actions).toEqual(['CANCEL', 'ARCHIVE', 'REGISTER_RETURN']);
  });

  it('no ARCHIVE with pending payments or refunds', () => {
    expect(
      availableActions({ ...fulfilled, allShipmentsDelivered: true, hasPendingPayments: true }),
    ).not.toContain('ARCHIVE');
    expect(
      availableActions({ ...fulfilled, allShipmentsDelivered: true, hasPendingRefunds: true }),
    ).not.toContain('ARCHIVE');
  });

  it('cancelled and paid offers only REFUND', () => {
    const summary = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], [], {
      orderCancelled: true,
    });
    const input = {
      ...base,
      orderStatus: 'CANCELLED' as const,
      paymentStatus: derivePaymentStatus(summary),
      summary,
    };
    expect(availableActions(input)).toEqual(['REFUND']);
    expect(availableActions({ ...input, hasShippedUnreturned: true })).toEqual([
      'REFUND',
      'REGISTER_RETURN',
    ]);
  });

  it('archived offers nothing', () => {
    expect(
      availableActions({
        ...fulfilled,
        orderStatus: 'ARCHIVED',
        allShipmentsDelivered: true,
        canIssueInvoice: true,
      }),
    ).toEqual([]);
  });
});

describe('fix round 1', () => {
  const actionBase = {
    orderStatus: 'OPEN' as const,
    fulfillmentStatus: 'UNFULFILLED' as const,
    hasUnshippedQuantity: true,
    hasShippedUnreturned: false,
    allShipmentsDelivered: false,
    hasPendingPayments: false,
    hasPendingRefunds: false,
    canIssueInvoice: false,
  };
  const withSummary = (summary: ReturnType<typeof financialSummary>) => ({
    ...actionBase,
    summary,
    paymentStatus: derivePaymentStatus(summary),
  });

  it('SHIP available for a zero-total order', () => {
    const summary = financialSummary(0, [], []);
    expect(derivePaymentStatus(summary)).toBe('PAID');
    expect(availableActions(withSummary(summary))).toContain('SHIP');
  });

  it('SHIP available when only the excess was refunded (PAID, due 0)', () => {
    const summary = financialSummary(5000, [{ status: 'COMPLETED', amount: 10000 }], [
      { status: 'COMPLETED', amount: 5000, kind: 'MONEY' },
    ]);
    expect(derivePaymentStatus(summary)).toBe('PAID');
    expect(summary.due).toBe(0);
    expect(availableActions(withSummary(summary))).toContain('SHIP');
  });

  it('no SHIP when PARTIALLY_PAID', () => {
    const summary = financialSummary(10000, [{ status: 'COMPLETED', amount: 4000 }], []);
    expect(derivePaymentStatus(summary)).toBe('PARTIALLY_PAID');
    expect(availableActions(withSummary(summary))).not.toContain('SHIP');
  });

  it('no SHIP without unshipped quantity', () => {
    const summary = financialSummary(0, [], []);
    expect(
      availableActions({ ...withSummary(summary), hasUnshippedQuantity: false }),
    ).not.toContain('SHIP');
  });

  it('fulfillment ignores zero-quantity lines', () => {
    expect(deriveFulfillmentStatus([{ id: 1, quantity: 0 }], new Map())).toBe('UNFULFILLED');
    expect(
      deriveFulfillmentStatus(
        [
          { id: 1, quantity: 2 },
          { id: 2, quantity: 0 },
        ],
        new Map([[1, 2]]),
      ),
    ).toBe('FULFILLED');
  });

  it('cancelled & partially paid is REFUND_DUE with full excess', () => {
    const s = financialSummary(10000, [{ status: 'COMPLETED', amount: 4000 }], [], {
      orderCancelled: true,
    });
    expect(derivePaymentStatus(s)).toBe('REFUND_DUE');
    expect(s.excess).toBe(4000);
    expect(s.due).toBe(0);
  });

  it('cancelled & fully paid is REFUND_DUE', () => {
    const s = financialSummary(10000, [{ status: 'COMPLETED', amount: 10000 }], [], {
      orderCancelled: true,
    });
    expect(derivePaymentStatus(s)).toBe('REFUND_DUE');
  });

  const order = { orderDiscount: 1300, shippingOriginal: 0, shippingDiscount: 0 };

  it('returns do not pro-rate the stored order discount; it is only clamped (return 1 of 2)', () => {
    const t = computeTotals(
      [{ unitPrice: 5000, unitDiscount: 1000, quantity: 2, returnedQuantity: 1 }],
      order,
    );
    expect(t.subtotal).toBe(4000);
    expect(t.orderDiscount).toBe(1300);
    expect(t.total).toBe(2700);
  });

  it('returning everything clamps the order discount to 0', () => {
    const t = computeTotals(
      [{ unitPrice: 5000, unitDiscount: 1000, quantity: 2, returnedQuantity: 2 }],
      order,
    );
    expect(t.subtotal).toBe(0);
    expect(t.orderDiscount).toBe(0);
    expect(t.total).toBe(0);
  });

  it('all lines returned across several lines → orderDiscount 0', () => {
    const t = computeTotals(
      [
        { unitPrice: 3000, unitDiscount: 0, quantity: 1, returnedQuantity: 1 },
        { unitPrice: 2000, unitDiscount: 0, quantity: 3, returnedQuantity: 3 },
      ],
      { orderDiscount: 1000, shippingOriginal: 500, shippingDiscount: 0 },
    );
    expect(t.subtotal).toBe(0);
    expect(t.orderDiscount).toBe(0);
    expect(t.total).toBe(500);
  });

  it('negative net (over-refund) yields due greater than total (documented; caps in plan 4)', () => {
    const s = financialSummary(5000, [{ status: 'COMPLETED', amount: 1000 }], [
      { status: 'COMPLETED', amount: 3000, kind: 'MONEY' },
    ]);
    expect(s.net).toBe(-2000);
    expect(s.due).toBe(7000);
    expect(s.due).toBeGreaterThan(s.total);
    expect(derivePaymentStatus(s)).toBe('REFUNDED');
  });
});

describe('orderDiscountShareForReturn', () => {
  const twoUnits = (returnedQuantity: number) => [
    { id: 1, unitPrice: 5000, unitDiscount: 1000, quantity: 2, returnedQuantity },
  ];

  it('returning 1 of 2 units → share 650 of 1300', () => {
    expect(orderDiscountShareForReturn(twoUnits(0), 1300, [{ orderLineId: 1, quantity: 1 }])).toBe(650);
  });

  it('a second return of the last unit, with the discount now 650 → share 650', () => {
    expect(orderDiscountShareForReturn(twoUnits(1), 650, [{ orderLineId: 1, quantity: 1 }])).toBe(650);
  });

  it('rounds half-up to integer cents', () => {
    // 1001 × 4000 / 8000 = 500.5 → 501
    expect(orderDiscountShareForReturn(twoUnits(0), 1001, [{ orderLineId: 1, quantity: 1 }])).toBe(501);
  });

  it('is 0 when the subtotal is 0 or nothing is returned', () => {
    expect(orderDiscountShareForReturn(twoUnits(2), 1300, [{ orderLineId: 1, quantity: 1 }])).toBe(0);
    expect(orderDiscountShareForReturn(twoUnits(0), 1300, [])).toBe(0);
  });

  it('is capped at the order discount and ignores unknown lines', () => {
    const lines = [
      { id: 1, unitPrice: 3000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
      { id: 2, unitPrice: 1000, unitDiscount: 0, quantity: 1, returnedQuantity: 0 },
    ];
    expect(
      orderDiscountShareForReturn(lines, 500, [
        { orderLineId: 1, quantity: 5 },
        { orderLineId: 99, quantity: 1 },
      ]),
    ).toBe(500);
    expect(orderDiscountShareForReturn(lines, 1000, [{ orderLineId: 2, quantity: 1 }])).toBe(250);
  });
});

describe('allocateProportionally', () => {
  it('splits by largest remainder, ties to the lower index', () => {
    expect(allocateProportionally(500, [1000, 1000, 1000])).toEqual([167, 167, 166]);
    expect(allocateProportionally(10, [1, 1])).toEqual([5, 5]);
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProportionally(5, [0, 0])).toEqual([0, 0]);
  });

  it('is exact when total × weight exceeds 2^53', () => {
    // Exact tie between the two remainders: the extra cent goes to index 0.
    expect(allocateProportionally(499999500, [999998999, 1])).toEqual([499999500, 0]);
    expect(allocateProportionally(999999999, [1_000_000_000, 7])).toEqual([999999992, 7]);
  });

  it('returns zeros, never throws, when an input is not a non-negative safe integer', () => {
    expect(allocateProportionally(10.5, [1, 1])).toEqual([0, 0]);
    expect(allocateProportionally(10, [1.5, 1])).toEqual([0, 0]);
    expect(allocateProportionally(10, [Number.NaN, 1])).toEqual([0, 0]);
    expect(allocateProportionally(10, [-1, 3])).toEqual([0, 0]);
    expect(allocateProportionally(10, [Number.POSITIVE_INFINITY, 1])).toEqual([0, 0]);
    expect(allocateProportionally(Number.NaN, [1, 1])).toEqual([0, 0]);
    expect(allocateProportionally(10, [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toEqual([0, 0]);
  });
});
