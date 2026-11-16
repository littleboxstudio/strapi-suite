import { describe, it, expect } from 'vitest';
import {
  discountBase, invoiceItems, priceWholeSelection, type InvoiceItems } from '../../../../server/src/services/modules/ecommerce/domain/invoiceItems';
import type {
  InvoiceDoc,
  PositionOrder,
} from '../../../../server/src/services/modules/ecommerce/domain/invoiceSelection';
import type { InvoiceLine } from '../../../../server/src/services/modules/ecommerce/domain/invoicing';
import type { ShippingLine } from '../../../../server/src/services/modules/ecommerce/domain/shippingLines';
import type { ManualDiscount } from '../../../../server/src/services/modules/ecommerce/domain/manualDiscounts';
import type { AppliedPromotion } from '../../../../server/src/services/modules/ecommerce/domain/promotions';

const ship = (id: number, amount: number, editOf?: number): ShippingLine => ({
  id,
  origin: editOf ? 'EDIT' : 'CHECKOUT',
  amount,
  providerId: 'p',
  serviceId: 's',
  name: 'Ship',
  tax: 23,
  createdAt: '2026-11-01T00:00:00.000Z',
  actor: 'system',
  ...(editOf ? { editOf } : {}),
});

type O = Parameters<typeof invoiceItems>[0];
const order = (over: Partial<O> = {}): O => ({
  lines: [{ id: 3, unitPrice: 3100, unitDiscount: 0, quantity: 3, returnedQuantity: 0, tax: 23 }],
  orderDiscount: 0,
  shippingDiscount: 0,
  shippingTotal: 500,
  shippingTax: 23,
  shippingLines: [ship(1, 500)],
  manualDiscounts: [],
  applied: [],
  ...over,
});

const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  orderLineId: null,
  kind: 'ITEM',
  sku: 'S',
  name: 'N',
  quantity: 1,
  total: 0,
  tax: 23,
  partial: false,
  ...over,
});
const doc = (id: number, lines: InvoiceLine[], over: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  id,
  kind: 'INVOICE',
  status: 'ISSUED',
  creditedInvoiceId: null,
  creditType: null,
  lines,
  paymentIds: [],
  creditedLines: [],
  ...over,
});

const manual = (id: number, amount: number): ManualDiscount => ({
  id,
  kind: 'FIXED',
  percent: null,
  amount,
  reason: 'Gesture',
  createdAt: '2026-11-01T00:00:00.000Z',
  actor: 'a',
});
const promo = (promotionId: number, cls: string, amount: number): AppliedPromotion =>
  ({
    promotionId,
    name: `P${promotionId}`,
    amount,
    benefits: [{ index: 0, type: 'X', class: cls, amount, params: {} }],
  }) as unknown as AppliedPromotion;

const withDiscounts = (over: Partial<O> = {}) =>
  order({
    manualDiscounts: [manual(1, 1000)],
    applied: [promo(5, 'ORDER_DISCOUNT', 500), promo(1, 'SHIPPING_DISCOUNT', 200)],
    orderDiscount: 1500,
    shippingDiscount: 200,
    ...over,
  });

describe('invoiceItems', () => {
  it('a line offers all its uninvoiced units at net value', () => {
    expect(invoiceItems(order(), []).lines[0]).toEqual({ orderLineId: 3, units: 3, value: 9300, invoiced: false });
  });

  it('a line partly invoiced by a legacy invoice offers the rest as one item', () => {
    const o = order({
      lines: [{ id: 3, unitPrice: 1000, unitDiscount: 100, quantity: 11, returnedQuantity: 0, tax: 23 }],
    });
    const items = invoiceItems(o, [doc(1, [line({ orderLineId: 3, quantity: 5, total: 4500 })])]);
    expect(items.lines[0]).toMatchObject({ units: 6, value: 5400, invoiced: false });
  });

  it('a shipping line with an EDIT correction is one item worth both', () => {
    const items = invoiceItems(order({ shippingLines: [ship(1, 500), ship(2, 200, 1)] }), []);
    expect(items.shipping).toEqual([{ shippingLineId: 1, value: 700, invoiced: false }]);
  });

  it('a legacy negative shipping line is never offered: it reads invoiced', () => {
    const items = invoiceItems(order({ shippingLines: [ship(1, 500), ship(2, -260)] }), []);
    expect(items.shipping).toEqual([
      { shippingLineId: 1, value: 500, invoiced: false },
      { shippingLineId: 2, value: -260, invoiced: true },
    ]);
  });

  it('discount items: manual, ORDER promotion benefit, shipping promotion', () => {
    const d = invoiceItems(withDiscounts(), []).discounts;
    expect(d.map((x) => x.id)).toEqual(['m:1', 'p:5:0', 's:1']);
    expect(d.map((x) => x.amount)).toEqual([1000, 500, 200]);
  });

  it('several SHIPPING_DISCOUNT benefits of one promotion are one s:<promotionId> item (summed)', () => {
    const twice = {
      promotionId: 4,
      name: 'P4',
      amount: 300,
      benefits: [
        { index: 0, type: 'X', class: 'SHIPPING_DISCOUNT', amount: 200, params: {} },
        { index: 1, type: 'Y', class: 'SHIPPING_DISCOUNT', amount: 100, params: {} },
      ],
    } as unknown as AppliedPromotion;
    const d = invoiceItems(order({ applied: [twice], shippingDiscount: 300 }), []).discounts;
    expect(d).toEqual([{ id: 's:4', kind: 'SHIPPING', label: 'P4', amount: 300, invoiced: false }]);
  });

  it('an unexplained difference becomes an adj item', () => {
    const d = invoiceItems(withDiscounts({ orderDiscount: 1501 }), []).discounts;
    expect(d.find((x) => x.id === 'adj:order')).toMatchObject({ amount: 1 });
  });

  it('an applied promotion stored without benefits (older rows) adds no item and never throws', () => {
    const legacy = { promotionId: 7, name: 'Old', amount: 500 } as unknown as AppliedPromotion;
    const d = invoiceItems(order({ applied: [legacy], orderDiscount: 500 }), []).discounts;
    expect(d).toEqual([
      { id: 'adj:order', kind: 'ORDER', label: 'Order discount adjustment', amount: 500, invoiced: false },
    ]);
  });

  it('a discount item on an invoice reads invoiced', () => {
    const inv = doc(1, [line({ kind: 'DISCOUNT', discountId: 'm:1', total: -1000 })]);
    const get = (docs: InvoiceDoc[]) =>
      invoiceItems(withDiscounts(), docs).discounts.find((x) => x.id === 'm:1')!.invoiced;
    expect(get([inv])).toBe(true);
    const cn = doc(2, [], { kind: 'CREDIT_NOTE', creditedInvoiceId: 1, creditType: 'CORRECTION' });
    expect(get([inv, cn])).toBe(false);
  });

  it('a negative shipping line settled by a live SHIPPING credit note reads invoiced', () => {
    const o = order({ shippingTotal: 240, shippingLines: [ship(1, 500), { ...ship(2, -260), origin: 'RECALCULATION' }] });
    const inv = doc(1, [line({ kind: 'SHIPPING', total: 500, shippingLineId: 1 })]);
    const cn = (over: Partial<InvoiceDoc> = {}) =>
      doc(2, [line({ kind: 'SHIPPING', total: 260, shippingLineId: 1 })], {
        kind: 'CREDIT_NOTE',
        creditedInvoiceId: 1,
        creditType: 'SHIPPING',
        settledShippingLineIds: [2],
        ...over,
      });
    const negative = (docs: InvoiceDoc[]) =>
      invoiceItems(o, docs).shipping.find((x) => x.shippingLineId === 2)!.invoiced;
    // Legacy negative lines are never offered, settled or not (negative lines are never created).
    expect(negative([inv])).toBe(true);
    expect(negative([inv, cn()])).toBe(true);
    expect(negative([inv, cn({ status: 'FAILED' })])).toBe(true);
    const correction = doc(3, [], { kind: 'CREDIT_NOTE', creditedInvoiceId: 1, creditType: 'CORRECTION' });
    expect(negative([inv, cn(), correction])).toBe(true);
  });
});

describe('invoiceItems: shipping discounts settled by a SHIPPING credit note', () => {
  it('reads invoiced while the credit note counts', () => {
    // Shipping 500 invoiced; a shipping promotion of 200 came later (over-invoiced 200).
    const o = order({ shippingTotal: 300, shippingDiscount: 200, applied: [promo(1, 'SHIPPING_DISCOUNT', 200)] });
    const inv = doc(1, [line({ kind: 'SHIPPING', total: 500, shippingLineId: 1, discountShare: 0 })]);
    const cn = (over: Partial<InvoiceDoc> = {}) =>
      doc(2, [line({ kind: 'SHIPPING', total: 200, shippingLineId: 1 })], {
        kind: 'CREDIT_NOTE',
        creditedInvoiceId: 1,
        creditType: 'SHIPPING',
        settledDiscountIds: ['s:1'],
        ...over,
      });
    const settled = (docs: InvoiceDoc[]) => invoiceItems(o, docs).discounts.find((x) => x.id === 's:1')!.invoiced;
    expect(settled([inv])).toBe(false);
    expect(settled([inv, cn()])).toBe(true);
    expect(settled([inv, cn({ status: 'PENDING' })])).toBe(true);
    expect(settled([inv, cn({ status: 'FAILED' })])).toBe(false);
    const correction = doc(3, [], { kind: 'CREDIT_NOTE', creditedInvoiceId: 1, creditType: 'CORRECTION' });
    expect(settled([inv, cn(), correction])).toBe(false);
  });
});

describe('priceWholeSelection', () => {
  const items = (over: Partial<InvoiceItems> = {}): InvoiceItems => ({
    lines: [
      { orderLineId: 1, units: 2, value: 8100, invoiced: false },
      { orderLineId: 2, units: 1, value: 4500, invoiced: false },
    ],
    shipping: [{ shippingLineId: 7, value: 300, invoiced: false }],
    discounts: [{ id: 'm:1', kind: 'ORDER', label: 'x', amount: 1400, invoiced: false }],
    ...over,
  });
  const pay = (net: number) => [{ id: 9, net, available: true }];
  const req = (over: Record<string, unknown> = {}) =>
    ({ orderLineIds: [1, 2], shippingLineIds: [7], discountIds: ['m:1'], paymentIds: [9], ...over }) as Parameters<
      typeof priceWholeSelection
    >[2];

  it('prices lines + shipping - discounts and checks the payments', () => {
    const r = priceWholeSelection(items(), pay(11500), req());
    expect(r.issues).toEqual([]);
    expect(r.selection?.total).toBe(11500);
    expect(r.selection?.lines.map((l) => l.discountShare)).toEqual([900, 500]);
    expect(r.selection?.shipping.map((s) => s.discountShare)).toEqual([0]);
  });

  it('a free line takes no share', () => {
    const r = priceWholeSelection(
      items({
        lines: [
          { orderLineId: 1, units: 1, value: 6200, invoiced: false },
          { orderLineId: 2, units: 1, value: 0, invoiced: false },
        ],
        shipping: [],
        discounts: [{ id: 'm:1', kind: 'ORDER', label: 'x', amount: 620, invoiced: false }],
      }),
      pay(5580),
      req({ shippingLineIds: [] })
    );
    expect(r.issues).toEqual([]);
    expect(r.selection?.lines.map((l) => l.discountShare)).toEqual([620, 0]);
  });

  it('refuses a discount above its pool', () => {
    const r = priceWholeSelection(
      items({
        lines: [{ orderLineId: 1, units: 1, value: 500, invoiced: false }],
        shipping: [],
        discounts: [{ id: 'm:1', kind: 'ORDER', label: 'x', amount: 600, invoiced: false }],
      }),
      pay(1),
      req({ orderLineIds: [1], shippingLineIds: [] })
    );
    expect(r.selection).toBeNull();
    expect(r.issues).toEqual([{ path: 'discountIds', code: 'DISCOUNT_EXCEEDS_SELECTION' }]);
  });

  it('refuses an invoiced line, a duplicate and an unknown discount', () => {
    const r = priceWholeSelection(
      items({ lines: [{ orderLineId: 1, units: 0, value: 0, invoiced: true }] }),
      pay(1),
      req({ orderLineIds: [1, 1, 5], shippingLineIds: [7, 99], discountIds: ['m:1', 'm:1', 'zz'], paymentIds: [9, 9, 8] })
    );
    expect(r.selection).toBeNull();
    expect(r.issues).toEqual(
      expect.arrayContaining([
        { path: 'orderLineIds.0', code: 'LINE_ALREADY_INVOICED' },
        { path: 'orderLineIds.1', code: 'duplicate' },
        { path: 'orderLineIds.2', code: 'unknown_line' },
        { path: 'shippingLineIds.1', code: 'SHIPPING_LINE_NOT_INVOICEABLE' },
        { path: 'discountIds.1', code: 'duplicate' },
        { path: 'discountIds.2', code: 'DISCOUNT_NOT_INVOICEABLE' },
        { path: 'paymentIds.1', code: 'duplicate' },
        { path: 'paymentIds.2', code: 'PAYMENT_NOT_INVOICEABLE' },
      ])
    );
  });

  it('needs something to invoice and a payment', () => {
    const r = priceWholeSelection(items(), pay(1), req({ orderLineIds: [], shippingLineIds: [], discountIds: [], paymentIds: [] }));
    expect(r.issues).toEqual([
      { path: 'orderLineIds', code: 'required' },
      { path: 'paymentIds', code: 'required' },
    ]);
  });

  it('totals must match', () => {
    const r = priceWholeSelection(items(), pay(11499), req());
    expect(r.issues).toEqual([{ path: 'paymentIds', code: 'INVOICE_TOTALS_DIFFER' }]);
  });

  it('a negative shipping item is never priced (SHIPPING_LINE_NOT_INVOICEABLE)', () => {
    const r = priceWholeSelection(
      items({
        lines: [{ orderLineId: 1, units: 1, value: 1000, invoiced: false }],
        shipping: [{ shippingLineId: 7, value: -260, invoiced: false }],
        discounts: [],
      }),
      pay(740),
      req({ orderLineIds: [1], discountIds: [] })
    );
    expect(r.issues).toEqual([{ path: 'shippingLineIds.0', code: 'SHIPPING_LINE_NOT_INVOICEABLE' }]);
  });
});

describe('discountBase', () => {
  it('is the value of the lines not yet invoiced and the order discounts not yet invoiced', () => {
    const items = {
      lines: [
        { orderLineId: 1, units: 2, value: 6200, invoiced: false },
        { orderLineId: 2, units: 1, value: 1550, invoiced: true },
        { orderLineId: 3, units: 0, value: 0, invoiced: true },
      ],
      shipping: [{ shippingLineId: 1, value: 500, invoiced: false }],
      discounts: [
        { id: 'm:1', kind: 'ORDER' as const, label: 'a', amount: 1000, invoiced: false },
        { id: 'm:2', kind: 'ORDER' as const, label: 'b', amount: 300, invoiced: true },
        { id: 's:1', kind: 'SHIPPING' as const, label: 'c', amount: 200, invoiced: false },
      ],
    };
    expect(discountBase(items)).toEqual({ products: 6200, pendingDiscounts: 1000 });
  });

  it('never reports negative pending discounts', () => {
    const items = { lines: [], shipping: [], discounts: [{ id: 'adj:order', kind: 'ORDER' as const, label: 'x', amount: -5, invoiced: false }] };
    expect(discountBase(items)).toEqual({ products: 0, pendingDiscounts: 0 });
  });
});
