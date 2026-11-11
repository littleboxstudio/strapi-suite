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
  /** Editable only for a new variant; read-only current stock otherwise. */
  stock: string;
  /** Signed adjustment for an existing variant ('' = none). */
  stockAdjustment: string;
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
    stockAdjustment: '',
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
    stock: String(variant.stock),
    stockAdjustment: variant.stockAdjustment ? String(variant.stockAdjustment) : '',
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
  let stock = 0;
  if (stockText === '') errors.stock = 'required';
  else if (!/^-?\d+$/.test(stockText)) errors.stock = 'invalid_number';
  else stock = Number(stockText);

  let stockAdjustment = 0;
  if (!isNew) {
    const adjustText = draft.stockAdjustment.trim();
    if (adjustText !== '') {
      if (/^[+-]?\d+$/.test(adjustText)) stockAdjustment = Number(adjustText);
      else errors.stockAdjustment = 'invalid_number';
    }
  }

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
      ...(stockAdjustment !== 0 ? { stockAdjustment } : {}),
      ...dims,
      active: draft.active,
      translations: Object.fromEntries(
        Object.entries(draft.options).map(([code, option]) => [code, { option: option.trim() }])
      ),
    },
  };
}
