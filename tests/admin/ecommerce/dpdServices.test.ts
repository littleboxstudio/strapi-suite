import { describe, it, expect } from 'vitest';
import {
  DPD_SERVICE_IDS,
  activeServiceCount,
  dpdServiceMarkets,
  dpdServicesErrorMap,
  dpdServicesToForm,
  formToDpdServices,
  withServiceActive,
} from '../../../admin/src/ecommerce/utils/dpdServicesForm';
import type { DpdServices } from '../../../admin/src/ecommerce/settingsTypes';

const SERVICES: DpdServices = {
  EXPRESS: {
    active: true,
    name: { pt: 'DPD Expresso', en: 'DPD Express' },
    tax: 23,
    rates: {
      PT: [
        { upTo: 2, price: 495 },
        { upTo: null, price: 990 },
      ],
      'PT-ISL': [{ upTo: null, price: 1500 }],
    },
  },
  PICKUP: { active: false, name: { pt: 'DPD Pickup' }, tax: 6, rates: {} },
};

describe('dpd services form', () => {
  it('lists both services, Express first', () => {
    expect(DPD_SERVICE_IDS).toEqual(['EXPRESS', 'PICKUP']);
  });

  it('round-trips the stored services', () => {
    const form = dpdServicesToForm(SERVICES, ['pt', 'en'], 'pt', ['PT', 'PT-ISL', 'ES']);
    expect(form.EXPRESS).toMatchObject({
      names: { pt: 'DPD Expresso', en: 'DPD Express' },
      markets: ['PT', 'PT-ISL'],
      brackets: {
        PT: [
          { upTo: '2', price: '4,95' },
          { upTo: '', price: '9,90' },
        ],
      },
      taxChoice: '23',
      active: true,
    });
    expect(form.PICKUP).toMatchObject({
      names: { pt: 'DPD Pickup', en: '' },
      markets: [],
      active: false,
    });
    expect(formToDpdServices(form, 'pt')).toEqual({ errors: {}, services: SERVICES });
  });

  it('drops markets that are no longer store markets', () => {
    const form = dpdServicesToForm(SERVICES, ['pt'], 'pt', ['PT']);
    expect(form.EXPRESS.markets).toEqual(['PT']);
    expect(formToDpdServices(form, 'pt').services?.EXPRESS.rates).toEqual({
      PT: SERVICES.EXPRESS.rates.PT,
    });
  });

  it('allows a service without markets (it serves no market)', () => {
    const form = dpdServicesToForm(SERVICES, ['pt'], 'pt', ['PT']);
    form.PICKUP.active = true;
    expect(formToDpdServices(form, 'pt').services?.PICKUP).toEqual({
      active: true,
      name: { pt: 'DPD Pickup' },
      tax: 6,
      rates: {},
    });
  });

  it('keys errors by service', () => {
    const form = dpdServicesToForm(SERVICES, ['pt'], 'pt', ['PT']);
    form.EXPRESS.names.pt = ' ';
    form.PICKUP.markets = ['PT'];
    form.PICKUP.brackets = { PT: [{ upTo: '', price: 'x' }] };
    expect(formToDpdServices(form, 'pt')).toEqual({
      errors: { 'EXPRESS.name.pt': 'required', 'PICKUP.rates.PT.0.price': 'invalid_number' },
    });
  });

  it('counts the active services', () => {
    expect(activeServiceCount(SERVICES)).toBe(1);
    expect(activeServiceCount(withServiceActive(SERVICES, 'PICKUP', true))).toBe(2);
    expect(activeServiceCount(withServiceActive(SERVICES, 'EXPRESS', false))).toBe(0);
    const form = dpdServicesToForm(SERVICES, ['pt'], 'pt', ['PT']);
    expect(activeServiceCount(form)).toBe(1);
  });

  it('withServiceActive changes one service only, without mutating', () => {
    const next = withServiceActive(SERVICES, 'EXPRESS', false);
    expect(next.EXPRESS).toEqual({ ...SERVICES.EXPRESS, active: false });
    expect(next.PICKUP).toBe(SERVICES.PICKUP);
    expect(SERVICES.EXPRESS.active).toBe(true);
  });

  it('maps server errors to the form paths, first error wins', () => {
    expect(
      dpdServicesErrorMap([
        { path: 'services.EXPRESS.rates.PT.0.price', code: 'invalid_number' },
        { path: 'services.EXPRESS.rates.PT.0.price', code: 'out_of_range' },
        { path: 'services.PICKUP.tax', code: 'out_of_range' },
        { path: 'services', code: 'NO_ACTIVE_SERVICE' },
        { path: 'config.accountHome', code: 'required' },
      ])
    ).toEqual({
      'EXPRESS.rates.PT.0.price': 'invalid_number',
      'PICKUP.tax': 'out_of_range',
      services: 'NO_ACTIVE_SERVICE',
      'config.accountHome': 'required',
    });
  });
});

describe('dpd portugal translations', () => {
  const en = require('../../../admin/src/core/translations/en.json');
  const pt = require('../../../admin/src/core/translations/pt.json');
  const P = 'littlebox-strapi-suite.ecommerce.settings';
  const fields = [
    'authEndpoint',
    'expeditionEndpoint',
    'clientId',
    'username',
    'clientSecret',
    'password',
    'accountHome',
    'accountShop',
    'pickupEndpoint',
    'pickupKey',
    'senderName',
    'senderAddress',
    'senderPostalCode',
    'senderCity',
    'senderPhone',
    'senderEmail',
  ];
  it.each([
    ...fields.map((f) => `${P}.providers.dpd-portugal.fields.${f}`),
    `${P}.providers.dpd-portugal.name`,
    `${P}.providers.dpd-portugal.description`,
    `${P}.errors.NO_ACTIVE_SERVICE`,
    `${P}.dpdServices.services.EXPRESS`,
    `${P}.dpdServices.services.PICKUP`,
    `${P}.dpdServices.deactivateConfirm.text`,
  ])('%s is translated in en and pt', (key) => {
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });

  it('uses the Portuguese labels', () => {
    expect(pt[`${P}.providers.dpd-portugal.fields.authEndpoint`]).toBe('Endpoint de autenticação');
    expect(pt[`${P}.providers.dpd-portugal.fields.senderPhone`]).toBe('Remetente: telemóvel');
  });
});

describe('dpdServiceMarkets', () => {
  it('PICKUP: only the store markets PT and PT-ISL, in store order', () => {
    expect(dpdServiceMarkets('PICKUP', ['ES', 'PT-ISL', 'FR', 'PT'])).toEqual(['PT-ISL', 'PT']);
    expect(dpdServiceMarkets('PICKUP', ['ES'])).toEqual([]);
  });

  it('EXPRESS: every store market', () => {
    expect(dpdServiceMarkets('EXPRESS', ['ES', 'PT-ISL', 'PT'])).toEqual(['ES', 'PT-ISL', 'PT']);
  });
});
