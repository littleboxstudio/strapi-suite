import type { ImageRecord } from '../types';
import { parseMoneyToCents } from './money';
import type { ErrorMap, FormVariant } from './productForm';

export const TAX_PRESETS = [23, 13, 6, 0];
export const TAX_OTHER = 'other';

/** What the variant modal edits: numbers kept as typed text until confirmed. */
export type VariantDraft = {
  id?: number;
  key: string;
  images: ImageRecord[];
  active: boolean;
  sku: string;
  /**
   * The stock as the admin wants it: the initial stock of a new variant, or the new current stock of
   * an existing one (sent as a difference from `savedStock`).
   */
  stock: string;
  /** Existing variants: the stock stored on the server when the product was loaded. */
  savedStock?: number;
  price: string;
  taxChoice: string;
  taxOther: string;
  weight: string;
  width: string;
  height: string;
  depth: string;
  options: Record<string, string>;
};

const DIMENSIONS = ['weight', 'width', 'height', 'depth'] as const;

export function emptyVariantDraft(localeCodes: string[], key: string): VariantDraft {
  return {
    key,
    images: [],
    active: true,
    sku: '',
    stock: '0',
    price: '',
    taxChoice: String(TAX_PRESETS[0]),
    taxOther: '',
    weight: '0',
    width: '0',
    height: '0',
    depth: '0',
    options: Object.fromEntries(localeCodes.map((code) => [code, ''])),
  };
}

export const centsToText = (cents: number, uiLocale: string) =>
  new Intl.NumberFormat(uiLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(cents / 100);

export function variantToDraft(
  variant: FormVariant,
  localeCodes: string[],
  uiLocale: string
): VariantDraft {
  const preset = TAX_PRESETS.includes(variant.tax);
  return {
    ...(variant.id !== undefined ? { id: variant.id } : {}),
    key: variant.key,
    images: variant.images,
    active: variant.active,
    sku: variant.sku,
    // A pending (confirmed, not yet saved) change shows as the stock it will become.
    stock: String(variant.stock + (variant.stockAdjustment ?? 0)),
    ...(variant.id !== undefined ? { savedStock: variant.stock } : {}),
    price: centsToText(variant.price, uiLocale),
    taxChoice: preset ? String(variant.tax) : TAX_OTHER,
    taxOther: preset ? '' : String(variant.tax),
    weight: String(variant.weight),
    width: String(variant.width),
    height: String(variant.height),
    depth: String(variant.depth),
    options: Object.fromEntries(
      localeCodes.map((code) => [code, variant.translations[code]?.option ?? ''])
    ),
  };
}

/** Non-negative decimal accepting a comma or a dot; null when invalid. */
export function parseDecimal(text: string): number | null {
  const s = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** Validates the draft; returns the variant only when there are no errors. */
export function draftToVariant(
  draft: VariantDraft,
  defaultLocale: string
): { variant?: FormVariant; errors: ErrorMap } {
  const errors: ErrorMap = {};

  if (!draft.options[defaultLocale]?.trim()) {
    errors[`translations.${defaultLocale}.option`] = 'required';
  }

  const sku = draft.sku.trim();
  if (sku === '') errors.sku = 'required';

  const isNew = draft.id === undefined;
  const stockText = draft.stock.trim();
  let typedStock = 0;
  if (stockText === '') errors.stock = 'required';
  else if (!/^-?\d+$/.test(stockText)) errors.stock = 'invalid_number';
  else typedStock = Number(stockText);

  // An existing variant keeps its stored stock and moves to the typed value through a ledger
  // adjustment; the server refuses it if the stock changed since it was loaded.
  const savedStock = draft.savedStock ?? 0;
  const stock = isNew ? typedStock : savedStock;
  const stockAdjustment = isNew ? 0 : typedStock - savedStock;

  let price = 0;
  if (draft.price.trim() === '') errors.price = 'required';
  else {
    const cents = parseMoneyToCents(draft.price);
    if (cents === null) errors.price = 'invalid_number';
    else price = cents;
  }

  const taxText = draft.taxChoice === TAX_OTHER ? draft.taxOther : draft.taxChoice;
  const tax = parseDecimal(taxText);
  if (taxText.trim() === '') errors.tax = 'required';
  else if (tax === null) errors.tax = 'invalid_number';
  else if (tax > 100) errors.tax = 'out_of_range';

  const dims = { weight: 0, width: 0, height: 0, depth: 0 };
  DIMENSIONS.forEach((field) => {
    const text = draft[field].trim();
    if (text === '') return;
    const value = parseDecimal(text);
    if (value === null) errors[field] = 'invalid_number';
    else dims[field] = value;
  });

  if (Object.keys(errors).length) return { errors };

  return {
    errors,
    variant: {
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      key: draft.key,
      images: draft.images,
      sku,
      price,
      tax: tax as number,
      stock,
      ...(stockAdjustment !== 0 ? { stockAdjustment, stockExpected: savedStock } : {}),
      ...dims,
      active: draft.active,
      translations: Object.fromEntries(
        Object.entries(draft.options).map(([code, option]) => [code, { option: option.trim() }])
      ),
    },
  };
}

/** RFC 4122 v4 id; `crypto.randomUUID` is missing outside secure contexts (plain-http admin). */
export function mintUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Attaches the idempotency key of a confirmed adjustment: kept when the pending amount is
 * unchanged, minted otherwise, removed when there is no adjustment.
 */
export function withAdjustmentKey(
  variant: FormVariant,
  previous: FormVariant | null,
  mint: () => string = mintUuid
): FormVariant {
  const { stockAdjustmentKey: _old, ...rest } = variant;
  if (!variant.stockAdjustment) return rest;
  const keep =
    previous?.stockAdjustmentKey && previous.stockAdjustment === variant.stockAdjustment;
  return { ...rest, stockAdjustmentKey: keep ? previous.stockAdjustmentKey : mint() };
}
