import { describe, it, expect } from 'vitest';
import {
  buildIntegrationPayload,
  credentialsSaved,
  hasCredentialsStep,
  integrationErrorMap,
  integrationFormFromView,
  isIntegerText,
  lookupFieldOptions,
  missingCredentials,
  showsAsRequired,
  stepFields,
  validateIntegrationForm,
} from '../../../admin/src/ecommerce/utils/integrationForm';
import {
  fillAllMarkets,
  validateBracketRows,
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
  newBracketRows,
  type BracketDraft,
  type ManualMethodDraft,
} from '../../../admin/src/ecommerce/utils/manualMethodForm';
import type {
  IntegrationView,
  ManualMethod,
  ProviderField,
} from '../../../admin/src/ecommerce/settingsTypes';

const L = 'ecommerce.settings.providers.moloni.fields';

const FIELDS: ProviderField[] = [
  { key: 'clientId', type: 'string', required: true, label: `${L}.clientId` },
  { key: 'clientSecret', type: 'secret', required: true, label: `${L}.clientSecret` },
  { key: 'password', type: 'secret', required: true, label: `${L}.password` },
  { key: 'companyId', type: 'number', required: true, label: `${L}.companyId` },
  {
    key: 'documentType',
    type: 'select',
    required: false,
    default: 'FR',
    options: ['FR', 'FT'],
    label: `${L}.documentType`,
  },
  { key: 'documentSetId', type: 'number', required: false, label: `${L}.documentSetId` },
  { key: 'sandbox', type: 'boolean', required: false, label: `${L}.sandbox` },
];

describe('buildIntegrationPayload', () => {
  it('omits empty secrets so the stored values are kept', () => {
    const payload = buildIntegrationPayload(FIELDS, {
      clientId: 'abc',
      clientSecret: '',
      password: '   ',
      companyId: '5',
      documentType: 'FR',
      documentSetId: '',
      sandbox: false,
    });
    expect(payload.secrets).toEqual({});
  });

  it('sends the secrets that were typed, trimmed', () => {
    const payload = buildIntegrationPayload(FIELDS, { clientSecret: ' s3cret ', password: 'pw' });
    expect(payload.secrets).toEqual({ clientSecret: 's3cret', password: 'pw' });
  });

  it('sends null for cleared optional secrets, never for required ones or retyped values', () => {
    const fields: ProviderField[] = [
      ...FIELDS,
      { key: 'webhookSecret', type: 'secret', required: false, label: 'w' },
      { key: 'other', type: 'secret', required: false, label: 'o' },
    ];
    const payload = buildIntegrationPayload(
      fields,
      { webhookSecret: '', other: 'new-value', password: '' },
      ['webhookSecret', 'other', 'password']
    );
    expect(payload.secrets).toEqual({ webhookSecret: null, other: 'new-value' });
  });

  it('converts numbers and clears blank optional values with null', () => {
    const payload = buildIntegrationPayload(FIELDS, {
      clientId: ' abc ',
      companyId: ' 12 ',
      documentType: 'FT',
      documentSetId: '',
      sandbox: true,
    });
    expect(payload.config).toEqual({
      clientId: 'abc',
      companyId: 12,
      documentType: 'FT',
      documentSetId: null,
      sandbox: true,
    });
  });

  it('keeps a non-integer number as text so the server reports invalid_number', () => {
    const payload = buildIntegrationPayload(FIELDS, { companyId: '1.5' });
    expect(payload.config?.companyId).toBe('1.5');
  });

  it('ignores values of undeclared fields and never puts secrets in config', () => {
    const payload = buildIntegrationPayload(FIELDS, { other: 'x', clientSecret: 'y' });
    expect(payload.config).not.toHaveProperty('other');
    expect(payload.config).not.toHaveProperty('clientSecret');
  });
});

describe('integrationFormFromView', () => {
  it('fills config values as text, booleans as booleans and secrets empty', () => {
    const view: IntegrationView = {
      id: 'moloni',
      category: 'billing',
      name: 'Moloni',
      active: false,
      fields: FIELDS,
      config: { clientId: 'abc', companyId: 12, documentType: 'FR', sandbox: true },
      secrets: { clientSecret: '••••cret', password: null },
      secretsStatus: 'ok',
      encryptionKeyConfigured: true,
    };
    expect(integrationFormFromView(view)).toEqual({
      clientId: 'abc',
      clientSecret: '',
      password: '',
      companyId: '12',
      documentType: 'FR',
      documentSetId: '',
      sandbox: true,
    });
  });
});

describe('isIntegerText', () => {
  it('accepts digits only (and the empty string while typing)', () => {
    expect(isIntegerText('')).toBe(true);
    expect(isIntegerText('042')).toBe(true);
    expect(isIntegerText('1.5')).toBe(false);
    expect(isIntegerText('-1')).toBe(false);
    expect(isIntegerText('1e3')).toBe(false);
  });
});

describe('integrationErrorMap', () => {
  it('maps config.* and secrets.* paths to the field key, first error wins', () => {
    expect(
      integrationErrorMap([
        { path: 'config.companyId', code: 'invalid_number' },
        { path: 'secrets.password', code: 'required' },
        { path: 'config.companyId', code: 'required' },
      ])
    ).toEqual({ companyId: 'invalid_number', password: 'required' });
  });
});

const METHOD: ManualMethod = {
  id: 1,
  name: { pt: 'Correio' },
  rates: {
    PT: [
      { upTo: 1.5, price: 300 },
      { upTo: null, price: 1000 },
    ],
    ES: [{ upTo: null, price: 500 }],
    FR: [{ upTo: null, price: 700 }],
  },
  tax: 6,
  active: false,
  position: 0,
};

const base = (over: Partial<ManualMethodDraft> = {}): ManualMethodDraft => ({
  ...emptyManualMethodDraft(['pt']),
  names: { pt: 'X' },
  ...over,
});

const PT_ROWS: BracketDraft[] = [
  { upTo: '1', price: '3' },
  { upTo: '', price: '10' },
];

describe('manual method draft', () => {
  it('starts with no market selected', () => {
    expect(emptyManualMethodDraft(['pt', 'en'])).toMatchObject({
      names: { pt: '', en: '' },
      markets: [],
      brackets: {},
      active: true,
    });
    expect(newBracketRows()).toEqual([{ upTo: '', price: '' }]);
  });

  it('requires a market', () => {
    expect(draftToManualMethodInput(base(), 'pt').errors.markets).toBe('required');
  });

  it('builds per-country brackets from a valid draft', () => {
    const draft = base({
      markets: ['PT', 'ES'],
      brackets: { PT: PT_ROWS, ES: [{ upTo: '', price: '5,50' }] },
      taxChoice: '23',
    });
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: {},
      input: {
        name: { pt: 'X' },
        rates: {
          PT: [
            { upTo: 1, price: 300 },
            { upTo: null, price: 1000 },
          ],
          ES: [{ upTo: null, price: 550 }],
        },
        tax: 23,
        active: true,
      },
    });
  });

  it('accepts a comma or a dot in the weight limit', () => {
    const rates = (upTo: string) =>
      draftToManualMethodInput(
        base({
          markets: ['PT'],
          brackets: {
            PT: [
              { upTo, price: '1' },
              { upTo: '', price: '2' },
            ],
          },
        }),
        'pt'
      ).input?.rates?.PT[0].upTo;
    expect(rates('1,5')).toBe(1.5);
    expect(rates('1.25')).toBe(1.25);
  });

  it('only the last row may have no limit', () => {
    const draft = base({
      markets: ['PT'],
      brackets: {
        PT: [
          { upTo: '', price: '3' },
          { upTo: '', price: '10' },
        ],
      },
    });
    expect(draftToManualMethodInput(draft, 'pt').errors).toEqual({ 'rates.PT.0.upTo': 'required' });
  });

  it('checks the weight limits like the server', () => {
    const errorsOf = (rows: BracketDraft[]) =>
      draftToManualMethodInput(base({ markets: ['PT'], brackets: { PT: rows } }), 'pt').errors;
    const row = (upTo: string) => ({ upTo, price: '1' });
    expect(errorsOf([row('abc'), row('')])).toEqual({ 'rates.PT.0.upTo': 'invalid_number' });
    expect(errorsOf([row('1.2345'), row('')])).toEqual({ 'rates.PT.0.upTo': 'invalid_number' });
    expect(errorsOf([row('0'), row('')])).toEqual({ 'rates.PT.0.upTo': 'out_of_range' });
    expect(errorsOf([row('2'), row('2'), row('')])).toEqual({ 'rates.PT.1.upTo': 'out_of_range' });
    expect(errorsOf([row('2'), row('1,5'), row('')])).toEqual({
      'rates.PT.1.upTo': 'out_of_range',
    });
    expect(errorsOf([row('1'), row('2.001')])).toEqual({});
  });

  it('flags an invalid or too large price per row', () => {
    const errorsOf = (price: string) =>
      draftToManualMethodInput(
        base({ markets: ['PT'], brackets: { PT: [{ upTo: '', price }] } }),
        'pt'
      ).errors;
    expect(errorsOf('abc')).toEqual({ 'rates.PT.0.price': 'invalid_number' });
    expect(errorsOf('')).toEqual({ 'rates.PT.0.price': 'invalid_number' });
    expect(errorsOf('99999999')).toEqual({ 'rates.PT.0.price': 'out_of_range' });
  });

  it('requires brackets for a selected market', () => {
    expect(draftToManualMethodInput(base({ markets: ['PT'] }), 'pt').errors).toEqual({
      'rates.PT': 'required',
    });
  });

  it('reports the default-locale name and tax errors', () => {
    const draft = {
      ...base({ markets: ['PT'], brackets: { PT: [{ upTo: '', price: '1' }] } }),
      names: { pt: '', en: 'Pickup' },
      taxChoice: 'other',
      taxOther: '120',
    };
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: { 'name.pt': 'required', tax: 'out_of_range' },
    });
  });

  it('round-trips a stored method, keeping only countries still in the markets', () => {
    const draft = manualMethodToDraft(METHOD, ['pt'], 'pt', ['PT', 'ES']);
    expect(draft).toMatchObject({
      names: { pt: 'Correio' },
      markets: ['PT', 'ES'],
      brackets: {
        PT: [
          { upTo: '1,5', price: '3,00' },
          { upTo: '', price: '10,00' },
        ],
        ES: [{ upTo: '', price: '5,00' }],
      },
      taxChoice: '6',
      active: false,
    });
    expect(draftToManualMethodInput(draft, 'pt').input).toEqual({
      name: { pt: 'Correio' },
      rates: { PT: METHOD.rates.PT, ES: METHOD.rates.ES },
      tax: 6,
      active: false,
    });
  });

  it('ignores old-shaped rates (not arrays)', () => {
    const old = { ...METHOD, rates: { '1': 495 } as any };
    expect(manualMethodToDraft(old, ['pt'], 'pt', ['1', 'PT']).markets).toEqual([]);
  });

  it('shows kg with up to 3 decimals', () => {
    const m = {
      ...METHOD,
      rates: {
        PT: [
          { upTo: 0.25, price: 100 },
          { upTo: 12.345, price: 200 },
        ],
      },
    };
    expect(manualMethodToDraft(m, ['pt'], 'en', ['PT']).brackets.PT.map((b) => b.upTo)).toEqual([
      '0.25',
      '12.345',
    ]);
  });
});

describe('fillAllMarkets', () => {
  it('gives every selected market its own copy of the rows', () => {
    const draft = base({
      markets: ['PT', 'ES'],
      brackets: {
        PT: [{ upTo: '', price: '1' }],
        ES: [
          { upTo: '2', price: '2' },
          { upTo: '', price: '3' },
        ],
        FR: [{ upTo: '', price: '9' }],
      },
    });
    const out = fillAllMarkets(draft, PT_ROWS);
    expect(out.brackets).toEqual({ PT: PT_ROWS, ES: PT_ROWS });
    out.brackets.ES[0].price = '99';
    expect(out.brackets.PT[0].price).toBe(PT_ROWS[0].price);
    expect(PT_ROWS[0].price).not.toBe('99');
  });
});

describe('validateBracketRows', () => {
  it('checks the order, the open last row and the prices', () => {
    expect(
      validateBracketRows(
        [
          { upTo: '1', price: '3,50' },
          { upTo: '', price: '5' },
        ],
        'fill'
      )
    ).toEqual({
      brackets: [
        { upTo: 1, price: 350 },
        { upTo: null, price: 500 },
      ],
      errors: {},
    });
    expect(
      validateBracketRows(
        [
          { upTo: '', price: 'x' },
          { upTo: '2', price: '1' },
          { upTo: '1', price: '1' },
        ],
        'fill'
      ).errors
    ).toEqual({
      'fill.0.upTo': 'required',
      'fill.0.price': 'invalid_number',
      'fill.2.upTo': 'out_of_range',
    });
  });
});

describe('manualMethodErrorMap', () => {
  it('keys server errors by path, first error wins', () => {
    expect(
      manualMethodErrorMap([
        { path: 'rates.PT.1.upTo', code: 'out_of_range' },
        { path: 'rates.PT.1.upTo', code: 'invalid_number' },
        { path: 'rates', code: 'required' },
      ])
    ).toEqual({ 'rates.PT.1.upTo': 'out_of_range', rates: 'required' });
  });
});

describe('markets field', () => {
  const field: ProviderField = {
    key: 'markets',
    type: 'markets',
    required: true,
    default: [],
    label: 'm',
  };
  const view = (config: Record<string, unknown>): IntegrationView => ({
    id: 'ctt-expresso',
    category: 'carrier',
    name: 'CTT',
    active: false,
    fields: [field],
    config,
    secrets: {},
    secretsStatus: 'none',
    encryptionKeyConfigured: true,
  });

  it('sends the country codes as a list of strings', () => {
    expect(buildIntegrationPayload([field], { markets: ['PT', 'ES'] }).config.markets).toEqual([
      'PT',
      'ES',
    ]);
  });

  it('reads the stored codes', () => {
    expect(integrationFormFromView(view({ markets: ['PT'] })).markets).toEqual(['PT']);
    expect(integrationFormFromView(view({})).markets).toEqual([]);
  });

  it('requires a market only on an active integration, like any required field', () => {
    expect(validateIntegrationForm([field], { markets: [] })).toEqual({});
    expect(validateIntegrationForm([field], { markets: [] }, true)).toEqual({
      markets: 'required',
    });
    expect(validateIntegrationForm([field], { markets: ['PT'] }, true)).toEqual({});
  });
});

describe('validateIntegrationForm', () => {
  const fields: ProviderField[] = [
    { key: 'paymentSuccessPath', type: 'string', format: 'path', required: true, label: 'x' },
    { key: 'name', type: 'string', required: false, label: 'y' },
  ];
  it('flags an invalid path', () => {
    expect(validateIntegrationForm(fields, { paymentSuccessPath: '//x', name: 'a b' })).toEqual({
      paymentSuccessPath: 'invalid_path',
    });
  });
  it('flags a path with a query or a fragment', () => {
    expect(validateIntegrationForm(fields, { paymentSuccessPath: '/ok?x=1', name: '' })).toEqual({
      paymentSuccessPath: 'invalid_path',
    });
    expect(validateIntegrationForm(fields, { paymentSuccessPath: '/ok#a', name: '' })).toEqual({
      paymentSuccessPath: 'invalid_path',
    });
  });
  it('accepts a valid or blank path', () => {
    expect(validateIntegrationForm(fields, { paymentSuccessPath: '/ok', name: '' })).toEqual({});
    expect(validateIntegrationForm(fields, { paymentSuccessPath: '  ', name: '' })).toEqual({});
  });
});

describe('showsAsRequired', () => {
  it('a required text field with a default is not shown as required (blank restores it)', () => {
    const base = { key: 'k', label: 'x' };
    expect(
      showsAsRequired({ ...base, type: 'string', format: 'path', required: true, default: '/a' })
    ).toBe(false);
    expect(showsAsRequired({ ...base, type: 'string', required: true })).toBe(true);
    expect(showsAsRequired({ ...base, type: 'markets', required: true, default: [] })).toBe(true);
    expect(showsAsRequired({ ...base, type: 'string', required: false })).toBe(false);
  });
});

describe('two-step configure helpers', () => {
  const STEP_FIELDS: ProviderField[] = [
    { key: 'clientId', type: 'string', required: true, label: 'l', group: 'credentials' },
    { key: 'clientSecret', type: 'secret', required: true, label: 'l', group: 'credentials' },
    { key: 'companyId', type: 'number', required: true, label: 'l', lookup: 'companies' },
    { key: 'documentSetId', type: 'number', required: false, label: 'l', lookup: 'documentSets' },
  ];
  const stepView = (
    config: Record<string, unknown>,
    secrets: Record<string, string | null>
  ): IntegrationView => ({
    id: 'moloni',
    category: 'billing',
    name: 'Moloni',
    active: false,
    fields: STEP_FIELDS,
    config,
    secrets,
    secretsStatus: 'ok',
    encryptionKeyConfigured: true,
  });

  it('hasCredentialsStep is true only when some field is a credential', () => {
    expect(hasCredentialsStep(STEP_FIELDS)).toBe(true);
    expect(hasCredentialsStep(FIELDS)).toBe(false);
  });

  it('stepFields splits credentials from the rest', () => {
    expect(stepFields(STEP_FIELDS, 'credentials').map((f) => f.key)).toEqual([
      'clientId',
      'clientSecret',
    ]);
    expect(stepFields(STEP_FIELDS, 'details').map((f) => f.key)).toEqual([
      'companyId',
      'documentSetId',
    ]);
  });

  it('credentialsSaved needs every required credential stored', () => {
    expect(
      credentialsSaved(stepView({ clientId: 'abc' }, { clientSecret: 'abc********1234' }))
    ).toBe(true);
    expect(credentialsSaved(stepView({ clientId: 'abc' }, { clientSecret: null }))).toBe(false);
    expect(credentialsSaved(stepView({ clientId: ' ' }, { clientSecret: 'abc********1234' }))).toBe(
      false
    );
  });

  it('missingCredentials accepts a blank secret only when one is stored', () => {
    const stored = stepView({}, { clientSecret: 'abc********1234' });
    expect(missingCredentials(stored, { clientId: 'abc', clientSecret: '' })).toEqual([]);
    expect(missingCredentials(stored, { clientId: '', clientSecret: '' })).toEqual(['clientId']);
    const empty = stepView({}, { clientSecret: null });
    expect(missingCredentials(empty, { clientId: 'abc', clientSecret: '  ' })).toEqual([
      'clientSecret',
    ]);
    expect(missingCredentials(empty, { clientId: 'abc', clientSecret: 'new' })).toEqual([]);
  });

  it('lookupFieldOptions keeps a saved value missing from the list', () => {
    const list = [{ value: '5', label: 'Loja online' }];
    const unknown = (v: string) => `ID ${v} (not found)`;
    expect(lookupFieldOptions(list, '5', unknown)).toEqual(list);
    expect(lookupFieldOptions(list, '', unknown)).toEqual(list);
    expect(lookupFieldOptions(list, '9', unknown)).toEqual([
      ...list,
      { value: '9', label: 'ID 9 (not found)' },
    ]);
  });
});
