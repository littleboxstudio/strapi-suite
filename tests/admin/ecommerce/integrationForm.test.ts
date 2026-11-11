import { describe, it, expect } from 'vitest';
import {
  buildIntegrationPayload,
  integrationErrorMap,
  integrationFormFromView,
  isIntegerText,
} from '../../../admin/src/ecommerce/utils/integrationForm';
import {
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
} from '../../../admin/src/ecommerce/utils/manualMethodForm';
import type { IntegrationView, ProviderField } from '../../../admin/src/ecommerce/settingsTypes';

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

describe('manual method draft', () => {
  it('builds the input from a valid draft', () => {
    const draft = {
      ...emptyManualMethodDraft(['pt', 'en']),
      names: { pt: ' Entrega em loja ', en: '' },
      price: '3,50',
      taxChoice: '23',
      countries: ['PT', 'ES'],
    };
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: {},
      input: { name: { pt: 'Entrega em loja' }, price: 350, tax: 23, countries: ['PT', 'ES'], active: true },
    });
  });

  it('reports the default-locale name, price, tax and countries errors', () => {
    const draft = {
      ...emptyManualMethodDraft(['pt', 'en']),
      names: { pt: '', en: 'Pickup' },
      price: 'abc',
      taxChoice: 'other',
      taxOther: '120',
      countries: [],
    };
    expect(draftToManualMethodInput(draft, 'pt')).toEqual({
      errors: {
        'name.pt': 'required',
        price: 'invalid_number',
        tax: 'out_of_range',
        countries: 'required',
      },
    });
  });

  it('round-trips a stored method through the draft', () => {
    const draft = manualMethodToDraft(
      { id: 1, name: { pt: 'Correio' }, price: 495, tax: 6, countries: ['PT'], active: false, position: 0 },
      ['pt', 'en'],
      'pt-PT'
    );
    expect(draft).toMatchObject({ names: { pt: 'Correio', en: '' }, price: '4,95', taxChoice: '6', active: false });
    expect(draftToManualMethodInput(draft, 'pt').input).toEqual({
      name: { pt: 'Correio' },
      price: 495,
      tax: 6,
      countries: ['PT'],
      active: false,
    });
  });

  it('collapses countries.N server errors onto countries', () => {
    expect(
      manualMethodErrorMap([
        { path: 'countries.2', code: 'invalid_country' },
        { path: 'name.pt', code: 'required' },
      ])
    ).toEqual({ countries: 'invalid_country', 'name.pt': 'required' });
  });
});
