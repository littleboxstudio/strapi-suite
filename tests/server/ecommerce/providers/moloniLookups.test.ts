import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMoloniTokensForTests,
  createMoloniClient,
} from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/client';
import { moloniLookups } from '../../../../server/src/services/modules/ecommerce/providers/billing/moloni/lookups';
import { getProviderDefinition } from '../../../../server/src/services/modules/ecommerce/providers/registry';
import { EcommerceBillingError } from '../../../../server/src/services/modules/ecommerce/errors';
import { json, moloniFake } from './moloniFake';

/** Saved credentials; no company chosen yet. */
const rt = (config: Record<string, unknown> = {}) => ({
  config: { clientId: 'cid', username: 'u@x.pt', ...config },
  secrets: { clientSecret: 'CS', password: 'PW' },
});

const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e);

beforeEach(() => __resetMoloniTokensForTests());
afterEach(() => vi.unstubAllGlobals());

const companyRoutes = {
  'companies/getAll': () => [
    { company_id: 7, name: 'Loja Lda', vat: '501234567' },
    { company_id: 8, name: 'Outra' },
    { company_id: 0, name: 'broken' },
  ],
};

describe('moloniLookups', () => {
  it('without a company returns only the companies, read without company_id', async () => {
    const m = moloniFake(companyRoutes);
    const out = await moloniLookups(rt(), { companyId: null });
    expect(out).toEqual({
      lists: {
        companies: [
          { value: '7', label: 'Loja Lda (501234567)' },
          { value: '8', label: 'Outra' },
        ],
      },
      failed: [],
    });
    expect(m.of('companies/getAll')[0].body).toEqual({});
    expect(m.paths()).toEqual(['grant', 'companies/getAll']);
  });

  it('with a company reads every list for that company', async () => {
    const m = moloniFake({
      ...companyRoutes,
      'documentSets/getAll': () => [{ document_set_id: 5, name: 'Loja online' }],
      'paymentMethods/getAll': () => [{ payment_method_id: 31, name: 'Cartão' }],
      'productCategories/getAll': (b: any) =>
        b.parent_id === 0
          ? [
              { category_id: 41, name: 'Loja', num_categories: 1 },
              { category_id: 42, name: 'Serviços', num_categories: 0 },
            ]
          : b.parent_id === 41
            ? [{ category_id: 43, name: 'Canecas', num_categories: 0 }]
            : [],
      'measurementUnits/getAll': () => [{ unit_id: 51, name: 'Unidade', short_name: 'Un.' }],
      'taxExemptions/getAll': () => [{ code: 'M07', name: 'Isento artigo 9.º do CIVA' }],
    });
    const out = await moloniLookups(rt(), { companyId: 7 });
    expect(out.failed).toEqual([]);
    expect(out.lists.documentSets).toEqual([{ value: '5', label: 'Loja online' }]);
    expect(out.lists.paymentMethods).toEqual([{ value: '31', label: 'Cartão' }]);
    expect(out.lists.productCategories).toEqual([
      { value: '41', label: 'Loja' },
      { value: '43', label: 'Loja › Canecas' },
      { value: '42', label: 'Serviços' },
    ]);
    expect(out.lists.measurementUnits).toEqual([{ value: '51', label: 'Unidade (Un.)' }]);
    expect(out.lists.exemptionReasons).toEqual([{ value: 'M07', label: 'M07 – Isento artigo 9.º do CIVA' }]);
    expect(m.of('documentSets/getAll')[0].body).toEqual({ company_id: 7 });
    // One grant shared by every list.
    expect(m.of('grant')).toHaveLength(1);
  });

  it('marks a list that Moloni rejects as failed and keeps the others', async () => {
    moloniFake({
      ...companyRoutes,
      'documentSets/getAll': () => [{ code: 1, field: 'company_id', description: 'x' }],
      'paymentMethods/getAll': () => [{ payment_method_id: 31, name: 'Cartão' }],
      'productCategories/getAll': () => [],
      'measurementUnits/getAll': () => [],
      'taxExemptions/getAll': () => [],
    });
    const out = await moloniLookups(rt(), { companyId: 7 });
    expect(out.failed).toEqual(['documentSets']);
    expect(out.lists.paymentMethods).toHaveLength(1);
    expect(out.lists.documentSets).toBeUndefined();
  });

  it('falls back to the AT exemption codes when Moloni has no list', async () => {
    moloniFake({
      ...companyRoutes,
      'documentSets/getAll': () => [],
      'paymentMethods/getAll': () => [],
      'productCategories/getAll': () => [],
      'measurementUnits/getAll': () => [],
      'taxExemptions/getAll': () => json(404, { error: 'not found' }),
    });
    const out = await moloniLookups(rt(), { companyId: 7 });
    expect(out.failed).toEqual([]);
    expect(out.lists.exemptionReasons.map((o) => o.value)).toEqual(expect.arrayContaining(['M07', 'M16', 'M99']));
  });

  it('throws BILLING_AUTH_FAILED when Moloni refuses the credentials', async () => {
    moloniFake({ grant: () => json(400, { error: 'invalid_grant' }) });
    const err = await fail(moloniLookups(rt(), { companyId: null }));
    expect(err).toBeInstanceOf(EcommerceBillingError);
    expect((err as EcommerceBillingError).code).toBe('BILLING_AUTH_FAILED');
  });

  it('throws BILLING_CONFIG_MISSING when the credentials are not saved', async () => {
    moloniFake(companyRoutes);
    const err = await fail(moloniLookups({ config: { clientId: 'cid' }, secrets: {} }, { companyId: null }));
    expect((err as EcommerceBillingError).code).toBe('BILLING_CONFIG_MISSING');
  });

  it('is the lookups of the Moloni definition, whose fields name existing lists', () => {
    const def = getProviderDefinition('moloni')!;
    expect(def.lookups).toBe(moloniLookups);
    const credentials = def.fields.filter((f) => f.group === 'credentials').map((f) => f.key);
    expect(credentials).toEqual(['clientId', 'clientSecret', 'username', 'password']);
    const lookups = Object.fromEntries(def.fields.filter((f) => f.lookup).map((f) => [f.key, f.lookup]));
    expect(lookups).toEqual({
      companyId: 'companies',
      documentSetId: 'documentSets',
      exemptionReason: 'exemptionReasons',
      paymentMethodId: 'paymentMethods',
      storeCreditPaymentMethodId: 'paymentMethods',
      productCategoryId: 'productCategories',
      measurementUnitId: 'measurementUnits',
    });
  });
});

describe('createMoloniClient token cache', () => {
  it('does not reuse a token granted to other credentials', async () => {
    const m = moloniFake({ 'companies/getAll': () => [] });
    await createMoloniClient(rt()).call('companies/getAll', {}, { company: false });
    await createMoloniClient(rt()).call('companies/getAll', {}, { company: false });
    expect(m.of('grant')).toHaveLength(1);
    await createMoloniClient({ ...rt(), secrets: { clientSecret: 'CS', password: 'NEW' } }).call(
      'companies/getAll',
      {},
      { company: false }
    );
    expect(m.of('grant')).toHaveLength(2);
    expect(m.of('grant')[1].query.get('password')).toBe('NEW');
  });
});
