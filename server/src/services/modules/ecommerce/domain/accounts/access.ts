/**
 * Who may call which storefront route, per customer-accounts mode (spec "Modes and endpoint
 * access"). Pure: the controller resolves the headers, this decides.
 *
 * Classes:
 * - `catalog`: products, categories, collections. BFF token only; the session headers are not
 *   even read (owner's decision).
 * - `public-session`: open a guest session, pickup points. Any session.
 * - `account-public`: register, verify, resend, login, forgot / reset, confirm e-mail change.
 *   Routes that also need a session check that on top of this decision: register, verify,
 *   login and reset need a guest session (SESSION_INVALID otherwise); confirm needs any.
 * - `account-private`: the private area. Login only.
 * - `checkout`: cart, quote, discounts, store credit, checkout e-mail verification, create order.
 * - `order-existing`: payment link and order status of an existing order (by `publicId`).
 *
 * Rules:
 * - A valid login session wins over a guest session.
 * - An invalid, expired or revoked login token on any non-catalog route is 401
 *   `CUSTOMER_SESSION_INVALID`, never a fallback to the guest session (Review Focus 1).
 * - `GUEST_ONLY`: accounts are off. Account routes answer 403 `ACCOUNTS_DISABLED` before the
 *   login token is looked at (the controller does not even resolve it, so no session row is
 *   touched: Review Focus 5). On every other route the login token is treated as absent, valid or
 *   not, and the guest-session rules apply (the spec's "guest session" cells; a store that turned
 *   accounts off has no login session in play).
 * - Payment link and order status stay open to guest sessions in every mode.
 * - An unknown mode is read as `GUEST_ONLY` (accounts fail closed).
 */
export type CustomerAccountsMode = 'GUEST_ONLY' | 'REGISTERED_ONLY' | 'BOTH';

export const ROUTE_CLASSES = [
  'catalog',
  'public-session',
  'account-public',
  'account-private',
  'checkout',
  'order-existing',
] as const;

export type RouteClass = (typeof ROUTE_CLASSES)[number];

export type AccessAuth = { guest: boolean; customer: 'none' | 'valid' | 'invalid' };

export type AccessDecision =
  | { allow: true; as: 'guest' | 'customer' | 'none' }
  | { allow: false; status: number; code: string };

const allow = (as: 'guest' | 'customer' | 'none'): AccessDecision => ({ allow: true, as });
const deny = (status: number, code: string): AccessDecision => ({ allow: false, status, code });

const SESSION_INVALID = () => deny(401, 'SESSION_INVALID');
const LOGIN_REQUIRED = () => deny(401, 'LOGIN_REQUIRED');

const isAccountClass = (c: RouteClass) => c === 'account-public' || c === 'account-private';

export const decideAccess = (
  mode: CustomerAccountsMode,
  routeClass: RouteClass,
  auth: AccessAuth
): AccessDecision => {
  if (routeClass === 'catalog') return allow('none');

  const accountsOn = mode === 'REGISTERED_ONLY' || mode === 'BOTH';
  if (!accountsOn) {
    if (isAccountClass(routeClass)) return deny(403, 'ACCOUNTS_DISABLED');
    // The login token is ignored while accounts are off.
    return auth.guest ? allow('guest') : SESSION_INVALID();
  }

  if (auth.customer === 'invalid') return deny(401, 'CUSTOMER_SESSION_INVALID');
  const customer = auth.customer === 'valid';
  const session = customer ? allow('customer') : auth.guest ? allow('guest') : null;

  switch (routeClass) {
    case 'account-public':
      return session ?? allow('none');
    case 'account-private':
      return customer ? allow('customer') : LOGIN_REQUIRED();
    case 'checkout':
      if (mode === 'REGISTERED_ONLY') return customer ? allow('customer') : LOGIN_REQUIRED();
      return session ?? SESSION_INVALID();
    case 'order-existing':
    case 'public-session':
      return session ?? SESSION_INVALID();
    default:
      return SESSION_INVALID();
  }
};
