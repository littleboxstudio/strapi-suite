import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import { EcommerceNotFoundError, EcommerceValidationError, type ValidationIssue } from './errors';
import { isUniqueViolation } from './dbErrors';
import { isValidEmail } from './customers';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  FULFILLMENT_STATUSES,
  availableActions,
  canTransition,
  computeTotals,
  deriveFulfillmentStatus,
  derivePaymentStatus,
  financialSummary,
  shippedQuantities,
  type Address,
  type FinancialSummary,
  type FulfillmentStatus,
  type OrderActionKey,
  type OrderStatus,
  type PaymentLike,
  type PaymentStatus,
  type RefundLike,
  type ShipmentLike,
} from './domain/orders';
import {
  simulateModification,
  type CatalogVariant as ModificationCatalogVariant,
  type ExistingLine,
  type ModificationCurrent,
  type ModificationResult,
  type ShippingModification,
} from './domain/orderModification';
import { refundableAmount } from './domain/refunds';
import type { ShippingOption, ShippingQuoteRequest } from './shipping';
import type { StockMoveInput } from './stock';
import type { OrderHistoryEntry } from './orderHistory';
import type { CustomerInput } from './customers';

export type { Address } from './domain/orders';

const PAGE_SIZE = 50;
const MAX_CREATE_ATTEMPTS = 3;
const FIRST_REFERENCE = 1001;

export type OrderSource = 'admin' | 'storefront';

export type CreateOrderInput = {
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  shippingAddress: Address;
  billingAddress: Address;
  locale: string;
  lines: { variantId: number; quantity: number }[];
  shipping: { providerId: string; serviceId: string };
  notes?: string;
  idempotencyKey?: string;
};

export type CreateOrderContext = { actor: string; source: OrderSource };

export type OrderLineView = {
  id: number;
  variantId: number;
  productId: number;
  sku: string;
  name: string;
  option: string | null;
  imageUrl: string | null;
  unitPrice: number;
  unitDiscount: number;
  quantity: number;
  returnedQuantity: number;
  tax: number;
  isGift: boolean;
  shipped: number;
  pending: number;
};

export type OrderView = {
  id: number;
  reference: number;
  publicId: string;
  locale: string;
  source: OrderSource | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  createdAt: string;
  cancelledAt: string | null;
  archivedAt: string | null;
  customer: { id: number | null } & Record<string, unknown>;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  shippingMethod: Record<string, unknown> | null;
  notes: string | null;
  totals: {
    itemsOriginal: number;
    productDiscount: number;
    subtotal: number;
    orderDiscount: number;
    shippingOriginal: number;
    shippingDiscount: number;
    shippingTotal: number;
    total: number;
  };
  lines: OrderLineView[];
  payments: Record<string, unknown>[];
  refunds: unknown[];
  invoices: unknown[];
  shipments: unknown[];
  promotions: unknown[];
  summary: FinancialSummary;
  availableActions: OrderActionKey[];
  history: Record<string, unknown>[];
};

export type OrderState = {
  /** The stored order row, populated with lines, payments and history. */
  order: any;
  lines: OrderLineView[];
  /** Payment rows sorted by id. */
  payments: any[];
  /** Refund rows sorted by id. */
  refunds: any[];
  /** Sum of the PENDING / PROCESSING refunds. */
  inFlightRefunds: number;
  hasPendingRefunds: boolean;
  summary: FinancialSummary;
  actions: OrderActionKey[];
};

const IN_FLIGHT_REFUND = ['PENDING', 'PROCESSING'];

export type OrderListParams = {
  page?: number;
  search?: string;
  orderStatus?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
};

type CatalogVariant = {
  variantId: number;
  productId: number;
  sku: string;
  price: number;
  tax: number;
  weight: number;
  width: number;
  height: number;
  depth: number;
  name: string;
  option: string | null;
  imageUrl: string | null;
  stock: number;
  /** The variant and its product are both active. */
  active: boolean;
};

type MergedLine = { index: number; variantId: number; quantity: number };

/**
 * What the admin sends to preview or apply a modification. `RECALCULATE` carries no amount:
 * the service quotes it. `MANUAL` may rename the stored method.
 */
export type OrderModificationInput = {
  lines: { orderLineId?: number; variantId: number; quantity: number }[];
  shipping:
    { mode: 'KEEP' } | { mode: 'RECALCULATE' } | { mode: 'MANUAL'; amount: number; name?: string };
  addresses?: { shipping?: Address; billing?: Address };
};

export type OrderModificationOutcome = Pick<ModificationResult, 'outcome' | 'difference'>;

type NormalizedModification = {
  lines: { orderLineId?: number; variantId: number; quantity: number }[];
  shipping: OrderModificationInput['shipping'];
  addresses: { shipping?: Address; billing?: Address };
};

const SHIPPING_MODES = ['KEEP', 'RECALCULATE', 'MANUAL'] as const;
const OPERATION_ID_MIN = 8;
const OPERATION_ID_MAX = 64;

/** Key-sorted JSON, so two equal addresses compare equal whatever their key order. */
const canonical = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)))
      : (v ?? null)
  );

const operationConflict = () =>
  new EcommerceValidationError('Invalid modification', [
    { path: 'operationId', code: 'OPERATION_ID_CONFLICT' },
  ]);

const ADDRESS_REQUIRED = [
  'firstName',
  'lastName',
  'line1',
  'postalCode',
  'city',
  'country',
] as const;
const ADDRESS_OPTIONAL = ['company', 'nif', 'line2', 'phone'] as const;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const toPage = (page: unknown): number => {
  const n = Math.floor(Number(page));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};
const byPosition = (a: any, b: any) =>
  (a.position ?? 0) - (b.position ?? 0) || (a.id ?? 0) - (b.id ?? 0);

function normalizeAddress(
  raw: unknown,
  path: string,
  errors: ValidationIssue[],
  allowedCountries?: string[]
): Address {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of ADDRESS_REQUIRED) {
    out[f] = clean(a[f]);
    if (!out[f]) errors.push({ path: `${path}.${f}`, code: 'required' });
  }
  out.country = out.country.toUpperCase();
  if (out.country && !/^[A-Z]{2}$/.test(out.country)) {
    errors.push({ path: `${path}.country`, code: 'invalid_country' });
  } else if (out.country && allowedCountries && !allowedCountries.includes(out.country)) {
    errors.push({ path: `${path}.country`, code: 'invalid_country' });
  }
  for (const f of ADDRESS_OPTIONAL) {
    const v = clean(a[f]);
    if (v) out[f] = v;
  }
  return out as unknown as Address;
}

const EcommerceOrderService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const stock = (): {
    move(input: StockMoveInput): Promise<{ applied: boolean }>;
    netDeductedForOrder(orderId: number): Promise<Map<number, number>>;
    available(ids: number[]): Promise<Map<number, number>>;
  } => service('EcommerceStockService');
  const customers = (): {
    findOrCreate(input: CustomerInput): Promise<{ id: number; created: boolean }>;
  } => service('EcommerceCustomerService');
  const shipping = (): {
    findOption(
      req: ShippingQuoteRequest,
      providerId: string,
      serviceId: string
    ): Promise<ShippingOption | null>;
  } => service('EcommerceShippingService');
  const refundService = (): {
    releaseStoreCreditOnCancel(
      orderId: number,
      actor: string,
      opts: { collector: { emit(e: any): void }; operationId?: string }
    ): Promise<unknown>;
  } => service('EcommerceRefundService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): {
    collector(): { emit(e: any): void; flush(): Promise<void> };
  } => service('EcommerceEventBus');
  const getDefaultLocale = async (): Promise<string> =>
    strapi.plugin('i18n').service('locales').getDefaultLocale();

  const findByIdempotencyKey = async (key: string) => {
    const o = await strapi.db.query(uids().order).findOne({ where: { idempotencyKey: key } });
    return o
      ? { id: o.id as number, reference: o.reference as number, publicId: o.publicId as string }
      : null;
  };

  /**
   * The requested variants with texts in `locale` (falling back to the default locale) and
   * `active` = variant and product both active. Inactive ones are included so callers can tell
   * "unavailable" from "unknown" and still read their stock.
   */
  const loadCatalog = async (
    variantIds: number[],
    locale: string
  ): Promise<Map<number, CatalogVariant>> => {
    const u = uids();
    const defaultLocale = await getDefaultLocale();
    const products: any[] = await strapi.db.query(u.product).findMany({
      where: { variants: { id: { $in: variantIds } } },
      populate: {
        translations: true,
        images: true,
        variants: { populate: { translations: true, images: true } },
      },
    });
    const pick = (rows: any[] = [], field: string): string | null =>
      rows.find((t) => t.locale === locale)?.[field] ??
      rows.find((t) => t.locale === defaultLocale)?.[field] ??
      null;

    const out = new Map<number, CatalogVariant>();
    for (const p of products) {
      const productImage = [...(p.images ?? [])].sort(byPosition)[0];
      for (const v of p.variants ?? []) {
        if (!variantIds.includes(v.id)) continue;
        // The variant's own picture is the most precise; otherwise the product's first image.
        const image = [...(v.images ?? [])].sort(byPosition)[0] ?? productImage;
        out.set(v.id, {
          variantId: v.id,
          productId: p.id,
          sku: v.sku,
          price: num(v.price),
          tax: num(v.tax),
          weight: num(v.weight),
          width: num(v.width),
          height: num(v.height),
          depth: num(v.depth),
          name: pick(p.translations, 'name') ?? '',
          option: pick(v.translations, 'option'),
          imageUrl: image?.url ?? null,
          stock: num(v.stock),
          active: !!p.active && !!v.active,
        });
      }
    }
    return out;
  };

  const validateInput = async (input: CreateOrderInput) => {
    const errors: ValidationIssue[] = [];
    const store = await service('EcommerceSettingsService').getStoreSettings();
    const countries: string[] = store?.shippingCountries ?? [];

    const c = (input?.customer ?? {}) as Record<string, unknown>;
    const customer = {
      firstName: clean(c.firstName),
      lastName: clean(c.lastName),
      email: clean(c.email),
      phone: clean(c.phone) || null,
    };
    if (!customer.firstName) errors.push({ path: 'customer.firstName', code: 'required' });
    if (!customer.lastName) errors.push({ path: 'customer.lastName', code: 'required' });
    if (!customer.email) errors.push({ path: 'customer.email', code: 'required' });
    else if (!isValidEmail(customer.email))
      errors.push({ path: 'customer.email', code: 'invalid_email' });

    const shippingAddress = normalizeAddress(
      input?.shippingAddress,
      'shippingAddress',
      errors,
      countries
    );
    const billingAddress = normalizeAddress(input?.billingAddress, 'billingAddress', errors);

    const locale = clean(input?.locale);
    if (!locale) errors.push({ path: 'locale', code: 'required' });

    const providerId = clean(input?.shipping?.providerId);
    const serviceId = clean(input?.shipping?.serviceId);
    if (!providerId || !serviceId) errors.push({ path: 'shipping', code: 'required' });

    const rawLines = Array.isArray(input?.lines) ? input.lines : [];
    if (!rawLines.length) errors.push({ path: 'lines', code: 'required' });
    // Repeated variants are summed into the first occurrence.
    const merged = new Map<number, MergedLine>();
    rawLines.forEach((l, i) => {
      const variantId = Number(l?.variantId);
      const quantity = l?.quantity;
      if (!Number.isSafeInteger(variantId) || variantId <= 0) {
        errors.push({ path: `lines.${i}.variantId`, code: 'required' });
        return;
      }
      if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
        errors.push({ path: `lines.${i}.quantity`, code: 'INVALID_QUANTITY' });
        return;
      }
      const prev = merged.get(variantId);
      if (prev) prev.quantity += quantity;
      else merged.set(variantId, { index: i, variantId, quantity });
    });

    if (errors.length) throw new EcommerceValidationError('Invalid order', errors);

    const notes = clean(input?.notes) || null;
    const idempotencyKey = clean(input?.idempotencyKey) || null;
    return {
      customer,
      shippingAddress,
      billingAddress,
      locale,
      providerId,
      serviceId,
      lines: [...merged.values()],
      notes,
      idempotencyKey,
    };
  };

  const nextReference = async (): Promise<number> => {
    const [top] = await strapi.db.query(uids().order).findMany({
      select: ['reference'],
      orderBy: { reference: 'desc' },
      limit: 1,
    });
    return Math.max(num(top?.reference) + 1, FIRST_REFERENCE);
  };

  const loadOrder = async (id: number) => {
    const order = await strapi.db.query(uids().order).findOne({
      where: { id },
      populate: { lines: true, payments: true, history: true, customer: { select: ['id'] } },
    });
    if (!order) throw new EcommerceNotFoundError('Order not found');
    return order;
  };

  /** Shipments arrive in plan 4; until then nothing is shipped. */
  const loadShipments = async (_orderId: number): Promise<ShipmentLike[]> => [];

  /** Every refund of the order (any status), sorted by id. */
  const loadRefunds = async (orderId: number): Promise<any[]> => {
    const rows: any[] = await strapi.db.query(uids().refund).findMany({
      where: { order: { id: orderId } },
      populate: { payment: { select: ['id'] }, storeCredit: { select: ['id', 'code'] } },
      orderBy: { id: 'asc' },
    });
    return rows;
  };

  const summaryOf = (order: any, payments: PaymentLike[], refunds: RefundLike[]): FinancialSummary =>
    financialSummary(num(order.total), payments, refunds, {
      orderCancelled: order.orderStatus === 'CANCELLED',
    });

  const toPaymentLike = (p: any): PaymentLike => ({ status: p.status, amount: num(p.amount) });
  const toRefundLike = (r: any): RefundLike => ({
    status: r.status,
    amount: num(r.amount),
    kind: r.kind === 'STORE_CREDIT' ? 'STORE_CREDIT' : 'MONEY',
  });

  const create = async (input: CreateOrderInput, ctx: CreateOrderContext) => {
    // A replay returns the stored order before any validation, catalog or shipping work,
    // so it succeeds even if settings or the catalog changed since.
    const replayKey = clean(input?.idempotencyKey);
    if (replayKey) {
      const existing = await findByIdempotencyKey(replayKey);
      if (existing) return existing;
    }

    const v = await validateInput(input);

    // Catalog, availability and the shipping quote are read before the transaction: carrier
    // quotes may be remote calls and must not hold a database transaction open.
    const catalog = await loadCatalog(
      v.lines.map((l) => l.variantId),
      v.locale
    );
    const lineErrors: ValidationIssue[] = [];
    for (const l of v.lines) {
      if (!catalog.get(l.variantId)?.active)
        lineErrors.push({ path: `lines.${l.index}.variantId`, code: 'VARIANT_UNAVAILABLE' });
    }
    if (lineErrors.length) throw new EcommerceValidationError('Invalid order', lineErrors);

    const available = await stock().available(v.lines.map((l) => l.variantId));
    for (const l of v.lines) {
      if ((available.get(l.variantId) ?? 0) < l.quantity) {
        lineErrors.push({ path: `lines.${l.index}.quantity`, code: 'INSUFFICIENT_STOCK' });
      }
    }
    if (lineErrors.length) throw new EcommerceValidationError('Invalid order', lineErrors);

    const lineAmounts = v.lines.map((l) => ({
      unitPrice: catalog.get(l.variantId)!.price,
      unitDiscount: 0,
      quantity: l.quantity,
      returnedQuantity: 0,
    }));
    const itemsSubtotal = computeTotals(lineAmounts, {
      orderDiscount: 0,
      shippingOriginal: 0,
      shippingDiscount: 0,
    }).subtotal;

    const option = await shipping().findOption(
      {
        country: v.shippingAddress.country,
        postalCode: v.shippingAddress.postalCode,
        items: v.lines.map((l) => {
          const c = catalog.get(l.variantId)!;
          return {
            variantId: l.variantId,
            quantity: l.quantity,
            weight: c.weight,
            width: c.width,
            height: c.height,
            depth: c.depth,
          };
        }),
        subtotal: itemsSubtotal,
        locale: v.locale,
      },
      v.providerId,
      v.serviceId
    );
    if (!option) {
      throw new EcommerceValidationError('Invalid order', [
        { path: 'shipping', code: 'SHIPPING_UNAVAILABLE' },
      ]);
    }

    const shippingOriginal = num(option.price);
    const totals = computeTotals(lineAmounts, {
      orderDiscount: 0,
      shippingOriginal,
      shippingDiscount: 0,
    });
    const paymentStatus = derivePaymentStatus(financialSummary(totals.total, [], []));
    const units = v.lines.reduce((s, l) => s + l.quantity, 0);

    const attempt = async () => {
      const collector = events().collector();
      const result = await strapi.db.transaction(async () => {
        const u = uids();
        const customer = await customers().findOrCreate(v.customer);
        const reference = await nextReference();
        const publicId = randomUUID();

        const order = await strapi.db.query(u.order).create({
          data: {
            reference,
            publicId,
            customer: customer.id,
            locale: v.locale,
            orderStatus: 'OPEN',
            paymentStatus,
            fulfillmentStatus: 'UNFULFILLED',
            customerSnapshot: { ...v.customer },
            shippingAddress: v.shippingAddress,
            billingAddress: v.billingAddress,
            currency: 'EUR',
            itemsOriginal: totals.itemsOriginal,
            productDiscount: totals.productDiscount,
            subtotal: totals.subtotal,
            orderDiscount: totals.orderDiscount,
            shippingOriginal,
            shippingDiscount: 0,
            shippingTotal: totals.shippingTotal,
            total: totals.total,
            shippingTax: num(option.tax),
            shippingMethod: {
              providerId: option.providerId,
              serviceId: option.serviceId,
              name: option.name,
              price: shippingOriginal,
              tax: num(option.tax),
              ...(option.estimatedDays !== undefined
                ? { estimatedDays: option.estimatedDays }
                : {}),
            },
            promotions: [],
            source: ctx.source,
            notes: v.notes,
            idempotencyKey: v.idempotencyKey,
            cancelledAt: null,
            archivedAt: null,
          },
        });
        const orderId = order.id as number;

        for (const [position, l] of v.lines.entries()) {
          const c = catalog.get(l.variantId)!;
          await strapi.db.query(u.orderLine).create({
            data: {
              order: orderId,
              variant: l.variantId,
              variantId: l.variantId,
              productId: c.productId,
              sku: c.sku,
              name: c.name,
              option: c.option,
              imageUrl: c.imageUrl,
              unitPrice: c.price,
              unitDiscount: 0,
              quantity: l.quantity,
              returnedQuantity: 0,
              tax: c.tax,
              isGift: false,
              promotionRefs: [],
              position,
            },
          });
        }

        for (const l of v.lines) {
          await stock().move({
            variantId: l.variantId,
            quantity: -l.quantity,
            type: 'ORDER_DEDUCT',
            operationKey: `order:${orderId}:create:${l.variantId}`,
            orderId,
            reason: `Order #${reference} created`,
            actor: ctx.actor,
          });
        }

        await history().record({
          orderId,
          type: 'ORDER_CREATED',
          description: `Order created with ${units} ${units === 1 ? 'item' : 'items'}`,
          previousValue: null,
          newValue: {
            reference,
            source: ctx.source,
            total: totals.total,
            lines: v.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          },
          actor: ctx.actor,
        });

        collector.emit({
          type: 'ORDER_CREATED',
          orderId,
          payload: { reference, publicId, source: ctx.source, total: totals.total },
        });
        return { id: orderId, reference, publicId };
      });
      await collector.flush();
      return result;
    };

    let lastError: unknown;
    for (let i = 0; i < MAX_CREATE_ATTEMPTS; i++) {
      try {
        return await attempt();
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        lastError = err;
        // A concurrent request with the same key committed first: that order is the answer.
        if (v.idempotencyKey) {
          const existing = await findByIdempotencyKey(v.idempotencyKey);
          if (existing) return existing;
        }
        // Otherwise the reference (or publicId) was taken: retry the whole creation.
      }
    }
    throw lastError;
  };

  const list = async (params: OrderListParams = {}) => {
    const u = uids();
    const q = strapi.db.query(u.order);
    const page = toPage(params.page);
    const pagination = (total: number) => ({
      page,
      pageSize: PAGE_SIZE,
      total,
      pageCount: Math.ceil(total / PAGE_SIZE),
    });

    const where: Record<string, unknown> = {};
    if (ORDER_STATUSES.includes(params.orderStatus as OrderStatus))
      where.orderStatus = params.orderStatus;
    if (PAYMENT_STATUSES.includes(params.paymentStatus as PaymentStatus))
      where.paymentStatus = params.paymentStatus;
    if (FULFILLMENT_STATUSES.includes(params.fulfillmentStatus as FulfillmentStatus)) {
      where.fulfillmentStatus = params.fulfillmentStatus;
    }

    const term = clean(params.search);
    if (term) {
      const ref = term.replace(/^#/, '');
      // JSON columns are not portably searchable: match the customer's normalized e-mail,
      // which is the snapshot e-mail at creation time.
      const byEmail = { customer: { emailNormalized: { $containsi: term.toLowerCase() } } };
      if (/^\d+$/.test(ref) && Number.isSafeInteger(Number(ref))) {
        where.$or = [{ reference: Number(ref) }, byEmail];
      } else {
        Object.assign(where, byEmail);
      }
    }

    const [total, rows] = await Promise.all([
      q.count({ where }),
      q.findMany({
        where,
        orderBy: { reference: 'desc' },
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    ]);
    return {
      results: rows.map((o: any) => ({
        id: o.id,
        reference: o.reference,
        orderStatus: o.orderStatus,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        total: o.total,
        createdAt: o.createdAt,
        customerName: [o.customerSnapshot?.firstName, o.customerSnapshot?.lastName]
          .filter(Boolean)
          .join(' '),
      })),
      pagination: pagination(total),
    };
  };

  const toLineView = (l: any, shipped: Map<number, number>): OrderLineView => {
    const quantity = num(l.quantity);
    const s = shipped.get(l.id) ?? 0;
    return {
      id: l.id,
      variantId: l.variantId,
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      option: l.option ?? null,
      imageUrl: l.imageUrl ?? null,
      unitPrice: num(l.unitPrice),
      unitDiscount: num(l.unitDiscount),
      quantity,
      returnedQuantity: num(l.returnedQuantity),
      tax: num(l.tax),
      isGift: !!l.isGift,
      shipped: s,
      pending: Math.max(0, quantity - s),
    };
  };

  /**
   * Internal: the order with its lines, payments, financial summary and available actions.
   * The single source of truth for `get()` and for every action precondition.
   * Joins the caller's transaction when there is one.
   */
  const computeOrderState = async (orderId: number): Promise<OrderState> => {
    const order = await loadOrder(orderId);
    const shipments = await loadShipments(orderId);
    const shipped = shippedQuantities(shipments);
    const lines = [...(order.lines ?? [])].sort(byPosition).map((l: any) => toLineView(l, shipped));
    const payments: any[] = [...(order.payments ?? [])].sort((a, b) => a.id - b.id);
    const refunds = await loadRefunds(orderId);
    const summary = summaryOf(order, payments.map(toPaymentLike), refunds.map(toRefundLike));
    const inFlight = refunds.filter((r) => IN_FLIGHT_REFUND.includes(r.status));
    const inFlightRefunds = inFlight.reduce((s, r) => s + num(r.amount), 0);
    const hasPendingRefunds = inFlight.length > 0;
    const actions = availableActions({
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      summary,
      hasUnshippedQuantity: lines.some((l) => l.pending > 0),
      hasShippedUnreturned: lines.some((l) => l.shipped > l.returnedQuantity),
      allShipmentsDelivered: shipments
        .filter((s) => s.status !== 'CANCELLED')
        .every((s) => s.delivered),
      hasPendingPayments: payments.some((p) => p.status === 'PENDING'),
      hasPendingRefunds,
      // Invoicing arrives in plan 4.
      hasUninvoicedCompletedPayments: false,
    }).filter(
      // In-flight refunds already claim part of the excess.
      (a) => a !== 'REFUND' || refundableAmount(summary, inFlightRefunds) > 0
    );
    return { order, lines, payments, refunds, inFlightRefunds, hasPendingRefunds, summary, actions };
  };

  const get = async (id: number): Promise<OrderView> => {
    const { order, lines, payments: paymentRows, summary, actions } = await computeOrderState(id);

    const historyRows: any[] = [...(order.history ?? [])].sort((a, b) => b.id - a.id);

    return {
      id: order.id,
      reference: order.reference,
      publicId: order.publicId,
      locale: order.locale,
      source: order.source ?? null,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      createdAt: order.createdAt,
      cancelledAt: order.cancelledAt ?? null,
      archivedAt: order.archivedAt ?? null,
      customer: { id: order.customer?.id ?? null, ...(order.customerSnapshot ?? {}) },
      shippingAddress: order.shippingAddress ?? null,
      billingAddress: order.billingAddress ?? null,
      shippingMethod: order.shippingMethod ?? null,
      notes: order.notes ?? null,
      totals: {
        itemsOriginal: num(order.itemsOriginal),
        productDiscount: num(order.productDiscount),
        subtotal: num(order.subtotal),
        orderDiscount: num(order.orderDiscount),
        shippingOriginal: num(order.shippingOriginal),
        shippingDiscount: num(order.shippingDiscount),
        shippingTotal: num(order.shippingTotal),
        total: num(order.total),
      },
      lines,
      payments: paymentRows.map((p) => ({
        id: p.id,
        method: p.method,
        status: p.status,
        amount: num(p.amount),
        currency: p.currency ?? 'EUR',
        reference: p.reference ?? null,
        externalId: p.externalId ?? null,
        coverage: p.coverage ?? null,
        methodLabel: p.metadata?.methodLabel ?? null,
        completedAt: p.completedAt ?? null,
        actor: p.actor ?? null,
        createdAt: p.createdAt,
      })),
      refunds: [],
      invoices: [],
      shipments: [],
      promotions: Array.isArray(order.promotions) ? order.promotions : [],
      summary,
      availableActions: actions,
      history: historyRows.map((h) => ({
        id: h.id,
        type: h.type,
        description: h.description,
        previousValue: h.previousValue ?? null,
        newValue: h.newValue ?? null,
        actor: h.actor ?? null,
        operationId: h.operationId ?? null,
        createdAt: h.createdAt,
      })),
    };
  };

  /**
   * Internal: re-derives paymentStatus and fulfillmentStatus from the stored data and records a
   * `*_STATUS_CHANGED` history entry for each one that changed. Joins the caller's transaction.
   */
  const recalculate = async (
    orderId: number,
    opts: { actor?: string; operationId?: string } = {}
  ): Promise<{ paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus }> =>
    strapi.db.transaction(async () => {
      const order = await loadOrder(orderId);
      const payments: PaymentLike[] = (order.payments ?? []).map(toPaymentLike);
      const refunds: RefundLike[] = (await loadRefunds(orderId)).map(toRefundLike);
      const paymentStatus = derivePaymentStatus(summaryOf(order, payments, refunds));
      const shipped = shippedQuantities(await loadShipments(orderId));
      const fulfillmentStatus = deriveFulfillmentStatus(
        (order.lines ?? []).map((l: any) => ({ id: l.id, quantity: num(l.quantity) })),
        shipped
      );

      const actor = opts.actor ?? 'system';
      const changes: Record<string, unknown> = {};
      if (paymentStatus !== order.paymentStatus) {
        changes.paymentStatus = paymentStatus;
        await history().record({
          orderId,
          type: 'PAYMENT_STATUS_CHANGED',
          description: `Payment status changed from ${order.paymentStatus} to ${paymentStatus}`,
          previousValue: { paymentStatus: order.paymentStatus },
          newValue: { paymentStatus },
          actor,
          operationId: opts.operationId,
        });
      }
      if (fulfillmentStatus !== order.fulfillmentStatus) {
        changes.fulfillmentStatus = fulfillmentStatus;
        await history().record({
          orderId,
          type: 'FULFILLMENT_STATUS_CHANGED',
          description: `Fulfillment status changed from ${order.fulfillmentStatus} to ${fulfillmentStatus}`,
          previousValue: { fulfillmentStatus: order.fulfillmentStatus },
          newValue: { fulfillmentStatus },
          actor,
          operationId: opts.operationId,
        });
      }
      if (Object.keys(changes).length) {
        await strapi.db.query(uids().order).update({ where: { id: orderId }, data: changes });
      }
      return { paymentStatus, fulfillmentStatus };
    });

  /**
   * Serializes order-level writers: a no-op update takes the order row's write lock for the
   * rest of the caller's transaction, so concurrent payments, modifications, cancels and
   * archives on the same order run one after the other (portable across SQLite, Postgres and
   * MySQL/MariaDB, unlike `SELECT ... FOR UPDATE`). Call it first inside the transaction.
   */
  const lockOrder = async (orderId: number): Promise<void> => {
    await strapi.db
      .query(uids().order)
      .updateMany({ where: { id: orderId }, data: { updatedAt: new Date() } });
  };

  /** Throws `ACTION_NOT_AVAILABLE` unless `action` is in the order's available actions. */
  const assertAction = (state: OrderState, action: OrderActionKey, allowed = true): void => {
    if (!allowed || !state.actions.includes(action)) {
      throw new EcommerceValidationError('Action not available', [
        { path: 'action', code: 'ACTION_NOT_AVAILABLE' },
      ]);
    }
  };

  /** Moves an OPEN order to `to` after checking `action`; one transaction, events after commit. */
  const transition = async (
    orderId: number,
    actor: string,
    action: 'CANCEL' | 'ARCHIVE',
    to: 'CANCELLED' | 'ARCHIVED'
  ): Promise<OrderView> => {
    const collector = events().collector();
    const operationId = randomUUID();
    await strapi.db.transaction(async () => {
      await lockOrder(orderId);
      const state = await computeOrderState(orderId);
      const from: OrderStatus = state.order.orderStatus;
      assertAction(state, action, canTransition(from, to));

      const now = new Date().toISOString();
      const reference = state.order.reference;
      const u = uids();
      // Conditional on OPEN: a concurrent transition that committed first leaves 0 rows here,
      // and throwing rolls this one back before any history, stock move or event.
      const { count } = await strapi.db.query(u.order).updateMany({
        where: { id: orderId, orderStatus: 'OPEN' },
        data:
          to === 'CANCELLED'
            ? { orderStatus: to, cancelledAt: now }
            : { orderStatus: to, archivedAt: now },
      });
      assertAction(state, action, count > 0);

      if (to === 'CANCELLED') {
        // Restock only what the order still holds (net of earlier restocks and returns).
        // The deterministic key makes a concurrent second cancel a no-op.
        const held = await stock().netDeductedForOrder(orderId);
        const restocked: { variantId: number; quantity: number }[] = [];
        for (const [variantId, units] of held) {
          if (units <= 0) continue;
          const { applied } = await stock().move({
            variantId,
            quantity: units,
            type: 'CANCEL_RESTOCK',
            operationKey: `cancel:${orderId}:${variantId}`,
            orderId,
            reason: `Order #${reference} cancelled`,
            actor,
          });
          if (applied) restocked.push({ variantId, quantity: units });
        }
        // Store credit spent on the order goes back to its vouchers (design 4.14), as
        // COMPLETED STORE_CREDIT refunds, in this same transaction.
        await refundService().releaseStoreCreditOnCancel(orderId, actor, { collector, operationId });
        await history().record({
          orderId,
          type: 'ORDER_CANCELLED',
          description: `Order cancelled`,
          previousValue: null,
          newValue: { cancelledAt: now, restocked },
          actor,
          operationId,
        });
      } else {
        await history().record({
          orderId,
          type: 'ORDER_ARCHIVED',
          description: `Order archived`,
          previousValue: null,
          newValue: { archivedAt: now },
          actor,
          operationId,
        });
      }
      await history().record({
        orderId,
        type: 'ORDER_STATUS_CHANGED',
        description: `Order status changed from ${from} to ${to}`,
        previousValue: { orderStatus: from },
        newValue: { orderStatus: to },
        actor,
        operationId,
      });
      await recalculate(orderId, { actor, operationId });

      if (to === 'CANCELLED') {
        // Cancelling does not change what was paid.
        collector.emit({
          type: 'ORDER_CANCELLED',
          orderId,
          payload: { reference, amountPaid: state.summary.paid },
        });
      } else {
        collector.emit({ type: 'ORDER_ARCHIVED', orderId, payload: { reference } });
      }
    });
    await collector.flush();
    if (to === 'CANCELLED') await expireOpenStripeSessions(orderId);
    return get(orderId);
  };

  /**
   * After a cancel commits: expires the order's OPEN Stripe sessions so the customer can no
   * longer pay (a session Stripe reports paid is settled instead: the money is recorded and
   * becomes refundable). Best effort: failures are logged and never undo the cancel.
   */
  const expireOpenStripeSessions = async (orderId: number): Promise<void> => {
    try {
      const stripePayments: { expireOpenSessions(orderId: number): Promise<void> } | undefined =
        service('EcommerceStripePaymentService');
      await stripePayments?.expireOpenSessions(orderId);
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      const code = (err as { code?: unknown })?.code;
      strapi.log?.error(
        `[ecommerce] could not expire the Stripe sessions of cancelled order ${orderId}: ${name}${typeof code === 'string' ? `:${code}` : ''}`
      );
    }
  };

  const cancel = (orderId: number, actor: string) =>
    transition(orderId, actor, 'CANCEL', 'CANCELLED');

  const archive = (orderId: number, actor: string) =>
    transition(orderId, actor, 'ARCHIVE', 'ARCHIVED');

  // -------------------------------------------------------------------------
  // Modification (design 4.8)
  // -------------------------------------------------------------------------

  const normalizeModification = async (
    input: OrderModificationInput
  ): Promise<NormalizedModification> => {
    const errors: ValidationIssue[] = [];
    const rawLines: any[] | null = Array.isArray(input?.lines) ? input.lines : null;
    if (!rawLines) errors.push({ path: 'lines', code: 'required' });
    // Quantities and line ids are validated by the simulation, with per-line paths.
    const lines = (rawLines ?? []).map((l) => ({
      ...(l?.orderLineId !== undefined && l?.orderLineId !== null
        ? { orderLineId: Number(l.orderLineId) }
        : {}),
      variantId: Number(l?.variantId),
      quantity: l?.quantity,
    }));

    const raw = (input?.shipping ?? {}) as Record<string, unknown>;
    const mode = raw.mode as (typeof SHIPPING_MODES)[number];
    let shippingInput: OrderModificationInput['shipping'] = { mode: 'KEEP' };
    if (!SHIPPING_MODES.includes(mode)) {
      errors.push({ path: 'shipping.mode', code: 'required' });
    } else if (mode === 'MANUAL') {
      const name = clean(raw.name);
      shippingInput = { mode, amount: raw.amount as number, ...(name ? { name } : {}) };
    } else {
      shippingInput = { mode };
    }

    const addresses: NormalizedModification['addresses'] = {};
    const a = input?.addresses;
    if (a?.shipping) {
      const store = await service('EcommerceSettingsService').getStoreSettings();
      addresses.shipping = normalizeAddress(
        a.shipping,
        'addresses.shipping',
        errors,
        store?.shippingCountries ?? []
      );
    }
    if (a?.billing) addresses.billing = normalizeAddress(a.billing, 'addresses.billing', errors);

    if (errors.length) throw new EcommerceValidationError('Invalid modification', errors);
    return { lines, shipping: shippingInput, addresses };
  };

  /** The order (MODIFY must be available) and the catalog of every variant involved. */
  const loadModificationContext = async (orderId: number, n: NormalizedModification) => {
    const state = await computeOrderState(orderId);
    assertAction(state, 'MODIFY');
    const ids = new Set<number>(state.lines.map((l) => l.variantId));
    for (const l of n.lines) {
      if (Number.isSafeInteger(l.variantId) && l.variantId > 0) ids.add(l.variantId);
    }
    const catalog = ids.size
      ? await loadCatalog([...ids], state.order.locale)
      : new Map<number, CatalogVariant>();
    return { state, catalog };
  };

  type ModificationContext = Awaited<ReturnType<typeof loadModificationContext>>;

  const toModificationCurrent = (state: OrderState): ModificationCurrent => ({
    lines: state.lines.map((l): ExistingLine => ({
      id: l.id,
      variantId: l.variantId,
      sku: l.sku,
      name: l.name,
      option: l.option ?? '',
      tax: l.tax,
      shipped: l.shipped,
      isGift: l.isGift,
      unitPrice: l.unitPrice,
      unitDiscount: l.unitDiscount,
      quantity: l.quantity,
      returnedQuantity: l.returnedQuantity,
    })),
    orderDiscount: num(state.order.orderDiscount),
    shippingOriginal: num(state.order.shippingOriginal),
    shippingDiscount: num(state.order.shippingDiscount),
    payments: state.payments.map(toPaymentLike),
    refunds: state.refunds.map(toRefundLike),
  });

  const toModificationCatalog = (catalog: Map<number, CatalogVariant>) => {
    const out = new Map<number, ModificationCatalogVariant>();
    for (const [id, c] of catalog) {
      out.set(id, {
        variantId: c.variantId,
        sku: c.sku,
        name: c.name,
        option: c.option ?? '',
        unitPrice: c.price,
        tax: c.tax,
        imageUrl: c.imageUrl,
        stock: c.stock,
        active: c.active,
      });
    }
    return out;
  };

  const runSimulation = (
    ctx: ModificationContext,
    n: NormalizedModification,
    shippingInput: ShippingModification
  ): ModificationResult =>
    simulateModification(
      toModificationCurrent(ctx.state),
      { lines: n.lines, shipping: shippingInput, addresses: n.addresses },
      toModificationCatalog(ctx.catalog)
    );

  /**
   * The shipping input for the simulation. `RECALCULATE` quotes the order's method for the
   * units still to ship after the modification, at the (new) shipping address. When the lines
   * themselves are invalid no quote is requested: `invalidDraft` carries those errors instead.
   */
  const resolveShipping = async (
    ctx: ModificationContext,
    n: NormalizedModification
  ): Promise<{
    input: ShippingModification;
    option: ShippingOption | null;
    invalidDraft?: ModificationResult;
  }> => {
    if (n.shipping.mode === 'KEEP') return { input: { mode: 'KEEP' }, option: null };
    if (n.shipping.mode === 'MANUAL') {
      return { input: { mode: 'MANUAL', amount: n.shipping.amount }, option: null };
    }

    const { state, catalog } = ctx;
    const draft = runSimulation(ctx, n, { mode: 'KEEP' });
    if (draft.errors.length) {
      return {
        input: { mode: 'KEEP' },
        option: null,
        invalidDraft: { ...draft, shipping: { ...draft.shipping, mode: 'RECALCULATE' } },
      };
    }
    const shippedById = new Map(state.lines.map((l) => [l.id, l.shipped]));
    const items: ShippingQuoteRequest['items'] = [];
    for (const c of draft.lineChanges) {
      const shipped = c.orderLineId !== undefined ? (shippedById.get(c.orderLineId) ?? 0) : 0;
      const quantity = c.newQuantity - shipped;
      if (quantity <= 0) continue;
      const v = catalog.get(c.variantId);
      items.push({
        variantId: c.variantId,
        quantity,
        weight: v?.weight ?? 0,
        width: v?.width ?? 0,
        height: v?.height ?? 0,
        depth: v?.depth ?? 0,
      });
    }
    const destination: Address | null = n.addresses.shipping ?? state.order.shippingAddress;
    const method = (state.order.shippingMethod ?? {}) as Record<string, unknown>;
    const option = await shipping().findOption(
      {
        country: destination?.country ?? '',
        postalCode: destination?.postalCode,
        items,
        subtotal: draft.after.subtotal,
        locale: state.order.locale,
      },
      String(method.providerId ?? ''),
      String(method.serviceId ?? '')
    );
    if (!option) {
      throw new EcommerceValidationError('Invalid modification', [
        { path: 'shipping', code: 'SHIPPING_QUOTE_FAILED' },
      ]);
    }
    return {
      input: { mode: 'RECALCULATE', quote: num(option.price), previousShipmentsCost: 0 },
      option,
    };
  };

  const previewModification = async (
    rawOrderId: number | string,
    input: OrderModificationInput
  ): Promise<ModificationResult> => {
    const orderId = Number(rawOrderId);
    const n = await normalizeModification(input);
    const ctx = await loadModificationContext(orderId, n);
    const { input: shippingInput, invalidDraft } = await resolveShipping(ctx, n);
    return invalidDraft ?? runSimulation(ctx, n, shippingInput);
  };

  /** The ORDER_MODIFIED history row's unique key: one application per operationId. */
  const modificationKey = (operationId: string) => `modify:${operationId}`;

  /** The outcome of an earlier application of `operationId` on this order, if any. */
  const findAppliedModification = async (
    orderId: number,
    operationId: string
  ): Promise<OrderModificationOutcome | null> => {
    const q = strapi.db.query(uids().orderHistory);
    const uniqueKey = modificationKey(operationId);
    const row = await q.findOne({ where: { uniqueKey, order: { id: orderId } } });
    if (row) {
      return {
        outcome: row.newValue?.outcome ?? 'NONE',
        difference: num(row.newValue?.difference),
      };
    }
    // The stock keys embed the operationId: reusing one from another order is a client bug.
    if (await q.findOne({ where: { uniqueKey } })) {
      throw operationConflict();
    }
    return null;
  };

  const applyModification = async (
    rawOrderId: number | string,
    input: OrderModificationInput,
    actor: string,
    rawOperationId: string
  ): Promise<{ order: OrderView } & OrderModificationOutcome> => {
    const orderId = Number(rawOrderId);
    const operationId = typeof rawOperationId === 'string' ? rawOperationId.trim() : '';
    if (operationId.length < OPERATION_ID_MIN || operationId.length > OPERATION_ID_MAX) {
      throw new EcommerceValidationError('Invalid modification', [
        { path: 'operationId', code: 'required' },
      ]);
    }

    // A replay returns the current order before any precondition: the first request may
    // already have changed what is available.
    const replay = async () => {
      const applied = await findAppliedModification(orderId, operationId);
      return applied ? { order: await get(orderId), ...applied } : null;
    };
    const earlier = await replay();
    if (earlier) return earlier;

    const n = await normalizeModification(input);
    // The carrier quote may be a remote call: it is taken before the transaction and used
    // as-is inside it. A quote gone stale meanwhile is accepted (design 9.2: no locking).
    const {
      input: shippingInput,
      option,
      invalidDraft,
    } = await resolveShipping(await loadModificationContext(orderId, n), n);
    if (invalidDraft) {
      throw new EcommerceValidationError('Invalid modification', invalidDraft.errors);
    }

    const collector = events().collector();
    let outcome: OrderModificationOutcome;
    try {
      outcome = await strapi.db.transaction(async () => {
        await lockOrder(orderId);
        if (await findAppliedModification(orderId, operationId)) throw operationConflict();
        const ctx = await loadModificationContext(orderId, n);
        const result = runSimulation(ctx, n, shippingInput);
        if (result.errors.length) {
          throw new EcommerceValidationError('Invalid modification', result.errors);
        }
        await writeModification(ctx, n, result, option, actor, operationId);
        await recalculate(orderId, { actor, operationId });
        collector.emit({
          type: 'ORDER_MODIFIED',
          orderId,
          payload: { outcome: result.outcome, difference: result.difference },
        });
        return { outcome: result.outcome, difference: result.difference };
      });
    } catch (err) {
      // A concurrent request with the same operationId committed first (the unique key of its
      // ORDER_MODIFIED row or of a stock move was taken): that is the answer.
      const isConflict =
        err instanceof EcommerceValidationError &&
        (err as any).errors?.some?.((e: ValidationIssue) => e.code === 'OPERATION_ID_CONFLICT');
      if (isConflict || isUniqueViolation(err)) {
        const winner = await replay();
        if (winner) return winner;
      }
      throw err;
    }
    await collector.flush();
    return { order: await get(orderId), ...outcome };
  };

  /** Persists a validated simulation: lines, stock, addresses, shipping, totals and history. */
  const writeModification = async (
    ctx: ModificationContext,
    n: NormalizedModification,
    result: ModificationResult,
    option: ShippingOption | null,
    actor: string,
    operationId: string
  ): Promise<void> => {
    const u = uids();
    const { state, catalog } = ctx;
    const order = state.order;
    const orderId = order.id as number;
    const record = (entry: Omit<OrderHistoryEntry, 'orderId' | 'actor' | 'operationId'>) =>
      history().record({ ...entry, orderId, actor, operationId });

    // --- Lines ---------------------------------------------------------------
    const byId = new Map(state.lines.map((l) => [l.id, l]));
    let position = Math.max(-1, ...(order.lines ?? []).map((l: any) => num(l.position))) + 1;
    for (const change of result.lineChanges) {
      if (change.kind === 'UNCHANGED') continue;
      if (change.kind === 'ADDED') {
        const c = catalog.get(change.variantId)!;
        const created = await strapi.db.query(u.orderLine).create({
          data: {
            order: orderId,
            variant: c.variantId,
            variantId: c.variantId,
            productId: c.productId,
            sku: c.sku,
            name: c.name,
            option: c.option,
            imageUrl: c.imageUrl,
            unitPrice: c.price,
            unitDiscount: 0,
            quantity: change.newQuantity,
            returnedQuantity: 0,
            tax: c.tax,
            isGift: false,
            promotionRefs: [],
            position: position++,
          },
        });
        await record({
          type: 'LINE_ADDED',
          description: `Added ${change.newQuantity} × ${c.sku}`,
          previousValue: null,
          newValue: {
            orderLineId: created.id,
            variantId: c.variantId,
            sku: c.sku,
            name: c.name,
            option: c.option,
            unitPrice: c.price,
            quantity: change.newQuantity,
          },
        });
        continue;
      }

      const line = byId.get(change.orderLineId!)!;
      const ref = {
        orderLineId: line.id,
        variantId: line.variantId,
        sku: line.sku,
        name: line.name,
        option: line.option,
      };
      // A line with nothing shipped or returned leaves no trace on the order; otherwise it
      // stays with quantity 0 (the simulation rejects going below the shipped units).
      if (change.newQuantity === 0 && line.shipped === 0 && line.returnedQuantity === 0) {
        await strapi.db.query(u.orderLine).delete({ where: { id: line.id } });
      } else {
        await strapi.db.query(u.orderLine).update({
          where: { id: line.id },
          data: { quantity: change.newQuantity },
        });
      }
      if (change.kind === 'REMOVED') {
        await record({
          type: 'LINE_REMOVED',
          description: `Removed ${change.previousQuantity} × ${line.sku}`,
          previousValue: { ...ref, quantity: change.previousQuantity },
          newValue: null,
        });
      } else {
        await record({
          type: 'LINE_QUANTITY_CHANGED',
          description: `Quantity of ${line.sku} changed from ${change.previousQuantity} to ${change.newQuantity}`,
          previousValue: { ...ref, quantity: change.previousQuantity },
          newValue: { ...ref, quantity: change.newQuantity },
        });
      }
    }

    // --- Stock ---------------------------------------------------------------
    for (const m of result.stockMovements) {
      const { applied } = await stock().move({
        variantId: m.variantId,
        quantity: m.quantity,
        type: m.quantity < 0 ? 'ORDER_DEDUCT' : 'ORDER_RESTOCK',
        operationKey: `modify:${operationId}:${m.variantId}`,
        orderId,
        reason: `Order #${order.reference} modified`,
        actor,
      });
      // The key already exists: this operationId was used elsewhere. Roll everything back.
      if (!applied) throw operationConflict();
    }

    // --- Addresses -----------------------------------------------------------
    const data: Record<string, unknown> = {};
    for (const [kind, field] of [
      ['shipping', 'shippingAddress'],
      ['billing', 'billingAddress'],
    ] as const) {
      const next = n.addresses[kind];
      const previous = order[field] ?? null;
      if (!next || canonical(next) === canonical(previous)) continue;
      data[field] = next;
      await record({
        type: 'ADDRESS_CHANGED',
        description: `${kind === 'shipping' ? 'Shipping' : 'Billing'} address changed`,
        previousValue: { [field]: previous },
        newValue: { [field]: next },
      });
    }

    // --- Shipping ------------------------------------------------------------
    const s = result.shipping;
    if (s.mode !== 'KEEP') {
      const previousMethod = (order.shippingMethod ?? null) as Record<string, unknown> | null;
      let method: Record<string, unknown>;
      if (s.mode === 'RECALCULATE' && option) {
        method = {
          providerId: option.providerId,
          serviceId: option.serviceId,
          name: option.name,
          price: num(option.price),
          tax: num(option.tax),
          ...(option.estimatedDays !== undefined ? { estimatedDays: option.estimatedDays } : {}),
        };
        data.shippingTax = num(option.tax);
      } else {
        // MANUAL keeps the carrier ids; only the price (and optionally the name) change.
        const name = n.shipping.mode === 'MANUAL' ? n.shipping.name : undefined;
        method = {
          ...(previousMethod ?? {}),
          price: s.shippingOriginal,
          ...(name ? { name } : {}),
        };
      }
      data.shippingMethod = method;
      await record({
        type: 'SHIPPING_CHANGED',
        description: `Shipping ${s.mode === 'MANUAL' ? 'set manually' : 'recalculated'}: ${s.previousCharged} → ${s.newCharged} cents`,
        previousValue: {
          charged: s.previousCharged,
          shippingOriginal: num(order.shippingOriginal),
          shippingDiscount: num(order.shippingDiscount),
          shippingMethod: previousMethod,
        },
        newValue: {
          mode: s.mode,
          previousCharged: s.previousCharged,
          newCharged: s.newCharged,
          ...(s.quote !== undefined ? { quote: s.quote } : {}),
          ...(s.previousShipmentsCost !== undefined
            ? { previousShipmentsCost: s.previousShipmentsCost }
            : {}),
          shippingMethod: method,
        },
      });
    }

    // --- Totals --------------------------------------------------------------
    const storedLines: any[] = await strapi.db.query(u.orderLine).findMany({
      where: { order: orderId },
    });
    const previousDiscount = num(order.orderDiscount);
    const totals = computeTotals(
      storedLines.map((l) => ({
        unitPrice: num(l.unitPrice),
        unitDiscount: num(l.unitDiscount),
        quantity: num(l.quantity),
        returnedQuantity: num(l.returnedQuantity),
      })),
      {
        orderDiscount: previousDiscount,
        shippingOriginal: s.shippingOriginal,
        shippingDiscount: s.shippingDiscount,
      }
    );
    if (totals.orderDiscount !== previousDiscount) {
      await record({
        type: 'ORDER_DISCOUNT_CHANGED',
        description: `Order discount capped at the new subtotal: ${previousDiscount} → ${totals.orderDiscount} cents`,
        previousValue: { orderDiscount: previousDiscount },
        newValue: { orderDiscount: totals.orderDiscount },
      });
    }

    // Conditional on OPEN: a concurrent cancel or archive that committed first leaves 0 rows,
    // and throwing rolls this modification back.
    const { count } = await strapi.db.query(u.order).updateMany({
      where: { id: orderId, orderStatus: 'OPEN' },
      data: {
        ...data,
        itemsOriginal: totals.itemsOriginal,
        productDiscount: totals.productDiscount,
        subtotal: totals.subtotal,
        orderDiscount: totals.orderDiscount,
        shippingOriginal: s.shippingOriginal,
        shippingDiscount: s.shippingDiscount,
        shippingTotal: totals.shippingTotal,
        total: totals.total,
      },
    });
    assertAction(state, 'MODIFY', count > 0);

    await record({
      type: 'ORDER_MODIFIED',
      uniqueKey: modificationKey(operationId),
      description: `Order modified: total ${result.before.total} → ${totals.total} cents (${result.outcome})`,
      previousValue: { totals: result.before },
      newValue: {
        operationId,
        outcome: result.outcome,
        difference: result.difference,
        totals: result.after,
      },
    });
  };

  /**
   * Shipping options for a draft order. The caller sends only variant ids and quantities;
   * weight and dimensions come from the catalog.
   */
  const quoteForLines = async (input: {
    country: string;
    postalCode?: string;
    lines: { variantId: number; quantity: number }[];
    locale: string;
  }) => {
    const errors: ValidationIssue[] = [];
    const rawLines: any[] = Array.isArray(input?.lines) ? input.lines : [];
    if (!rawLines.length) errors.push({ path: 'lines', code: 'required' });
    const country = clean(input?.country);
    if (!country) errors.push({ path: 'country', code: 'required' });
    const merged = new Map<number, number>();
    /** First line index of each variant, for error paths. */
    const firstIndex = new Map<number, number>();
    rawLines.forEach((l, i) => {
      const variantId = Number(l?.variantId);
      const quantity = Number(l?.quantity);
      if (!Number.isInteger(variantId) || variantId < 1) {
        errors.push({ path: `lines.${i}.variantId`, code: 'invalid' });
      } else if (!Number.isInteger(quantity) || quantity < 1) {
        errors.push({ path: `lines.${i}.quantity`, code: 'invalid' });
      } else {
        merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
        if (!firstIndex.has(variantId)) firstIndex.set(variantId, i);
      }
    });
    if (errors.length) throw new EcommerceValidationError('Invalid shipping quote', errors);

    const locale = clean(input?.locale) || (await getDefaultLocale());
    const catalog = await loadCatalog([...merged.keys()], locale);
    const items: ShippingQuoteRequest['items'] = [];
    let subtotal = 0;
    const unavailable: ValidationIssue[] = [];
    for (const [variantId, quantity] of merged) {
      const c = catalog.get(variantId);
      if (!c || !c.active) {
        unavailable.push({
          path: `lines.${firstIndex.get(variantId)}.variantId`,
          code: 'VARIANT_UNAVAILABLE',
        });
        continue;
      }
      items.push({
        variantId,
        quantity,
        weight: c.weight,
        width: c.width,
        height: c.height,
        depth: c.depth,
      });
      subtotal += c.price * quantity;
    }
    if (unavailable.length) {
      throw new EcommerceValidationError('Invalid shipping quote', unavailable);
    }
    const request: ShippingQuoteRequest = {
      country,
      ...(clean(input?.postalCode) ? { postalCode: clean(input.postalCode) } : {}),
      items,
      subtotal,
      locale,
    };
    return service('EcommerceShippingService').quote(request);
  };

  /** Active variants of active products matching `q` by product name or SKU (at most 20). */
  const searchVariants = async (q: string, locale?: string) => {
    const term = clean(q);
    if (!term) return [];
    const loc = clean(locale) || (await getDefaultLocale());
    const termLower = term.toLowerCase();
    const products: any[] = await strapi.db.query(uids().product).findMany({
      where: {
        active: true,
        $or: [
          { translations: { name: { $containsi: term } } },
          { variants: { sku: { $containsi: term } } },
        ],
      },
      populate: { translations: true, variants: true },
      orderBy: { id: 'asc' },
      limit: 20,
    });
    const ids: number[] = [];
    for (const p of products) {
      const nameMatch = (p.translations ?? []).some((t: any) =>
        String(t.name ?? '').toLowerCase().includes(termLower)
      );
      for (const v of p.variants ?? []) {
        if (!v.active) continue;
        if (nameMatch || String(v.sku ?? '').toLowerCase().includes(termLower)) ids.push(v.id);
      }
    }
    if (!ids.length) return [];
    const catalog = await loadCatalog(ids.slice(0, 20), loc);
    return ids
      .slice(0, 20)
      .map((id) => catalog.get(id))
      .filter((c): c is CatalogVariant => !!c && c.active)
      .map((c) => ({
        variantId: c.variantId,
        productId: c.productId,
        name: c.name,
        option: c.option,
        sku: c.sku,
        price: c.price,
        stock: c.stock,
        imageUrl: c.imageUrl,
      }));
  };

  return {
    create,
    list,
    quoteForLines,
    searchVariants,
    get,
    recalculate,
    computeOrderState,
    assertAction,
    cancel,
    archive,
    previewModification,
    applyModification,
    lockOrder,
  };
};

export default EcommerceOrderService;
