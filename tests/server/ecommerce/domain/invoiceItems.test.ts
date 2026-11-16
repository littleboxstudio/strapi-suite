import { describe, it, expect } from 'vitest';
import { invoiceItems } from '../../../../server/src/services/modules/ecommerce/domain/invoiceItems';
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

  it('a negative credit line is its own item', () => {
    const items = invoiceItems(order({ shippingLines: [ship(1, 500), ship(2, -260)] }), []);
    expect(items.shipping.map((s) => s.value)).toEqual([500, -260]);
  });

  it('discount items: manual, ORDER promotion benefit, shipping promotion', () => {
    const d = invoiceItems(withDiscounts(), []).discounts;
    expect(d.map((x) => x.id)).toEqual(['m:1', 'p:5:0', 's:1']);
    expect(d.map((x) => x.amount)).toEqual([1000, 500, 200]);
  });

  it('an unexplained difference becomes an adj item', () => {
    const d = invoiceItems(withDiscounts({ orderDiscount: 1501 }), []).discounts;
    expect(d.find((x) => x.id === 'adj:order')).toMatchObject({ amount: 1 });
  });

  it('a discount item on an invoice reads invoiced', () => {
    const inv = doc(1, [line({ kind: 'DISCOUNT', discountId: 'm:1', total: -1000 })]);
    const get = (docs: InvoiceDoc[]) =>
      invoiceItems(withDiscounts(), docs).discounts.find((x) => x.id === 'm:1')!.invoiced;
    expect(get([inv])).toBe(true);
    const cn = doc(2, [], { kind: 'CREDIT_NOTE', creditedInvoiceId: 1, creditType: 'CORRECTION' });
    expect(get([inv, cn])).toBe(false);
  });
});
