import { MAX_MONEY_CENTS, parseMoneyToCents } from './money';
import {
  ADDRESS_REQUIRED_FIELDS,
  addressFormFromAddress,
  toAddress,
  type AddressForm,
} from './orderForm';
import type {
  FieldError,
  ModificationPreview,
  ModificationShipping,
  Order,
  OrderModificationInput,
  VariantSearchResult,
} from '../orderTypes';

export type ShippingMode = ModificationShipping['mode'];

export const SHIPPING_MODES: ShippingMode[] = ['KEEP', 'RECALCULATE', 'MANUAL'];

/**
 * One line of the modification draft. Existing lines keep their `orderLineId`; removing one only
 * marks it (it can be restored), removing a new line drops it. Gift lines are read-only.
 */
export type ModifyLineDraft = {
  /** Stable UI key: `line-<orderLineId>` or `new-<variantId>`. */
  key: string;
  orderLineId?: number;
  variantId: number;
  name: string;
  option: string | null;
  sku: string;
  /** Price per unit after the product discount, for display only. */
  unitPrice: number;
  quantity: number;
  /** Quantity on the order before the modification (0 for new lines). */
  originalQuantity: number;
  shipped: number;
  isGift: boolean;
  removed: boolean;
  /** Known for lines added from the picker only. */
  stock: number | null;
};

export type ModifyOrderForm = {
  lines: ModifyLineDraft[];
  shippingAddress: AddressForm;
  billingAddress: AddressForm;
  originalShippingAddress: AddressForm;
  originalBillingAddress: AddressForm;
  shippingMode: ShippingMode;
  /** Decimal amount typed by the admin (MANUAL mode). */
  manualAmount: string;
};

/** First code per UI key: `line.<key>`, `shippingAddress.<field>`, `shipping`, `form`, … */
export type ModificationErrorMap = Record<string, string>;

export function modifyFormFromOrder(order: Order): ModifyOrderForm {
  const shippingAddress = addressFormFromAddress(order.shippingAddress);
  const billingAddress = addressFormFromAddress(order.billingAddress);
  return {
    lines: order.lines.map((l) => ({
      key: `line-${l.id}`,
      orderLineId: l.id,
      variantId: l.variantId,
      name: l.name,
      option: l.option,
      sku: l.sku,
      unitPrice: l.unitPrice - l.unitDiscount,
      quantity: l.quantity,
      originalQuantity: l.quantity,
      shipped: l.shipped,
      isGift: l.isGift,
      removed: false,
      stock: null,
    })),
    shippingAddress,
    billingAddress,
    originalShippingAddress: { ...shippingAddress },
    originalBillingAddress: { ...billingAddress },
    shippingMode: 'KEEP',
    manualAmount: '',
  };
}

/** Adds a variant (quantity 1), or bumps / restores the non-gift line that already has it. */
export function addModifyLine(lines: ModifyLineDraft[], v: VariantSearchResult): ModifyLineDraft[] {
  if (v.stock <= 0) return lines;
  const index = lines.findIndex((l) => !l.isGift && l.variantId === v.variantId);
  if (index !== -1) {
    return lines.map((l, i) => {
      if (i !== index) return l;
      return l.removed ? { ...l, removed: false } : { ...l, quantity: l.quantity + 1 };
    });
  }
  return [
    ...lines,
    {
      key: `new-${v.variantId}`,
      variantId: v.variantId,
      name: v.name,
      option: v.option,
      sku: v.sku,
      unitPrice: v.price,
      quantity: 1,
      originalQuantity: 0,
      shipped: 0,
      isGift: false,
      removed: false,
      stock: v.stock,
    },
  ];
}

export function setModifyLineQuantity(
  lines: ModifyLineDraft[],
  key: string,
  quantity: number
): ModifyLineDraft[] {
  return lines.map((l) => (l.key === key && !l.isGift ? { ...l, quantity } : l));
}

export function removeModifyLine(lines: ModifyLineDraft[], key: string): ModifyLineDraft[] {
  const line = lines.find((l) => l.key === key);
  if (!line || line.isGift) return lines;
  if (line.orderLineId === undefined) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, removed: true } : l));
}

export function restoreModifyLine(lines: ModifyLineDraft[], key: string): ModifyLineDraft[] {
  return lines.map((l) => (l.key === key ? { ...l, removed: false } : l));
}

/** The lines sent to the server, in order: removed existing lines are omitted. */
export function sentLines(form: ModifyOrderForm): ModifyLineDraft[] {
  return form.lines.filter((l) => l.isGift || !l.removed);
}

const sameAddress = (a: AddressForm, b: AddressForm) =>
  JSON.stringify(toAddress(a, true)) === JSON.stringify(toAddress(b, true));

export function addressChanged(value: AddressForm, original: AddressForm): boolean {
  return !sameAddress(value, original);
}

/** Request body of `modification/preview` and (with an operationId) `modification`. */
export function buildModificationInput(form: ModifyOrderForm): OrderModificationInput {
  const lines = sentLines(form).map((l) =>
    l.orderLineId !== undefined
      ? {
          orderLineId: l.orderLineId,
          variantId: l.variantId,
          quantity: l.isGift ? l.originalQuantity : l.quantity,
        }
      : { variantId: l.variantId, quantity: l.quantity }
  );

  let shipping: ModificationShipping;
  if (form.shippingMode === 'MANUAL') {
    // An unparsable amount becomes null in JSON: the server answers INVALID_AMOUNT.
    shipping = { mode: 'MANUAL', amount: parseMoneyToCents(form.manualAmount) ?? NaN };
  } else {
    shipping = { mode: form.shippingMode };
  }

  const addresses: NonNullable<OrderModificationInput['addresses']> = {};
  if (addressChanged(form.shippingAddress, form.originalShippingAddress)) {
    addresses.shipping = toAddress(form.shippingAddress, true);
  }
  if (addressChanged(form.billingAddress, form.originalBillingAddress)) {
    addresses.billing = toAddress(form.billingAddress, true);
  }

  return {
    lines,
    shipping,
    ...(addresses.shipping || addresses.billing ? { addresses } : {}),
  };
}

const validQuantity = (q: number) => Number.isSafeInteger(q) && q >= 1;

/** Mirrors the server rules (same paths) so obvious mistakes are flagged without a round trip. */
export function validateModificationForm(form: ModifyOrderForm): FieldError[] {
  const errors: FieldError[] = [];
  if (!sentLines(form).length) errors.push({ path: 'lines', code: 'LINES_REQUIRED' });
  sentLines(form).forEach((l, i) => {
    if (l.isGift) return;
    if (!validQuantity(l.quantity)) errors.push({ path: `lines.${i}.quantity`, code: 'INVALID_QUANTITY' });
    else if (l.quantity < l.shipped) {
      errors.push({ path: `lines.${i}.quantity`, code: 'QUANTITY_BELOW_SHIPPED' });
    }
  });
  form.lines.forEach((l) => {
    if (l.removed && !l.isGift && l.orderLineId !== undefined && l.shipped > 0) {
      errors.push({ path: `removed.${l.orderLineId}`, code: 'QUANTITY_BELOW_SHIPPED' });
    }
  });
  (
    [
      ['shipping', form.shippingAddress, form.originalShippingAddress],
      ['billing', form.billingAddress, form.originalBillingAddress],
    ] as const
  ).forEach(([kind, value, original]) => {
    if (!addressChanged(value, original)) return;
    ADDRESS_REQUIRED_FIELDS.forEach((f) => {
      if (!value[f].trim()) errors.push({ path: `addresses.${kind}.${f}`, code: 'required' });
    });
  });
  if (form.shippingMode === 'MANUAL') {
    const cents = parseMoneyToCents(form.manualAmount);
    if (cents === null || cents < 0 || cents > MAX_MONEY_CENTS) {
      errors.push({ path: 'shipping.amount', code: 'INVALID_AMOUNT' });
    }
  }
  return errors;
}

const LINE_PATH = /^lines\.(\d+)(\.|$)/;
const REMOVED_PATH = /^removed\.(\d+)$/;

/** Server (or local) error paths → the UI keys of the modify form. First code per key wins. */
export function toModificationErrorMap(
  form: ModifyOrderForm,
  errors: FieldError[]
): ModificationErrorMap {
  const sent = sentLines(form);
  const map: ModificationErrorMap = {};
  const put = (key: string, code: string) => {
    if (!(key in map)) map[key] = code;
  };
  errors.forEach(({ path, code }) => {
    const line = LINE_PATH.exec(path);
    if (line) {
      const draft = sent[Number(line[1])];
      put(draft ? `line.${draft.key}` : 'form', code);
      return;
    }
    const removed = REMOVED_PATH.exec(path);
    if (removed) {
      const draft = form.lines.find((l) => l.orderLineId === Number(removed[1]));
      put(draft ? `line.${draft.key}` : 'form', code);
      return;
    }
    if (path.startsWith('addresses.shipping.')) {
      put(`shippingAddress.${path.slice('addresses.shipping.'.length)}`, code);
      return;
    }
    if (path.startsWith('addresses.billing.')) {
      put(`billingAddress.${path.slice('addresses.billing.'.length)}`, code);
      return;
    }
    if (path === 'shipping.amount') {
      put('shipping.amount', code);
      return;
    }
    if (path === 'shipping' || path.startsWith('shipping.')) {
      put('shipping', code);
      return;
    }
    if (path === 'lines') {
      put('lines', code);
      return;
    }
    put('form', code);
  });
  return map;
}

/** Number of products (lines with units) and units, before and after the modification. */
export function countLines(lineChanges: ModificationPreview['lineChanges']): {
  before: { products: number; units: number };
  after: { products: number; units: number };
} {
  const out = { before: { products: 0, units: 0 }, after: { products: 0, units: 0 } };
  lineChanges.forEach((c) => {
    if (c.previousQuantity > 0) out.before.products += 1;
    if (c.newQuantity > 0) out.after.products += 1;
    out.before.units += c.previousQuantity;
    out.after.units += c.newQuantity;
  });
  return out;
}
