import { describe, it, expect } from 'vitest';
import {
  draftToStorePickup,
  emptyStoreDraft,
  marketsWithoutStores,
  storePickupErrorMap,
  storePickupSummary,
  storePickupToDraft,
  validateStoreDraft,
  withoutStoreErrors,
} from '../../../admin/src/ecommerce/utils/storePickupForm';
import type { StorePickupConfig } from '../../../admin/src/ecommerce/settingsTypes';

const PORTO = {
  id: 'st_abcdefghij',
  name: 'Loja Porto',
  address: 'Rua X 1',
  address2: null,
  postalCode: '4000-001',
  city: 'Porto',
  country: 'PT',
};
const FUNCHAL = {
  id: 'st_0123456789',
  name: 'Loja Funchal',
  address: 'Rua Y 2',
  address2: '1.º andar',
  postalCode: '9000-001',
  city: 'Funchal',
  country: 'PT',
};

const CONFIG: StorePickupConfig = {
  name: { en: 'Store pickup', pt: 'Levantamento em loja' },
  tax: 23,
  rates: {
    PT: [{ upTo: null, price: 0 }],
    'PT-ISL': [
      { upTo: 2, price: 150 },
      { upTo: null, price: 300 },
    ],
  },
  stores: { PT: [PORTO], 'PT-ISL': [FUNCHAL] },
};

const STORE_MARKETS = ['PT', 'PT-ISL', 'ES'];

describe('store pickup form', () => {
  it('round-trips the stored config (store ids kept, country left to the server)', () => {
    const draft = storePickupToDraft(CONFIG, ['pt', 'en'], 'pt', STORE_MARKETS);
    expect(draft).toMatchObject({
      names: { pt: 'Levantamento em loja', en: 'Store pickup' },
      markets: ['PT', 'PT-ISL'],
      taxChoice: '23',
    });
    expect(draft.stores.PT).toEqual([
      expect.objectContaining({
        id: 'st_abcdefghij',
        name: 'Loja Porto',
        address2: '',
        postalCode: '4000-001',
      }),
    ]);
    expect(draftToStorePickup(draft, 'pt')).toEqual({
      errors: {},
      config: {
        name: CONFIG.name,
        tax: 23,
        rates: CONFIG.rates,
        stores: {
          PT: [
            {
              id: 'st_abcdefghij',
              name: 'Loja Porto',
              address: 'Rua X 1',
              address2: null,
              postalCode: '4000-001',
              city: 'Porto',
            },
          ],
          'PT-ISL': [
            {
              id: 'st_0123456789',
              name: 'Loja Funchal',
              address: 'Rua Y 2',
              address2: '1.º andar',
              postalCode: '9000-001',
              city: 'Funchal',
            },
          ],
        },
      },
    });
  });

  it('gives every store draft a distinct key', () => {
    const draft = storePickupToDraft(CONFIG, ['pt'], 'pt', STORE_MARKETS);
    const keys = [
      ...draft.stores.PT,
      ...draft.stores['PT-ISL'],
      emptyStoreDraft(),
      emptyStoreDraft(),
    ].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sends a new store without id, trimmed, and an empty address 2 as null', () => {
    const draft = storePickupToDraft(CONFIG, ['pt'], 'pt', STORE_MARKETS);
    draft.stores.PT = [
      ...draft.stores.PT,
      {
        ...emptyStoreDraft(),
        name: ' Loja Lisboa ',
        address: 'Av. Z 3',
        address2: ' ',
        postalCode: '1000-001',
        city: 'Lisboa',
      },
    ];
    expect(draftToStorePickup(draft, 'pt').config?.stores.PT[1]).toEqual({
      name: 'Loja Lisboa',
      address: 'Av. Z 3',
      address2: null,
      postalCode: '1000-001',
      city: 'Lisboa',
    });
  });

  it('sends only the stores of markets with a rate table; drops stale markets', () => {
    const draft = storePickupToDraft(
      { ...CONFIG, stores: { ...CONFIG.stores, FR: [{ ...PORTO, id: 'st_frfrfrfrfr' }] } },
      ['pt'],
      'pt',
      STORE_MARKETS
    );
    expect(Object.keys(draft.stores)).toEqual(['PT', 'PT-ISL']);
    draft.markets = ['PT'];
    expect(Object.keys(draftToStorePickup(draft, 'pt').config?.stores ?? {})).toEqual(['PT']);
  });

  it('allows no markets at all (nothing is offered)', () => {
    const draft = storePickupToDraft(
      { name: { pt: 'Levantamento' }, tax: 6, rates: {}, stores: {} },
      ['pt'],
      'pt',
      STORE_MARKETS
    );
    expect(draftToStorePickup(draft, 'pt')).toEqual({
      errors: {},
      config: { name: { pt: 'Levantamento' }, tax: 6, rates: {}, stores: {} },
    });
  });

  it('validates the name, the rates and the stores, keyed like the server', () => {
    const draft = storePickupToDraft(CONFIG, ['pt'], 'pt', STORE_MARKETS);
    draft.names.pt = '';
    draft.brackets.PT = [{ upTo: '', price: 'x' }];
    draft.stores['PT-ISL'] = [{ ...draft.stores['PT-ISL'][0], city: ' ', name: 'a'.repeat(121) }];
    expect(draftToStorePickup(draft, 'pt')).toEqual({
      errors: {
        'name.pt': 'required',
        'rates.PT.0.price': 'invalid_number',
        'stores.PT-ISL.0.name': 'too_long',
        'stores.PT-ISL.0.city': 'required',
      },
    });
  });

  it('validates one store: required fields and lengths', () => {
    expect(validateStoreDraft(emptyStoreDraft())).toEqual({
      name: 'required',
      address: 'required',
      postalCode: 'required',
      city: 'required',
    });
    expect(
      validateStoreDraft({
        ...emptyStoreDraft(),
        name: 'Loja',
        address: 'Rua',
        address2: 'x'.repeat(201),
        postalCode: '1'.repeat(21),
        city: 'Lisboa',
      })
    ).toEqual({ address2: 'too_long', postalCode: 'too_long' });
  });

  it('lists the markets with a rate table and no store', () => {
    const draft = storePickupToDraft(CONFIG, ['pt'], 'pt', STORE_MARKETS);
    draft.markets = ['PT', 'PT-ISL', 'ES'];
    draft.stores['PT-ISL'] = [];
    expect(marketsWithoutStores(draft)).toEqual(['PT-ISL', 'ES']);
  });

  it('summarises the store markets with a rate table, in store order', () => {
    expect(
      storePickupSummary({ ...CONFIG, rates: { ...CONFIG.rates, ES: [], FR: [] } }, [
        'ES',
        'PT-ISL',
        'PT',
      ])
    ).toEqual([
      { market: 'ES', stores: 0 },
      { market: 'PT-ISL', stores: 1 },
      { market: 'PT', stores: 1 },
    ]);
  });

  it('maps server errors to the form paths, first error wins', () => {
    expect(
      storePickupErrorMap([
        { path: 'stores.PT.0.postalCode', code: 'STORE_MARKET_MISMATCH' },
        { path: 'stores.PT.0.postalCode', code: 'too_long' },
        { path: 'tax', code: 'out_of_range' },
      ] as any)
    ).toEqual({ 'stores.PT.0.postalCode': 'STORE_MARKET_MISMATCH', tax: 'out_of_range' });
  });

  it("drops the errors of a market's stores (indexes shift when one is removed)", () => {
    expect(
      withoutStoreErrors(
        {
          'stores.PT.0.name': 'required',
          'stores.PT': 'too_many',
          'stores.PT-ISL.0.city': 'required',
          tax: 'required',
        },
        'PT'
      )
    ).toEqual({ 'stores.PT-ISL.0.city': 'required', tax: 'required' });
  });
});

describe('store pickup translations', () => {
  const en = require('../../../admin/src/core/translations/en.json');
  const pt = require('../../../admin/src/core/translations/pt.json');
  const P = 'littlebox-strapi-suite.ecommerce.settings';
  it.each([
    `${P}.providers.store-pickup.name`,
    `${P}.providers.store-pickup.description`,
    `${P}.errors.NO_MARKET_WITH_STORES`,
    `${P}.errors.STORE_MARKET_MISMATCH`,
    `${P}.errors.too_many`,
    `${P}.errors.invalid_market`,
    `${P}.storePickup.noStores`,
    `${P}.storePickup.configure`,
    `${P}.storePickup.deactivated`,
    `${P}.storePickup.stores.add`,
    `${P}.storePickup.store.fields.postalCode`,
  ])('%s is translated in en and pt', (key) => {
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });

  it('uses the agreed warning', () => {
    expect(en[`${P}.storePickup.noStores`]).toBe('Not offered until it has a store');
    expect(pt[`${P}.storePickup.noStores`]).toBe('Não é oferecido enquanto não tiver uma loja');
  });
});
