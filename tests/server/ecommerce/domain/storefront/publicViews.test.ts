import { describe, it, expect } from 'vitest';
import type { OrderQuote } from '../../../../../server/src/services/modules/ecommerce/orderPricing';
import type { OrderView } from '../../../../../server/src/services/modules/ecommerce/orders';
import type { CodeStatus } from '../../../../../server/src/services/modules/ecommerce/domain/promotions';
import {
  PUBLIC_CODE_STATUSES,
  codeStatusMessage,
  paymentResult,
  toPublicCodeStatus,
  toPublicOrderStatus,
  toPublicQuote,
  type OrderStatusSource,
  type PublicCodeStatus,
  type QuoteSource,
} from '../../../../../server/src/services/modules/ecommerce/domain/storefront/publicViews';

// Type tests: the service shapes stay assignable to the structural sources.
const _q: QuoteSource = {} as OrderQuote;
const _o: OrderStatusSource = {} as OrderView;
void _q;
void _o;

const ALL_CODE_STATUSES: CodeStatus[] = [
  'APPLIED',
  'NOT_FOUND',
  'INACTIVE',
  'SCHEDULED',
  'EXPIRED',
  'USAGE_LIMIT_REACHED',
  'CUSTOMER_LIMIT_REACHED',
  'EMAIL_NOT_ELIGIBLE',
  'EMAIL_NOT_VERIFIED',
  'CONDITIONS_NOT_MET',
  'CONFLICT',
  'NO_BENEFIT',
  'AWAITING_SHIPPING',
];

describe('toPublicCodeStatus (Review Focus 4)', () => {
  it('masks the statuses that reveal customer data or that a code exists', () => {
    expect(toPublicCodeStatus('CUSTOMER_LIMIT_REACHED')).toBe('NOT_ELIGIBLE');
    expect(toPublicCodeStatus('EMAIL_NOT_ELIGIBLE')).toBe('NOT_ELIGIBLE');
    expect(toPublicCodeStatus('INACTIVE')).toBe('NOT_FOUND');
    expect(toPublicCodeStatus('SCHEDULED')).toBe('NOT_FOUND');
    expect(toPublicCodeStatus('EXPIRED')).toBe('EXPIRED');
    expect(toPublicCodeStatus('EMAIL_NOT_VERIFIED')).toBe('EMAIL_NOT_VERIFIED');
  });

  it('keeps the others and reaches every public status', () => {
    for (const s of ['APPLIED', 'NOT_FOUND', 'USAGE_LIMIT_REACHED', 'CONDITIONS_NOT_MET', 'CONFLICT', 'NO_BENEFIT', 'AWAITING_SHIPPING'] as const) {
      expect(toPublicCodeStatus(s)).toBe(s);
    }
    const reached = new Set(ALL_CODE_STATUSES.map(toPublicCodeStatus));
    expect([...reached].sort()).toEqual([...PUBLIC_CODE_STATUSES].sort());
  });
});

describe('codeStatusMessage', () => {
  it('uses pt for pt-* and en otherwise', () => {
    expect(codeStatusMessage('CONFLICT', 'pt-PT')).toBe(
      'Este código não pode ser combinado com as promoções já aplicadas; mantivemos a melhor combinação para si.'
    );
    expect(codeStatusMessage('CONFLICT', 'pt')).toBe(codeStatusMessage('CONFLICT', 'pt-PT'));
    expect(codeStatusMessage('CONFLICT', 'fr')).toBe(
      'This code cannot be combined with the promotions already applied; we kept the best combination for you.'
    );
    expect(codeStatusMessage('EMAIL_NOT_VERIFIED', 'en')).toBe('Confirm your e-mail address to use this code.');
    expect(codeStatusMessage('EMAIL_NOT_VERIFIED', 'pt')).toBe('Confirme o seu endereço de e-mail para usar este código.');
    expect(codeStatusMessage('AWAITING_SHIPPING', 'en')).toBe('This code applies to shipping: choose a delivery method.');
    expect(codeStatusMessage('AWAITING_SHIPPING', 'pt-BR')).toBe('Este código aplica-se aos portes: escolha um método de entrega.');
  });

  it('has a distinct text per status in both languages', () => {
    for (const locale of ['en', 'pt']) {
      const texts = PUBLIC_CODE_STATUSES.map((s) => codeStatusMessage(s, locale));
      for (const t of texts) expect(t.length).toBeGreaterThan(5);
      expect(new Set(texts).size).toBe(PUBLIC_CODE_STATUSES.length);
    }
    for (const s of PUBLIC_CODE_STATUSES) expect(codeStatusMessage(s, 'pt')).not.toBe(codeStatusMessage(s, 'en'));
  });
});

const appliedPromotion = (over: Record<string, unknown>) => ({
  promotionId: 1,
  version: 3,
  name: 'Interno',
  displayName: { pt: 'Verão' } as Record<string, string>,
  code: 'CAMP-INT',
  method: 'AUTOMATIC' as const,
  classes: ['ORDER' as const],
  amount: 1000,
  benefits: [{ index: 0, type: 'ORDER_PERCENT', class: 'ORDER', amount: 1000, params: { stock: 5 } }],
  snapshot: { eligibility: {}, conditions: {}, stacking: {}, priority: 1, perOrderLimit: null },
  ...over,
});

const quote = (): OrderQuote =>
  ({
    lines: [
      {
        sourceIndex: 0,
        variantId: 10,
        productId: 100,
        sku: 'TSHIRT-M',
        name: 'T-shirt',
        option: 'M',
        imageUrl: '/uploads/t.jpg',
        unitPrice: 3000,
        unitDiscount: 0,
        quantity: 2,
        tax: 23,
        isGift: false,
        refs: [
          { promotionId: 1, benefitIndex: 0, amount: 600 },
          { promotionId: 1, benefitIndex: 1, amount: 0 },
          { promotionId: 2, benefitIndex: 0, amount: 0 },
        ],
      },
      {
        sourceIndex: 1,
        variantId: 11,
        productId: 101,
        sku: 'BOOK',
        name: 'Book',
        option: null,
        imageUrl: null,
        unitPrice: 2500,
        unitDiscount: 500,
        quantity: 2,
        tax: 6,
        isGift: false,
        refs: [],
      },
    ],
    promotions: [
      appliedPromotion({}),
      appliedPromotion({
        promotionId: 2,
        name: 'Admin label',
        displayName: { en: 'Welcome' },
        code: 'WELCOME',
        method: 'CODE',
        classes: ['PRODUCT'],
        amount: 0,
      }),
    ],
    codes: [
      { code: 'WELCOME', status: 'APPLIED', promotionId: 2 },
      { code: 'VIPONLY', status: 'CUSTOMER_LIMIT_REACHED', promotionId: 7 },
      { code: 'CAMP-INT', status: 'APPLIED', promotionId: 1 },
    ],
    rejected: [{ promotionId: 9, reason: 'CONDITIONS_NOT_MET' }],
    totals: {
      itemsOriginal: 11000,
      productDiscount: 1000,
      subtotal: 10000,
      orderDiscount: 1000,
      shippingOriginal: 499,
      shippingDiscount: 0,
      shippingTotal: 499,
      total: 9499,
      totalDiscount: 2000,
    },
    shippingOption: { providerId: 'ctt', serviceId: 'express', name: 'CTT Expresso', price: 499, tax: 23 },
    exhaustive: true,
    giftOptions: [
      {
        promotionId: 1,
        benefitIndex: 1,
        quantity: 1,
        selectedVariantId: 20,
        variants: [{ variantId: 20, sku: 'G', name: 'Gift', option: null, imageUrl: null, available: true }],
      },
    ],
  }) as unknown as OrderQuote;

describe('toPublicQuote', () => {
  const ctx = {
    locale: 'pt',
    defaultLocale: 'en',
    enteredCodes: ['welcome', 'VIPONLY'],
    shippingOptions: [{ providerId: 'ctt', serviceId: 'express', name: 'CTT Expresso', price: 499, estimatedDays: 2 }],
  };

  it('shows only the display name and hides the AUTOMATIC code (Review Focus 4)', () => {
    const pub = toPublicQuote(quote(), ctx);
    expect(pub.promotions[0]).toEqual({ promotionId: 1, name: 'Verão', code: null, amount: 1000, classes: ['ORDER'] });
    expect(pub.promotions[1]).toEqual({ promotionId: 2, name: 'Welcome', code: 'WELCOME', amount: 0, classes: ['PRODUCT'] });
    const json = JSON.stringify(pub);
    for (const leak of ['Interno', 'Admin label', 'CAMP-INT', 'snapshot', 'stock', 'rejected', 'version', 'benefits', 'refs', 'sourceIndex']) {
      expect(json).not.toContain(leak);
    }
  });

  it('projects lines, codes, gifts, totals and taxes', () => {
    const pub = toPublicQuote(quote(), ctx);
    expect(pub.lines).toEqual([
      {
        variantId: 10,
        productId: 100,
        sku: 'TSHIRT-M',
        name: 'T-shirt',
        option: 'M',
        imageUrl: '/uploads/t.jpg',
        unitPrice: 3000,
        unitDiscount: 0,
        quantity: 2,
        total: 6000,
        tax: 23,
        isGift: false,
        promotionIds: [1, 2],
      },
      {
        variantId: 11,
        productId: 101,
        sku: 'BOOK',
        name: 'Book',
        option: null,
        imageUrl: null,
        unitPrice: 2500,
        unitDiscount: 500,
        quantity: 2,
        total: 4000,
        tax: 6,
        isGift: false,
        promotionIds: [],
      },
    ]);
    expect(pub.codes).toEqual([
      { code: 'WELCOME', status: 'APPLIED', message: codeStatusMessage('APPLIED', 'pt') },
      { code: 'VIPONLY', status: 'NOT_ELIGIBLE', message: codeStatusMessage('NOT_ELIGIBLE', 'pt') },
    ]);
    expect(pub.giftOptions).toEqual(quote().giftOptions);
    expect(pub.giftOptions[0].benefitIndex).toBe(1);
    expect(pub.totals).toEqual(quote().totals);
    expect(pub.currency).toBe('EUR');
    expect(pub.taxes).toEqual([
      { rate: 6, base: 3396, vat: 204, gross: 3600 },
      { rate: 23, base: 4796, vat: 1103, gross: 5899 },
    ]);
    expect(pub.shippingOptions).toEqual(ctx.shippingOptions);
    expect(pub.selectedShipping).toEqual({
      providerId: 'ctt',
      serviceId: 'express',
      name: 'CTT Expresso',
      price: 499,
      estimatedDays: null,
    });
  });

  it('never shows the internal name: neutral label when displayName is empty (F1)', () => {
    const q = quote();
    (q.promotions as unknown as Record<string, unknown>[])[0] = appliedPromotion({ name: 'INTERNO-SECRETO', displayName: {} });
    (q.promotions as unknown as Record<string, unknown>[])[1] = appliedPromotion({
      promotionId: 2,
      name: 'SEGREDO-2',
      displayName: { de: 'Sommer', pt: '  ' },
      method: 'CODE',
      code: 'WELCOME',
    });
    const pt = toPublicQuote(q, { ...ctx, locale: 'pt-PT' });
    expect(pt.promotions.map((p) => p.name)).toEqual(['Promoção', 'Promoção']);
    const en = toPublicQuote(q, { ...ctx, locale: 'fr' });
    expect(en.promotions.map((p) => p.name)).toEqual(['Promotion', 'Promotion']);
    for (const json of [JSON.stringify(pt), JSON.stringify(en)]) {
      expect(json).not.toContain('INTERNO-SECRETO');
      expect(json).not.toContain('SEGREDO-2');
    }
  });

  it('builds totals field by field (F3)', () => {
    const q = quote();
    (q.totals as unknown as Record<string, unknown>).internalCost = 123;
    const pub = toPublicQuote(q, ctx);
    expect(pub.totals).not.toHaveProperty('internalCost');
    expect(Object.keys(pub.totals).sort()).toEqual(Object.keys(quote().totals).sort());
  });

  it('no shipping selected', () => {
    const q = { ...quote(), shippingOption: null, totals: { ...quote().totals, shippingTotal: null } };
    const pub = toPublicQuote(q, { ...ctx, shippingOptions: null });
    expect(pub.selectedShipping).toBeNull();
    expect(pub.shippingOptions).toBeNull();
    expect(pub.taxes.map((t) => t.gross)).toEqual([3600, 5400]);
  });
});

describe('paymentResult', () => {
  const base = { orderStatus: 'OPEN', paymentStatus: 'PENDING', due: 1000, hasPendingStripePayment: false };
  it('in order', () => {
    expect(paymentResult({ ...base, orderStatus: 'CANCELLED', due: 0 })).toBe('CANCELLED');
    expect(paymentResult({ ...base, due: 0, hasPendingStripePayment: true })).toBe('PAID');
    expect(paymentResult({ ...base, due: -5 })).toBe('PAID');
    expect(paymentResult({ ...base, hasPendingStripePayment: true })).toBe('PROCESSING');
    expect(paymentResult(base)).toBe('UNPAID');
  });
});

const orderView = (): OrderView =>
  ({
    id: 55,
    reference: 1001,
    publicId: 'ord_abc',
    locale: 'pt',
    source: 'STOREFRONT',
    orderStatus: 'OPEN',
    paymentStatus: 'PENDING',
    fulfillmentStatus: 'UNFULFILLED',
    createdAt: '2026-11-11T10:00:00.000Z',
    cancelledAt: null,
    archivedAt: null,
    customer: { id: 9, email: 'ana@x.pt', name: 'Ana' },
    shippingAddress: { line1: 'Rua A', city: 'Lisboa' },
    billingAddress: { line1: 'Rua B', city: 'Porto' },
    shippingMethod: { providerId: 'ctt', serviceId: 'express', name: 'CTT Expresso', price: 499, tax: 23 },
    notes: 'internal note',
    totals: {
      itemsOriginal: 6000,
      productDiscount: 0,
      subtotal: 6000,
      orderDiscount: 1000,
      shippingOriginal: 499,
      shippingDiscount: 0,
      shippingTotal: 499,
      total: 5499,
    },
    lines: [
      {
        id: 77,
        variantId: 10,
        productId: 100,
        sku: 'TSHIRT-M',
        name: 'T-shirt',
        option: 'M',
        imageUrl: null,
        unitPrice: 3000,
        unitDiscount: 0,
        quantity: 2,
        returnedQuantity: 0,
        tax: 23,
        isGift: false,
        promotionIds: [1],
        shipped: 0,
        reserved: 0,
        pending: 2,
        returnable: 0,
      },
    ],
    payments: [{ id: 3, stripePaymentIntentId: 'pi_x' }],
    refunds: [],
    notificationsSummary: { sent: 1, failed: 0, skipped: 0 },
    invoices: [],
    billing: { active: false, providerId: null },
    shipments: [],
    returns: [],
    shipping: { remainingCost: 0, deliveryStatus: 'PENDING' },
    promotions: [{ ...appliedPromotion({}), redemptionStatus: 'RESERVED' }],
    promotionCodes: [{ code: 'CAMP-INT', status: 'APPLIED', promotionId: 1 }],
    summary: { orderTotal: 5499, total: 5499, paid: 1000, pendingPayments: 0, refunded: 0, net: 1000, due: 4499, excess: 0, overRefunded: 0 },
    availableActions: ['cancel'],
    history: [{ action: 'CREATED' }],
  }) as unknown as OrderView;

describe('toPublicOrderStatus', () => {
  it('projects only public fields', () => {
    const pub = toPublicOrderStatus(orderView(), { defaultLocale: 'en', hasPendingStripePayment: true });
    expect(pub).toEqual({
      publicId: 'ord_abc',
      reference: '#1001',
      createdAt: '2026-11-11T10:00:00.000Z',
      locale: 'pt',
      orderStatus: 'OPEN',
      paymentStatus: 'PENDING',
      paymentResult: 'PROCESSING',
      currency: 'EUR',
      totals: {
        itemsOriginal: 6000,
        productDiscount: 0,
        subtotal: 6000,
        orderDiscount: 1000,
        shippingTotal: 499,
        total: 5499,
        paid: 1000,
        due: 4499,
      },
      lines: [
        { name: 'T-shirt', option: 'M', sku: 'TSHIRT-M', quantity: 2, unitPrice: 3000, unitDiscount: 0, total: 6000, isGift: false },
      ],
      promotions: [{ name: 'Verão', amount: 1000 }],
      shipping: { name: 'CTT Expresso' },
    });
    for (const k of ['customer', 'history', 'payments', 'id', 'shippingAddress', 'billingAddress', 'notes', 'summary']) {
      expect(pub).not.toHaveProperty(k);
    }
    const json = JSON.stringify(pub);
    for (const leak of ['Interno', 'CAMP-INT', 'snapshot', 'ana@x.pt', 'Rua', 'pi_x', '"id"', 'internal note']) {
      expect(json).not.toContain(leak);
    }
  });

  it('never shows the internal name on the order status (F1)', () => {
    const view = {
      ...orderView(),
      promotions: [{ ...appliedPromotion({ name: 'INTERNO-SECRETO', displayName: {} }), redemptionStatus: 'RESERVED' }],
    } as unknown as OrderView;
    const pub = toPublicOrderStatus(view, { defaultLocale: 'en', hasPendingStripePayment: false });
    expect(pub.promotions).toEqual([{ name: 'Promoção', amount: 1000 }]);
    const en = toPublicOrderStatus({ ...view, locale: 'en' } as OrderView, { defaultLocale: 'pt', hasPendingStripePayment: false });
    expect(en.promotions).toEqual([{ name: 'Promotion', amount: 1000 }]);
    expect(JSON.stringify(pub) + JSON.stringify(en)).not.toContain('INTERNO-SECRETO');
  });

  it('falls back to the default locale name and handles no shipping / cancelled', () => {
    const view = {
      ...orderView(),
      locale: 'fr',
      orderStatus: 'CANCELLED',
      shippingMethod: null,
      promotions: [{ ...appliedPromotion({ displayName: { en: 'Summer' } }), redemptionStatus: 'RELEASED' }],
    } as unknown as OrderView;
    const pub = toPublicOrderStatus(view, { defaultLocale: 'en', hasPendingStripePayment: false });
    expect(pub.promotions).toEqual([{ name: 'Summer', amount: 1000 }]);
    expect(pub.shipping).toBeNull();
    expect(pub.paymentResult).toBe('CANCELLED');
  });
});

const _statusTypeCheck: PublicCodeStatus = 'NOT_ELIGIBLE';
void _statusTypeCheck;
