# Customer accounts: register, login, password recovery, blocking

Status: approved in conversation with the store owner (2026-11-26). Builder: implement on
`feat/ecommerce`. The storefront frontend and the developer documentation are out of scope.

## Intent

The store has no customer accounts today: every order is a guest checkout through the BFF. The
owner wants optional accounts: register with e-mail confirmation, login, password recovery, a
private area (my orders, my profile, my sessions), and the ability to block a customer. Whether
the store accepts guests, registered customers or both is a store setting. Security matters more
than convenience everywhere a choice exists.

## Current state (what the builder builds on)

- The storefront API (`server/src/routes/ecommerce/content-api-storefront.ts`) is called only by
  the BFF, server to server, authenticated by the API token chosen in the e-commerce settings
  (`check-storefront-token` policy). The BFF forwards the client IP in `X-Storefront-Client-IP`.
- The guest session is the checkout session (`ltb-st-module-ecommerce-checkout-session`): an
  opaque token stored as a hash, sent in `X-Checkout-Session`, holding the cart and the checkout
  e-mail verification (6-digit code). Service: `storefrontSessions.ts`.
- The BFF keeps every session token (guest and, from now on, login) in an httpOnly cookie and
  forwards it in a header. The browser never talks to Strapi.
- Customers (`ltb-st-module-ecommerce-customer`) are created when an order is placed and matched
  by `emailNormalized`. They have no password.
- E-mails: templates in `server/src/services/modules/ecommerce/email/` (catalog, defaults,
  engine), edited in Settings → Email templates, sent with the configured provider.
- Rate limiting: in-memory limiter in the storefront controller (single Strapi instance).

## Goals

1. A store setting, Settings → General → "Customer accounts", with three modes:
   `GUEST_ONLY` (default, also for existing stores), `REGISTERED_ONLY`, `BOTH`.
2. Storefront endpoints for register, e-mail verification, login, logout, password recovery,
   profile, password change, e-mail change, my orders and my sessions.
3. Login sessions that can be revoked immediately (block, password change, logout, "remove
   session").
4. Passwords hashed with Argon2id plus a versioned pepper, through one reusable service.
5. Admin: block / unblock a customer, set a registered customer's password, see account type,
   verification and block state on the customer record.
6. Existing customers become guest accounts with the e-mail not verified.

## Non-goals

- Frontend pages and developer documentation (later).
- Social login, 2FA, magic links, "remember me" variants.
- A tags list endpoint (none exists today; not added).
- Multi-instance rate limiting (the existing limiter stays per process).

## Anti-goals (a failure even if it works)

- Any admin endpoint reachable with the storefront token or a customer token.
- A guest session reaching the private area, or a customer reaching another customer's data.
- An invalid login token silently treated as a guest.
- A password, password hash, pepper, token or verification link in a log line or API response
  (apart from the one response that returns the new login token).
- An endpoint whose answer reveals whether an e-mail is registered, blocked or verified (except
  "e-mail already in use" on the authenticated e-mail change).

## Modes and endpoint access

Every storefront request still needs the BFF API token. "Session" below means a valid guest
session (`X-Checkout-Session`) or a valid login session (`X-Customer-Token`).

| Endpoints | GUEST_ONLY | REGISTERED_ONLY | BOTH |
|---|---|---|---|
| Catalog (products, categories, collections) | BFF token only, as today | BFF token only, as today | BFF token only, as today |
| Pickup points, open guest session | session (guest or login) | session (guest or login) | session (guest or login) |
| Register, verify e-mail, resend, login, forgot / reset password | 403 `ACCOUNTS_DISABLED` | on | on |
| Private area (me, orders, sessions, password, e-mail change, logout) | 403 `ACCOUNTS_DISABLED` | login only | login only |
| Cart, quote, discounts, store credit, checkout e-mail verification, create order | guest session | login only (guest → 401 `LOGIN_REQUIRED`) | guest or login |
| Payment link, order status (an existing order, by its `publicId`) | guest session | guest or login | guest or login |

Rules:
- A guest session can always be opened, in every mode: it is what the catalog runs on before a
  login. In `REGISTERED_ONLY` it serves the public endpoints only.
- When both headers are sent and the login token is valid, the login session wins.
- When `X-Customer-Token` is sent and is invalid, expired or revoked → 401
  `CUSTOMER_SESSION_INVALID`, never a fallback to the guest session.
- Catalog endpoints stay exactly as today (owner's decision): BFF token only, no session check,
  and the session headers are ignored there.
- Payment link and order status act on an order that already exists, addressed by its
  unguessable `publicId`. They stay open to guest sessions in every mode, so guest orders placed
  before a switch to `REGISTERED_ONLY` can still be paid and followed (builder's call).
- In `GUEST_ONLY` the checkout e-mail verification (code) stays as today. With a login session
  it does not apply: the checkout e-mail is the account's verified e-mail.

## Data model

Customer (new attributes):
- `accountType`: `GUEST` | `REGISTERED`, default `GUEST`.
- `emailVerified` (bool, default false), `emailVerifiedAt`.
- `passwordHash` (private, never returned), `passwordPepperVersion` (int),
  `passwordChangedAt`.
- `pendingEmail`, `pendingEmailNormalized` (e-mail change waiting for confirmation).
- `blocked` (bool, default false), `blockedAt`, `blockedNote` (internal, admin only),
  `blockedById` (admin user id).
- `cart` (json): the logged-in customer's cart, same shape as the checkout session's
  `StoredCart`.
- `emailNormalized` becomes unique for new writes. If existing data has duplicates, the builder
  finds out in the migration; see "What's left to the builder".

New content type: customer session (hidden), one row per login:
- `customer` relation, `createdAt`, `lastUsedAt`, `expiresAt` (absolute), `revokedAt`,
  `userAgent` (truncated to 255), `ipPrefix` (IPv4 /24, IPv6 /48), `revokeReason`.

New content type: customer token (hidden), single-use links:
- `customer` relation, `purpose`: `VERIFY_EMAIL` | `RESET_PASSWORD` | `CHANGE_EMAIL`,
  `tokenHash` (unique; the raw token is never stored), `email` (the address the link was sent
  to), `expiresAt`, `usedAt`.
- Creating a token of a purpose invalidates the customer's earlier unused tokens of that purpose.
- TTLs: verify e-mail 24h, reset password 1h, change e-mail 24h.
- Raw tokens are 32 random bytes, base64url.

## Login session tokens (JWT)

- The login and verify-e-mail endpoints return `{ token, expiresAt }`. The BFF stores the token
  in its httpOnly cookie and sends it in `X-Customer-Token`.
- The token is a JWT signed with HS256 by a dedicated secret. Library: `jose`, added as a direct
  dependency. Verification pins the algorithm, issuer and audience.
- The secret is derived (HKDF) from the module's existing encryption key source
  (`resolveEncryptionKeySource`), with its own info label. It is never the admin JWT secret.
  Without a key source, accounts are unavailable (503 `ACCOUNTS_UNAVAILABLE`).
- Claims: `sub` (customer id), `sid` (customer session id), `iat`, `exp`.
- On every request the server checks:
  - the signature and `exp`;
  - the session row: exists, not revoked, not expired, and `lastUsedAt` within the idle
    window;
  - the customer: exists, `REGISTERED`, `emailVerified`, not blocked;
  - `iat` is after `passwordChangedAt`.
  The JWT alone is never trusted. It identifies the session and the database decides.
- Lifetimes: 30 days idle (checked against `lastUsedAt` in the database), 90 days absolute, a
  hard cut with no refresh. Rotating the encryption key source invalidates every login session;
  that is accepted (builder's call). `lastUsedAt` is refreshed at most once a minute,
  as the checkout session does.
- Every private endpoint takes the customer from the session, never from the request.
  Resources of another customer answer 404, not 403.
- Revocation:
  - logout revokes the current session;
  - block revokes all of the customer's sessions;
  - a password change by the customer revokes all others;
  - a password change by the admin or a reset revokes all;
  - an e-mail change revokes all others.
- When a login (or verify e-mail) succeeds with a guest session: the guest cart is merged into
  the customer's cart, then the guest session is expired and scrubbed.

## Password service

One service, `EcommercePasswordService`, used by register, login, reset, change and admin:

- Argon2id with memory 65536 KiB, time 3, parallelism 4. Library: `@node-rs/argon2`, which has
  prebuilt binaries and supports `secret`. Salt is generated by the library. The stored value is
  the PHC string (algorithm, version, parameters, salt, hash).
- Pepper: through the Argon2 `secret` parameter. Env vars `LTB_ECOMMERCE_PASSWORD_PEPPER_V<n>`
  (n ≥ 1, at least 32 bytes base64). The current version is the highest n present. Stored
  beside the hash in `passwordPepperVersion`. Never in the database.
- On a successful login, the hash is redone when its parameters differ from the current ones or
  its pepper version is not the current one. Old versions must remain set until no hash uses
  them.
- Without any pepper, the module still boots. Accounts are unavailable (503
  `ACCOUNTS_UNAVAILABLE`), and the admin settings show a warning.
- Concurrency: at most 4 hashes or verifications at once and a waiting queue of 16. Beyond that,
  429 `RATE_LIMITED` with Retry-After.
- Login with an unknown e-mail, a guest account or a blocked account still runs one verification
  against a fixed dummy hash, so the timing does not reveal the account state.
- Policy (register, reset, change, admin):
  - length 10–128 characters, counted after Unicode NFC normalization;
  - no composition rules;
  - not equal to the e-mail, case-insensitive.
- Passwords are never logged, never echoed and never stored outside the hash. Request bodies of
  these routes are never logged.

## Flows

### Register (`POST /account/register`)

Body: e-mail, password, first name, last name, optional phone and locale. A guest session is
required. The answer is always 202 `{ status: 'VERIFICATION_SENT' }`, unless the input is
invalid (400) or the request is rate limited (429). What happens depends on the e-mail:

- **New:** create a `REGISTERED`, unverified customer and send `ACCOUNT_VERIFICATION`.
- **Guest account:** set the password, turn it `REGISTERED`, keep it unverified, update the
  name and phone, and send `ACCOUNT_VERIFICATION`. Its past orders are already on it.
- **Registered, unverified:** replace the password and send a new `ACCOUNT_VERIFICATION`.
- **Registered, verified:** change nothing and send `REGISTRATION_ATTEMPT` (a notice to the
  owner).
- **Blocked:** change nothing and send nothing.

Timing: every branch runs one password hash and the e-mail is sent after the response
(fire and forget, failures logged without addresses), so the 202 takes the same time whatever
the e-mail's state (builder's call).

Known risk, accepted by design: someone who registers with another person's guest e-mail sets
the password. The account only opens when the owner clicks the link, so the e-mail must say
clearly "if you did not create this account, ignore this e-mail". The builder writes the
default copy accordingly.

### Verify e-mail (`POST /account/verify-email`)

Body `{ token }`. A guest session is required. The token must be valid, of purpose
`VERIFY_EMAIL`, unused and unexpired, its e-mail must still be the customer's e-mail, and the
customer must not be blocked. On success:

- mark the e-mail verified;
- mark the token used;
- open a login session and merge the guest cart into it (see Login).

The answer is `{ token, expiresAt, customer }`. Every failure answers the same 400
`TOKEN_INVALID`.

`POST /account/verify-email/resend` takes `{ email }` and always answers 202. It sends only for
a registered, unverified, unblocked account.

### Login (`POST /account/login`)

Body `{ email, password }`. A guest session is required. Success needs a registered account
with the e-mail verified, not blocked, and the right password.

- Every failure answers 401 `INVALID_CREDENTIALS`, with one exception.
- The exception: right password but e-mail not verified answers 403
  `EMAIL_NOT_VERIFIED`. It is only returned after the password was verified, so it reveals
  nothing to someone without the password.
- A blocked account is just `INVALID_CREDENTIALS`.

Rate limits:
- per IP: 10 per minute;
- per normalized e-mail: 5 per 15 minutes, counted on failures. It is a throttle only: no
  account lockout and no account state change (builder's call).

The success answer is `{ token, expiresAt, customer }`. Cart merge into the customer's cart:

- same variant: the quantities are summed and capped by the existing cart line rules;
- promotion codes: union;
- destination, shipping method and gift choices: the guest's values win when set;
- e-mail and locale: the guest's locale wins when set; the e-mail is the account's.

### Logout (`POST /account/logout`)

Revokes the current session. Answers 204. The BFF then opens a new guest session; the cart stays
on the account.

### Forgot and reset password

`POST /account/password/forgot` takes `{ email }` and always answers 202. It sends
`PASSWORD_RESET` only for a registered, unblocked account (verified or not). Guest accounts get
nothing; they register instead.

`POST /account/password/reset` takes `{ token, password }`. A guest session is required.
Success:
- sets the password;
- marks the e-mail verified, since the link proves ownership;
- revokes all sessions and marks the token used;
- sends `PASSWORD_CHANGED`.

It answers 204, and the frontend then sends the customer to the login. Invalid or expired
tokens, and blocked customers, answer 400 `TOKEN_INVALID`.

### Private area (login session required)

- **`GET /account/me`:** profile (id, e-mail, pending e-mail, first and last name, phone,
  locale, created at).
- **`PUT /account/me`:** first and last name, phone and locale only.
- **`POST /account/password`:** body `{ currentPassword, newPassword }`.
  - A wrong current password answers 400 `INVALID_CREDENTIALS`, rate limited.
  - Success revokes the other sessions and sends `PASSWORD_CHANGED`.
- **`POST /account/email`:** body `{ currentPassword, newEmail }`.
  - The new e-mail must not belong to any customer, guest or registered, or be another
    customer's pending e-mail. Otherwise 409 `EMAIL_IN_USE`.
  - Success stores it as pending and sends `EMAIL_CHANGE_VERIFICATION` to the new address.
  - A new request replaces the earlier pending change.
- **`POST /account/email/confirm`:** body `{ token }`.
  - Needs a session (guest or login), because the link may open on another device.
  - Re-checks that the e-mail is still free (409 `EMAIL_IN_USE`).
  - Success swaps the e-mail, clears the pending e-mail, revokes the other sessions and sends
    `EMAIL_CHANGED` to the old address.
  - In the same transaction, everything keyed by the old normalized e-mail moves to the new one:
    store credits and per-customer promotion usage (builder's call, so credits and limits
    follow the customer).
- **`GET /account/orders`:** the customer's orders, paginated and newest first, in the
  storefront order shape.
- **`GET /account/orders/:publicId`:** the detail of one of the customer's orders. Another
  customer's order answers 404.
- **`GET /account/sessions`:** id, created, last used, user agent, IP prefix and `current`.
- **`DELETE /account/sessions/:id`:** revokes one session, which can be the current one. A
  session of another customer answers 404.
- **`POST /account/sessions/revoke-others`:** revokes all sessions except the current one.

The BFF sends the browser's user agent in `X-Storefront-Client-User-Agent` (new header). It is
stored truncated and never logged.

### Cart and checkout with a login session

- Cart endpoints read and write `customer.cart` instead of the session cart. Updates are atomic
  per request, and the last write wins.
- Create order: the customer comes from the session and the e-mail is the account e-mail. The
  name and phone in the body are used for the order snapshot (they may differ from the
  account) and never update the account (builder's call). The
  checkout e-mail verification is skipped. On success the customer's cart is cleared, as the
  session cart is today.
- Guest checkout (`GUEST_ONLY` or `BOTH`) with an e-mail that belongs to a registered account is
  allowed after the usual code verification. The order goes to that customer and no login
  session is opened.

### Guest accounts

When an order creates a customer, the new customer is `GUEST`, not verified, and has the hash
of a random 32-byte password nobody knows. The hash is computed before the order transaction.

Migration (bootstrap, idempotent):
- existing customers become `GUEST`, not verified, not blocked;
- their random-password hashes are filled in a background job (through the password service's
  concurrency limit) that never blocks startup;
- a guest without a hash yet is simply a guest: guests can never log in.

### Blocking

- The admin customer record gets "Block customer" / "Unblock customer" actions, with a
  confirmation that states the consequences and an optional internal note.
- Block sets `blocked`, `blockedAt`, `blockedById` and `blockedNote`, and revokes all sessions.
- While blocked:
  - login fails as invalid credentials;
  - register, resend and forgot do nothing (with the same answers as always);
  - verify, reset and e-mail confirm fail with `TOKEN_INVALID`;
  - guest checkout with that e-mail is refused when the code is requested and at order creation
    (403 `CUSTOMER_BLOCKED`), compared by normalized e-mail;
  - the admin cannot create an order for that customer. The server refuses in the order
    creation and duplicate paths, and the admin UI hides or disables the customer choice and
    shows why.
- Existing orders of a blocked customer are unaffected: fulfilment, invoices and refunds go on.
- Unblock clears the flags. Nothing else is restored: sessions stay revoked.
- These are recorded in the customer's audit history, without any secret:
  - block and unblock;
  - an admin password change;
  - a customer password change or reset;
  - an e-mail change.

### Admin: edit e-mail (existing action)

- Still allowed. It is refused when the new e-mail belongs to another customer or is another
  customer's pending e-mail.
- For a `REGISTERED` customer it also marks the e-mail not verified, revokes all sessions and
  sends `ACCOUNT_VERIFICATION` to the new address. Store credits and promotion usage move as in
  the customer's own e-mail change (builder's call).

### Admin: set password

- Shown only for `REGISTERED`, unblocked customers.
- The admin types the new password twice, and the same policy applies.
- Saving revokes all sessions and sends `PASSWORD_CHANGED`.
- It does not change `emailVerified`.

## Admin UI

- Customer record header: badges for Guest / Registered, E-mail verified / not verified, and
  Blocked (danger).
- Actions: Block / Unblock, Change password.
- New RBAC actions:
  - `ecommerce.customers.block` for block and unblock;
  - `ecommerce.customers.password` for change password.
  They are separate from `customers.manage`.
- Customers list: a Blocked badge beside the name, and a filter by account type and blocked.
- Settings → General → "Customer accounts":
  - a three-way choice of mode;
  - a hint that the e-mail links are written in the templates (no path settings);
  - a warning when the pepper or the encryption key source is missing and the mode is not
    `GUEST_ONLY`.
  Saving a mode other than `GUEST_ONLY` without `storefrontUrl` is refused.

## E-mail templates (Settings → Email templates)

New template types, all localized like the others, each with default subject and HTML in the
existing style:

| Type | To | Variables (besides store / customer basics) |
|---|---|---|
| `ACCOUNT_VERIFICATION` | the account e-mail | `token`, `expiresInHours` |
| `PASSWORD_RESET` | the account e-mail | `token`, `expiresInMinutes` |
| `PASSWORD_CHANGED` | the account e-mail | `changedAt` |
| `EMAIL_CHANGE_VERIFICATION` | the new e-mail | `token`, `newEmail`, `expiresInHours` |
| `EMAIL_CHANGED` | the old e-mail | `newEmail` (masked), `changedAt` |
| `REGISTRATION_ATTEMPT` | the account e-mail | none: the links are `{{store.url}}` and its reset page |

The links are written in the templates, so the owner edits the storefront path there: the
defaults are `{{store.url}}/account/verify-email?token={{token}}`, `/account/reset-password` and
`/account/confirm-email` (owner's ruling, 2026-11-27: the paths are not backend settings).
`store.url` has no trailing slash and `token` is URL-encoded. The link never points at Strapi.
Sending still requires `storefrontUrl`. These e-mails go
out immediately, not through the order notification events. They are never stored with the raw
token.

## Rate limits (in addition to the password-hash queue)

All limits are per IP, plus per normalized e-mail where an e-mail is in the body:

| Endpoints | Limit |
|---|---|
| Register | 5/hour per e-mail, 20/hour per IP |
| Resend and forgot | 3/hour per e-mail, 20/hour per IP |
| Login | see Login |
| Token endpoints (verify, reset, confirm) | 20/hour per IP |
| Private endpoints | per session, the existing cart-like rule |

## Errors (storefront)

The existing storefront error shape is kept. New codes:
- `ACCOUNTS_DISABLED` (403);
- `LOGIN_REQUIRED` (401);
- `CUSTOMER_SESSION_INVALID` (401);
- `INVALID_CREDENTIALS` (401, or 400 on the password change);
- `EMAIL_NOT_VERIFIED` (403);
- `TOKEN_INVALID` (400);
- `EMAIL_IN_USE` (409);
- `CUSTOMER_BLOCKED` (403, guest checkout only);
- `ACCOUNTS_UNAVAILABLE` (503);
- `WEAK_PASSWORD` (400, with the rule that failed: `TOO_SHORT`, `TOO_LONG` or
  `EQUALS_EMAIL`).

## Constraints

- Single tenant, single Strapi instance (the in-memory limiters).
- Only the e-commerce module changes. Nothing outside it changes behaviour.
- No new admin route is reachable without admin authentication and the RBAC action.
- Translations for every new admin string: `en.json` and `pt.json` (pt-PT).
- Search bars and single-line inputs in the admin: 38px.
- Tests:
  - vitest unit tests for the domain;
  - service tests in the existing style for every flow and every mode;
  - an access-matrix test that walks the table above.

## What's left to the builder

- The exact module and file split, following the existing storefront and e-commerce layout.
- How the customer cart is stored and updated atomically (column vs. separate row), keeping the
  `StoredCart` shape.
- Duplicate `emailNormalized` rows found by the migration (builder's call): the oldest row is
  kept. The orders and store credits of the others are re-linked to it, and the others are left
  in place, untouched otherwise. A log line gives only the count, never the e-mails. If the
  unique index still cannot be added, uniqueness is enforced in the service.
- The default e-mail copy (English and Portuguese, in the existing template style).
- The order shape of `/account/orders`: reuse the existing order-status shape and extend it,
  never exposing internal ids or admin-only data.
