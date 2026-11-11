import type { LookupOption, LookupResult, ProviderRuntime } from '../../registry';
import { EcommerceBillingError } from '../../../errors';
import { createMoloniClient, type MoloniClient } from './client';

/** Lookup names used by the Moloni field definitions. */
export const MOLONI_LOOKUPS = {
  companies: 'companies',
  documentSets: 'documentSets',
  paymentMethods: 'paymentMethods',
  productCategories: 'productCategories',
  measurementUnits: 'measurementUnits',
  exemptionReasons: 'exemptionReasons',
} as const;

/** Category tree depth read for the category list (root = 1). */
const MAX_CATEGORY_DEPTH = 3;
/** Upper bound on `productCategories/getAll` calls for one lookup. */
const MAX_CATEGORY_CALLS = 30;

/**
 * Tax Authority exemption codes, offered when Moloni's own list cannot be read. Labels are the
 * short legal references; the accountant confirms which applies.
 */
const FALLBACK_EXEMPTIONS: LookupOption[] = [
  ['M01', 'Artigo 16.º, n.º 6 do CIVA'],
  ['M02', 'Artigo 6.º do Decreto-Lei n.º 198/90'],
  ['M04', 'Isento artigo 13.º do CIVA'],
  ['M05', 'Isento artigo 14.º do CIVA'],
  ['M06', 'Isento artigo 15.º do CIVA'],
  ['M07', 'Isento artigo 9.º do CIVA'],
  ['M09', 'IVA - não confere direito a dedução'],
  ['M10', 'IVA - regime de isenção (artigo 53.º do CIVA)'],
  ['M11', 'Regime particular do tabaco'],
  ['M12', 'Regime da margem de lucro - Agências de viagens'],
  ['M13', 'Regime da margem de lucro - Bens em segunda mão'],
  ['M14', 'Regime da margem de lucro - Objetos de arte'],
  ['M15', 'Regime da margem de lucro - Objetos de coleção e antiguidades'],
  ['M16', 'Isento artigo 14.º do RITI'],
  ['M19', 'Outras isenções'],
  ['M20', 'IVA - regime forfetário'],
  ['M21', 'IVA - não confere direito à dedução (ou expressão similar)'],
  ['M25', 'Mercadorias à consignação'],
  ['M30', 'IVA - autoliquidação (artigo 2.º, n.º 1, alínea i) do CIVA)'],
  ['M40', 'IVA - autoliquidação (artigo 6.º, n.º 6, alínea a) do CIVA)'],
  ['M41', 'IVA - autoliquidação (artigo 8.º, n.º 3 do RITI)'],
  ['M42', 'IVA - autoliquidação (Decreto-Lei n.º 21/2007)'],
  ['M43', 'IVA - autoliquidação (Decreto-Lei n.º 362/99)'],
  ['M99', 'Não sujeito ou não tributado'],
].map(([value, name]) => ({ value, label: `${value} – ${name}` }));

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const positiveId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
};

/** Maps a Moloni list to options; entries without a usable id are skipped. */
function options(body: unknown, idField: string, label: (item: any) => string): LookupOption[] {
  if (!Array.isArray(body)) return [];
  const out: LookupOption[] = [];
  for (const item of body) {
    const value = positiveId(item?.[idField]);
    if (value) out.push({ value, label: label(item) || value });
  }
  return out;
}

const isAuthOrNetwork = (err: unknown) =>
  err instanceof EcommerceBillingError &&
  (err.code === 'BILLING_AUTH_FAILED' || err.code === 'BILLING_UNREACHABLE' || err.code === 'BILLING_CONFIG_MISSING');

async function companies(client: MoloniClient): Promise<LookupOption[]> {
  const body = await client.call<unknown>('companies/getAll', {}, { company: false });
  return options(body, 'company_id', (c) => {
    const name = text(c.name);
    const vat = text(c.vat);
    return vat ? `${name} (${vat})` : name;
  });
}

/** The category tree, children labelled `Parent › Child`, read level by level via `parent_id`. */
async function categories(client: MoloniClient): Promise<LookupOption[]> {
  const out: LookupOption[] = [];
  let calls = 0;
  const walk = async (parentId: number, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_CATEGORY_DEPTH || calls >= MAX_CATEGORY_CALLS) return;
    calls++;
    const body = await client.call<unknown>('productCategories/getAll', { parent_id: parentId });
    if (!Array.isArray(body)) return;
    for (const item of body) {
      const id = positiveId(item?.category_id);
      if (!id) continue;
      const label = prefix ? `${prefix} › ${text(item.name) || id}` : text(item.name) || id;
      out.push({ value: id, label });
      if (Number(item?.num_categories) > 0) await walk(Number(id), label, depth + 1);
    }
  };
  await walk(0, '', 1);
  return out;
}

async function exemptions(client: MoloniClient): Promise<LookupOption[]> {
  const body = await client.call<unknown>('taxExemptions/getAll');
  if (!Array.isArray(body)) return [];
  const out: LookupOption[] = [];
  for (const item of body) {
    const code = text(item?.code);
    if (!code) continue;
    const name = text(item?.name) || text(item?.description);
    out.push({ value: code, label: name ? `${code} – ${name}` : code });
  }
  return out;
}

/**
 * Moloni lists for the configure form. The company list needs only the credentials; the others
 * need `companyId`. A refused login or an unreachable API throws; any other failure only marks that
 * list as failed (exemption reasons then fall back to the AT code list).
 */
export async function moloniLookups(
  rt: ProviderRuntime,
  params: { companyId: number | null }
): Promise<LookupResult> {
  const companyId = params.companyId;
  const client = createMoloniClient({
    config: { ...rt.config, ...(companyId ? { companyId } : {}) },
    secrets: rt.secrets,
  });

  const lists: Record<string, LookupOption[]> = {
    [MOLONI_LOOKUPS.companies]: await companies(client),
  };
  const failed: string[] = [];
  if (!companyId) return { lists, failed };

  const readers: [string, () => Promise<LookupOption[]>][] = [
    [
      MOLONI_LOOKUPS.documentSets,
      async () => options(await client.call('documentSets/getAll'), 'document_set_id', (d) => text(d.name)),
    ],
    [
      MOLONI_LOOKUPS.paymentMethods,
      async () => options(await client.call('paymentMethods/getAll'), 'payment_method_id', (m) => text(m.name)),
    ],
    [MOLONI_LOOKUPS.productCategories, () => categories(client)],
    [
      MOLONI_LOOKUPS.measurementUnits,
      async () =>
        options(await client.call('measurementUnits/getAll'), 'unit_id', (u) => {
          const name = text(u.name);
          const short = text(u.short_name);
          return short && short !== name ? `${name} (${short})` : name;
        }),
    ],
    [MOLONI_LOOKUPS.exemptionReasons, () => exemptions(client)],
  ];

  // Sequential: one token, and Moloni rate limits bursts.
  for (const [name, read] of readers) {
    try {
      lists[name] = await read();
    } catch (err) {
      if (isAuthOrNetwork(err)) throw err;
      if (name === MOLONI_LOOKUPS.exemptionReasons) lists[name] = FALLBACK_EXEMPTIONS;
      else failed.push(name);
    }
  }
  if (!lists[MOLONI_LOOKUPS.exemptionReasons]?.length) lists[MOLONI_LOOKUPS.exemptionReasons] = FALLBACK_EXEMPTIONS;
  return { lists, failed };
}
