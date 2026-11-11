import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../../config';
import {
  EcommerceCarrierError,
  EcommerceNotFoundError,
  EcommerceValidationError,
  type ValidationIssue,
} from './errors';
import { isUniqueViolation } from './dbErrors';
import { MAX_MONEY_CENTS, type FulfillmentStatus, type OrderActionKey } from './domain/orders';
import { randomUUID } from 'crypto';
import {
  orderDeliveryStatus,
  reservedQuantities,
  validateDeliveryDate,
  validateShipmentRequest,
} from './domain/fulfillment';
import type {
  CarrierAdapter,
  CarrierTrackingEvent,
  CarrierShipmentRequest,
  CarrierShipmentResult,
} from './providers/carriers/types';
import type { ProviderRuntime } from './providers/registry';
import type { OrderHistoryEntry } from './orderHistory';
import type { LoadedShipment, OrderState } from './orders';

/** Creating a carrier shipment may take long (label generation): 30 s, passed to the adapter. */
export const CREATE_SHIPMENT_TIMEOUT_MS = 30000;
/** Every other carrier call (cancel, label). */
export const CARRIER_CALL_TIMEOUT_MS = 15000;
/** Our own backstop on top of the timeout handed to the adapter. */
const BACKSTOP_GRACE_MS = 5000;

const MAX_CARRIER_NAME = 120;
const MAX_URL = 2000;
const MAX_TEXT = 255;
const MAX_REASON = 500;

export type ShipmentInput = {
  lines: { orderLineId: number; quantity: number }[];
  method:
    | { mode: 'MANUAL'; carrierName: string; trackingCode?: string; trackingUrl?: string }
    | { mode: 'CARRIER' };
  shippingCost: number;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShipmentItem = {
  orderLineId: number;
  sku: string;
  name: string;
  option: string | null;
  quantity: number;
};

export type ShipmentView = {
  id: number;
  status: string;
  providerId: string;
  serviceId: string | null;
  carrierName: string;
  items: ShipmentItem[];
  trackingCode: string | null;
  trackingUrl: string | null;
  shippingCost: number;
  labelAvailable: boolean;
  deliveryStatus: string | null;
  deliverySource: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  error: string | null;
  createdAt: string | null;
  events: {
    type: string;
    description: string | null;
    occurredAt: string | null;
    source: string | null;
  }[];
};

/** The stored `items` JSON (`{ lines: [...] }`), malformed entries dropped. */
export const shipmentItemsOf = (row: any): ShipmentItem[] => {
  const lines = row?.items?.lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((i: any) => i && typeof i === 'object' && Number.isInteger(Number(i.orderLineId)))
    .map((i: any) => ({
      orderLineId: Number(i.orderLineId),
      sku: typeof i.sku === 'string' ? i.sku : '',
      name: typeof i.name === 'string' ? i.name : '',
      option: typeof i.option === 'string' ? i.option : null,
      quantity: Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : 0,
    }));
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const idOf = (v: any): number | null => (v && typeof v === 'object' ? (v.id ?? null) : (v ?? null));
const isMoney = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_MONEY_CENTS;

const isHttpUrl = (v: string): boolean => {
  if (v.length > MAX_URL) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const invalid = (path: string, code: string) =>
  new EcommerceValidationError('Invalid shipment', [{ path, code }]);

const notAvailable = () => invalid('action', 'ACTION_NOT_AVAILABLE');

/** A carrier error code safe to store and return; anything else is CARRIER_REQUEST_FAILED. */
const carrierCode = (err: unknown): EcommerceCarrierError['code'] =>
  err instanceof EcommerceCarrierError ? err.code : 'CARRIER_REQUEST_FAILED';

/**
 * Only an `EcommerceCarrierError` without `uncertain` proves the carrier did nothing. Any other
 * failure (a timeout, an unexpected exception) may have happened after the carrier accepted.
 */
const isUncertain = (err: unknown): boolean =>
  !(err instanceof EcommerceCarrierError) || err.uncertain;

const withTimeout = <T>(work: Promise<T>, ms: number, uncertain: boolean): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EcommerceCarrierError('TIMEOUT', 'TIMEOUT', uncertain)),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

type NormalizedInput = {
  lines: { orderLineId: number; quantity: number }[];
  method:
    | {
        mode: 'MANUAL';
        carrierName: string;
        trackingCode: string | null;
        trackingUrl: string | null;
      }
    | { mode: 'CARRIER' };
  shippingCost: number;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

const normalizeInput = (input: ShipmentInput): NormalizedInput => {
  const errors: ValidationIssue[] = [];
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<ShipmentInput>;

  const idempotencyKey = clean(raw.idempotencyKey);
  if (!idempotencyKey) errors.push({ path: 'idempotencyKey', code: 'required' });
  else if (idempotencyKey.length > MAX_TEXT)
    errors.push({ path: 'idempotencyKey', code: 'too_long' });

  if (!isMoney(raw.shippingCost)) errors.push({ path: 'shippingCost', code: 'INVALID_AMOUNT' });

  const notifyCustomer = raw.notifyCustomer === undefined ? true : raw.notifyCustomer;
  if (typeof notifyCustomer !== 'boolean') errors.push({ path: 'notifyCustomer', code: 'invalid' });

  const m = (raw.method && typeof raw.method === 'object' ? raw.method : {}) as Record<
    string,
    unknown
  >;
  let method: NormalizedInput['method'] = { mode: 'CARRIER' };
  if (m.mode === 'MANUAL') {
    const carrierName = clean(m.carrierName);
    if (!carrierName) errors.push({ path: 'method.carrierName', code: 'required' });
    else if (carrierName.length > MAX_CARRIER_NAME)
      errors.push({ path: 'method.carrierName', code: 'too_long' });
    const trackingCode = clean(m.trackingCode) || null;
    if (trackingCode && trackingCode.length > MAX_TEXT)
      errors.push({ path: 'method.trackingCode', code: 'too_long' });
    const trackingUrl = clean(m.trackingUrl) || null;
    if (trackingUrl && !isHttpUrl(trackingUrl))
      errors.push({ path: 'method.trackingUrl', code: 'invalid_url' });
    method = { mode: 'MANUAL', carrierName, trackingCode, trackingUrl };
  } else if (m.mode !== 'CARRIER') {
    errors.push({ path: 'method.mode', code: 'invalid_mode' });
  }

  if (errors.length) throw new EcommerceValidationError('Invalid shipment', errors);
  return {
    lines: Array.isArray(raw.lines) ? raw.lines : [],
    method,
    shippingCost: raw.shippingCost as number,
    notifyCustomer: notifyCustomer as boolean,
    idempotencyKey,
  };
};

type Collector = { emit(e: any): void; flush(): Promise<void> };

/**
 * The outcome of `createShipment`. `contacted: false` means the request never left (building it
 * failed), so the outcome is definitive.
 */
type CarrierCall =
  | { result: CarrierShipmentResult; externalId: string }
  | { error: unknown; contacted: boolean; externalId?: undefined };

/** Shipments (design 4.10): manual, or created through the order's carrier adapter. */
const EcommerceShipmentService = ({ strapi }: { strapi: Core.Strapi }) => {
  const uids = () => {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    return config.uuid.modules.ecommerce;
  };
  const service = (name: string): any => strapi.plugin(PLUGIN_ID).service(name);
  const orders = (): {
    lockOrder(orderId: number): Promise<void>;
    computeOrderState(orderId: number): Promise<OrderState>;
    assertAction(state: OrderState, action: OrderActionKey, allowed?: boolean): void;
    recalculate(
      orderId: number,
      opts?: { actor?: string; operationId?: string }
    ): Promise<{ fulfillmentStatus: FulfillmentStatus }>;
  } => service('EcommerceOrderService');
  const shipping = (): {
    carrierFor(providerId: string): Promise<{ adapter: CarrierAdapter; runtime: ProviderRuntime }>;
  } => service('EcommerceShippingService');
  const history = (): { record(entry: OrderHistoryEntry): Promise<void> } =>
    service('EcommerceOrderHistoryService');
  const events = (): { collector(): Collector } => service('EcommerceEventBus');

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  const findRow = (where: Record<string, unknown>) =>
    strapi.db.query(uids().shipment).findOne({ where, populate: { order: { select: ['id'] } } });

  const loadRow = async (shipmentId: number) => {
    const row = await findRow({ id: Number(shipmentId) });
    if (!row) throw new EcommerceNotFoundError('Shipment not found');
    return row;
  };

  const toViews = async (rows: any[]): Promise<ShipmentView[]> => {
    if (!rows.length) return [];
    const eventRows: any[] = await strapi.db.query(uids().shipmentEvent).findMany({
      where: { shipment: { id: { $in: rows.map((r) => r.id) } } },
      populate: { shipment: { select: ['id'] } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      providerId: r.providerId,
      serviceId: r.serviceId ?? null,
      carrierName: r.carrierName,
      items: shipmentItemsOf(r),
      trackingCode: r.trackingCode ?? null,
      trackingUrl: r.trackingUrl ?? null,
      shippingCost: num(r.shippingCost),
      labelAvailable: !!r.labelAvailable,
      deliveryStatus: r.deliveryStatus ?? null,
      deliverySource: r.deliverySource ?? null,
      shippedAt: r.shippedAt ?? null,
      deliveredAt: r.deliveredAt ?? null,
      cancelledAt: r.cancelledAt ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt ?? null,
      events: eventRows
        .filter((e) => idOf(e.shipment) === r.id)
        .map((e) => ({
          type: e.type,
          description: e.description ?? null,
          occurredAt: e.occurredAt ?? null,
          source: e.source ?? null,
        })),
    }));
  };

  const viewOf = async (shipmentId: number): Promise<ShipmentView> =>
    (await toViews([await loadRow(shipmentId)]))[0];

  /** `rows`: the order's shipment rows when the caller already loaded them. */
  const listForOrder = async (orderId: number, rows?: any[]): Promise<ShipmentView[]> =>
    toViews(
      rows ??
        (await strapi.db.query(uids().shipment).findMany({
          where: { order: { id: Number(orderId) } },
          orderBy: { id: 'asc' },
        }))
    );

  // ---------------------------------------------------------------------------
  // Shared writes (inside the caller's transaction)
  // ---------------------------------------------------------------------------

  /**
   * The success tail of every shipment (MANUAL in its only transaction, CARRIER in the second):
   * the CREATED shipment event, the SHIPMENT_CREATED history entry, `recalculate` and the
   * SHIPMENT_CREATED domain event.
   */
  const recordShipmentCreated = async (
    shipment: any,
    orderId: number,
    notify: boolean,
    ctx: { actor: string; collector: Collector }
  ): Promise<void> => {
    const now = new Date().toISOString();
    const items = shipmentItemsOf(shipment);
    await strapi.db.query(uids().shipmentEvent).create({
      data: {
        shipment: shipment.id,
        order: orderId,
        type: 'CREATED',
        code: 'CREATED',
        description: `Shipped with ${shipment.carrierName}`,
        occurredAt: now,
        source: 'ADMIN',
        actor: ctx.actor,
        uniqueKey: `shp:${shipment.id}:created`,
      },
    });
    await history().record({
      orderId,
      type: 'SHIPMENT_CREATED',
      description: `Shipment #${shipment.id} created (${shipment.carrierName})`,
      previousValue: null,
      newValue: {
        shipmentId: shipment.id,
        carrierName: shipment.carrierName,
        trackingCode: shipment.trackingCode ?? null,
        shippingCost: num(shipment.shippingCost),
        items: items.map((i) => ({ orderLineId: i.orderLineId, quantity: i.quantity })),
      },
      actor: ctx.actor,
    });
    const { fulfillmentStatus } = await orders().recalculate(orderId, { actor: ctx.actor });
    const state = await orders().computeOrderState(orderId);
    ctx.collector.emit({
      type: 'SHIPMENT_CREATED',
      orderId,
      payload: {
        shipmentId: shipment.id,
        full: fulfillmentStatus === 'FULFILLED',
        notify,
        pending: state.lines
          .filter((l) => l.pending > 0)
          .map((l) => ({ orderLineId: l.id, quantity: l.pending })),
      },
    });
  };

  const recordFailure = async (shipment: any, orderId: number, code: string, actor: string) => {
    await history().record({
      orderId,
      type: 'SHIPMENT_FAILED',
      description: `Shipment #${shipment.id} failed (${code})`,
      previousValue: null,
      newValue: { shipmentId: shipment.id, error: code },
      actor,
    });
  };

  // ---------------------------------------------------------------------------
  // Carrier
  // ---------------------------------------------------------------------------

  /** The order's carrier adapter, refusing up front when it cannot `method`. */
  const carrierWith = async (
    providerId: string,
    method: 'createShipment' | 'cancelShipment' | 'getLabel' | 'track'
  ) => {
    if (!providerId || providerId === 'manual')
      throw new EcommerceCarrierError('CARRIER_NOT_CONFIGURED');
    const carrier = await shipping().carrierFor(providerId);
    if (typeof carrier.adapter[method] !== 'function')
      throw new EcommerceCarrierError('NOT_SUPPORTED');
    return carrier;
  };

  const buildCarrierRequest = async (
    shipment: any,
    order: any
  ): Promise<CarrierShipmentRequest> => {
    const items = shipmentItemsOf(shipment);
    const lines: any[] = await strapi.db.query(uids().orderLine).findMany({
      where: { id: { $in: items.map((i) => i.orderLineId) } },
    });
    const variantOf = new Map(lines.map((l) => [l.id, Number(l.variantId)]));
    const variantIds = [...new Set(lines.map((l) => Number(l.variantId)))];
    const variants: any[] = variantIds.length
      ? await strapi.db.query(uids().variant).findMany({ where: { id: { $in: variantIds } } })
      : [];
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const customer = (order.customerSnapshot ?? {}) as Record<string, unknown>;
    const name = `${clean(customer.firstName)} ${clean(customer.lastName)}`.trim();
    return {
      ourReference: `LB-SHP-${shipment.id}`,
      orderReference: String(order.reference),
      serviceId: shipment.serviceId ?? '',
      destination: order.shippingAddress,
      contact: {
        name,
        email: clean(customer.email),
        ...(clean(customer.phone) ? { phone: clean(customer.phone) } : {}),
      },
      items: items.map((i) => {
        const variantId = variantOf.get(i.orderLineId) ?? 0;
        const v = variantById.get(variantId);
        return {
          variantId,
          quantity: i.quantity,
          weight: num(v?.weight),
          width: num(v?.width),
          height: num(v?.height),
          depth: num(v?.depth),
        };
      }),
    };
  };

  /** Calls `createShipment` outside any transaction; never throws. */
  const callCreateShipment = async (
    shipment: any,
    order: any,
    carrier: { adapter: CarrierAdapter; runtime: ProviderRuntime }
  ): Promise<CarrierCall> => {
    let request: CarrierShipmentRequest;
    try {
      request = await buildCarrierRequest(shipment, order);
    } catch {
      // Nothing reached the carrier: a definitive failure.
      return { error: new EcommerceCarrierError('CARRIER_REQUEST_FAILED'), contacted: false };
    }
    try {
      const result = await withTimeout(
        carrier.adapter.createShipment!(request, carrier.runtime, {
          timeoutMs: CREATE_SHIPMENT_TIMEOUT_MS,
        }),
        CREATE_SHIPMENT_TIMEOUT_MS + BACKSTOP_GRACE_MS,
        true
      );
      const externalId = typeof result?.externalId === 'string' ? clean(result.externalId) : '';
      // A "success" without the carrier's id cannot be cancelled or tracked: its outcome is unknown.
      if (!externalId) {
        return {
          error: new EcommerceCarrierError(
            'CARRIER_REQUEST_FAILED',
            'CARRIER_REQUEST_FAILED',
            true
          ),
          contacted: true,
        };
      }
      return { result, externalId };
    } catch (error) {
      return { error, contacted: true };
    }
  };

  /**
   * Transaction 2 of a carrier shipment: under the order lock, re-reads the order and the row,
   * then records the adapter's outcome. Uncertain outcomes stay PENDING (`UNCERTAIN`) for a
   * manual `retry`; they are never retried automatically.
   */
  const completeCarrierShipment = async (
    shipmentId: number,
    orderId: number,
    call: CarrierCall,
    actor: string
  ): Promise<ShipmentView> => {
    const u = uids();
    const collector = events().collector();
    let failure: Error | null = null;
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const order = await strapi.db.query(u.order).findOne({ where: { id: orderId } });
      const current = await loadRow(shipmentId);
      const returnedId = call.externalId ?? null;

      if (current.status !== 'PENDING') {
        // A concurrent retry already concluded it: report the state it reached.
        if (current.status === 'ACTIVE') return;
        // FAILED/CANCELLED meanwhile: keep the carrier's id so `cancel` can reach it.
        if (returnedId && !current.externalId) {
          await strapi.db.query(u.shipment).update({
            where: { id: shipmentId },
            data: { externalId: returnedId },
          });
        }
        failure = invalid('status', 'SHIPMENT_STATE_CHANGED');
        return;
      }
      if (order?.orderStatus !== 'OPEN') {
        await strapi.db.query(u.shipment).update({
          where: { id: shipmentId },
          data: {
            status: 'FAILED',
            error: 'ORDER_CHANGED',
            externalId: returnedId ?? current.externalId ?? null,
          },
        });
        await recordFailure(current, orderId, 'ORDER_CHANGED', actor);
        failure = invalid('order', 'ORDER_CHANGED');
        return;
      }

      if ('result' in call) {
        const r = (call.result ?? {}) as Partial<CarrierShipmentResult>;
        const trackingCode = clean(r.trackingCode);
        const trackingUrl = clean(r.trackingUrl);
        const updated = await strapi.db.query(u.shipment).update({
          where: { id: shipmentId },
          data: {
            status: 'ACTIVE',
            error: null,
            externalId: returnedId,
            trackingCode: trackingCode && trackingCode.length <= MAX_TEXT ? trackingCode : null,
            trackingUrl: trackingUrl && isHttpUrl(trackingUrl) ? trackingUrl : null,
            shippingCost: isMoney(r.cost) ? r.cost : num(current.shippingCost),
            labelAvailable: r.labelAvailable === true,
            shippedAt: new Date().toISOString(),
          },
        });
        await recordShipmentCreated(updated, orderId, current.metadata?.notify !== false, {
          actor,
          collector,
        });
        return;
      }

      const code = carrierCode(call.error);
      strapi.log?.warn?.(`[ecommerce] carrier shipment ${shipmentId} failed: ${code}`);
      if (call.contacted && isUncertain(call.error)) {
        await strapi.db.query(u.shipment).update({
          where: { id: shipmentId },
          data: { error: 'UNCERTAIN' },
        });
        return;
      }
      await strapi.db.query(u.shipment).update({
        where: { id: shipmentId },
        data: { status: 'FAILED', error: code },
      });
      await recordFailure(current, orderId, code, actor);
      failure =
        call.error instanceof EcommerceCarrierError ? call.error : new EcommerceCarrierError(code);
    });
    await collector.flush();
    if (failure) throw failure;
    return viewOf(shipmentId);
  };

  // ---------------------------------------------------------------------------
  // Create / retry
  // ---------------------------------------------------------------------------

  /** The shipment created with `key`, refusing a key already used on another order. */
  const findByKey = async (orderId: number, key: string) => {
    const row = await findRow({ idempotencyKey: key });
    if (row && idOf(row.order) !== orderId)
      throw invalid('idempotencyKey', 'IDEMPOTENCY_KEY_CONFLICT');
    return row;
  };

  const create = async (
    rawOrderId: number | string,
    input: ShipmentInput,
    actor: string
  ): Promise<ShipmentView> => {
    const orderId = Number(rawOrderId);
    const n = normalizeInput(input);
    const u = uids();

    const existing = await findByKey(orderId, n.idempotencyKey);
    if (existing) return viewOf(existing.id);

    const order = await strapi.db.query(u.order).findOne({ where: { id: orderId } });
    if (!order) throw new EcommerceNotFoundError('Order not found');
    const method = (order.shippingMethod ?? {}) as Record<string, unknown>;
    const carrier =
      n.method.mode === 'CARRIER'
        ? await carrierWith(String(method.providerId ?? ''), 'createShipment')
        : null;

    const collector = events().collector();
    let row: any;
    try {
      row = await strapi.db.transaction(async () => {
        await orders().lockOrder(orderId);
        // A request with the same key that held the lock first already answered.
        const winner = await findByKey(orderId, n.idempotencyKey);
        if (winner) return { ...winner, replay: true };

        const state = await orders().computeOrderState(orderId);
        // Everything already reserved (another tab shipped it): the units are the reason.
        const allReserved =
          state.order.orderStatus === 'OPEN' && state.lines.every((l) => l.pending === 0);
        if (!allReserved) orders().assertAction(state, 'SHIP');
        const reserved = reservedQuantities(state.shipments as LoadedShipment[]);
        const issues = validateShipmentRequest(
          state.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
          reserved,
          n.lines
        );
        if (issues.length) throw new EcommerceValidationError('Invalid shipment', issues);

        const lineById = new Map(state.lines.map((l) => [l.id, l]));
        const items: ShipmentItem[] = n.lines.map((r) => {
          const l = lineById.get(r.orderLineId)!;
          return {
            orderLineId: l.id,
            sku: l.sku,
            name: l.name,
            option: l.option ?? null,
            quantity: r.quantity,
          };
        });
        const common = {
          order: orderId,
          items: { lines: items },
          shippingCost: n.shippingCost,
          labelAvailable: false,
          deliveryStatus: 'IN_TRANSIT',
          idempotencyKey: n.idempotencyKey,
          actor,
          metadata: { notify: n.notifyCustomer },
        };

        if (n.method.mode === 'MANUAL') {
          const created = await strapi.db.query(u.shipment).create({
            data: {
              ...common,
              providerId: 'manual',
              serviceId: null,
              carrierName: n.method.carrierName,
              status: 'ACTIVE',
              trackingCode: n.method.trackingCode,
              trackingUrl: n.method.trackingUrl,
              shippedAt: new Date().toISOString(),
            },
          });
          await recordShipmentCreated(created, orderId, n.notifyCustomer, { actor, collector });
          return created;
        }

        return strapi.db.query(u.shipment).create({
          data: {
            ...common,
            providerId: String(method.providerId),
            serviceId: method.serviceId != null ? String(method.serviceId) : null,
            carrierName: clean(method.name) || String(method.providerId),
            status: 'PENDING',
          },
        });
      });
    } catch (err) {
      // A concurrent request with the same key committed first: its shipment is the answer.
      if (isUniqueViolation(err)) {
        const winner = await findByKey(orderId, n.idempotencyKey);
        if (winner) return viewOf(winner.id);
      }
      throw err;
    }
    if (row.replay) return viewOf(row.id);
    await collector.flush();
    if (n.method.mode === 'MANUAL') return viewOf(row.id);

    const call = await callCreateShipment(row, order, carrier!);
    return completeCarrierShipment(row.id, orderId, call, actor);
  };

  /**
   * Repeats `createShipment` for a PENDING shipment whose outcome is uncertain, with the same
   * `ourReference` (LB-SHP-<id>): carriers deduplicate by it, so a shipment the carrier did
   * create is returned instead of being created twice.
   */
  const retry = async (shipmentId: number | string, actor: string): Promise<ShipmentView> => {
    const row = await loadRow(Number(shipmentId));
    if (row.status !== 'PENDING' || row.error !== 'UNCERTAIN') throw notAvailable();
    const orderId = idOf(row.order) as number;
    const carrier = await carrierWith(row.providerId, 'createShipment');
    const order = await strapi.db.query(uids().order).findOne({ where: { id: orderId } });
    if (!order) throw new EcommerceNotFoundError('Order not found');
    const call = await callCreateShipment(row, order, carrier);
    // Nothing reached the carrier this time, but the first attempt may have: the shipment stays
    // PENDING/UNCERTAIN (never FAILED, which `cancel` would close without asking the carrier).
    if ('contacted' in call && !call.contacted) throw call.error;
    return completeCarrierShipment(row.id, orderId, call, actor);
  };

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  /** Throws unless `row` may be cancelled now. */
  const assertCancellable = (row: any, state: OrderState): void => {
    if (state.order.orderStatus === 'ARCHIVED' || row.status === 'CANCELLED') throw notAvailable();
    if (row.status === 'ACTIVE' && row.deliveryStatus === 'DELIVERED') {
      throw invalid('status', 'ALREADY_DELIVERED');
    }
    // The carrier may hold it: only `retry` can tell (never cancelled silently).
    if (row.status === 'PENDING' && !row.externalId) throw invalid('status', 'SHIPMENT_UNCERTAIN');
    if (row.status === 'ACTIVE') {
      const lineById = new Map(state.lines.map((l) => [l.id, l]));
      for (const item of shipmentItemsOf(row)) {
        const l = lineById.get(item.orderLineId);
        if (l && l.shipped - item.quantity < l.returnedQuantity) {
          throw invalid('lines', 'SHIPMENT_HAS_RETURNS');
        }
      }
    }
  };

  /** A shipment the carrier knows about (it holds an `externalId`) is cancelled there first. */
  const heldByCarrier = (row: any): boolean =>
    !!row.externalId && row.providerId !== 'manual' && row.status !== 'CANCELLED';

  const cancel = async (
    shipmentId: number | string,
    input: { reason?: string },
    actor: string
  ): Promise<ShipmentView> => {
    const u = uids();
    const reason = clean(input?.reason).slice(0, MAX_REASON) || null;
    const first = await loadRow(Number(shipmentId));
    const orderId = idOf(first.order) as number;
    // The local rules are checked under the order lock before the carrier is contacted.
    const before = await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(first.id);
      assertCancellable(row, await orders().computeOrderState(orderId));
      return row;
    });

    const carrierCancelled = heldByCarrier(before);
    if (carrierCancelled) {
      const carrier = await carrierWith(before.providerId, 'cancelShipment');
      await withTimeout(
        carrier.adapter.cancelShipment!(before.externalId, carrier.runtime, {
          timeoutMs: CARRIER_CALL_TIMEOUT_MS,
        }),
        CARRIER_CALL_TIMEOUT_MS + BACKSTOP_GRACE_MS,
        true
      );
    }

    let refusal: Error | null = null;
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(before.id);
      try {
        if (row.status !== before.status) throw notAvailable();
        assertCancellable(row, await orders().computeOrderState(orderId));
      } catch (err) {
        if (!carrierCancelled) throw err;
        // The carrier already cancelled it but the shipment changed meanwhile (delivered,
        // returned...): leave a trace and a clear error instead of silently diverging.
        const refusedWith =
          err instanceof EcommerceValidationError ? String(err.errors[0]?.code) : 'UNKNOWN';
        await strapi.db.query(u.shipment).update({
          where: { id: row.id },
          data: { error: 'CARRIER_CANCELLED' },
        });
        await history().record({
          orderId,
          type: 'SHIPMENT_CARRIER_CANCELLED',
          description: `Shipment #${row.id} was cancelled at the carrier but not here (${refusedWith})`,
          previousValue: { status: row.status },
          newValue: { status: row.status, carrierCancelled: true, refusedWith, reason },
          actor,
        });
        refusal = invalid('status', 'SHIPMENT_STATE_CHANGED');
        return;
      }
      const now = new Date().toISOString();
      await strapi.db.query(u.shipment).update({
        where: { id: row.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await strapi.db.query(u.shipmentEvent).create({
        data: {
          shipment: row.id,
          order: orderId,
          type: 'CANCELLED',
          code: 'CANCELLED',
          description: reason ?? 'Shipment cancelled',
          occurredAt: now,
          source: 'ADMIN',
          actor,
          uniqueKey: `shp:${row.id}:cancelled`,
        },
      });
      await history().record({
        orderId,
        type: 'SHIPMENT_CANCELLED',
        description: `Shipment #${row.id} cancelled`,
        previousValue: { status: row.status },
        newValue: { status: 'CANCELLED', reason },
        actor,
      });
      await orders().recalculate(orderId, { actor });
    });
    if (refusal) throw refusal;
    return viewOf(before.id);
  };

  // ---------------------------------------------------------------------------
  // Label
  // ---------------------------------------------------------------------------

  const getLabel = async (
    shipmentId: number | string
  ): Promise<{ filename: string; content: Buffer }> => {
    const row = await loadRow(Number(shipmentId));
    if (row.status !== 'ACTIVE' || !row.labelAvailable || !row.externalId) {
      throw invalid('label', 'LABEL_NOT_AVAILABLE');
    }
    const carrier = await carrierWith(row.providerId, 'getLabel');
    const label = await withTimeout(
      carrier.adapter.getLabel!(row.externalId, carrier.runtime, {
        timeoutMs: CARRIER_CALL_TIMEOUT_MS,
      }),
      CARRIER_CALL_TIMEOUT_MS + BACKSTOP_GRACE_MS,
      false
    );
    if (!label || typeof label.filename !== 'string' || !Buffer.isBuffer(label.content)) {
      throw new EcommerceCarrierError('CARRIER_REQUEST_FAILED');
    }
    return { filename: label.filename, content: label.content };
  };

  // ---------------------------------------------------------------------------
  // Deliveries and tracking
  // ---------------------------------------------------------------------------

  /**
   * Marks `row` delivered under the caller's transaction and order lock. The conditional
   * `updateMany` is the guard: with 0 rows another request already delivered it. Returns whether
   * this call did it. Does not touch FulfillmentStatus or OrderStatus.
   */
  const markDelivered = async (
    row: any,
    orderId: number,
    ctx: {
      deliveredAt: string;
      source: 'MANUAL' | 'CARRIER';
      actor: string;
      description: string;
      notifyCustomer: boolean;
      collector: Collector;
    }
  ): Promise<boolean> => {
    const u = uids();
    const res = await strapi.db.query(u.shipment).updateMany({
      where: {
        id: row.id,
        $or: [{ deliveryStatus: { $null: true } }, { deliveryStatus: { $ne: 'DELIVERED' } }],
      },
      data: {
        deliveryStatus: 'DELIVERED',
        deliveredAt: ctx.deliveredAt,
        deliverySource: ctx.source,
      },
    });
    if (!res?.count) return false;
    await strapi.db.query(u.shipmentEvent).create({
      data: {
        shipment: row.id,
        order: orderId,
        type: 'DELIVERED',
        code: 'DELIVERED',
        description: ctx.description,
        occurredAt: ctx.deliveredAt,
        source: ctx.source === 'MANUAL' ? 'ADMIN' : 'CARRIER',
        actor: ctx.actor,
        uniqueKey: `shp:${row.id}:delivered`,
      },
    });
    await history().record({
      orderId,
      type: 'SHIPMENT_DELIVERED',
      description: `${ctx.description} (shipment #${row.id}, ${ctx.deliveredAt})`,
      previousValue: { deliveryStatus: row.deliveryStatus ?? null },
      newValue: {
        shipmentId: row.id,
        deliveryStatus: 'DELIVERED',
        deliveredAt: ctx.deliveredAt,
        deliverySource: ctx.source,
      },
      actor: ctx.actor,
    });
    const state = await orders().computeOrderState(orderId);
    ctx.collector.emit({
      type: 'SHIPMENT_DELIVERED',
      orderId,
      payload: {
        shipmentId: row.id,
        deliveredAt: ctx.deliveredAt,
        allDelivered:
          orderDeliveryStatus(state.order.fulfillmentStatus, state.shipments) === 'DELIVERED',
        notify: ctx.notifyCustomer && state.order.orderStatus === 'OPEN',
      },
    });
    return true;
  };

  const confirmDelivery = async (
    shipmentId: number | string,
    input: { deliveredAt: string; notifyCustomer?: boolean },
    actor: string
  ): Promise<ShipmentView> => {
    const first = await loadRow(Number(shipmentId));
    const orderId = idOf(first.order) as number;
    const notifyCustomer = input?.notifyCustomer === undefined ? true : input.notifyCustomer;
    if (typeof notifyCustomer !== 'boolean') {
      throw new EcommerceValidationError('Invalid delivery', [
        { path: 'notifyCustomer', code: 'invalid' },
      ]);
    }
    const collector = events().collector();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(first.id);
      const state = await orders().computeOrderState(orderId);
      if (state.order.orderStatus === 'ARCHIVED' || row.status !== 'ACTIVE') throw notAvailable();
      if (row.deliveryStatus === 'DELIVERED') throw invalid('status', 'ALREADY_DELIVERED');
      const issues = validateDeliveryDate(
        input?.deliveredAt,
        row.shippedAt ?? row.createdAt,
        new Date()
      );
      if (issues.length) throw new EcommerceValidationError('Invalid delivery', issues);
      const deliveredAt = new Date(input.deliveredAt).toISOString();
      const done = await markDelivered(row, orderId, {
        deliveredAt,
        source: 'MANUAL',
        actor,
        description: 'Delivery confirmed manually',
        notifyCustomer,
        collector,
      });
      if (!done) throw invalid('status', 'ALREADY_DELIVERED');
    });
    await collector.flush();
    return viewOf(first.id);
  };

  const updateTracking = async (
    shipmentId: number | string,
    input: { trackingCode?: string | null; trackingUrl?: string | null },
    actor: string
  ): Promise<ShipmentView> => {
    const u = uids();
    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const errors: ValidationIssue[] = [];
    const data: Record<string, string | null> = {};
    if (raw.trackingCode !== undefined) {
      const code = clean(raw.trackingCode) || null;
      if (code && code.length > MAX_TEXT) errors.push({ path: 'trackingCode', code: 'too_long' });
      data.trackingCode = code;
    }
    if (raw.trackingUrl !== undefined) {
      const url = clean(raw.trackingUrl) || null;
      if (url && !isHttpUrl(url)) errors.push({ path: 'trackingUrl', code: 'invalid_url' });
      data.trackingUrl = url;
    }
    if (!Object.keys(data).length) errors.push({ path: 'trackingCode', code: 'required' });
    if (errors.length) throw new EcommerceValidationError('Invalid tracking', errors);

    const first = await loadRow(Number(shipmentId));
    const orderId = idOf(first.order) as number;
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(first.id);
      if (row.status === 'CANCELLED') throw notAvailable();
      const now = new Date().toISOString();
      await strapi.db.query(u.shipment).update({ where: { id: row.id }, data });
      await strapi.db.query(u.shipmentEvent).create({
        data: {
          shipment: row.id,
          order: orderId,
          type: 'TRACKING_UPDATED',
          code: 'TRACKING_UPDATED',
          description: 'Tracking updated',
          occurredAt: now,
          source: 'ADMIN',
          actor,
          uniqueKey: `shp:${row.id}:tracking:${randomUUID()}`,
        },
      });
      await history().record({
        orderId,
        type: 'SHIPMENT_TRACKING_UPDATED',
        description: `Shipment #${row.id} tracking updated`,
        previousValue: {
          trackingCode: row.trackingCode ?? null,
          trackingUrl: row.trackingUrl ?? null,
        },
        newValue: { shipmentId: row.id, ...data },
        actor,
      });
    });
    return viewOf(first.id);
  };

  /** Events the adapter returned, malformed ones dropped. */
  const validTrackingEvents = (raw: unknown): CarrierTrackingEvent[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e: any) =>
          e &&
          typeof e.code === 'string' &&
          e.code.trim() &&
          typeof e.occurredAt === 'string' &&
          !Number.isNaN(new Date(e.occurredAt).getTime())
      )
      .map((e: any) => ({
        code: e.code.trim().slice(0, MAX_TEXT),
        description: typeof e.description === 'string' ? e.description : '',
        occurredAt: new Date(e.occurredAt).toISOString(),
        delivered: e.delivered === true,
      }))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  };

  /** Manual action only (no cron): fetches the carrier events and marks the delivery. */
  const refreshTracking = async (
    shipmentId: number | string,
    actor: string
  ): Promise<ShipmentView> => {
    const u = uids();
    const first = await loadRow(Number(shipmentId));
    const orderId = idOf(first.order) as number;
    if (first.providerId === 'manual') throw invalid('shipment', 'NOT_SUPPORTED');
    if (first.status !== 'ACTIVE' || !first.externalId) throw notAvailable();
    const carrier = await carrierWith(first.providerId, 'track');
    // Never inside a transaction: the carrier may be slow.
    const fetched = await withTimeout(
      carrier.adapter.track!(
        { externalId: first.externalId, trackingCode: first.trackingCode ?? null },
        carrier.runtime,
        { timeoutMs: CARRIER_CALL_TIMEOUT_MS }
      ),
      CARRIER_CALL_TIMEOUT_MS + BACKSTOP_GRACE_MS,
      false
    );
    const trackingEvents = validTrackingEvents(fetched);

    const collector = events().collector();
    await strapi.db.transaction(async () => {
      await orders().lockOrder(orderId);
      const row = await loadRow(first.id);
      if (row.status !== 'ACTIVE') throw invalid('status', 'SHIPMENT_STATE_CHANGED');
      // Carrier timestamps are normalised, never rejected: never in the future, never before
      // the shipment. The dedup key keeps the carrier's own value so it stays stable.
      const shippedMs = new Date(row.shippedAt ?? row.createdAt).getTime();
      const clamp = (iso: string): string => {
        let ms = Math.min(new Date(iso).getTime(), Date.now());
        if (!Number.isNaN(shippedMs)) ms = Math.max(ms, shippedMs);
        return new Date(ms).toISOString();
      };
      for (const e of trackingEvents) {
        const uniqueKey = `trk:${row.id}:${e.code}:${e.occurredAt}`;
        const dup = await strapi.db.query(u.shipmentEvent).findOne({ where: { uniqueKey } });
        if (dup) continue;
        await strapi.db.query(u.shipmentEvent).create({
          data: {
            shipment: row.id,
            order: orderId,
            type: 'TRACKING',
            code: e.code,
            description: e.description || null,
            occurredAt: clamp(e.occurredAt),
            source: 'CARRIER',
            actor: `carrier:${row.providerId}`,
            uniqueKey,
          },
        });
      }
      const delivered = trackingEvents.find((e) => e.delivered);
      if (delivered && row.deliveryStatus !== 'DELIVERED') {
        // A false result means a concurrent confirmation won under the order lock: nothing to add.
        await markDelivered(row, orderId, {
          deliveredAt: clamp(delivered.occurredAt),
          source: 'CARRIER',
          actor: `carrier:${row.providerId}`,
          description: 'Delivery confirmed by the carrier',
          notifyCustomer: true,
          collector,
        });
      }
    });
    await collector.flush();
    return viewOf(first.id);
  };

  return {
    create,
    retry,
    cancel,
    getLabel,
    listForOrder,
    confirmDelivery,
    updateTracking,
    refreshTracking,
  };
};

export default EcommerceShipmentService;
