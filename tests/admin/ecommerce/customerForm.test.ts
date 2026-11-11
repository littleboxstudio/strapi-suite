import { describe, it, expect } from 'vitest';
import {
  buildCustomerInput,
  customerFormFromCustomer,
  customerName,
  toCustomerErrorMap,
  validateCustomerForm,
} from '../../../admin/src/ecommerce/utils/customerForm';
import {
  CUSTOMERS_MANAGE_ACTION,
  ORDERS_MANAGE_ACTION,
  rbacKey,
} from '../../../admin/src/ecommerce/utils/rbac';

const en = require('../../../admin/src/core/translations/en.json');
const pt = require('../../../admin/src/core/translations/pt.json');

describe('customer form', () => {
  it('fills the form from a customer, phone null → empty string', () => {
    expect(
      customerFormFromCustomer({ id: 1, firstName: 'Ana', lastName: 'Silva', email: 'a@x.pt', phone: null } as any)
    ).toEqual({ firstName: 'Ana', lastName: 'Silva', email: 'a@x.pt', phone: '' });
  });

  it('trims the input and sends an empty phone as null', () => {
    expect(buildCustomerInput({ firstName: ' Ana ', lastName: 'Silva ', email: ' a@x.pt', phone: ' ' })).toEqual({
      firstName: 'Ana',
      lastName: 'Silva',
      email: 'a@x.pt',
      phone: null,
    });
  });

  it('requires first name, last name and e-mail, and checks the e-mail format', () => {
    expect(validateCustomerForm({ firstName: '', lastName: ' ', email: '', phone: '' })).toEqual([
      { path: 'firstName', code: 'required' },
      { path: 'lastName', code: 'required' },
      { path: 'email', code: 'required' },
    ]);
    expect(validateCustomerForm({ firstName: 'A', lastName: 'B', email: 'nope', phone: '' })).toEqual([
      { path: 'email', code: 'invalid_email' },
    ]);
    expect(validateCustomerForm({ firstName: 'A', lastName: 'B', email: 'a@b.pt', phone: '' })).toEqual([]);
  });

  it('keeps the first error per field', () => {
    expect(
      toCustomerErrorMap([
        { path: 'email', code: 'duplicate_email' },
        { path: 'email', code: 'invalid_email' },
        { path: 'firstName', code: 'required' },
      ])
    ).toEqual({ email: 'duplicate_email', firstName: 'required' });
  });

  it('joins first and last names', () => {
    expect(customerName({ firstName: 'Ana', lastName: 'Silva' })).toBe('Ana Silva');
    expect(customerName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
  });

  it.each(['required', 'invalid_email', 'duplicate_email'])('error %s is translated in en and pt', (code) => {
    const key = `littlebox-strapi-suite.ecommerce.customers.errors.${code}`;
    expect(en[key]).toEqual(expect.any(String));
    expect(pt[key]).toEqual(expect.any(String));
  });
});

describe('customers and orders permissions', () => {
  it('pins the action uids and their useRBAC keys', () => {
    expect(CUSTOMERS_MANAGE_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.customers.manage');
    expect(ORDERS_MANAGE_ACTION).toBe('plugin::littlebox-strapi-suite.ecommerce.orders.manage');
    expect(rbacKey(CUSTOMERS_MANAGE_ACTION)).toBe('canManage');
    expect(rbacKey(ORDERS_MANAGE_ACTION)).toBe('canManage');
  });
});
