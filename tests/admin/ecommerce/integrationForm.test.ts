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
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
  ratesSummary,
} from '../../../admin/src/ecommerce/utils/manualMethodForm';
import { formatCents } from '../../../admin/src/ecommerce/utils/money';
import type {
  IntegrationView,
  ManualMethod,
  ProviderField,
  ShippingZone,
} from '../../../admin/src/ecommerce/settingsTypes';

const L = 'ecommerce.settings.providers.moloni.fields';

const FIELDS: ProviderField[] = [
  { key: 'clientId', type: 'string', required: true, label: `${L}.clientId` },
  { key: 'clientSecret', type: 'secret', required: true, label: `${L}.clientSecret` },
  { key: 'password', type: 'secret', required: true, label: `${L}.password` },
  { key: 'companyId', type: 'number', required: true, label: `${L}.companyId` },
  { key: 'documentType', type: 'select', required: false, default: 'FR', options: ['FR', 'FT'], label: `${L}.documentType` },
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
      verified: false,
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

const ZONES: ShippingZone[] = [
  { id: 1, name: 'Continente', countries: ['PT'], position: 1 },
  { id: 2, name: 'Ilhas', countries: ['ES'], position: 2 },
];

const METHOD: ManualMethod = {
  id: 1,
  name: { pt: 'Correio' },
  rates: { '1': 495 },
  tax: 6,
  active: false,
  position: 0,
};

describe('manual method draft', () => {
  it('starts with every zone blank', () => {
    expect(emptyManualMethodDraft(['pt'], ZONES).rates).toEqual({ '1': '', '2': '' });
  });

  it('builds the input from a valid draft, leaving blank zones out', () => {
    const draft = {
      names: { pt: 'Entrega em loja' },
      rates: { '1': '3,50', '2': '' },
      taxChoice: '23',
      taxOther: '',
      active: true,
    };
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: {},
      input: { name: { pt: 'Entrega em loja' }, rates: { '1': 350 }, tax: 23, active: true },
    });
  });

  it('flags an invalid price per zone', () => {
    const draft = { ...emptyManualMethodDraft(['pt'], ZONES), names: { pt: 'X' }, rates: { '1': 'abc' } };
    expect(draftToManualMethodInput(draft, 'pt').errors['rates.1']).toBe('invalid_number');
  });

  it('requires a price in at least one zone', () => {
    const draft = { ...emptyManualMethodDraft(['pt'], ZONES), names: { pt: 'X' } };
    expect(draftToManualMethodInput(draft, 'pt').errors.rates).toBe('required');
  });

  it('reports the default-locale name and tax errors', () => {
    const draft = {
      ...emptyManualMethodDraft(['pt', 'en'], ZONES),
      names: { pt: '', en: 'Pickup' },
      rates: { '1': '1' },
      taxChoice: 'other',
      taxOther: '120',
    };
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: { 'name.pt': 'required', tax: 'out_of_range' },
    });
  });

  it('round-trips a stored method through the draft', () => {
    const draft = manualMethodToDraft(METHOD, ['pt'], 'pt', ZONES);
    expect(draft).toMatchObject({ names: { pt: 'Correio' }, rates: { '1': '4,95', '2': '' }, taxChoice: '6', active: false });
    expect(draftToManualMethodInput(draft, 'pt').input).toEqual({
      name: { pt: 'Correio' },
      rates: { '1': 495 },
      tax: 6,
      active: false,
    });
  });

  it('keeps rates.<id> server errors per zone', () => {
    expect(manualMethodErrorMap([{ path: 'rates.9', code: 'invalid_zone' }])).toEqual({
      'rates.9': 'invalid_zone',
    });
  });

  it('reports an error on a zone the form does not show on the rates as a whole', () => {
    expect(
      manualMethodErrorMap(
        [
          { path: 'rates.9', code: 'invalid_zone' },
          { path: 'rates.1', code: 'out_of_range' },
        ],
        [{ id: 1 }]
      )
    ).toEqual({ rates: 'invalid_zone', 'rates.1': 'out_of_range' });
  });
});

describe('ratesSummary', () => {
  it('lists the priced zones in zone order', () => {
    // The price follows formatCents (Node's ICU writes "€ 4,95" for plain `pt`).
    expect(ratesSummary({ ...METHOD, rates: { '2': 995, '1': 495 } }, ZONES, 'pt')).toBe(
      `Continente ${formatCents(495, 'pt')} · Ilhas ${formatCents(995, 'pt')}`
    );
    expect(ratesSummary({ rates: { '2': 995, '1': 495 } }, ZONES, 'pt-PT')).toBe(
      'Continente 4,95\u00a0€ · Ilhas 9,95\u00a0€'
    );
  });

  it('omits zones without a price and is empty without any', () => {
    expect(ratesSummary({ ...METHOD, rates: { '2': 995 } }, ZONES, 'pt')).toBe(
      `Ilhas ${formatCents(995, 'pt')}`
    );
    expect(ratesSummary({ ...METHOD, rates: {} }, ZONES, 'pt')).toBe('');
  });
});

describe('zones field', () => {
  const zonesField: ProviderField = { key: 'zones', type: 'zones', required: true, default: [], label: 'z' };
  const view = (config: Record<string, unknown>): IntegrationView => ({
    id: 'ctt-expresso',
    category: 'carrier',
    name: 'CTT',
    active: false,
    verified: true,
    fields: [zonesField],
    config,
    secrets: {},
    secretsStatus: 'none',
    encryptionKeyConfigured: true,
  });

  it('sends the zone ids as numbers', () => {
    expect(buildIntegrationPayload([zonesField], { zones: ['1', '3'] }).config.zones).toEqual([1, 3]);
  });

  it('reads the stored ids as text', () => {
    expect(integrationFormFromView(view({ zones: [2] })).zones).toEqual(['2']);
    expect(integrationFormFromView(view({})).zones).toEqual([]);
  });

  it('requires a zone only on an active integration, like any required field', () => {
    expect(validateIntegrationForm([zonesField], { zones: [] })).toEqual({});
    expect(validateIntegrationForm([zonesField], { zones: [] }, true)).toEqual({ zones: 'required' });
    expect(validateIntegrationForm([zonesField], { zones: ['1'] }, true)).toEqual({});
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
    expect(showsAsRequired({ ...base, type: 'string', format: 'path', required: true, default: '/a' })).toBe(false);
    expect(showsAsRequired({ ...base, type: 'string', required: true })).toBe(true);
    expect(showsAsRequired({ ...base, type: 'zones', required: true, default: [] })).toBe(true);
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
  const stepView = (config: Record<string, unknown>, secrets: Record<string, string | null>): IntegrationView => ({
    id: 'moloni',
    category: 'billing',
    name: 'Moloni',
    active: false,
    verified: false,
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
    expect(stepFields(STEP_FIELDS, 'credentials').map((f) => f.key)).toEqual(['clientId', 'clientSecret']);
    expect(stepFields(STEP_FIELDS, 'details').map((f) => f.key)).toEqual(['companyId', 'documentSetId']);
  });

  it('credentialsSaved needs every required credential stored', () => {
    expect(credentialsSaved(stepView({ clientId: 'abc' }, { clientSecret: 'abc********1234' }))).toBe(true);
    expect(credentialsSaved(stepView({ clientId: 'abc' }, { clientSecret: null }))).toBe(false);
    expect(credentialsSaved(stepView({ clientId: ' ' }, { clientSecret: 'abc********1234' }))).toBe(false);
  });

  it('missingCredentials accepts a blank secret only when one is stored', () => {
    const stored = stepView({}, { clientSecret: 'abc********1234' });
    expect(missingCredentials(stored, { clientId: 'abc', clientSecret: '' })).toEqual([]);
    expect(missingCredentials(stored, { clientId: '', clientSecret: '' })).toEqual(['clientId']);
    const empty = stepView({}, { clientSecret: null });
    expect(missingCredentials(empty, { clientId: 'abc', clientSecret: '  ' })).toEqual(['clientSecret']);
    expect(missingCredentials(empty, { clientId: 'abc', clientSecret: 'new' })).toEqual([]);
  });

  it('lookupFieldOptions keeps a saved value missing from the list', () => {
    const list = [{ value: '5', label: 'Loja online' }];
    const unknown = (v: string) => `ID ${v} (not found)`;
    expect(lookupFieldOptions(list, '5', unknown)).toEqual(list);
    expect(lookupFieldOptions(list, '', unknown)).toEqual(list);
    expect(lookupFieldOptions(list, '9', unknown)).toEqual([...list, { value: '9', label: 'ID 9 (not found)' }]);
  });
});
