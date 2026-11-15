import { describe, it, expect } from 'vitest';
import {
  formatOpeningHours,
  normalizePickupPostalCode,
  pickupPointLines,
  pickupSearchErrorCode,
  pickupSelectionInput,
  pickupNeeded,
  isStorePickupMethod,
  keptPickup,
  orderPointKept,
  pickupErrorId,
  storeChoices,
  storeSelection,
} from '../../../admin/src/ecommerce/utils/pickupPoints';
import {
  buildCreateOrderInput,
  buildQuoteInput,
  emptyOrderForm,
  validateOrderForm,
  type OrderForm,
} from '../../../admin/src/ecommerce/utils/orderForm';
import { API_ERROR_CODES } from '../../../admin/src/ecommerce/utils/orderDetail';
import type { PickupPoint } from '../../../admin/src/ecommerce/orderTypes';
import en from '../../../admin/src/core/translations/en.json';
import pt from '../../../admin/src/core/translations/pt.json';

const POINT: PickupPoint = {
  id: 'PT12345',
  name: 'Papelaria Central',
  address: 'Rua do Ponto 10',
  address2: 'Loja B',
  postalCode: '4000-200',
  city: 'Porto',
  country: 'PT',
  openingHours: [
    { day: 1, from: '09:00', to: '13:00' },
    { day: 1, from: '14:00', to: '19:00' },
    { day: 2, from: '09:00', to: '13:00' },
    { day: 2, from: '14:00', to: '19:00' },
    { day: 3, from: '09:00', to: '13:00' },
    { day: 3, from: '14:00', to: '19:00' },
    { day: 6, from: '09:00', to: '13:00' },
  ],
};

const dayName = (d: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1];

describe('normalizePickupPostalCode', () => {
  it('accepts NNNN-NNN and NNNNNNN, trimmed', () => {
    expect(normalizePickupPostalCode(' 4000-200 ')).toBe('4000-200');
    expect(normalizePickupPostalCode('4000200')).toBe('4000-200');
  });

  it('refuses anything else', () => {
    expect(normalizePickupPostalCode('')).toBeNull();
    expect(normalizePickupPostalCode('4000')).toBeNull();
    expect(normalizePickupPostalCode('4000-20a')).toBeNull();
    expect(normalizePickupPostalCode('28001')).toBeNull();
  });
});

describe('formatOpeningHours', () => {
  it('groups consecutive days with the same hours', () => {
    expect(formatOpeningHours(POINT.openingHours, dayName)).toEqual([
      'Mon–Wed 09:00–13:00, 14:00–19:00',
      'Sat 09:00–13:00',
    ]);
  });

  it('no hours → empty', () => {
    expect(formatOpeningHours([], dayName)).toEqual([]);
  });

  it('days out of order are sorted; a single day is not a range', () => {
    expect(
      formatOpeningHours(
        [
          { day: 5, from: '10:00', to: '18:00' },
          { day: 4, from: '10:00', to: '18:00' },
          { day: 7, from: '10:00', to: '12:00' },
        ],
        dayName
      )
    ).toEqual(['Thu–Fri 10:00–18:00', 'Sun 10:00–12:00']);
  });
});

describe('pickupPointLines', () => {
  it('name, address with line 2, postal code and city', () => {
    expect(pickupPointLines(POINT)).toEqual({
      name: 'Papelaria Central',
      address: 'Rua do Ponto 10, Loja B',
      place: '4000-200 Porto',
    });
    expect(pickupPointLines({ ...POINT, address2: null }).address).toBe('Rua do Ponto 10');
  });
});

describe('pickupSelectionInput', () => {
  it('the id and the searched postal code', () => {
    expect(pickupSelectionInput({ point: POINT, postalCode: '4000-200' })).toEqual({
      pickupPointId: 'PT12345',
      pickupPostalCode: '4000-200',
    });
  });

  it('nothing chosen → empty', () => {
    expect(pickupSelectionInput(null)).toEqual({});
  });
});

describe('pickupNeeded', () => {
  const pickup = { providerId: 'dpd-portugal', serviceId: 'PICKUP', requiresPickupPoint: true };
  const manual = { providerId: 'manual', serviceId: '1' };

  it('an option requiring a point needs one, unless the order already has one', () => {
    expect(pickupNeeded(pickup, false)).toBe('REQUIRED');
    expect(pickupNeeded(pickup, true)).toBe('OPTIONAL');
    expect(pickupNeeded(manual, true)).toBe('NONE');
    expect(pickupNeeded(null, false)).toBe('NONE');
  });
});

describe('pickupSearchErrorCode', () => {
  const failure = (code?: string) => ({ response: { data: { error: { details: code ? { code } : {} } } } });

  it('the server code when known, else PICKUP_SEARCH_FAILED', () => {
    expect(pickupSearchErrorCode(failure('INVALID_POSTAL_CODE'))).toBe('INVALID_POSTAL_CODE');
    expect(pickupSearchErrorCode(failure('PICKUP_NOT_AVAILABLE'))).toBe('PICKUP_NOT_AVAILABLE');
    expect(pickupSearchErrorCode(failure('SOMETHING_ELSE'))).toBe('PICKUP_SEARCH_FAILED');
    expect(pickupSearchErrorCode(new Error('network'))).toBe('PICKUP_SEARCH_FAILED');
  });
});

describe('manual order form with a pickup point', () => {
  const base = (): OrderForm => ({
    ...emptyOrderForm('en'),
    customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt', phone: '' },
    shippingAddress: {
      firstName: 'Ana',
      lastName: 'Silva',
      company: '',
      nif: '',
      line1: 'Rua do Cliente 5',
      line2: '',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
      phone: '',
    },
    lines: [{ variantId: 10, name: 'Shirt', option: null, sku: 'SH', price: 2000, quantity: 1 } as any],
    shipping: { providerId: 'dpd-portugal', serviceId: 'PICKUP', requiresPickupPoint: true },
  });

  it('a pickup option without a point → PICKUP_POINT_REQUIRED on pickupPointId', () => {
    expect(validateOrderForm(base())).toContainEqual({ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' });
    expect(
      validateOrderForm({ ...base(), pickup: { point: POINT, postalCode: '4000-200' } }).map((e) => e.path)
    ).not.toContain('pickupPointId');
  });

  it('the create input sends the point and only the method ids', () => {
    const input = buildCreateOrderInput({ ...base(), pickup: { point: POINT, postalCode: '4000-200' } }, 'key-1');
    expect(input.shipping).toEqual({ providerId: 'dpd-portugal', serviceId: 'PICKUP' });
    expect(input.pickupPointId).toBe('PT12345');
    expect(input.pickupPostalCode).toBe('4000-200');
    expect(input.shippingAddress.postalCode).toBe('1000-001');
  });

  it('the price quote uses the point postal code (the delivery address)', () => {
    const q = buildQuoteInput({ ...base(), pickup: { point: POINT, postalCode: '4000-200' } }, {});
    expect(q.shipping).toEqual({
      country: 'PT',
      postalCode: '4000-200',
      providerId: 'dpd-portugal',
      serviceId: 'PICKUP',
    });
  });

  it('without pickup nothing changes', () => {
    const form = { ...base(), shipping: { providerId: 'manual', serviceId: '1' } };
    const input = buildCreateOrderInput(form, 'key-1');
    expect(input).not.toHaveProperty('pickupPointId');
    expect(validateOrderForm(form).map((e) => e.path)).not.toContain('pickupPointId');
  });
});

describe('pickup admin texts', () => {
  it('PICKUP_ADDRESS_LOCKED is a known code with the EN and PT texts', () => {
    expect(API_ERROR_CODES).toContain('PICKUP_ADDRESS_LOCKED');
    const key = 'littlebox-strapi-suite.ecommerce.orders.errors.PICKUP_ADDRESS_LOCKED';
    expect((en as Record<string, string>)[key]).toBe(
      'The delivery address is the pickup point. Choose another pickup point to change it.'
    );
    expect((pt as Record<string, string>)[key]).toBe(
      'A morada de entrega é o ponto Pickup. Escolha outro ponto para a alterar.'
    );
  });
});

// ---------------------------------------------------------------------------
// Store pickup (store pickup spec 6)
// ---------------------------------------------------------------------------

const STORE = {
  id: 'st_lisboa',
  name: 'Loja Chiado',
  address: 'Rua Garrett 1',
  address2: null,
  postalCode: '1200-203',
  city: 'Lisboa',
  country: 'PT',
};
const STORE_2 = { ...STORE, id: 'st_porto', name: 'Loja Porto', postalCode: '4000-100', city: 'Porto' };
const storeOption = {
  providerId: 'store-pickup',
  serviceId: 'STORE',
  requiresPickupPoint: true,
  pickupPoints: [STORE, STORE_2],
};
const dpdPickup = { providerId: 'dpd-portugal', serviceId: 'PICKUP', requiresPickupPoint: true };

describe('store pickup in the pickers', () => {
  it('isStorePickupMethod: only the store-pickup provider', () => {
    expect(isStorePickupMethod(storeOption)).toBe(true);
    expect(isStorePickupMethod(dpdPickup)).toBe(false);
    expect(isStorePickupMethod(null)).toBe(false);
  });

  it('storeChoices: the stores of a store option; null for a DPD or plain option', () => {
    expect(storeChoices(storeOption)).toEqual([STORE, STORE_2]);
    expect(storeChoices(dpdPickup)).toBeNull();
    expect(storeChoices(null)).toBeNull();
  });

  it('a chosen store sends only its id (no postal code search)', () => {
    const selection = storeSelection(STORE);
    expect(selection.point).toMatchObject({ id: 'st_lisboa', name: 'Loja Chiado', postalCode: '1200-203' });
    expect(pickupSelectionInput(selection)).toEqual({ pickupPointId: 'st_lisboa' });
  });

  it('orderPointKept: the order point counts only for the same kind of method', () => {
    const storeOrder = { providerId: 'store-pickup', serviceId: 'STORE' };
    const dpdOrder = { providerId: 'dpd-portugal', serviceId: 'PICKUP' };
    expect(orderPointKept(storeOrder, true, storeOption)).toBe(true);
    expect(orderPointKept(dpdOrder, true, dpdPickup)).toBe(true);
    expect(orderPointKept(dpdOrder, true, storeOption)).toBe(false);
    expect(orderPointKept(storeOrder, true, dpdPickup)).toBe(false);
    expect(orderPointKept(storeOrder, false, storeOption)).toBe(false);
    expect(pickupNeeded(storeOption, orderPointKept(dpdOrder, true, storeOption))).toBe('REQUIRED');
  });

  it('keptPickup: the choice survives only the same option and, for stores, while still listed', () => {
    const chosen = storeSelection(STORE);
    const prev = { providerId: 'store-pickup', serviceId: 'STORE' };
    expect(keptPickup(prev, storeOption, chosen)).toBe(chosen);
    expect(keptPickup(prev, { ...storeOption, pickupPoints: [STORE_2] }, chosen)).toBeNull();
    expect(keptPickup(prev, dpdPickup, chosen)).toBeNull();
    expect(keptPickup(null, storeOption, chosen)).toBeNull();
    const dpdChoice = { point: POINT, postalCode: '4000-200' };
    expect(keptPickup({ providerId: 'dpd-portugal', serviceId: 'PICKUP' }, dpdPickup, dpdChoice)).toBe(dpdChoice);
    expect(keptPickup({ providerId: 'dpd-portugal', serviceId: 'PICKUP' }, storeOption, dpdChoice)).toBeNull();
    expect(keptPickup(prev, storeOption, null)).toBeNull();
  });

  it('pickupErrorId: store texts for the pickup codes in a store context', () => {
    expect(pickupErrorId('PICKUP_POINT_REQUIRED', true)).toBe('ecommerce.orders.pickup.store.errors.PICKUP_POINT_REQUIRED');
    expect(pickupErrorId('PICKUP_POINT_INVALID', true)).toBe('ecommerce.orders.pickup.store.errors.PICKUP_POINT_INVALID');
    expect(pickupErrorId('PICKUP_POINT_REQUIRED', false)).toBe('ecommerce.orders.errors.PICKUP_POINT_REQUIRED');
    expect(pickupErrorId('required', true)).toBe('ecommerce.orders.errors.required');
  });
});

describe('manual order form with a store', () => {
  const form = (): OrderForm => ({
    ...emptyOrderForm('en'),
    customer: { firstName: 'Ana', lastName: 'Silva', email: 'ana@example.pt', phone: '' },
    shippingAddress: {
      firstName: 'Ana',
      lastName: 'Silva',
      company: '',
      nif: '',
      line1: 'Rua do Cliente 5',
      line2: '',
      postalCode: '1000-001',
      city: 'Lisboa',
      country: 'PT',
      phone: '',
    },
    lines: [{ variantId: 10, name: 'Shirt', option: null, sku: 'SH', price: 2000, quantity: 1 } as any],
    shipping: { providerId: 'store-pickup', serviceId: 'STORE', requiresPickupPoint: true },
  });

  it('requires a store, then sends its id as pickupPointId without a postal code', () => {
    expect(validateOrderForm(form())).toContainEqual({ path: 'pickupPointId', code: 'PICKUP_POINT_REQUIRED' });
    const input = buildCreateOrderInput({ ...form(), pickup: storeSelection(STORE) }, 'key-1');
    expect(input.shipping).toEqual({ providerId: 'store-pickup', serviceId: 'STORE' });
    expect(input.pickupPointId).toBe('st_lisboa');
    expect(input).not.toHaveProperty('pickupPostalCode');
  });

  it('the price quote uses the store address', () => {
    const q = buildQuoteInput({ ...form(), pickup: storeSelection(STORE_2) }, {});
    expect(q.shipping).toMatchObject({ country: 'PT', postalCode: '4000-100', providerId: 'store-pickup' });
  });
});

describe('store pickup admin texts', () => {
  const keys = [
    'ecommerce.orders.pickup.store.title',
    'ecommerce.orders.pickup.store.label',
    'ecommerce.orders.pickup.store.placeholder',
    'ecommerce.orders.pickup.store.required',
    'ecommerce.orders.pickup.store.keep',
    'ecommerce.orders.pickup.store.current',
    'ecommerce.orders.pickup.store.change',
    'ecommerce.orders.pickup.store.locked',
    'ecommerce.orders.pickup.store.none',
    'ecommerce.orders.pickup.store.loadError',
    'ecommerce.orders.pickup.store.errors.PICKUP_POINT_REQUIRED',
    'ecommerce.orders.pickup.store.errors.PICKUP_POINT_INVALID',
    'ecommerce.orders.ship.storeHint',
    'ecommerce.orders.ship.confirm.storeText',
  ];

  it('every store key has an EN and a PT text', () => {
    for (const k of keys) {
      const key = `littlebox-strapi-suite.${k}`;
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((pt as Record<string, string>)[key], key).toBeTruthy();
    }
  });

  it('the ship notice copy', () => {
    const key = 'littlebox-strapi-suite.ecommerce.orders.ship.storeHint';
    expect((en as Record<string, string>)[key]).toBe(
      'The customer will be notified that the order is ready for pickup at {store}.'
    );
    expect((pt as Record<string, string>)[key]).toBe(
      'O cliente vai receber uma notificação de que a encomenda se encontra na loja {store}.'
    );
  });

  it('PICKUP_POINT_* codes are known and have texts', () => {
    for (const code of ['PICKUP_POINT_REQUIRED', 'PICKUP_POINT_INVALID']) {
      expect(API_ERROR_CODES).toContain(code);
      const key = `littlebox-strapi-suite.ecommerce.orders.errors.${code}`;
      expect((en as Record<string, string>)[key]).toBeTruthy();
      expect((pt as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
