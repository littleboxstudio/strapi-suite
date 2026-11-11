import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { storeCreditUsable, toPublicStoreCreditError } from './domain/storeCredit';
import {
  normalizePromotionCode,
  promotionStatus,
  type AppliedPromotion,
  type CodeStatus,
} from './domain/promotions';
import {
  codeStatusMessage,
  toPublicOrderStatus,
  toPublicQuote,
  type OrderStatusSource,
  type PublicCodeStatus,
  type PublicOrderStatus,
  type PublicQuote,
  type PublicShippingOption,
  type QuoteSource,
} from './domain/storefront/publicViews';
import { EcommerceNotFoundError, EcommerceValidationError, type ValidationIssue } from './errors';
import { isRecord } from './orderPricingHelpers';
import type { Address, PaymentStatus } from './domain/orders';
import type { CreatedOrder, OrderQuote, OrderState } from './orders';
import {
  MAX_CART_GIFT_CHOICES,
  MAX_CART_LINES,
  MAX_EMAIL_LENGTH,
  MAX_LINE_QUANTITY,
  MAX_LOCALE_LENGTH,
  MAX_POSTAL_CODE_LENGTH,
  MAX_PROMOTION_CODES,
  MAX_PROMOTION_CODE_LENGTH,
  MAX_SHIPPING_ID_LENGTH,
  MAX_STORE_CREDIT_CODE_LENGTH,
  MAX_STOREFRONT_IDEMPOTENCY_KEY_LENGTH,
} from './domain/storefront/limits';
import type { ShippingOption } from './shipping';
import { normalizeStoreCreditCode } from './storeCredits';
import type { CheckoutSession, StoredCart } from './storefrontSessions';

/** The cart as the BFF sends it (the controller validates the shape, Task 10). */
export type StorefrontCartInput = {
  lines: { variantId: number; quantity: number }[];
  locale: string;
  email?: string | null;
  promotionCodes?: string[];
  giftChoices?: Record<string, number>;
  destination?: { country: string; postalCode?: string } | null;
  shippingMethod?: { providerId: string; serviceId: string } | null;
};

export type StorefrontOrderInput = {
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: Address;
  /** Null or absent = the shipping address. */
  billingAddress?: Address | null;
  locale: string;
  lines: { variantId: number; quantity: number }[];
  shippingMethod: { providerId: string; serviceId: string };
  promotionCodes?: string[];
  giftChoices?: Record<string, number>;
  /** The total the customer was shown (cents); required. */
  expectedTotal: number;
  storeCreditCode?: string;
  notes?: string;
};

export type ApplyDiscountResult = {
  code: string;
  status: PublicCodeStatus;
  message: string;
  applied: boolean;
  quote: PublicQuote;
};

export type PlacedOrder = {
  publicId: string;
  reference: string;
  total: number;
  due: number;
  paymentStatus: PaymentStatus;
};

export type StorefrontPaymentLink = {
  url: string;
  expiresAt: string;
  amount: number;
  reused: boolean;
};

const LOG_PREFIX = '[ecommerce:storefront]';

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const boundedString = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};
const positiveInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max;

const invalid = (errors: ValidationIssue[]) =>
  new EcommerceValidationError('Invalid request', errors);

/** 0–100 lines with integer ids and quantities in [1, MAX_LINE_QUANTITY] (cart and order alike). */
const cartLines = (raw: unknown, errors: ValidationIssue[]): StoredCart['lines'] => {
  const lines: StoredCart['lines'] = [];
  if (!Array.isArray(raw)) errors.push({ path: 'lines', code: 'invalid' });
  else if (raw.length > MAX_CART_LINES) errors.push({ path: 'lines', code: 'too_many' });
  else {
    raw.forEach((l: unknown, i: number) => {
      const line = isRecord(l) ? l : {};
      if (!positiveInt(line.variantId)) {
        errors.push({ path: `lines.${i}.variantId`, code: 'invalid' });
      } else if (!positiveInt(line.quantity, MAX_LINE_QUANTITY)) {
        errors.push({ path: `lines.${i}.quantity`, code: 'invalid' });
      } else lines.push({ variantId: line.variantId as number, quantity: line.quantity as number });
    });
  }
  return lines;
};

/**
 * Validates and bounds a cart before it is stored or priced: 0–100 lines with integer ids and
 * quantities in [1, 1000], at most 5 codes of ≤ 40 characters (normalised, without duplicates),
 * at most 10 gift choices, and known shapes for the destination and shipping method.
 */
const toCart = (input: unknown): StoredCart => {
  const c = isRecord(input) ? input : {};
  const errors: ValidationIssue[] = [];

  const lines = cartLines(c.lines, errors);

  const locale = boundedString(c.locale, MAX_LOCALE_LENGTH);
  if (!locale) errors.push({ path: 'locale', code: 'required' });

  const promotionCodes: string[] = [];
  if (c.promotionCodes !== undefined && c.promotionCodes !== null) {
    if (!Array.isArray(c.promotionCodes)) errors.push({ path: 'promotionCodes', code: 'invalid' });
    else if (c.promotionCodes.length > MAX_PROMOTION_CODES) {
      errors.push({ path: 'promotionCodes', code: 'too_many' });
    } else {
      c.promotionCodes.forEach((raw: unknown, i: number) => {
        const code = normalizePromotionCode(raw);
        if (typeof raw !== 'string' || code.length > MAX_PROMOTION_CODE_LENGTH) {
          errors.push({ path: `promotionCodes.${i}`, code: 'invalid' });
        } else if (code && !promotionCodes.includes(code)) promotionCodes.push(code);
      });
    }
  }

  const giftChoices: Record<string, number> = {};
  if (c.giftChoices !== undefined && c.giftChoices !== null) {
    if (!isRecord(c.giftChoices)) errors.push({ path: 'giftChoices', code: 'invalid' });
    else {
      const entries = Object.entries(c.giftChoices);
      if (entries.length > MAX_CART_GIFT_CHOICES)
        errors.push({ path: 'giftChoices', code: 'too_many' });
      else {
        for (const [key, value] of entries) {
          if (!/^[1-9]\d{0,14}$/.test(key) || !positiveInt(value)) {
            errors.push({ path: `giftChoices.${key}`, code: 'invalid' });
          } else giftChoices[key] = value as number;
        }
      }
    }
  }

  let email: string | null = null;
  if (c.email !== undefined && c.email !== null) {
    if (typeof c.email !== 'string' || c.email.trim().length > MAX_EMAIL_LENGTH) {
      errors.push({ path: 'email', code: 'invalid_email' });
    } else email = c.email.trim() || null;
  }

  let destination: StoredCart['destination'] = null;
  if (c.destination !== undefined && c.destination !== null) {
    const d = isRecord(c.destination) ? c.destination : null;
    const country = typeof d?.country === 'string' ? d.country.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(country))
      errors.push({ path: 'destination.country', code: 'invalid_country' });
    let postalCode: string | undefined;
    if (d && d.postalCode !== undefined && d.postalCode !== null && d.postalCode !== '') {
      const p = boundedString(d.postalCode, MAX_POSTAL_CODE_LENGTH);
      if (p === null) errors.push({ path: 'destination.postalCode', code: 'invalid' });
      else postalCode = p;
    }
    destination = { country, ...(postalCode ? { postalCode } : {}) };
  }

  let shippingMethod: StoredCart['shippingMethod'] = null;
  if (c.shippingMethod !== undefined && c.shippingMethod !== null) {
    const m = isRecord(c.shippingMethod) ? c.shippingMethod : {};
    const providerId = boundedString(m.providerId, MAX_SHIPPING_ID_LENGTH);
    const serviceId = boundedString(m.serviceId, MAX_SHIPPING_ID_LENGTH);
    if (!providerId || !serviceId) errors.push({ path: 'shippingMethod', code: 'invalid' });
    else shippingMethod = { providerId, serviceId };
  }

  if (errors.length) throw invalid(errors);
  return {
    lines,
    promotionCodes,
    giftChoices,
    email,
    destination,
    shippingMethod,
    locale,
  };
};

const EMPTY_QUOTE_SOURCE: QuoteSource = {
  lines: [],
  promotions: [],
  codes: [],
  totals: {
    itemsOriginal: 0,
    productDiscount: 0,
    subtotal: 0,
    orderDiscount: 0,
    shippingOriginal: null,
    shippingDiscount: 0,
    shippingTotal: null,
    total: 0,
    totalDiscount: 0,
  },
  shippingOption: null,
  giftOptions: [],
};

const toPublicShippingOption = (o: ShippingOption): PublicShippingOption => ({
  providerId: o.providerId,
  serviceId: o.serviceId,
  name: o.name,
  price: o.price,
  estimatedDays: o.estimatedDays ?? null,
});

const appliedOf = (order: any): AppliedPromotion[] =>
  isRecord(order?.promotions) && Array.isArray(order.promotions.applied)
    ? order.promotions.applied.filter(isRecord)
    : [];

/** A validation issue plus, for a refused promotion, its raw reason (never sent as is). */
export type StorefrontIssue = ValidationIssue & { reason?: CodeStatus };

/** Refusals of a store credit from `create` (path `code`) on the storefront path, masked. */
const toStorefrontIssues = (errors: ValidationIssue[]): ValidationIssue[] =>
  errors.map((e) =>
    typeof e.code === 'string' && e.code.startsWith('STORE_CREDIT_')
      ? { path: 'storeCreditCode', code: toPublicStoreCreditError(e.code) }
      : e
  );

/**
 * Storefront checkout (plan 7): quotes and discount codes over the session's server-side cart,
 * store credit checks, order creation, Stripe payment links and the public order status.
 * Every response is a public view: no internal ids, names, snapshots or stock counts.
 */
const EcommerceStorefrontCheckoutService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    quote(input: Record<string, unknown>): Promise<OrderQuote>;
    quoteForLines(input: Record<string, unknown>): Promise<{ options: ShippingOption[] }>;
    create(
      input: Record<string, unknown>,
      ctx: { actor: string; source: 'storefront'; checkoutSessionId: number }
    ): Promise<CreatedOrder>;
    computeOrderState(orderId: number): Promise<OrderState>;
  } => service('EcommerceOrderService');
  const sessions = () => service('EcommerceStorefrontSessionService');
  const getDefaultLocale = async (): Promise<string> =>
    strapi.plugin('i18n').service('locales').getDefaultLocale();

  /** Prices a validated cart without writing anything. An empty cart never reaches the order service. */
  const price = async (s: CheckoutSession, cart: StoredCart): Promise<PublicQuote> => {
    const locale = cart.locale as string;
    const defaultLocale = await getDefaultLocale();
    if (cart.lines.length === 0) {
      return toPublicQuote(EMPTY_QUOTE_SOURCE, {
        locale,
        defaultLocale,
        enteredCodes: [],
        shippingOptions: null,
      });
    }
    const { destination, shippingMethod, email } = cart;
    const shippingOptions = destination
      ? (
          await orders().quoteForLines({
            country: destination.country,
            postalCode: destination.postalCode,
            lines: cart.lines,
            locale,
          })
        ).options.map(toPublicShippingOption)
      : null;
    const quote = await orders().quote({
      lines: cart.lines,
      locale,
      email,
      promotionCodes: cart.promotionCodes,
      giftChoices: cart.giftChoices,
      shipping: destination && shippingMethod ? { ...destination, ...shippingMethod } : null,
      // Only the session says whether the e-mail is verified, never the request.
      emailVerified: email ? sessions().isEmailVerified(s, email) : false,
    });
    return toPublicQuote(quote, {
      locale,
      defaultLocale,
      enteredCodes: cart.promotionCodes,
      shippingOptions,
    });
  };

  /** Saves the cart first (the BFF reads it back with GET /cart even if pricing fails), then prices it. */
  const quote = async (s: CheckoutSession, input: StorefrontCartInput): Promise<PublicQuote> => {
    const cart = toCart(input);
    await sessions().saveCart(s.id, cart);
    return price(s, cart);
  };

  /**
   * Requirement 1.6: prices the cart with the code added, through the same engine, without
   * reserving anything. The cart (with the code) is saved only when the code applied.
   */
  const applyDiscount = async (
    s: CheckoutSession,
    input: StorefrontCartInput & { code: unknown }
  ): Promise<ApplyDiscountResult> => {
    if (typeof input?.code !== 'string') throw invalid([{ path: 'code', code: 'invalid' }]);
    const code = normalizePromotionCode(input.code);
    if (!code) throw invalid([{ path: 'code', code: 'required' }]);
    if (code.length > MAX_PROMOTION_CODE_LENGTH)
      throw invalid([{ path: 'code', code: 'too_long' }]);
    const base = toCart(input);
    const promotionCodes = base.promotionCodes.includes(code)
      ? base.promotionCodes
      : [...base.promotionCodes, code];
    if (promotionCodes.length > MAX_PROMOTION_CODES) {
      throw invalid([{ path: 'promotionCodes', code: 'too_many' }]);
    }
    const cart: StoredCart = { ...base, promotionCodes };
    const locale = cart.locale as string;

    if (cart.lines.length === 0) {
      // Nothing to evaluate: the same answer for every code (existence is never revealed).
      const status: PublicCodeStatus = 'CONDITIONS_NOT_MET';
      return {
        code,
        status,
        message: codeStatusMessage(status, locale),
        applied: false,
        quote: await price(s, cart),
      };
    }

    const priced = await price(s, cart);
    const status: PublicCodeStatus =
      priced.codes.find((c) => normalizePromotionCode(c.code) === code)?.status ?? 'NOT_FOUND';
    const applied = status === 'APPLIED';
    // A shipping code waits for a delivery method: keep it so it applies once one is chosen.
    if (applied || status === 'AWAITING_SHIPPING') await sessions().saveCart(s.id, cart);
    return { code, status, message: codeStatusMessage(status, locale), applied, quote: priced };
  };

  /** Balance of a store credit for an e-mail. Any refusal → `code` with the public code. */
  const checkStoreCredit = async (input: {
    code: unknown;
    email: unknown;
  }): Promise<{ balance: number; expiresAt: string | null }> => {
    const refuse = (c: string) => invalid([{ path: 'code', code: toPublicStoreCreditError(c) }]);
    const email = boundedString(input?.email, MAX_EMAIL_LENGTH);
    if (!email) throw invalid([{ path: 'email', code: 'invalid_email' }]);
    const code = typeof input?.code === 'string' ? normalizeStoreCreditCode(input.code) : '';
    const credit =
      code && code.length <= MAX_STORE_CREDIT_CODE_LENGTH
        ? await strapi.db.query(uids().storeCredit).findOne({ where: { code } })
        : null;
    if (!credit) throw refuse('STORE_CREDIT_NOT_FOUND');
    const usable = storeCreditUsable(
      {
        status: credit.status,
        balance: num(credit.balance),
        expiresAt: credit.expiresAt ?? null,
        emailNormalized: credit.emailNormalized ?? '',
      },
      email,
      new Date()
    );
    if ('code' in usable) throw refuse(usable.code);
    return { balance: num(credit.balance), expiresAt: isoOrNull(credit.expiresAt) };
  };

  /**
   * Why a promotion refused the order: the order service reports only `PROMOTION_UNAVAILABLE`
   * on `promotions.<id>` (global or per-customer limit, or no longer active). Read after the
   * rollback, so the counters are those the order met. Internal: `storefrontErrors.ts` turns it
   * into the public status (only a reached global limit stays a 409).
   */
  const refusalReason = async (
    promotionId: number,
    emailVerified: boolean
  ): Promise<{ reason: CodeStatus; automatic: boolean }> => {
    try {
      const row = await strapi.db.query(uids().promotion).findOne({
        where: { id: promotionId },
        select: [
          'id',
          'method',
          'active',
          'startsAt',
          'endsAt',
          'usageLimit',
          'redemptions',
          'perCustomerLimit',
        ],
      });
      // Unknown method (row gone): treated as automatic, so no entered code is confirmed.
      if (!row) return { reason: 'INACTIVE', automatic: true };
      const automatic = row.method !== 'CODE';
      const status = promotionStatus(
        {
          active: row.active === true,
          startsAt: isoOrNull(row.startsAt) ?? '',
          endsAt: isoOrNull(row.endsAt),
        },
        new Date()
      );
      if (status !== 'ACTIVE') return { reason: status, automatic };
      if (row.usageLimit !== null && row.usageLimit !== undefined) {
        if (num(row.redemptions) >= num(row.usageLimit)) {
          return { reason: 'USAGE_LIMIT_REACHED', automatic };
        }
      }
      // A per-customer refusal needs a per-customer limit and a verified e-mail (the engine
      // never evaluates it otherwise); anything else is a global-capacity race.
      const perCustomer =
        row.perCustomerLimit !== null && row.perCustomerLimit !== undefined && emailVerified;
      return { reason: perCustomer ? 'CUSTOMER_LIMIT_REACHED' : 'USAGE_LIMIT_REACHED', automatic };
    } catch (err) {
      strapi.log.warn(
        `${LOG_PREFIX} promotion refusal lookup failed: ${(err as Error)?.message ?? 'unknown error'}`
      );
      return { reason: 'USAGE_LIMIT_REACHED', automatic: false };
    }
  };

  /**
   * Adds the internal reason to each `PROMOTION_UNAVAILABLE`. For an automatic promotion the
   * detail (its admin code) is dropped, so the refusal is never attached to an entered code.
   */
  const withRefusalReasons = (
    errors: ValidationIssue[],
    emailVerified: boolean
  ): Promise<StorefrontIssue[]> =>
    Promise.all(
      errors.map(async (e): Promise<StorefrontIssue> => {
        const m = e.code === 'PROMOTION_UNAVAILABLE' ? /^promotions\.(\d+)$/.exec(e.path) : null;
        if (!m) return e;
        const { reason, automatic } = await refusalReason(Number(m[1]), emailVerified);
        return automatic ? { path: e.path, code: e.code, reason } : { ...e, reason };
      })
    );

  /** The session must still be ACTIVE and unexpired right before the order is created. */
  const assertSessionLive = async (s: CheckoutSession): Promise<void> => {
    const row = await strapi.db
      .query(uids().checkoutSession)
      .findOne({ where: { id: s.id }, select: ['id', 'status', 'expiresAt'] });
    const expiresAt = row ? new Date(row.expiresAt).getTime() : NaN;
    if (!row || row.status !== 'ACTIVE' || !(expiresAt > Date.now())) {
      throw new EcommerceValidationError('Invalid session', [
        { path: 'session', code: 'SESSION_INVALID' },
      ]);
    }
  };

  const placeOrder = async (
    s: CheckoutSession,
    input: StorefrontOrderInput,
    idempotencyKey: string
  ): Promise<PlacedOrder> => {
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!key) throw invalid([{ path: 'idempotencyKey', code: 'required' }]);
    if (key.length > MAX_STOREFRONT_IDEMPOTENCY_KEY_LENGTH) {
      throw invalid([{ path: 'idempotencyKey', code: 'too_long' }]);
    }
    if (typeof input?.expectedTotal !== 'number') {
      throw invalid([{ path: 'expectedTotal', code: 'required' }]);
    }
    const lineErrors: ValidationIssue[] = [];
    const lines = cartLines(input.lines, lineErrors);
    if (lineErrors.length) throw invalid(lineErrors);
    await assertSessionLive(s);

    const email = input.customer?.email;
    const emailVerified = typeof email === 'string' ? sessions().isEmailVerified(s, email) : false;
    let created: CreatedOrder;
    try {
      created = await orders().create(
        {
          customer: input.customer,
          shippingAddress: input.shippingAddress,
          billingAddress: input.billingAddress ?? input.shippingAddress,
          locale: input.locale,
          lines,
          shipping: input.shippingMethod,
          notes: input.notes,
          promotionCodes: input.promotionCodes,
          giftChoices: input.giftChoices,
          expectedTotal: input.expectedTotal,
          storeCreditCode: input.storeCreditCode,
          idempotencyKey: `sf:${s.id}:${key}`,
          // A store credit needs no verified e-mail: its code is the secret (Global Constraints).
          emailVerified,
        },
        { actor: 'storefront', source: 'storefront', checkoutSessionId: s.id }
      );
    } catch (err) {
      if (err instanceof EcommerceValidationError) {
        throw new EcommerceValidationError(
          err.message,
          await withRefusalReasons(toStorefrontIssues(err.errors), emailVerified)
        );
      }
      throw err;
    }

    // A replay never clears the cart: it may have been rebuilt since the order.
    if (!created.replayed) {
      try {
        await sessions().clearCart(s.id);
      } catch (err) {
        strapi.log.error(
          `${LOG_PREFIX} cart clear failed after order: ${(err as Error)?.message ?? 'unknown error'}`
        );
      }
    }

    const state = await orders().computeOrderState(created.id);
    return {
      publicId: created.publicId,
      reference: `#${created.reference}`,
      total: num(created.total),
      due: state.summary.due,
      paymentStatus: state.order.paymentStatus,
    };
  };

  const ownedOrderId = async (s: CheckoutSession, publicId: unknown): Promise<number> => {
    const owned = await sessions().findOwnedOrder(s, publicId);
    if (!owned) throw new EcommerceNotFoundError('Order not found');
    return owned.id;
  };

  /** A Stripe Checkout link for what is due; the amount always comes from the order. */
  const paymentLink = async (
    s: CheckoutSession,
    publicId: unknown
  ): Promise<StorefrontPaymentLink> => {
    const orderId = await ownedOrderId(s, publicId);
    const link = await service('EcommerceStripePaymentService').getOrCreatePaymentLink(orderId, {
      actor: 'storefront',
    });
    return { url: link.url, expiresAt: link.expiresAt, amount: link.amount, reused: link.reused };
  };

  /** Built from the order state and its lines (never `get()`: shipments, invoices, history stay out). */
  const orderStatus = async (s: CheckoutSession, publicId: unknown): Promise<PublicOrderStatus> => {
    const orderId = await ownedOrderId(s, publicId);
    const state = await orders().computeOrderState(orderId);
    const { order } = state;
    const createdAt = isoOrNull(order.createdAt);
    const source: OrderStatusSource = {
      publicId: order.publicId,
      reference: order.reference,
      createdAt,
      locale: order.locale,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      totals: {
        itemsOriginal: num(order.itemsOriginal),
        productDiscount: num(order.productDiscount),
        subtotal: num(order.subtotal),
        orderDiscount: num(order.orderDiscount),
        shippingTotal: num(order.shippingTotal),
        total: num(order.total),
      },
      summary: { paid: state.summary.paid, due: state.summary.due },
      lines: state.lines,
      promotions: appliedOf(order),
      shippingMethod: isRecord(order.shippingMethod) ? order.shippingMethod : null,
    };
    const hasPendingStripePayment: boolean = await service(
      'EcommerceStripePaymentService'
    ).hasPendingCompletedStripeSession(orderId);
    return toPublicOrderStatus(source, {
      defaultLocale: await getDefaultLocale(),
      hasPendingStripePayment,
    });
  };

  return { quote, applyDiscount, checkStoreCredit, placeOrder, paymentLink, orderStatus };
};

export default EcommerceStorefrontCheckoutService;
