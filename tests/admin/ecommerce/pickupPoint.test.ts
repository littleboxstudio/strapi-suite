import { describe, it, expect } from 'vitest';
import {
  formatOpeningHours,
  normalizePickupPostalCode,
  pickupPointLines,
  pickupSearchErrorCode,
  pickupSelectionInput,
  pickupNeeded,
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
