import { parseQuantity, type FormErrors } from './shipmentForm';
import type { OrderStatus, RegisterReturnInput } from '../orderTypes';

/** Mirror the server limits. */
export const MAX_RETURN_REASON = 200;
export const MAX_RETURN_NOTES = 500;

export type ReturnLineDraft = { orderLineId: number; quantity: string; restock: boolean };
export type ReturnForm = { lines: ReturnLineDraft[]; reason: string; notes: string };

type ReturnableLine = { id: number; returnable: number; unitPrice: number; unitDiscount: number };

/** A line as the return form reads it: `returnable` comes from the server view. */
type FormLine = {
  id: number;
  returnable: number;
  /** Units a REFUND credit note credited (plan 15): never returnable. */
  refundCredited?: number;
  shipped?: number;
  returnedQuantity?: number;
};

/**
 * Lines with shipped units not yet returned, quantity 0 (a line whose units were all credited by a
 * refund credit note is listed too, with nothing returnable). Restock is on by default, except on a
 * cancelled order: the cancellation already put every held unit back.
 */
export function defaultReturnLines(lines: FormLine[], orderStatus: OrderStatus): ReturnLineDraft[] {
  return lines
    .filter((l) => l.returnable > 0 || (l.refundCredited ?? 0) > 0)
    .map((l) => ({ orderLineId: l.id, quantity: '0', restock: orderStatus !== 'CANCELLED' }));
}

/**
 * Why `q` units of `line` exceed what is returnable: units a refund credit note credited
 * (UNITS_REFUND_CREDITED) while they are within the shipped units not yet returned, else
 * QUANTITY_EXCEEDS_RETURNABLE.
 */
const exceededCode = (line: FormLine | undefined, q: number): string => {
  const credited = line?.refundCredited ?? 0;
  if (!line || credited <= 0) return 'QUANTITY_EXCEEDS_RETURNABLE';
  const shippedLeft =
    line.shipped !== undefined && line.returnedQuantity !== undefined
      ? line.shipped - line.returnedQuantity
      : line.returnable + credited;
  return q <= shippedLeft ? 'UNITS_REFUND_CREDITED' : 'QUANTITY_EXCEEDS_RETURNABLE';
};

/** The codes (local and server) of a quantity above what a line can return. */
const OVER_QUANTITY_CODES = new Set(['QUANTITY_EXCEEDS_RETURNABLE', 'UNITS_REFUND_CREDITED']);

/** The error is a quantity above the line's returnable units: shown as a short "at most N". */
export function isReturnQuantityExceeded(code: string | undefined): boolean {
  return code !== undefined && OVER_QUANTITY_CODES.has(code);
}

/** 0 ≤ quantity ≤ returnable, at least one unit, a reason (≤ 200) and notes ≤ 2000. */
export function validateReturnForm(form: ReturnForm, lines: FormLine[]): FormErrors {
  const errors: FormErrors = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  let units = 0;
  for (const line of form.lines) {
    const q = parseQuantity(line.quantity);
    const view = byId.get(line.orderLineId);
    if (q === null) errors[`lines.${line.orderLineId}`] = 'invalid_quantity';
    else if (q > (view?.returnable ?? 0)) {
      errors[`lines.${line.orderLineId}`] = exceededCode(view, q);
    } else units += q;
  }
  if (!units && !Object.keys(errors).length) errors.lines = 'required';
  const reason = form.reason.trim();
  if (!reason) errors.reason = 'required';
  else if (reason.length > MAX_RETURN_REASON) errors.reason = 'too_long';
  if (form.notes.trim().length > MAX_RETURN_NOTES) errors.notes = 'too_long';
  return errors;
}

/**
 * Σ (unitPrice − unitDiscount) × quantity over the valid quantities. The order discount share is
 * taken off on the server, so the approved value may be lower.
 */
export function estimatedReturnValue(form: ReturnForm, lines: ReturnableLine[]): number {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return form.lines.reduce((sum, draft) => {
    const line = byId.get(draft.orderLineId);
    const q = parseQuantity(draft.quantity);
    if (!line || q === null || q > line.returnable) return sum;
    return sum + (line.unitPrice - line.unitDiscount) * q;
  }, 0);
}

/** The request body of a form `validateReturnForm` accepted. */
export function buildReturnInput(form: ReturnForm, idempotencyKey: string): RegisterReturnInput {
  const notes = form.notes.trim();
  return {
    lines: form.lines
      .map((l) => ({ orderLineId: l.orderLineId, quantity: parseQuantity(l.quantity) ?? 0, restock: l.restock }))
      .filter((l) => l.quantity > 0),
    reason: form.reason.trim(),
    ...(notes ? { notes } : {}),
    idempotencyKey,
  };
}
