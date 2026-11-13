import { MAX_MONEY_CENTS, parseMoneyToCents } from './money';
import { allowedToolbarActions, type OrderActionPermissions, type ToolbarAction } from './orderDetail';
import type {
  DiscountRow,
  FieldError,
  ManualDiscountInput,
  Order,
  OrderEditAction,
  OrderEditing,
  ReviewFlagCode,
  ShippingLineView,
} from '../orderTypes';

/** The order offers `action` (the server decides; the UI only hides buttons). */
export function canEdit(order: Order, action: OrderEditAction): boolean {
  return order.editing.editable && order.editing.actions.includes(action);
}

export type ReviewAlert = {
  code: ReviewFlagCode;
  /** Translation id (without the plugin prefix) of the reason. */
  reasonKey: string;
  raisedAt: string;
  sectionId: 'order-section-shipments' | 'order-section-promotions';
  /** The merchant can still act on the section (recalculate). */
  actionable: boolean;
  /** Editing is closed (cancelled, archived, pending shipment): the flag can only be dismissed. */
  dismissable: boolean;
};

const ALERT_SECTION: Record<ReviewFlagCode, ReviewAlert['sectionId']> = {
  SHIPPING_REVIEW: 'order-section-shipments',
  DISCOUNTS_REVIEW: 'order-section-promotions',
};
const ALERT_ORDER: ReviewFlagCode[] = ['SHIPPING_REVIEW', 'DISCOUNTS_REVIEW'];

/** The open review flags, shipments first. */
export function reviewAlerts(order: Order): ReviewAlert[] {
  const editable = order.editing.editable;
  return [...order.reviewFlags]
    .sort((a, b) => ALERT_ORDER.indexOf(a.code) - ALERT_ORDER.indexOf(b.code))
    .map((f) => ({
      code: f.code,
      reasonKey: `ecommerce.orders.review.reason.${f.reason}`,
      raisedAt: f.raisedAt,
      sectionId: ALERT_SECTION[f.code],
      actionable: editable,
      dismissable: !editable,
    }));
}

/** The flag's raise date as an ISO string, or null when it is empty or not a date. */
export function reviewAlertDate(raisedAt: string | null | undefined): string | null {
  if (!raisedAt) return null;
  const time = new Date(raisedAt).getTime();
  return Number.isNaN(time) ? null : raisedAt;
}

export type ShippingLineRow = {
  line: ShippingLineView;
  badges: ('PAID' | 'INVOICED' | 'SPENT')[];
  actions: 'EDIT'[];
};

export function shippingLineRows(
  lines: ShippingLineView[],
  editing: OrderEditing,
  canManage: boolean
): ShippingLineRow[] {
  const canEditLine = canManage && editing.editable && editing.actions.includes('EDIT_SHIPPING_LINE');
  return lines.map((line) => ({
    line,
    badges: [
      ...(line.paid ? (['PAID'] as const) : []),
      ...(line.invoiced ? (['INVOICED'] as const) : []),
      ...(line.spent ? (['SPENT'] as const) : []),
    ],
    actions: canEditLine ? ['EDIT'] : [],
  }));
}

/** The Actions column is shown only when some row has an action. */
export function hasRowActions(rows: { actions: unknown[] }[]): boolean {
  return rows.some((r) => r.actions.length > 0);
}

/** Toggles a row of the discounts table; a locked row (gift already shipped) stays selected. */
export function discountSelectionToggle(selection: string[], row: DiscountRow): string[] {
  const selected = selection.includes(row.key);
  if (row.locked) return selected ? selection : [...selection, row.key];
  return selected ? selection.filter((k) => k !== row.key) : [...selection, row.key];
}

export const MAX_DISCOUNT_REASON = 200;

/**
 * A manual discount draft as the server input. FIXED is euros (→ cents); PERCENT accepts a comma or
 * a dot and at most 2 decimals. `input` is null when there are errors.
 */
export function manualDiscountDraftToInput(draft: {
  kind: 'FIXED' | 'PERCENT';
  value: string;
  reason: string;
}): { input: ManualDiscountInput | null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  let value = 0;
  const raw = draft.value.trim();

  if (draft.kind === 'FIXED') {
    const cents = parseMoneyToCents(raw);
    if (cents === null || cents < 1 || cents > MAX_MONEY_CENTS) {
      errors.push({ path: 'value', code: 'INVALID_AMOUNT' });
    } else value = cents;
  } else {
    const percent = /^\d+([.,]\d{1,2})?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    if (!(percent > 0 && percent <= 100)) errors.push({ path: 'value', code: 'INVALID_PERCENT' });
    else value = percent;
  }

  const reason = draft.reason.trim();
  if (!reason) errors.push({ path: 'reason', code: 'required' });
  else if (reason.length > MAX_DISCOUNT_REASON) errors.push({ path: 'reason', code: 'too_long' });

  return errors.length
    ? { input: null, errors }
    : { input: { kind: draft.kind, value, reason }, errors };
}

/**
 * The buttons of a result step: add a payment or send instructions while something is due, refund
 * while there is an excess; each behind its permission.
 */
export function balanceActions(order: Order, perms: OrderActionPermissions): ToolbarAction[] {
  const wanted: string[] = [];
  if (order.summary.due > 0) wanted.push('ADD_PAYMENT', 'SEND_PAYMENT_INSTRUCTIONS');
  if (order.summary.excess > 0) wanted.push('REFUND');
  return allowedToolbarActions(
    order.availableActions.filter((a) => wanted.includes(a)),
    perms
  );
}
