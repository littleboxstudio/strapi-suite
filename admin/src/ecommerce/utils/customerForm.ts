import { isEmail } from './settingsForm';
import type { Customer, CustomerInput, FieldError } from '../orderTypes';

export type CustomerForm = { firstName: string; lastName: string; email: string; phone: string };
export type CustomerField = keyof CustomerForm;
/** First error code per field. */
export type CustomerErrorMap = Partial<Record<CustomerField, string>>;

export const CUSTOMER_FIELDS: CustomerField[] = ['firstName', 'lastName', 'email', 'phone'];

export function customerFormFromCustomer(c: Customer): CustomerForm {
  return {
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
  };
}

export function buildCustomerInput(form: CustomerForm): CustomerInput {
  const phone = form.phone.trim();
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    phone: phone || null,
  };
}

/** Mirrors the server rules so obvious mistakes are flagged without a round trip. */
export function validateCustomerForm(form: CustomerForm): FieldError[] {
  const errors: FieldError[] = [];
  if (!form.firstName.trim()) errors.push({ path: 'firstName', code: 'required' });
  if (!form.lastName.trim()) errors.push({ path: 'lastName', code: 'required' });
  const email = form.email.trim();
  if (!email) errors.push({ path: 'email', code: 'required' });
  else if (!isEmail(email)) errors.push({ path: 'email', code: 'invalid_email' });
  return errors;
}

export function toCustomerErrorMap(errors: FieldError[]): CustomerErrorMap {
  const map: CustomerErrorMap = {};
  errors.forEach(({ path, code }) => {
    const field = path.split('.')[0] as CustomerField;
    if (CUSTOMER_FIELDS.includes(field) && !(field in map)) map[field] = code;
  });
  return map;
}

export function customerName(c: { firstName?: string | null; lastName?: string | null }): string {
  return [c.firstName, c.lastName].filter((s) => s && s.trim()).join(' ');
}
