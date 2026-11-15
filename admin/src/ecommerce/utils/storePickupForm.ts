import type {
  PickupStoreInput,
  SettingsFieldError,
  StorePickupConfig,
  StorePickupInput,
} from '../settingsTypes';
import {
  draftToManualMethodInput,
  manualMethodToDraft,
  type ManualMethodDraft,
} from './manualMethodForm';

/** The store fields, in form order, with the server's length limits. */
export const STORE_FIELDS = ['name', 'address', 'address2', 'postalCode', 'city'] as const;
export type StoreField = (typeof STORE_FIELDS)[number];

const STORE_FIELD_RULES: Record<StoreField, { max: number; required: boolean }> = {
  name: { max: 120, required: true },
  address: { max: 200, required: true },
  address2: { max: 200, required: false },
  postalCode: { max: 20, required: true },
  city: { max: 100, required: true },
};

/** One store as typed. `key` identifies the row in the list; `id` is null for a new store. */
export type StoreDraft = { key: string; id: string | null } & Record<StoreField, string>;

/** The Store pickup modal: edited like a manual method, plus the stores of each market. */
export type StorePickupDraft = ManualMethodDraft & {
  /** Stores per store market (only selected ones are saved; deselecting a market asks to drop them). */
  stores: Record<string, StoreDraft[]>;
};

/** Error code per path: `name.<locale>`, `tax`, `rates.<market>…`, `stores.<market>.<i>.<field>`. */
export type StorePickupErrors = Record<string, string>;

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

export function emptyStoreDraft(): StoreDraft {
  return { key: newKey(), id: null, name: '', address: '', address2: '', postalCode: '', city: '' };
}

/** Error code per field of one store (`required`, `too_long`). */
export function validateStoreDraft(store: StoreDraft): Partial<Record<StoreField, string>> {
  const errors: Partial<Record<StoreField, string>> = {};
  STORE_FIELDS.forEach((field) => {
    const value = store[field].trim();
    const rule = STORE_FIELD_RULES[field];
    if (value === '') {
      if (rule.required) errors[field] = 'required';
    } else if (value.length > rule.max) {
      errors[field] = 'too_long';
    }
  });
  return errors;
}

/** Only markets that are still store markets are kept. */
export function storePickupToDraft(
  config: StorePickupConfig,
  localeCodes: string[],
  uiLocale: string,
  markets: string[]
): StorePickupDraft {
  const method = manualMethodToDraft(
    { ...config, id: 0, position: 0, active: true },
    localeCodes,
    uiLocale,
    markets
  );
  const stores: Record<string, StoreDraft[]> = {};
  Object.entries(config.stores ?? {}).forEach(([market, list]) => {
    if (!markets.includes(market) || !Array.isArray(list)) return;
    stores[market] = list.map((s) => ({
      key: s.id,
      id: s.id,
      name: s.name,
      address: s.address,
      address2: s.address2 ?? '',
      postalCode: s.postalCode,
      city: s.city,
    }));
  });
  return { ...method, stores };
}

/**
 * Validates the draft like a manual method without required markets, and the stores of the
 * selected markets (the only ones sent). Returns the PUT body only when there are no errors.
 */
export function draftToStorePickup(
  draft: StorePickupDraft,
  defaultLocale: string
): { config?: StorePickupInput; errors: StorePickupErrors } {
  const { input, errors } = draftToManualMethodInput(draft, defaultLocale, {
    marketsRequired: false,
  });
  const stores: Record<string, PickupStoreInput[]> = {};
  draft.markets.forEach((market) => {
    const list = draft.stores[market] ?? [];
    if (list.length === 0) return;
    stores[market] = list.map((store, i) => {
      Object.entries(validateStoreDraft(store)).forEach(([field, code]) => {
        errors[`stores.${market}.${i}.${field}`] = code;
      });
      return {
        ...(store.id ? { id: store.id } : {}),
        name: store.name.trim(),
        address: store.address.trim(),
        address2: store.address2.trim() || null,
        postalCode: store.postalCode.trim(),
        city: store.city.trim(),
      };
    });
  });
  if (!input || Object.keys(errors).length) return { errors };
  return {
    errors,
    config: { name: input.name ?? {}, tax: input.tax ?? 0, rates: input.rates ?? {}, stores },
  };
}

/** Selected markets without any store: they are not offered (warned in the modal). */
export function marketsWithoutStores(draft: StorePickupDraft): string[] {
  return draft.markets.filter((m) => (draft.stores[m] ?? []).length === 0);
}

/**
 * The stores lost when the selected markets become `next`: those of each deselected market, in
 * the order of the selected markets (the modal asks before removing them).
 */
export function storesOfRemovedMarkets(
  draft: StorePickupDraft,
  next: string[]
): { market: string; store: StoreDraft }[] {
  return draft.markets
    .filter((m) => !next.includes(m))
    .flatMap((market) => (draft.stores[market] ?? []).map((store) => ({ market, store })));
}

/** A copy without the stores of `markets`. */
export function withoutMarketStores(draft: StorePickupDraft, markets: string[]): StorePickupDraft {
  return {
    ...draft,
    stores: Object.fromEntries(Object.entries(draft.stores).filter(([m]) => !markets.includes(m))),
  };
}

/** The store markets with a rate table and their store count, in the order of the store markets. */
export function storePickupSummary(
  config: StorePickupConfig,
  markets: string[]
): { market: string; stores: number }[] {
  return markets
    .filter((m) => Array.isArray(config.rates[m]))
    .map((market) => ({ market, stores: (config.stores[market] ?? []).length }));
}

/** Server errors keyed like the form errors (same paths); first error per path wins. */
export function storePickupErrorMap(errors: SettingsFieldError[]): StorePickupErrors {
  const map: StorePickupErrors = {};
  errors.forEach(({ path, code }) => {
    if (!(path in map)) map[path] = code;
  });
  return map;
}

/** A copy without the errors of `market`'s stores (their indexes change when one is removed). */
export function withoutStoreErrors(errors: StorePickupErrors, market: string): StorePickupErrors {
  const prefix = `stores.${market}`;
  return Object.fromEntries(
    Object.entries(errors).filter(([path]) => path !== prefix && !path.startsWith(`${prefix}.`))
  );
}
