import { describe, it, expect } from 'vitest';
import {
  buildShipmentInput,
  canShipByCarrier,
  defaultDeliveredAtInput,
  defaultShipLines,
  deliveredAtInputToIso,
  emptyShipForm,
  isHttpUrl,
  isStuckPendingShipment,
  isUncertainShipment,
  mapServerFieldErrors,
  resolveDeliveredAt,
  shipmentActions,
  STUCK_PENDING_SHIPMENT_MS,
  validateShipForm,
  validateTrackingForm,
  type ShipForm,
} from '../../../admin/src/ecommerce/utils/shipmentForm';
import type { ShipmentView } from '../../../admin/src/ecommerce/orderTypes';

const lines = [
  { id: 1, pending: 3 },
  { id: 2, pending: 0 },
  { id: 3, pending: 1 },
];

const form = (overrides: Partial<ShipForm> = {}): ShipForm => ({
  lines: [
    { orderLineId: 1, quantity: '3' },
    { orderLineId: 3, quantity: '1' },
  ],
  mode: 'MANUAL',
  carrierName: 'CTT',
  trackingCode: '',
  trackingUrl: '',
  shippingCost: '4,50',
  notifyCustomer: true,
  ...overrides,
});

const shipment = (overrides: Partial<ShipmentView> = {}): ShipmentView => ({
  id: 7,
  status: 'ACTIVE',
  providerId: 'manual',
  serviceId: null,
  carrierName: 'CTT',
  items: [],
  trackingCode: null,
  trackingUrl: null,
  shippingCost: 0,
  labelAvailable: false,
  deliveryStatus: 'IN_TRANSIT',
  deliverySource: null,
  shippedAt: '2026-11-10T10:00:00.000Z',
  deliveredAt: null,
  cancelledAt: null,
  error: null,
  createdAt: '2026-11-10T10:00:00.000Z',
  events: [],
  ...overrides,
});

describe('defaultShipLines', () => {
  it('lists only lines with units left to ship, defaulting to the pending quantity', () => {
    expect(defaultShipLines(lines)).toEqual([
      { orderLineId: 1, quantity: '3' },
      { orderLineId: 3, quantity: '1' },
    ]);
  });
});

describe('emptyShipForm', () => {
  it('prefills the carrier from the order method and the cost from the remaining shipping', () => {
    const f = emptyShipForm(
      { lines, shippingMethod: { providerId: 'manual', name: 'Standard' }, shipping: { remainingCost: 450, deliveryStatus: 'NONE' } },
      'pt-PT'
    );
    expect(f).toMatchObject({ mode: 'MANUAL', carrierName: 'Standard', shippingCost: '4,50', notifyCustomer: true });
    expect(f.lines).toHaveLength(2);
  });
});

describe('canShipByCarrier', () => {
  it('only for an order whose method belongs to a carrier', () => {
    expect(canShipByCarrier({ providerId: 'ctt' })).toBe(true);
    expect(canShipByCarrier({ providerId: 'manual' })).toBe(false);
    expect(canShipByCarrier(null)).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) and rejects other schemes', () => {
    expect(isHttpUrl('https://track.example/1')).toBe(true);
    expect(isHttpUrl('http://track.example')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl(`https://x.example/${'a'.repeat(2000)}`)).toBe(false);
  });
});

describe('validateShipForm', () => {
  it('accepts a valid manual shipment', () => {
    expect(validateShipForm(form(), lines)).toEqual({});
  });

  it('refuses a quantity above the pending one', () => {
    expect(validateShipForm(form({ lines: [{ orderLineId: 1, quantity: '4' }] }), lines)).toEqual({
      'lines.1': 'QUANTITY_EXCEEDS_PENDING',
    });
  });

  it('refuses invalid quantities and an empty shipment', () => {
    expect(validateShipForm(form({ lines: [{ orderLineId: 1, quantity: '1.5' }] }), lines)).toEqual({
      'lines.1': 'invalid_quantity',
    });
    expect(
      validateShipForm(
        form({ lines: [{ orderLineId: 1, quantity: '0' }, { orderLineId: 3, quantity: '' }] }),
        lines
      )
    ).toEqual({ lines: 'required' });
  });

  it('refuses a javascript: tracking URL', () => {
    expect(validateShipForm(form({ trackingUrl: 'javascript:alert(1)' }), lines)).toEqual({
      trackingUrl: 'invalid_url',
    });
  });

  it('requires the carrier name for a manual shipment, not for a carrier one', () => {
    expect(validateShipForm(form({ carrierName: '  ' }), lines)).toEqual({ carrierName: 'required' });
    expect(validateShipForm(form({ mode: 'CARRIER', carrierName: '', trackingUrl: 'javascript:x' }), lines)).toEqual(
      {}
    );
    expect(validateShipForm(form({ carrierName: 'x'.repeat(121) }), lines)).toEqual({ carrierName: 'too_long' });
  });

  it('checks the cost', () => {
    expect(validateShipForm(form({ shippingCost: 'abc' }), lines)).toEqual({ shippingCost: 'invalid_amount' });
    expect(validateShipForm(form({ shippingCost: '0' }), lines)).toEqual({});
  });
});

describe('buildShipmentInput', () => {
  it('sends only the lines with a quantity and the manual fields when manual', () => {
    const f = form({ lines: [{ orderLineId: 1, quantity: '2' }, { orderLineId: 3, quantity: '0' }], trackingCode: ' AB1 ' });
    expect(buildShipmentInput(f, 'key-1')).toEqual({
      lines: [{ orderLineId: 1, quantity: 2 }],
      method: { mode: 'MANUAL', carrierName: 'CTT', trackingCode: 'AB1' },
      shippingCost: 450,
      notifyCustomer: true,
      idempotencyKey: 'key-1',
    });
  });

  it('sends a bare carrier method', () => {
    const input = buildShipmentInput(form({ mode: 'CARRIER', notifyCustomer: false }), 'k');
    expect(input.method).toEqual({ mode: 'CARRIER' });
    expect(input.notifyCustomer).toBe(false);
  });
});

describe('validateTrackingForm', () => {
  it('checks the URL and the code length', () => {
    expect(validateTrackingForm({ trackingCode: 'A', trackingUrl: 'https://t.example' })).toEqual({});
    expect(validateTrackingForm({ trackingCode: '', trackingUrl: 'javascript:alert(1)' })).toEqual({
      trackingUrl: 'invalid_url',
    });
    expect(validateTrackingForm({ trackingCode: 'x'.repeat(256), trackingUrl: '' })).toEqual({
      trackingCode: 'too_long',
    });
  });
});

describe('resolveDeliveredAt', () => {
  const now = new Date(2026, 10, 11, 9, 5, 42, 300);
  it('sends the real current time when the default (truncated to the minute) was left untouched', () => {
    const def = defaultDeliveredAtInput(now);
    // Shipped at 09:05:10 and delivered in the same minute: the minute-truncated default would be
    // before the shipment, the real time is not.
    expect(resolveDeliveredAt(def, def, now)).toBe(now.toISOString());
    expect(Date.parse(resolveDeliveredAt(def, def, now)!)).toBeGreaterThan(new Date(2026, 10, 11, 9, 5, 10).getTime());
  });

  it('uses the value the admin typed, null when invalid', () => {
    const def = defaultDeliveredAtInput(now);
    expect(resolveDeliveredAt('2026-11-10T18:30', def, now)).toBe(new Date(2026, 10, 10, 18, 30).toISOString());
    expect(resolveDeliveredAt('nope', def, now)).toBeNull();
  });
});

describe('mapServerFieldErrors', () => {
  it('maps lines.<index>.* to lines.<orderLineId>, known fields to form paths, the rest to other', () => {
    const sent = [{ orderLineId: 7 }, { orderLineId: 9 }];
    expect(
      mapServerFieldErrors(
        [
          { path: 'lines.1.quantity', code: 'QUANTITY_EXCEEDS_PENDING' },
          { path: 'lines.5.quantity', code: 'invalid_quantity' },
          { path: 'method.trackingUrl', code: 'invalid_url' },
          { path: 'action', code: 'ACTION_NOT_AVAILABLE' },
        ],
        sent,
        { 'method.trackingUrl': 'trackingUrl', lines: 'lines' }
      )
    ).toEqual({
      errors: { 'lines.9': 'QUANTITY_EXCEEDS_PENDING', lines: 'invalid_quantity', trackingUrl: 'invalid_url' },
      other: 'ACTION_NOT_AVAILABLE',
    });
  });
});

describe('delivery date input', () => {
  it('defaults to the local current minute and converts back to ISO', () => {
    const now = new Date(2026, 10, 11, 9, 5, 30);
    expect(defaultDeliveredAtInput(now)).toBe('2026-11-11T09:05');
    expect(deliveredAtInputToIso('2026-11-11T09:05')).toBe(new Date(2026, 10, 11, 9, 5).toISOString());
    expect(deliveredAtInputToIso('')).toBeNull();
    expect(deliveredAtInputToIso('2026-13-40T99:99')).toBeNull();
  });
});

describe('shipmentActions', () => {
  const ctx = { orderStatus: 'OPEN' as const, canManage: true };

  it('active manual shipment in transit: deliver, tracking, cancel', () => {
    expect(shipmentActions(shipment(), ctx)).toEqual(['DELIVER', 'TRACKING', 'CANCEL']);
  });

  it('active carrier shipment with a label: also refresh and label', () => {
    expect(shipmentActions(shipment({ providerId: 'ctt', labelAvailable: true }), ctx)).toEqual([
      'DELIVER',
      'TRACKING',
      'REFRESH',
      'LABEL',
      'CANCEL',
    ]);
  });

  it('delivered: only tracking (and label)', () => {
    expect(shipmentActions(shipment({ deliveryStatus: 'DELIVERED' }), ctx)).toEqual(['TRACKING']);
  });

  it('uncertain pending: retry only (the server refuses to cancel it)', () => {
    const s = shipment({ status: 'PENDING', providerId: 'ctt', error: 'UNCERTAIN', deliveryStatus: null });
    expect(isUncertainShipment(s)).toBe(true);
    expect(shipmentActions(s, ctx)).toEqual(['RETRY']);
  });

  it('pending without outcome: nothing while recent, retry once stale (process died mid-create)', () => {
    const now = Date.parse('2026-11-11T10:00:00.000Z');
    const recent = shipment({ status: 'PENDING', providerId: 'ctt', error: null, createdAt: '2026-11-11T09:59:30.000Z' });
    const stale = shipment({ status: 'PENDING', providerId: 'ctt', error: null, createdAt: '2026-11-11T09:57:00.000Z' });
    expect(isStuckPendingShipment(recent, now)).toBe(false);
    expect(shipmentActions(recent, { ...ctx, now })).toEqual([]);
    expect(isStuckPendingShipment(stale, now)).toBe(true);
    expect(shipmentActions(stale, { ...ctx, now })).toEqual(['RETRY']);
    expect(STUCK_PENDING_SHIPMENT_MS).toBe(120_000);
  });

  it('failed: cancel only', () => {
    expect(shipmentActions(shipment({ status: 'FAILED', error: 'CARRIER_REQUEST_FAILED' }), ctx)).toEqual(['CANCEL']);
  });

  it('cancelled or archived: nothing to do; without orders.manage only the label', () => {
    expect(shipmentActions(shipment({ status: 'CANCELLED' }), ctx)).toEqual([]);
    expect(shipmentActions(shipment({ labelAvailable: true }), { orderStatus: 'ARCHIVED', canManage: true })).toEqual([
      'LABEL',
    ]);
    expect(shipmentActions(shipment({ labelAvailable: true }), { orderStatus: 'OPEN', canManage: false })).toEqual([
      'LABEL',
    ]);
  });
});
