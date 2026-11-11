import type { EmailTemplateType, VariableDef } from '../settingsTypes';

/** Every e-mail template type, in the order the list shows them. */
export const EMAIL_TEMPLATE_TYPES: EmailTemplateType[] = [
  'ORDER_CONFIRMATION',
  'PAYMENT_CONFIRMATION',
  'PAYMENT_INSTRUCTIONS',
  'SUPPLEMENTARY_PAYMENT',
  'PARTIAL_SHIPMENT',
  'FULL_SHIPMENT',
  'DELIVERY_CONFIRMATION',
  'CANCELLATION',
  'REFUND_STARTED',
  'REFUND_COMPLETED',
  'INVOICE_AVAILABLE',
  'STORE_CREDIT_ISSUED',
];

export const isEmailTemplateType = (value: string | undefined): value is EmailTemplateType =>
  EMAIL_TEMPLATE_TYPES.includes(value as EmailTemplateType);

/**
 * Inserts `snippet` at `cursor` (clamped to the text; an unknown cursor appends)
 * and returns the new text with the cursor right after the snippet.
 */
export function insertAtCursor(
  text: string,
  cursor: number,
  snippet: string
): { text: string; cursor: number } {
  const at = Number.isNaN(cursor) ? text.length : Math.min(Math.max(cursor, 0), text.length);
  return { text: text.slice(0, at) + snippet + text.slice(at), cursor: at + snippet.length };
}

/** The tag that prints a variable. */
export const variableTag = (path: string) => `{{${path}}}`;

/** An `{{#each}}` example for a list variable, with its item fields. */
export function listExample(variable: VariableDef): string {
  const fields = variable.itemFields?.length
    ? variable.itemFields.map((field) => variableTag(`this.${field}`)).join(' ')
    : variableTag('this');
  return `{{#each ${variable.path}}}\n  ${fields}\n{{/each}}`;
}

type RouteLocation = { pathname: string; search: string };

/** In-app navigation away from an editor with unsaved changes must be confirmed. */
export const shouldBlockNavigation = (
  dirty: boolean,
  current: RouteLocation,
  next: RouteLocation
): boolean => dirty && (current.pathname !== next.pathname || current.search !== next.search);
