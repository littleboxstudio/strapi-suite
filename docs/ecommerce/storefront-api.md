# Storefront API: BFF contract

The e-commerce module exposes a storefront API for **one** consumer: the storefront's
backend-for-frontend (BFF), a server you run next to the shop's website. This document is the
contract between that BFF and Strapi.

Base path: `/api/littlebox-strapi-suite/ecommerce/storefront`. Every route answers `403` while
the e-commerce module is inactive.

## 1. Server to server only

**The browser never calls this API.** The BFF token never reaches the browser, no CORS is
configured for these routes, and the storefront's origins must **not** be added to
`strapi::cors`. The browser talks to the BFF; the BFF talks to Strapi.

## 2. The BFF token

1. In Strapi, *Settings → API Tokens → Create new API Token*: type **Custom**, with **no
   permissions** at all, and a name such as `storefront-bff`. Copy the token: Strapi shows it
   once.
2. In the e-commerce *Settings*, choose that token as the storefront API token
   (`storefrontApiTokenId`).

Only the chosen token passes the `check-storefront-token` policy. Any other token is refused
with `403`, including the *read-only* token that the other modules (menus, pages…) accept, an
admin token, an expired token, or any token while none is chosen. Rotating it: create a new
token, choose it in Settings, deploy the BFF with it, then delete the old one.

## 3. Headers

| Header | When | Value |
|---|---|---|
| `Authorization` | always | `Bearer <BFF token>` |
| `X-Checkout-Session` | routes marked **S**; optional on `POST /checkout/session` | the session token |
| `Idempotency-Key` | `POST /orders` | 8–100 characters `[A-Za-z0-9_:-]`, one per checkout attempt |
| `X-Storefront-Client-IP` | always | the browser's IP (see below) |

### `X-Storefront-Client-IP`

- The BFF **always overwrites** this header with the IP of the browser it is serving: a single
  IPv4 or IPv6 address. It **never forwards** a value the browser sent.
- Strapi **ignores `X-Forwarded-For`** (and every other proxy header) for rate limiting: any
  client can forge them.
- A missing or invalid value (a list, a zone id, text) is treated as missing. Without it, only
  the per-session and per-e-mail limits apply (the BFF's own IP is never used as a key, so one
  client cannot throttle the whole shop). The exception is `POST /checkout/session`, which then
  counts in **one shared bucket for the whole shop** (20 per hour): a BFF that forgets the
  header cannot create unlimited sessions, but its customers will soon get `429`.
- IPv4-mapped IPv6 (`::ffff:203.0.113.7`) counts as the IPv4; any other IPv6 address counts by
  its `/64` prefix.

## 4. The session and the BFF cookie

`POST /checkout/session` returns the session token **once** (`201 { token, expiresAt }`).
Strapi only keeps its hash. The session lives `checkoutSessionTtlHours` from its creation
(Settings; never extended). Sent with a valid current token in `X-Checkout-Session`, it answers
`200 { token: null, expiresAt, reused: true }`: keep the token you have.

The BFF keeps the token in its own cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
Never in `localStorage` or anything script-readable.

**CSRF is the BFF's job.** `SameSite=Lax` is not enough: every BFF operation that changes data
(cart, codes, e-mail verification, order, payment) must check an anti-CSRF token or the
`Origin` header.

A missing, malformed, unknown or expired session gives `401 SESSION_INVALID` (they are never
distinguished). Open a new session and rebuild the cart. Expired sessions are deleted (or
emptied, when they have orders) opportunistically; nothing ever cancels an order.

## 5. Routes

**S** = `X-Checkout-Session` required. *Rule* = rate-limit rule (section 7).

| Method | Path | S | Rule | Body / answer |
|---|---|---|---|---|
| GET | `/products?page=&pageSize=&search=&sort=&locale=` | | `catalog` | `{ results, pagination }` |
| GET | `/products/:slug?locale=` | | `catalog` | `PublicProduct` |
| POST | `/checkout/session` | optional | `session.create` | `201 { token, expiresAt }` or `200 { token: null, expiresAt, reused: true }` |
| GET | `/cart` | S | `cart.quote` | the stored cart |
| POST | `/cart/quote` | S | `cart.quote` | cart (0–100 lines; empty → empty quote) → `PublicQuote` |
| POST | `/discounts/apply` | S | `discount.apply` | cart + `{ code }` → `{ code, status, message, applied, quote }` |
| POST | `/store-credit/check` | S | `storeCredit.check` | `{ code, email }` → `{ balance, expiresAt }` |
| POST | `/checkout/email-verification` | S | `email.send` | `{ email, locale }` → `202 { expiresAt }` |
| POST | `/checkout/email-verification/confirm` | S | `email.confirm` | `{ email, code }` → `{ verified: true }` |
| POST | `/orders` | S | `order.create` | order + `Idempotency-Key` → `201 { publicId, reference, total, due, paymentStatus }` |
| POST | `/orders/:publicId/payment` | S | `order.read` | → `{ url, expiresAt, amount, reused }` |
| GET | `/orders/:publicId/status` | S | `order.read` | `PublicOrderStatus` |

Cart body: `{ lines: [{ variantId, quantity }], locale?, email?, promotionCodes?, giftChoices?,
destination?: { country, postalCode? }, shippingMethod?: { providerId, serviceId } }`.

Order body: `{ customer: { firstName, lastName, email, phone? }, shippingAddress,
billingAddress?, locale?, lines (1–100), shippingMethod, promotionCodes?, giftChoices?,
expectedTotal, storeCreditCode?, notes? }`. Addresses: `firstName`, `lastName`, `company?`,
`nif?`, `line1`, `line2?`, `postalCode`, `city`, `country`, `phone?`.

Input rules: `quantity` and `variantId` are integers, `quantity` in `[1, 1000]`; at most 5
promotion codes of ≤ 40 characters and 10 gift choices; `email` ≤ 254; store-credit `code` ≤ 64;
`country` is `^[A-Z]{2}$`; `postalCode` ≤ 20; `notes` ≤ 1000; `locale` must be a configured
locale (empty → default); `:publicId` is a UUID. **Unknown fields are ignored**: prices,
discounts, statuses, stock or `emailVerified` sent by the BFF never reach the services. Money is
integer cents (EUR), VAT included.

Public answers never carry internal ids of orders, customers or payments (an order is its
`publicId`), internal promotion names, the code of an automatic promotion, snapshots, stock
counts, costs, audit or history, nor any backoffice URL.

### Images

`PublicImage.url` is the URL stored by the upload provider, without a host prefix. With a
cloud provider it is absolute. With Strapi's local provider it is a relative `/uploads/...` path:
**the BFF serves it** (proxy or rewrite to Strapi's `/uploads`), since the browser never talks
to Strapi.

## 6. Checkout flow

1. **Session**: `POST /checkout/session`; store the token in the BFF cookie.
2. **Quote**: `POST /cart/quote` with the cart on every change (the cart is saved first, then
   priced; `GET /cart` reads it back). Codes go through `POST /discounts/apply`. A code whose
   status is `AWAITING_SHIPPING` (a shipping promotion without a delivery method) is kept in the
   cart and re-evaluated once a shipping method is chosen. A gift variant deleted from the
   catalogue is simply left out of `giftOptions`.
3. **E-mail verification, when asked**: a code with status `EMAIL_NOT_VERIFIED` (promotion
   restricted to e-mails or with a per-customer limit) needs the customer's e-mail verified on
   this session: `POST /checkout/email-verification` sends a 6-digit code valid 10 minutes;
   `POST /checkout/email-verification/confirm` checks it (5 attempts; after that
   `429 VERIFICATION_LOCKED` until the code expires). Without a verified e-mail, per-customer
   limits are never evaluated, so the API never tells whether an e-mail already bought.
4. **Order**: `POST /orders` with the `expectedTotal` the customer saw (required) and a fresh
   `Idempotency-Key`. A different total → `409 TOTAL_CHANGED` (re-quote and show it). Retrying
   with the same key in the same session returns the same order (no double charge, no double
   stock or promotion use); the same key from another session creates that session's own
   order. A retry **after the session expired** gets `401 SESSION_INVALID`, not the stored
   order (the order still exists; the customer has its payment link and success page).
5. **Payment**: `POST /orders/:publicId/payment` returns a Stripe Checkout URL (the amount always
   comes from the order); redirect the browser there.
6. **Success page**: Stripe returns to `<storefrontUrl><paymentSuccessPath>?order=<publicId>`.
   **The success page does not prove payment**: read
   `GET /orders/:publicId/status` (`paymentResult`: `PAID`, `PROCESSING` for e.g. Multibanco
   awaiting confirmation, `UNPAID`, `CANCELLED`).

An order of another session and an unknown `publicId` give the same `404 ORDER_NOT_FOUND`.
There is no "view your order" link by e-mail in this version: the status is readable only from
the session that created the order.

### Store credit at checkout

A store credit (`storeCreditCode` on the order, checked with `POST /store-credit/check`) does
**not** need a verified e-mail: its 12-character code (60 bits) is the secret and is bound to the
credit's e-mail, and both routes are rate limited. A credit of another e-mail answers
`STORE_CREDIT_NOT_FOUND`, like an unknown code.

## 7. Rate limits

Fixed windows, per rule and dimension; a request counts in every dimension it has (session,
client IP when the header is valid, e-mail for the verification routes).

| Rule | Per session | Per client IP | Per e-mail |
|---|---|---|---|
| `session.create` | | 20 / 60 min (shared bucket without the IP header) | |
| `catalog` | | 600 / 1 min | |
| `cart.quote` | 120 / 10 min | 600 / 10 min | |
| `discount.apply` | 20 / 10 min | 60 / 60 min | |
| `storeCredit.check` | 10 / 10 min | 30 / 60 min | |
| `email.send` | 3 / 15 min | 10 / 60 min | 5 / 60 min |
| `email.confirm` | 10 / 15 min | 30 / 60 min | 5 / 60 min |
| `order.create` | 5 / 10 min | 20 / 60 min | |
| `order.read` | 120 / 10 min | | |

Over a limit: `429` with `Retry-After` (seconds) and `details: { code: 'RATE_LIMITED',
retryAfter }`.

**The counters live in memory: they are valid only with a single Strapi instance.** With
several instances (or after a restart) each one counts on its own.

## 8. Errors

Strapi's error format: `{ data: null, error: { status, name, message, details: { code,
errors? } } }`. `errors` is a list of `{ path, code, detail? }`.

| Status | `details.code` | Meaning |
|---|---|---|
| 400 | first field code (`required`, `invalid`, `invalid_locale`, `invalid_idempotency_key`, `VERIFICATION_CODE_INVALID`, `STORE_CREDIT_NOT_FOUND`, …) | invalid request |
| 400 | `PROMOTION_CODE_INVALID` | an entered code cannot be used: `errors[i] = { path: 'promotionCodes.<i>', detail: <public status> }` |
| 401 | `SESSION_INVALID` | missing, unknown or expired session |
| 403 | — | wrong BFF token, or the module is inactive |
| 404 | `ORDER_NOT_FOUND` | order of another session or unknown |
| 404 | `NOT_FOUND` | unknown product |
| 409 | `TOTAL_CHANGED` | the total changed: re-quote (`detail` = new total) |
| 409 | `PROMOTION_UNAVAILABLE` | a code reached its usage limit meanwhile (`promotionCodes.<i>`), or an automatic promotion became unavailable (`promotions`): re-quote |
| 409 | `STORE_CREDIT_INSUFFICIENT`, `STORE_CREDIT_CONFLICT` | the credit changed meanwhile |
| 409 | `NOTHING_DUE`, `PAYMENT_PENDING` | nothing to pay / a payment awaits confirmation |
| 409 | `VERIFICATION_CONFLICT`, `IDEMPOTENCY_KEY_CONFLICT`, … | concurrent change: retry |
| 429 | `RATE_LIMITED` | see section 7 (`Retry-After`) |
| 429 | `VERIFICATION_LOCKED` | too many wrong codes (`Retry-After` until the code expires) |
| 502 | `STRIPE_UNREACHABLE`, `STRIPE_REQUEST_FAILED`, `EMAIL_SEND_FAILED`, carrier codes | a provider failed: retry later |
| 503 | `STRIPE_NOT_CONFIGURED`, `STOREFRONT_URL_MISSING`, `EMAIL_NOT_CONFIGURED` | the shop is not configured for this |
| 500 | — | unexpected error (no details) |

Public code statuses (`status` in quotes and `discounts/apply`, `detail` of
`PROMOTION_CODE_INVALID`): `APPLIED`, `NOT_FOUND`, `NOT_ELIGIBLE`, `EMAIL_NOT_VERIFIED`,
`EXPIRED`, `USAGE_LIMIT_REACHED`, `CONDITIONS_NOT_MET`, `CONFLICT`, `NO_BENEFIT`,
`AWAITING_SHIPPING`. A code that is deactivated or not yet started answers `NOT_FOUND`; a code
the e-mail already used up, or that is restricted to other e-mails, answers `NOT_ELIGIBLE`.

Security events (`SESSION_INVALID`, `ORDER_ACCESS_DENIED`, `RATE_LIMITED`,
`VERIFICATION_LOCKED`) go to Strapi's log as warnings with the rule name only: no tokens, IPs or
e-mails.
