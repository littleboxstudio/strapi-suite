import { describe, it, expect } from 'vitest';
import {
  asksParcels,
  buildShipmentInput,
  cancelWarningId,
  isRetryUnsafeShipment,
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
  shipResultMessageId,
  shipmentActions,
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
  parcels: '1',
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
  retryable: false,
  carrierSupport: null,
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
      { lines, shippingMethod: { providerId: 'manual', name: 'Standard' }, shipping: { remainingCost: 450, deliveryStatus: 'NONE' } } as any,
      'pt-PT'
    );
    expect(f).toMatchObject({ mode: 'MANUAL', carrierName: 'Standard', shippingCost: '4,50', notifyCustomer: true });
    expect(f.lines).toHaveLength(2);
  });
});

describe('parcels (DPD)', () => {
  const dpd = { retry: false, cancel: false, tracking: false };

  it('are asked only for a DPD Portugal order', () => {
    expect(asksParcels({ providerId: 'dpd-portugal', serviceId: 'EXPRESS' })).toBe(true);
    expect(asksParcels({ providerId: 'ctt-expresso' })).toBe(false);
    expect(asksParcels({ providerId: 'manual' })).toBe(false);
    expect(asksParcels(null)).toBe(false);
  });

  it('default to 1', () => {
    const f = emptyShipForm(
      { lines, shippingMethod: { providerId: 'dpd-portugal', name: 'DPD' }, shipping: { remainingCost: 0 } } as any,
      'en'
    );
    expect(f.parcels).toBe('1');
  });

  it('must be an integer 1–99 for a carrier shipment that asks for them', () => {
    const carrier = (parcels: string) => form({ mode: 'CARRIER', parcels });
    for (const bad of ['0', '100', '1.5', '', 'x', '-1']) {
      expect(validateShipForm(carrier(bad), lines, { parcels: true })).toEqual({ parcels: 'invalid' });
    }
    expect(validateShipForm(carrier('99'), lines, { parcels: true })).toEqual({});
    // Not asked (another carrier), or a manual shipment: ignored.
    expect(validateShipForm(carrier('0'), lines)).toEqual({});
    expect(validateShipForm(form({ parcels: '0' }), lines, { parcels: true })).toEqual({});
  });

  it('are sent only with a carrier shipment that asks for them', () => {
    expect(buildShipmentInput(form({ mode: 'CARRIER', parcels: ' 2 ' }), 'k', { parcels: true }).parcels).toBe(2);
    expect(buildShipmentInput(form({ mode: 'CARRIER', parcels: '2' }), 'k')).not.toHaveProperty('parcels');
    expect(buildShipmentInput(form({ parcels: '2' }), 'k', { parcels: true })).not.toHaveProperty('parcels');
  });

  it('an uncertain DPD shipment offers "Mark as failed", never "Retry"', () => {
    const ctx = { orderStatus: 'OPEN' as const, canManage: true };
    const s = shipment({
      status: 'PENDING',
      providerId: 'dpd-portugal',
      error: 'UNCERTAIN',
      deliveryStatus: null,
      retryable: true,
      carrierSupport: dpd,
    });
    expect(isRetryUnsafeShipment(s)).toBe(true);
    expect(shipmentActions(s, ctx)).toEqual(['MARK_FAILED']);
    expect(isRetryUnsafeShipment(shipment({ ...s, retryable: false }))).toBe(false);
    expect(shipmentActions(shipment({ ...s, retryable: false }), ctx)).toEqual([]);
    expect(
      isRetryUnsafeShipment(shipment({ ...s, carrierSupport: { retry: true, cancel: true, tracking: true } }))
    ).toBe(false);
  });

  it('an active DPD shipment has no tracking refresh (no DPD tracking API)', () => {
    const ctx = { orderStatus: 'OPEN' as const, canManage: true };
    expect(
      shipmentActions(shipment({ providerId: 'dpd-portugal', labelAvailable: true, carrierSupport: dpd }), ctx)
    ).toEqual(['DELIVER', 'TRACKING', 'LABEL', 'CANCEL']);
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
    const s = shipment({ status: 'PENDING', providerId: 'ctt', error: 'UNCERTAIN', deliveryStatus: null, retryable: true });
    expect(isUncertainShipment(s)).toBe(true);
    expect(shipmentActions(s, ctx)).toEqual(['RETRY']);
  });

  it('pending without outcome: retry follows the server flag, never the browser clock', () => {
    // Created long ago by the browser clock, but the server says it is not stale yet.
    const recent = shipment({ status: 'PENDING', providerId: 'ctt', error: null, createdAt: '2000-01-01T00:00:00.000Z', retryable: false });
    const stale = shipment({ status: 'PENDING', providerId: 'ctt', error: null, createdAt: '2999-01-01T00:00:00.000Z', retryable: true });
    expect(isStuckPendingShipment(recent)).toBe(false);
    expect(shipmentActions(recent, ctx)).toEqual([]);
    expect(isStuckPendingShipment(stale)).toBe(true);
    expect(shipmentActions(stale, ctx)).toEqual(['RETRY']);
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

describe('shipResultMessageId', () => {
  const dpd = { retry: false, cancel: false, tracking: false };
  const pending = (over: Partial<ShipmentView> = {}) =>
    shipment({ status: 'PENDING', providerId: 'dpd-portugal', deliveryStatus: null, carrierSupport: dpd, ...over });

  it('an ACTIVE shipment: success', () => {
    expect(shipResultMessageId(shipment())).toBe('ecommerce.orders.ship.success');
  });

  it('a retry-unsafe PENDING shipment that is retryable (uncertain or stuck): CARRIER_RETRY_UNSAFE', () => {
    expect(shipResultMessageId(pending({ error: 'UNCERTAIN', retryable: true }))).toBe(
      'ecommerce.orders.errors.CARRIER_RETRY_UNSAFE'
    );
  });

  it('a PENDING DPD shipment not yet retryable: the pending hint', () => {
    expect(shipResultMessageId(pending({ retryable: false }))).toBe('ecommerce.orders.ship.uncertain');
  });

  it('a PENDING shipment at a carrier that can retry: the pending hint', () => {
    expect(
      shipResultMessageId(pending({ retryable: true, carrierSupport: { retry: true, cancel: true, tracking: true } }))
    ).toBe('ecommerce.orders.ship.uncertain');
  });
});

describe('cancelWarningId', () => {
  const dpd = { retry: false, cancel: false, tracking: false };

  it('a manual shipment: the plain warning', () => {
    expect(cancelWarningId(shipment())).toBe('ecommerce.orders.shipments.cancel.warning');
  });

  it('an ACTIVE DPD shipment (at the carrier): cancel it also on the portal', () => {
    expect(cancelWarningId(shipment({ providerId: 'dpd-portugal', carrierSupport: dpd }))).toBe(
      'ecommerce.orders.shipments.cancel.localWarning'
    );
  });

  it('an ACTIVE shipment at a carrier with a cancel API: cancelled at the carrier first', () => {
    expect(
      cancelWarningId(
        shipment({ providerId: 'ctt-expresso', carrierSupport: { retry: true, cancel: true, tracking: true } })
      )
    ).toBe('ecommerce.orders.shipments.cancel.carrierWarning');
  });

  it('a FAILED carrier shipment never reached the carrier: the plain warning', () => {
    expect(
      cancelWarningId(shipment({ status: 'FAILED', providerId: 'dpd-portugal', deliveryStatus: null, carrierSupport: dpd }))
    ).toBe('ecommerce.orders.shipments.cancel.warning');
  });
});
