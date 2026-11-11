import { parseQuantity, type FormErrors } from './shipmentForm';
import type { OrderStatus, RegisterReturnInput } from '../orderTypes';

/** Mirror the server limits. */
export const MAX_RETURN_REASON = 200;
export const MAX_RETURN_NOTES = 2000;

export type ReturnLineDraft = { orderLineId: number; quantity: string; restock: boolean };
export type ReturnForm = { lines: ReturnLineDraft[]; reason: string; notes: string };

type ReturnableLine = { id: number; returnable: number; unitPrice: number; unitDiscount: number };

/**
 * Lines with shipped units not yet returned, quantity 0. Restock is on by default, except on a
 * cancelled order: the cancellation already put every held unit back.
 */
export function defaultReturnLines(
  lines: { id: number; returnable: number }[],
  orderStatus: OrderStatus
): ReturnLineDraft[] {
  return lines
    .filter((l) => l.returnable > 0)
    .map((l) => ({ orderLineId: l.id, quantity: '0', restock: orderStatus !== 'CANCELLED' }));
}

/** 0 ≤ quantity ≤ returnable, at least one unit, a reason (≤ 200) and notes ≤ 2000. */
export function validateReturnForm(form: ReturnForm, lines: { id: number; returnable: number }[]): FormErrors {
  const errors: FormErrors = {};
  const returnableOf = new Map(lines.map((l) => [l.id, l.returnable]));
  let units = 0;
  for (const line of form.lines) {
    const q = parseQuantity(line.quantity);
    if (q === null) errors[`lines.${line.orderLineId}`] = 'invalid_quantity';
    else if (q > (returnableOf.get(line.orderLineId) ?? 0)) {
      errors[`lines.${line.orderLineId}`] = 'QUANTITY_EXCEEDS_RETURNABLE';
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
