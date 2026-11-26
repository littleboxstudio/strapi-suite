import { describe, expect, it } from 'vitest';
import {
  decideAccess,
  ROUTE_CLASSES,
  type AccessDecision,
  type RouteClass,
} from '../../../../../server/src/services/modules/ecommerce/domain/accounts/access';

type Mode = 'GUEST_ONLY' | 'REGISTERED_ONLY' | 'BOTH';
type Customer = 'none' | 'valid' | 'invalid';

const MODES: Mode[] = ['GUEST_ONLY', 'REGISTERED_ONLY', 'BOTH'];
const CUSTOMERS: Customer[] = ['none', 'valid', 'invalid'];
const GUESTS = [false, true];

const ok = (as: 'guest' | 'customer' | 'none'): AccessDecision => ({ allow: true, as });
const no = (status: number, code: string): AccessDecision => ({ allow: false, status, code });
const SESSION_INVALID = no(401, 'SESSION_INVALID');
const LOGIN_REQUIRED = no(401, 'LOGIN_REQUIRED');
const CUSTOMER_INVALID = no(401, 'CUSTOMER_SESSION_INVALID');
const DISABLED = no(403, 'ACCOUNTS_DISABLED');

/**
 * The spec table ("Modes and endpoint access"), written out independently of the implementation.
 * In GUEST_ONLY accounts are off: the login token is ignored (valid or not) and a guest session
 * is what counts; account routes answer 403 before the token is looked at.
 */
const expected = (mode: Mode, cls: RouteClass, guest: boolean, customer: Customer): AccessDecision => {
  if (cls === 'catalog') return ok('none');
  if (mode === 'GUEST_ONLY') {
    if (cls === 'account-public' || cls === 'account-private') return DISABLED;
    return guest ? ok('guest') : SESSION_INVALID;
  }
  if (customer === 'invalid') return CUSTOMER_INVALID;
  const asSession = customer === 'valid' ? ok('customer') : guest ? ok('guest') : null;
  switch (cls) {
    case 'account-public':
      return asSession ?? ok('none');
    case 'account-private':
      return customer === 'valid' ? ok('customer') : LOGIN_REQUIRED;
    case 'checkout':
      if (mode === 'REGISTERED_ONLY') return customer === 'valid' ? ok('customer') : LOGIN_REQUIRED;
      return asSession ?? SESSION_INVALID;
    case 'order-existing':
    case 'public-session':
      return asSession ?? SESSION_INVALID;
  }
  throw new Error(`unknown class ${cls}`);
};

describe('decideAccess: the spec matrix, cell by cell', () => {
  it('covers the six route classes', () => {
    expect([...ROUTE_CLASSES].sort()).toEqual(
      ['account-private', 'account-public', 'catalog', 'checkout', 'order-existing', 'public-session'].sort()
    );
  });

  for (const mode of MODES) {
    for (const cls of ROUTE_CLASSES) {
      for (const guest of GUESTS) {
        for (const customer of CUSTOMERS) {
          it(`${mode} · ${cls} · guest=${guest} · customer=${customer}`, () => {
            expect(decideAccess(mode, cls, { guest, customer })).toEqual(expected(mode, cls, guest, customer));
          });
        }
      }
    }
  }

  // Named cells from the brief, so a regression points at the rule it breaks.
  it('Review Focus 1: an invalid login token with a valid guest on checkout in BOTH → 401, never guest', () => {
    expect(decideAccess('BOTH', 'checkout', { guest: true, customer: 'invalid' })).toEqual(CUSTOMER_INVALID);
  });

  it('Review Focus 5: GUEST_ONLY private route with a valid login token → 403 ACCOUNTS_DISABLED', () => {
    expect(decideAccess('GUEST_ONLY', 'account-private', { guest: false, customer: 'valid' })).toEqual(DISABLED);
  });

  it('REGISTERED_ONLY checkout with only a guest session → LOGIN_REQUIRED', () => {
    expect(decideAccess('REGISTERED_ONLY', 'checkout', { guest: true, customer: 'none' })).toEqual(LOGIN_REQUIRED);
  });

  it('order-existing stays open to a guest session in every mode', () => {
    for (const mode of MODES) {
      expect(decideAccess(mode, 'order-existing', { guest: true, customer: 'none' })).toEqual(ok('guest'));
    }
  });

  it('the login session wins when both are valid', () => {
    expect(decideAccess('BOTH', 'checkout', { guest: true, customer: 'valid' })).toEqual(ok('customer'));
  });

  it('an unknown mode is treated as GUEST_ONLY (fail closed for accounts)', () => {
    expect(decideAccess('WHATEVER' as never, 'account-private', { guest: true, customer: 'valid' })).toEqual(
      DISABLED
    );
  });
});
