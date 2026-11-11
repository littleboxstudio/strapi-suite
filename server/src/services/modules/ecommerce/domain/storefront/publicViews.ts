/**
 * Public projections of quotes and orders for the storefront API. Only display names and
 * amounts of promotions (never the internal name, the code of an AUTOMATIC promotion or the
 * snapshot), no addresses, e-mail, internal ids or stock counts.
 *
 * The domain does not import service files: QuoteSource and OrderStatusSource are the
 * structural subsets of OrderQuote and OrderView used here (a type test keeps them assignable).
 */
import { displayNameFor, type AppliedPromotion, type CodeStatus } from '../promotions';
import { quoteVatItems, vatBreakdown, type VatRow } from './tax';

export const PUBLIC_CODE_STATUSES = [
  'APPLIED',
  'NOT_FOUND',
  'NOT_ELIGIBLE',
  'EMAIL_NOT_VERIFIED',
  'EXPIRED',
  'USAGE_LIMIT_REACHED',
  'CONDITIONS_NOT_MET',
  'CONFLICT',
  'NO_BENEFIT',
  'AWAITING_SHIPPING',
] as const;
export type PublicCodeStatus = (typeof PUBLIC_CODE_STATUSES)[number];

/**
 * CUSTOMER_LIMIT_REACHED / EMAIL_NOT_ELIGIBLE → NOT_ELIGIBLE (do not reveal whether an e-mail
 * already bought or is on a list); INACTIVE / SCHEDULED → NOT_FOUND (do not confirm the code
 * exists). The switch is exhaustive over CodeStatus.
 */
export const toPublicCodeStatus = (s: CodeStatus): PublicCodeStatus => {
  switch (s) {
    case 'CUSTOMER_LIMIT_REACHED':
    case 'EMAIL_NOT_ELIGIBLE':
      return 'NOT_ELIGIBLE';
    case 'INACTIVE':
    case 'SCHEDULED':
      return 'NOT_FOUND';
    case 'APPLIED':
    case 'NOT_FOUND':
    case 'EMAIL_NOT_VERIFIED':
    case 'EXPIRED':
    case 'USAGE_LIMIT_REACHED':
    case 'CONDITIONS_NOT_MET':
    case 'CONFLICT':
    case 'NO_BENEFIT':
    case 'AWAITING_SHIPPING':
      return s;
    default: {
      const never: never = s;
      return never;
    }
  }
};

const CODE_STATUS_MESSAGES: Record<'en' | 'pt', Record<PublicCodeStatus, string>> = {
  en: {
    APPLIED: 'Code applied.',
    NOT_FOUND: 'This code does not exist.',
    NOT_ELIGIBLE: 'This code is not available for this order.',
    EMAIL_NOT_VERIFIED: 'Confirm your e-mail address to use this code.',
    EXPIRED: 'This code has expired.',
    USAGE_LIMIT_REACHED: 'This code has reached its usage limit.',
    CONDITIONS_NOT_MET: 'Your cart does not meet the conditions of this code yet.',
    CONFLICT:
      'This code cannot be combined with the promotions already applied; we kept the best combination for you.',
    NO_BENEFIT: 'This code gives no discount on your current cart.',
    AWAITING_SHIPPING: 'This code applies to shipping: choose a delivery method.',
  },
  pt: {
    APPLIED: 'Código aplicado.',
    NOT_FOUND: 'Este código não existe.',
    NOT_ELIGIBLE: 'Este código não está disponível para esta encomenda.',
    EMAIL_NOT_VERIFIED: 'Confirme o seu endereço de e-mail para usar este código.',
    EXPIRED: 'Este código expirou.',
    USAGE_LIMIT_REACHED: 'Este código atingiu o limite de utilizações.',
    CONDITIONS_NOT_MET: 'O seu carrinho ainda não cumpre as condições deste código.',
    CONFLICT:
      'Este código não pode ser combinado com as promoções já aplicadas; mantivemos a melhor combinação para si.',
    NO_BENEFIT: 'Este código não dá desconto no seu carrinho atual.',
    AWAITING_SHIPPING: 'Este código aplica-se aos portes: escolha um método de entrega.',
  },
};

const messageLanguage = (locale: string): 'en' | 'pt' => {
  const l = typeof locale === 'string' ? locale.toLowerCase() : '';
  return l === 'pt' || l.startsWith('pt-') ? 'pt' : 'en';
};

export const codeStatusMessage = (status: PublicCodeStatus, locale: string): string =>
  CODE_STATUS_MESSAGES[messageLanguage(locale)][status];

type PromotionSource = Pick<
  AppliedPromotion,
  'promotionId' | 'name' | 'displayName' | 'code' | 'method' | 'classes' | 'amount'
>;

/** Structural subset of OrderQuote (orderPricing.ts). */
export type QuoteSource = {
  lines: {
    variantId: number;
    productId: number;
    sku: string;
    name: string;
    option: string | null;
    imageUrl: string | null;
    unitPrice: number;
    unitDiscount: number;
    quantity: number;
    tax: number;
    isGift: boolean;
    refs: { promotionId: number }[];
  }[];
  promotions: PromotionSource[];
  codes: { code: string; status: CodeStatus }[];
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    shippingOriginal: number | null;
    shippingDiscount: number;
    shippingTotal: number | null;
    total: number;
    totalDiscount: number;
  };
  shippingOption: {
    providerId: string;
    serviceId: string;
    name: string;
    price: number;
    tax: number;
    estimatedDays?: number;
  } | null;
  giftOptions: {
    promotionId: number;
    benefitIndex: number;
    quantity: number;
    selectedVariantId: number | null;
    variants: {
      variantId: number;
      sku: string;
      name: string;
      option: string | null;
      imageUrl: string | null;
      available: boolean;
    }[];
  }[];
};

export type PublicShippingOption = {
  providerId: string;
  serviceId: string;
  name: string;
  price: number;
  estimatedDays: number | null;
};

export type PublicQuoteLine = {
  variantId: number;
  productId: number;
  sku: string;
  name: string;
  option: string | null;
  imageUrl: string | null;
  unitPrice: number;
  unitDiscount: number;
  quantity: number;
  total: number;
  tax: number;
  isGift: boolean;
  promotionIds: number[];
};

export type PublicGiftOption = QuoteSource['giftOptions'][number];

export type PublicQuote = {
  lines: PublicQuoteLine[];
  promotions: {
    promotionId: number;
    name: string;
    code: string | null;
    amount: number;
    classes: PromotionSource['classes'];
  }[];
  codes: { code: string; status: PublicCodeStatus; message: string }[];
  giftOptions: PublicGiftOption[];
  totals: QuoteSource['totals'];
  taxes: VatRow[];
  currency: 'EUR';
  shippingOptions: PublicShippingOption[] | null;
  selectedShipping: PublicShippingOption | null;
};

const normalizeCode = (raw: string): string => (typeof raw === 'string' ? raw.trim().toUpperCase() : '');

export const toPublicQuote = (
  q: QuoteSource,
  ctx: {
    locale: string;
    defaultLocale: string;
    enteredCodes: string[];
    shippingOptions: PublicShippingOption[] | null;
  }
): PublicQuote => {
  const entered = new Set(ctx.enteredCodes.map(normalizeCode));
  const lines = q.lines.map((l) => ({
    variantId: l.variantId,
    productId: l.productId,
    sku: l.sku,
    name: l.name,
    option: l.option,
    imageUrl: l.imageUrl,
    unitPrice: l.unitPrice,
    unitDiscount: l.unitDiscount,
    quantity: l.quantity,
    total: (l.unitPrice - l.unitDiscount) * l.quantity,
    tax: l.tax,
    isGift: l.isGift,
    promotionIds: [...new Set(l.refs.map((r) => r.promotionId))],
  }));
  const shippingTax = q.shippingOption ? q.shippingOption.tax : null;
  return {
    lines,
    promotions: q.promotions.map((p) => ({
      promotionId: p.promotionId,
      name: displayNameFor(p, ctx.locale, ctx.defaultLocale),
      code: p.method === 'CODE' ? p.code : null,
      amount: p.amount,
      classes: [...p.classes],
    })),
    codes: q.codes
      .filter((c) => entered.has(normalizeCode(c.code)))
      .map((c) => {
        const status = toPublicCodeStatus(c.status);
        return { code: c.code, status, message: codeStatusMessage(status, ctx.locale) };
      }),
    giftOptions: q.giftOptions.map((g) => ({
      promotionId: g.promotionId,
      benefitIndex: g.benefitIndex,
      quantity: g.quantity,
      selectedVariantId: g.selectedVariantId,
      variants: g.variants.map((v) => ({
        variantId: v.variantId,
        sku: v.sku,
        name: v.name,
        option: v.option,
        imageUrl: v.imageUrl,
        available: v.available,
      })),
    })),
    totals: { ...q.totals },
    taxes: vatBreakdown(
      quoteVatItems({
        lines: q.lines,
        orderDiscount: q.totals.orderDiscount,
        shippingTotal: q.totals.shippingTotal,
        shippingTax,
      })
    ),
    currency: 'EUR',
    shippingOptions: ctx.shippingOptions,
    selectedShipping: q.shippingOption
      ? {
          providerId: q.shippingOption.providerId,
          serviceId: q.shippingOption.serviceId,
          name: q.shippingOption.name,
          price: q.shippingOption.price,
          estimatedDays: q.shippingOption.estimatedDays ?? null,
        }
      : null,
  };
};

export type PaymentResult = 'PAID' | 'PROCESSING' | 'UNPAID' | 'CANCELLED';

/**
 * In order: cancelled → CANCELLED; nothing due → PAID; a Stripe payment PENDING whose
 * Checkout Session is COMPLETE (e.g. Multibanco awaiting confirmation) → PROCESSING; else UNPAID.
 */
export const paymentResult = (o: {
  orderStatus: string;
  paymentStatus: string;
  due: number;
  hasPendingStripePayment: boolean;
}): PaymentResult => {
  if (o.orderStatus === 'CANCELLED') return 'CANCELLED';
  if (o.due <= 0) return 'PAID';
  if (o.hasPendingStripePayment) return 'PROCESSING';
  return 'UNPAID';
};

/** Structural subset of OrderView (orders.ts). */
export type OrderStatusSource = {
  publicId: string;
  reference: number;
  createdAt: string;
  locale: string;
  orderStatus: string;
  paymentStatus: string;
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    shippingTotal: number;
    total: number;
  };
  summary: { paid: number; due: number };
  lines: {
    name: string;
    option: string | null;
    sku: string;
    quantity: number;
    unitPrice: number;
    unitDiscount: number;
    isGift: boolean;
  }[];
  promotions: Pick<AppliedPromotion, 'name' | 'displayName' | 'amount'>[];
  shippingMethod: Record<string, unknown> | null;
};

export type PublicOrderStatus = {
  publicId: string;
  reference: string;
  createdAt: string;
  locale: string;
  orderStatus: string;
  paymentStatus: string;
  paymentResult: PaymentResult;
  currency: 'EUR';
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    shippingTotal: number;
    total: number;
    paid: number;
    due: number;
  };
  lines: {
    name: string;
    option: string | null;
    sku: string;
    quantity: number;
    unitPrice: number;
    unitDiscount: number;
    total: number;
    isGift: boolean;
  }[];
  promotions: { name: string; amount: number }[];
  shipping: { name: string } | null;
};

export const toPublicOrderStatus = (
  view: OrderStatusSource,
  ctx: { defaultLocale: string; hasPendingStripePayment: boolean }
): PublicOrderStatus => {
  const shippingName = view.shippingMethod?.name;
  return {
    publicId: view.publicId,
    reference: `#${view.reference}`,
    createdAt: view.createdAt,
    locale: view.locale,
    orderStatus: view.orderStatus,
    paymentStatus: view.paymentStatus,
    paymentResult: paymentResult({
      orderStatus: view.orderStatus,
      paymentStatus: view.paymentStatus,
      due: view.summary.due,
      hasPendingStripePayment: ctx.hasPendingStripePayment,
    }),
    currency: 'EUR',
    totals: {
      itemsOriginal: view.totals.itemsOriginal,
      productDiscount: view.totals.productDiscount,
      subtotal: view.totals.subtotal,
      orderDiscount: view.totals.orderDiscount,
      shippingTotal: view.totals.shippingTotal,
      total: view.totals.total,
      paid: view.summary.paid,
      due: view.summary.due,
    },
    lines: view.lines.map((l) => ({
      name: l.name,
      option: l.option,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      unitDiscount: l.unitDiscount,
      total: (l.unitPrice - l.unitDiscount) * l.quantity,
      isGift: l.isGift,
    })),
    promotions: view.promotions.map((p) => ({
      name: displayNameFor(p, view.locale, ctx.defaultLocale),
      amount: p.amount,
    })),
    shipping: typeof shippingName === 'string' && shippingName !== '' ? { name: shippingName } : null,
  };
};
