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
  type ShipmentLike,
} from './domain/orders';
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
  summary: FinancialSummary;
  actions: OrderActionKey[];
};

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
};

type MergedLine = { index: number; variantId: number; quantity: number };

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

  /** Active variants of active products, with texts in `locale` (falling back to the default locale). */
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
      if (!p.active) continue;
      const productImage = [...(p.images ?? [])].sort(byPosition)[0];
      for (const v of p.variants ?? []) {
        if (!variantIds.includes(v.id) || !v.active) continue;
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

  const summaryOf = (order: any, payments: PaymentLike[]): FinancialSummary =>
    financialSummary(num(order.total), payments, [], {
      orderCancelled: order.orderStatus === 'CANCELLED',
    });

  const toPaymentLike = (p: any): PaymentLike => ({ status: p.status, amount: num(p.amount) });

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
      if (!catalog.has(l.variantId))
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
    const summary = summaryOf(order, payments.map(toPaymentLike));
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
      hasPendingRefunds: false,
      // Invoicing arrives in plan 4.
      hasUninvoicedCompletedPayments: false,
    });
    return { order, lines, payments, summary, actions };
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
      const paymentStatus = derivePaymentStatus(summaryOf(order, payments));
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
      const state = await computeOrderState(orderId);
      const from: OrderStatus = state.order.orderStatus;
      assertAction(state, action, canTransition(from, to));

      const now = new Date().toISOString();
      const reference = state.order.reference;
      const u = uids();
      await strapi.db.query(u.order).update({
        where: { id: orderId },
        data:
          to === 'CANCELLED'
            ? { orderStatus: to, cancelledAt: now }
            : { orderStatus: to, archivedAt: now },
      });

      if (to === 'CANCELLED') {
        // Restock only what the order still holds (net of earlier restocks and returns).
        // The deterministic key makes a concurrent second cancel a no-op.
        const held = await stock().netDeductedForOrder(orderId);
        const restocked: { variantId: number; quantity: number }[] = [];
        for (const [variantId, units] of held) {
          if (units <= 0) continue;
          await stock().move({
            variantId,
            quantity: units,
            type: 'CANCEL_RESTOCK',
            operationKey: `cancel:${orderId}:${variantId}`,
            orderId,
            reason: `Order #${reference} cancelled`,
            actor,
          });
          restocked.push({ variantId, quantity: units });
        }
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
        const after = await computeOrderState(orderId);
        collector.emit({
          type: 'ORDER_CANCELLED',
          orderId,
          payload: { reference, amountPaid: after.summary.paid },
        });
      } else {
        collector.emit({ type: 'ORDER_ARCHIVED', orderId, payload: { reference } });
      }
    });
    await collector.flush();
    return get(orderId);
  };

  const cancel = (orderId: number, actor: string) =>
    transition(orderId, actor, 'CANCEL', 'CANCELLED');

  const archive = (orderId: number, actor: string) =>
    transition(orderId, actor, 'ARCHIVE', 'ARCHIVED');

  return { create, list, get, recalculate, computeOrderState, assertAction, cancel, archive };
};

export default EcommerceOrderService;
