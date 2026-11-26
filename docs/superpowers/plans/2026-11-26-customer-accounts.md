# Customer Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional storefront customer accounts. Customers can register with e-mail verification,
log in with revocable JWT sessions, recover their password and use a private area. The admin
gets block / unblock and set-password, and a store setting chooses guest, registered or both.

**Architecture:**
- **Pure rules** (password policy, cart merge, IP prefix, token and link helpers, access matrix)
  live in `domain/accounts/`.
- **Services** hold the stateful parts:
  - `EcommercePasswordService`: Argon2id, pepper, concurrency;
  - `EcommerceCustomerSessionService`: JWT and session rows;
  - `EcommerceCustomerTokenService`: single-use links;
  - `EcommerceAccountMailer`: e-mails;
  - `EcommerceAccountService`: the flows.
- **The storefront controller** resolves `X-Customer-Token` next to `X-Checkout-Session` and
  gates every route with the access matrix.
- **Admin** gets two new routes and UI on the customer record.

**Tech Stack:** Strapi 5 plugin (TypeScript), `@node-rs/argon2`, `jose`, vitest, React +
`@strapi/design-system`.

**Spec:** `docs/superpowers/specs/2026-11-26-customer-accounts-design.md` (read it; it is the
authority for every value not repeated here).

## Global Constraints

- **Branch and commits:**
  - work on `feat/ecommerce`;
  - commit with explicit paths, never `git add -A`, and never stage `.yalc/` or `yalc.lock`;
  - after each commit run `git branch -f main HEAD`;
  - never push;
  - commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Scope:** only the e-commerce module changes behaviour.
- **Secrets and logs:**
  - never log or return passwords, hashes, peppers, raw tokens, links containing tokens, or
    e-mail addresses;
  - log lines carry codes and counts only.
- **Settings defaults:**
  - customer accounts mode `GUEST_ONLY`;
  - paths `/account/verify-email`, `/account/reset-password` and `/account/confirm-email`.
- **Argon2id:**
  - memoryCost 65536, timeCost 3, parallelism 4;
  - pepper in env `LTB_ECOMMERCE_PASSWORD_PEPPER_V<n>`, where the current version is the
    highest n present and each value is at least 32 bytes after base64 decoding;
  - concurrency 4 and queue 16.
- **Password policy:**
  - 10–128 characters after NFC, measured in code points;
  - must not equal the e-mail (case-insensitive);
  - failure codes `TOO_SHORT`, `TOO_LONG` and `EQUALS_EMAIL`.
- **Login session:**
  - JWT HS256 signed with `jose`, issuer `ltb-ecommerce`, audience `ltb-storefront`;
  - claims `sub`, `sid`, `iat` and `exp`;
  - lifetime 30 days idle and 90 days absolute;
  - `lastUsedAt` refreshed at most once per 60s.
- **Token TTLs:** VERIFY_EMAIL 24h, RESET_PASSWORD 1h and CHANGE_EMAIL 24h. Raw tokens are 32
  random bytes in base64url, and only their sha256 hex is stored.
- **Headers:**
  - `X-Customer-Token`;
  - `X-Storefront-Client-User-Agent`, truncated to 255;
  - the existing `X-Checkout-Session` and `X-Storefront-Client-IP`.
- **IP prefix:** IPv4 /24 (`a.b.c.0/24`) and IPv6 /48 (`xxxx:xxxx:xxxx::/48`).
- **Storefront error codes and statuses:**
  - `ACCOUNTS_DISABLED` 403;
  - `LOGIN_REQUIRED` 401;
  - `CUSTOMER_SESSION_INVALID` 401;
  - `INVALID_CREDENTIALS` 401, or 400 on the password and e-mail change;
  - `EMAIL_NOT_VERIFIED` 403;
  - `TOKEN_INVALID` 400;
  - `EMAIL_IN_USE` 409;
  - `CUSTOMER_BLOCKED` 403;
  - `ACCOUNTS_UNAVAILABLE` 503;
  - `WEAK_PASSWORD` 400, with `reason`.
- **Catalog endpoints** (products, categories, collections) stay exactly as today. They ignore
  both session headers.
- **Admin UI:** every new string goes in `admin/src/core/translations/en.json` and `pt.json`
  (pt-PT), and single-line inputs are 38px tall.
- **Gate per task:**
  - `npm run test:ts:back` clean;
  - `npm run test:ts:tests` clean;
  - `npm run test:ts:front` clean when admin files changed;
  - `npx vitest run tests/server/ecommerce` green.

## Review Focus

1. **An expired or revoked JWT plus a valid guest session** on a guest-capable route → 401
   `CUSTOMER_SESSION_INVALID`, never served as guest. Test owned by Task 8.
2. **Concurrent logins merging into the same customer cart:** no lost lines beyond
   last-write-wins per request, and no crash on a malformed stored `customer.cart`. Test owned
   by Task 7, a malformed cart read as empty.
3. **Blocked customer, mixed-case e-mail with spaces** in guest checkout
   (`  Foo@Bar.com `) → `CUSTOMER_BLOCKED`. Test owned by Task 7.
4. **Pepper env removed after hashes exist** → login answers 503 `ACCOUNTS_UNAVAILABLE`, never
   500 and never "invalid credentials". Test owned by Task 2.
5. **Mode switched to `GUEST_ONLY` while customers hold sessions** → private routes 403
   `ACCOUNTS_DISABLED`, and the session rows are kept. Test owned by Task 8.

---

### Task 1: Settings — customer accounts mode and link paths

**Files:**
- Modify: `server/src/services/modules/ecommerce/settings.ts`
  - `StoreSettings`;
  - `STORE_SETTINGS_DEFAULTS`;
  - store validation near `for (const key of ['storefrontUrl']`;
  - `updateStoreSettings`.
- Modify: `admin/src/ecommerce/pages/settings/GeneralSettings.tsx`
- Modify: `admin/src/core/translations/en.json`, `pt.json`
- Test: `tests/server/ecommerce/settings.test.ts`

**Interfaces:**
- Produces, in `StoreSettings`:
  - `customerAccountsMode: 'GUEST_ONLY' | 'REGISTERED_ONLY' | 'BOTH'`;
  - `accountPaths: { verifyEmail: string; resetPassword: string; confirmEmail: string }`.
- Produces `accountsReadiness(): Promise<{ pepperConfigured: boolean; keyConfigured: boolean }>`
  on `EcommerceSettingsService`. Task 2 provides the pepper check: until then, read the env
  directly with the same var pattern. The admin GET of store settings includes it as
  `accountsReadiness`.

- [ ] **Step 1: Write failing tests** in `settings.test.ts`:
  - defaults are `customerAccountsMode === 'GUEST_ONLY'` and the paths from Global Constraints;
  - `updateStoreSettings({ customerAccountsMode: 'BOTH' })` with `storefrontUrl: null` throws
    `EcommerceValidationError`, path `customerAccountsMode`, code `storefront_url_required`;
  - a path not starting with `/`, containing `?`, `#`, `://` or whitespace, or longer than 200
    characters → code `invalid_path`;
  - an unknown mode → `invalid`.
- [ ] **Step 2:** Run `npx vitest run tests/server/ecommerce/settings.test.ts`. It must fail.
- [ ] **Step 3: Implement** the fields, validation and `accountsReadiness`. Stored settings
  without the fields read as the defaults.
- [ ] **Step 4: Admin section "Customer accounts"** in `GeneralSettings.tsx`:
  - a radio group with the three modes:
    - "Guest checkout only";
    - "Registered customers only";
    - "Guest checkout and registered customers";
  - three 38px path inputs with hints;
  - a warning Alert when the mode ≠ `GUEST_ONLY` and readiness has a false flag. It names
    the missing env (pepper or encryption key), never values.
- [ ] **Step 5:** Run the gate, then commit
  `feat(ecommerce): customer accounts mode and e-mail link paths in settings`.

### Task 2: Password service (Argon2id + pepper + concurrency)

**Files:**
- Modify: `package.json`. Add `@node-rs/argon2` and `jose` to `dependencies`, then run
  `npm install`.
- Create: `server/src/services/modules/ecommerce/domain/accounts/passwordPolicy.ts`
- Create: `server/src/services/modules/ecommerce/domain/accounts/peppers.ts`
- Create: `server/src/services/modules/ecommerce/domain/accounts/semaphore.ts`
- Create: `server/src/services/modules/ecommerce/passwords.ts`. Register it in
  `server/src/services/index.ts` as `EcommercePasswordService`.
- Test: `tests/server/ecommerce/domain/accounts/passwordPolicy.test.ts`, `peppers.test.ts`,
  `semaphore.test.ts`; `tests/server/ecommerce/passwords.test.ts`.

**Interfaces:**
- `checkPasswordPolicy(password: unknown, email: string): { ok: true } | { ok: false; reason: 'TOO_SHORT' | 'TOO_LONG' | 'EQUALS_EMAIL' }`.
  A non-string returns `TOO_SHORT`.
- `readPeppers(env: Record<string, string | undefined>): { current: number; byVersion: Map<number, Buffer> } | null`.
  It returns null when no valid var exists. Invalid vars (short or not base64) are ignored and
  counted for one warning.
- `createSemaphore(max: number, queue: number): { run<T>(fn: () => Promise<T>): Promise<T> }`.
  It rejects with `EcommerceRateLimitError` (new class in `errors.ts`, with `retryAfterSec: 1`)
  when the queue is full.
- `EcommercePasswordService`:
  - `available(): boolean`;
  - `hash(password: string): Promise<{ hash: string; pepperVersion: number }>`;
  - `verify(stored: { hash: string | null; pepperVersion: number | null } | null, password: string): Promise<{ ok: boolean; rehash: { hash: string; pepperVersion: number } | null }>`.
    A null `stored` or a null hash runs against the dummy hash and returns `ok: false`.
  - `randomGuestHash(): Promise<{ hash: string; pepperVersion: number }>`.
  - Without peppers, every method throws `EcommerceAccountsUnavailableError`, a new class in
    `errors.ts`.

- [ ] **Step 1: Failing tests:**
  - **Policy:** 9 characters → `TOO_SHORT`; 10 → ok; 129 → `TOO_LONG`; `"é"` composed vs
    decomposed counted equal after NFC; the e-mail in any case → `EQUALS_EMAIL`.
  - **Peppers:** V1 and V3 set → current 3, both in the map; a 16-byte value is ignored; no var
    → null.
  - **Semaphore:** 4 running, 16 queued, then the 21st call rejects with
    `EcommerceRateLimitError`; the queue drains in order.
  - **Service:**
    - `hash` then `verify` gives ok and `rehash: null`;
    - a hash made with pepper V1 when V2 is current verifies ok with `rehash` non-null and
      `pepperVersion: 2`;
    - a hash with lower parameters (timeCost 2) gives a non-null rehash;
    - a wrong password gives `ok: false`;
    - null stored gives `ok: false` and still calls the verifier once (spy);
    - no peppers → `EcommerceAccountsUnavailableError` (Review Focus 4);
    - the stored hash starts with `$argon2id$v=19$m=65536,t=3,p=4$`.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
  - Use `@node-rs/argon2` `hash` / `verify`, with `secret` set to the pepper buffer and
    algorithm `Algorithm.Argon2id`.
  - Detect a rehash by parsing the PHC parameters of the stored string.
  - The dummy hash is computed once lazily with a fixed random password.
  - Every hash and verify runs inside the semaphore.
- [ ] **Step 4:** Run the gate, then commit
  `feat(ecommerce): password service with Argon2id, pepper versions and a hash queue`.

### Task 3: Data model and migration

**Files:**
- Modify: `server/src/content-types/modules/ecommerce/customer/schema.json`. Add the spec's
  customer attributes:
  - `accountType` enum `GUEST` / `REGISTERED`, default `GUEST`;
  - `emailVerified` bool default false, and `emailVerifiedAt` datetime;
  - `passwordHash` string `private: true`, `passwordPepperVersion` integer, and
    `passwordChangedAt` datetime;
  - `pendingEmail` and `pendingEmailNormalized`;
  - `blocked` bool default false, `blockedAt`, `blockedNote` text, and `blockedById`
    integer;
  - `cart` json.
  Add an index on `pending_email_normalized`, and a non-unique index on
  `blocked, account_type`.
- Create: `server/src/content-types/modules/ecommerce/customer-session/schema.json`. Collection
  `ltb_st_module_ecommerce_customer_sessions` with:
  - a manyToOne relation `customer`;
  - `expiresAt` (required), `lastUsedAt`, `revokedAt`;
  - `revokeReason`, an enum of `LOGOUT`, `REVOKED_BY_CUSTOMER`, `PASSWORD_CHANGED`,
    `EMAIL_CHANGED`, `BLOCKED`, `ADMIN_PASSWORD` and `PASSWORD_RESET`;
  - `userAgent` string and `ipPrefix` string.
- Create: `server/src/content-types/modules/ecommerce/customer-token/schema.json`. Collection
  `ltb_st_module_ecommerce_customer_tokens` with:
  - a manyToOne relation `customer`;
  - `purpose`, an enum of `VERIFY_EMAIL`, `RESET_PASSWORD` and `CHANGE_EMAIL`;
  - `tokenHash`, unique and required;
  - `email`, `expiresAt` (required) and `usedAt`.
- Both new types are hidden in the CM and CTB, and not localized, like `checkout-session`.
- Modify: `server/src/content-types/index.ts` and `server/src/config/index.ts`. Add uids
  `customerSession` and `customerToken` beside `customer`.
- Create: `server/src/services/modules/ecommerce/customerAccountsMigration.ts`
- Modify: `server/src/bootstrap.ts`. Call the migration after the promotion eligibility
  migration, with the same try/warn pattern.
- Test: `tests/server/ecommerce/customerAccountsContentTypes.test.ts`,
  `tests/server/ecommerce/customerAccountsMigration.test.ts`. Use `helpers/fakeDb.ts`.

**Interfaces:**
- `migrateCustomerAccounts(strapi): Promise<{ normalized: number; relinked: number }>`. It is
  idempotent:
  - rows with a null `accountType` → `GUEST`, `emailVerified: false`, `blocked: false`;
  - for duplicate `emailNormalized` groups, it re-links orders and store credits to the
    oldest id; the other rows stay;
  - it logs counts only.
- `fillGuestHashes(strapi, opts?: { batch?: number }): Promise<number>`. It fills a null
  `passwordHash` on `GUEST` rows through `EcommercePasswordService.randomGuestHash`, in batches
  of 50. It does nothing when the service is unavailable. Bootstrap starts it with `void`,
  never awaited.
- **No unique DB index on `emailNormalized`.** Strapi syncs indexes before bootstrap and would
  fail on existing duplicates. Uniqueness is enforced in the services (Tasks 6, 7 and 9).

- [ ] **Step 1: Failing tests.**
  - The schema test asserts the attribute names, types and defaults above, and that
    `passwordHash` is private.
  - The migration test, on a fake DB with 3 customers where 2 share an e-mail and each has an
    order:
    - after the run all are `GUEST` and the orders sit on the oldest id;
    - a second run changes nothing (`normalized: 0`, `relinked: 0`).
  - `fillGuestHashes` with a fake password service fills the hashes, and with an unavailable
    service returns 0.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the gate, including `tests/server/ecommerce/schemaIndexes.test.ts` and
  `schemaDuplicateKeys.test.ts`, then commit
  `feat(ecommerce): customer account fields, session and token models, migration`.

### Task 4: Customer session service (JWT + revocable rows)

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/accounts/clientInfo.ts`
- Create: `server/src/services/modules/ecommerce/customerSessions.ts`. Register it as
  `EcommerceCustomerSessionService`.
- Test: `tests/server/ecommerce/domain/accounts/clientInfo.test.ts`,
  `tests/server/ecommerce/customerSessions.test.ts`

**Interfaces:**
- `ipPrefix(ip: string | null): string | null` and
  `truncateUserAgent(ua: unknown): string | null` (255).
- `deriveCustomerJwtSecret(keySource: string): Buffer`. HKDF-SHA256, empty salt, info
  `ltb-ecommerce-customer-jwt-v1`, 32 bytes.
- `EcommerceCustomerSessionService`:
  - `open(customerId: number, client: { ip: string | null; userAgent: string | null }): Promise<{ token: string; expiresAt: string; sessionId: number }>`;
  - `resolve(token: string): Promise<{ sessionId: number; customer: AccountCustomer } | null>`,
    which returns null for any failure;
  - `revoke(customerId: number, sessionId: number, reason): Promise<boolean>`, false when the
    session is not the customer's;
  - `revokeAll(customerId: number, reason, exceptSessionId?: number): Promise<number>`;
  - `list(customerId: number, currentSessionId: number): Promise<SessionView[]>`;
  - `purgeExpired(): Promise<number>`.
- `AccountCustomer`: `{ id, email, emailNormalized, firstName, lastName, phone, locale, accountType, emailVerified, blocked, passwordChangedAt, pendingEmail }`.
  Export it from `customerSessions.ts`; later tasks import it.
- `SessionView`: `{ id, createdAt, lastUsedAt, userAgent, ipPrefix, current }`.
- Without a key source, `open` and `resolve` throw `EcommerceAccountsUnavailableError`.

- [ ] **Step 1: Failing tests:**
  - **IP prefix:** `ipPrefix('203.0.113.77') === '203.0.113.0/24'`;
    `ipPrefix('2001:db8:abcd:12::1') === '2001:db8:abcd::/48'`; garbage → null.
  - **`resolve` returns null for:**
    - a tampered signature;
    - `alg: none`;
    - another audience;
    - an expired `exp`;
    - a revoked row;
    - a row past its `expiresAt`;
    - `lastUsedAt` more than 30 days ago;
    - a customer that is blocked, `GUEST` or unverified;
    - an `iat` earlier than `passwordChangedAt`.
  - **`lastUsedAt` refresh:** written only when older than 60s.
  - **Ownership:** `revoke` of another customer's session returns false and leaves it intact.
  - **`list`:** marks `current` and excludes revoked and expired rows.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
  - Sign with `jose` `SignJWT`, setting the `sub` and `sid` strings, `setIssuedAt`,
    `setExpirationTime` at the session's absolute expiry, `setIssuer` and `setAudience`.
  - Verify with `jwtVerify` and `algorithms: ['HS256']`.
  - Take the key source from `resolveEncryptionKeySource`.
- [ ] **Step 4:** Run the gate, then commit
  `feat(ecommerce): revocable customer login sessions (JWT checked against the database)`.

### Task 5: Account tokens, links and e-mail templates

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/accounts/links.ts`
- Create: `server/src/services/modules/ecommerce/customerTokens.ts`. Register it as
  `EcommerceCustomerTokenService`.
- Create: `server/src/services/modules/ecommerce/accountMailer.ts`. Register it as
  `EcommerceAccountMailer`.
- Modify: `server/src/services/modules/ecommerce/email/catalog.ts`. Add the 6 types, their
  variables and sample data.
- Modify: `server/src/services/modules/ecommerce/email/defaults/`. Add en and pt defaults per
  type, in the existing file style.
- Modify: the admin e-mail template labels in `en.json` and `pt.json`, if the template list
  shows translated type names.
- Test: `tests/server/ecommerce/domain/accounts/links.test.ts`,
  `tests/server/ecommerce/customerTokens.test.ts`, `tests/server/ecommerce/accountMailer.test.ts`,
  and an extension of `tests/server/ecommerce/email/catalog.test.ts`.

**Interfaces:**
- `buildAccountLink(storefrontUrl: string, path: string, token: string): string`. It joins
  without a double slash and URL-encodes the token in `?token=`.
- `maskEmail(email: string): string`. For example `f***@example.com`.
- `EcommerceCustomerTokenService`:
  - `issue(customerId: number, purpose, email: string): Promise<{ raw: string; expiresAt: string }>`.
    It marks the customer's earlier unused tokens of that purpose used.
  - `consume(raw: unknown, purpose): Promise<{ customerId: number; email: string } | null>`.
    It needs a single atomic conditional update on `usedAt IS NULL`, and returns null when the
    token is unused-but-expired, unknown or already used.
- `EcommerceAccountMailer`: one method per template, each taking
  `(to: string, locale: string | null, data)`:
  - `sendAccountVerification(to, locale, { firstName, raw })`;
  - `sendPasswordReset(to, locale, { firstName, raw })`;
  - `sendPasswordChanged(to, locale, { firstName })`;
  - `sendEmailChangeVerification(to, locale, { firstName, newEmail, raw })`;
  - `sendEmailChanged(to, locale, { firstName, newEmail })`;
  - `sendRegistrationAttempt(to, locale, { firstName })`.

  Each builds the link from the settings (`storefrontUrl` + `accountPaths.*`), renders via
  `EcommerceEmailTemplateService.render(type, locale, data)` and sends with `sendWithResend`.
  The idempotency key is a hash, never the raw token. Each returns `Promise<void>`. It throws
  `EcommerceEmailError('EMAIL_NOT_CONFIGURED')` when Resend is inactive.
- Template types: `ACCOUNT_VERIFICATION`, `PASSWORD_RESET`, `PASSWORD_CHANGED`,
  `EMAIL_CHANGE_VERIFICATION`, `EMAIL_CHANGED`, `REGISTRATION_ATTEMPT`.
- Template variables, by type:
  - `ACCOUNT_VERIFICATION`: `verificationUrl`, `expiresInHours`;
  - `PASSWORD_RESET`: `resetUrl`, `expiresInMinutes`;
  - `PASSWORD_CHANGED`: `changedAt`;
  - `EMAIL_CHANGE_VERIFICATION`: `confirmationUrl`, `newEmail`, `expiresInHours`;
  - `EMAIL_CHANGED`: `newEmail` (masked), `changedAt`;
  - `REGISTRATION_ATTEMPT`: `loginUrl` (`storefrontUrl`), `resetUrl`
    (`storefrontUrl + accountPaths.resetPassword`, without a token).
  Every type also gets `customer.firstName` and the store basics, as the existing templates do.
- The `ACCOUNT_VERIFICATION` default copy includes the sentence "If you did not create this
  account, ignore this e-mail". The pt version: "Se não criou esta conta, ignore este email".

- [ ] **Step 1: Failing tests:**
  - **Links:**
    - `buildAccountLink('https://shop.pt/', '/account/verify-email', 'a+b')` gives
      `https://shop.pt/account/verify-email?token=a%2Bb`;
    - `maskEmail('filipe@x.pt')` gives `f*****@x.pt`.
  - **Tokens:**
    - issue then consume returns the customer;
    - a second consume returns null;
    - issuing again invalidates the first;
    - an expired token returns null;
    - a token of another purpose returns null;
    - only the sha256 hex is stored, so the raw token appears in no DB row.
  - **Catalog:** the six types are present, the defaults render with the sample data, and the
    template validator accepts them.
  - **Mailer:**
    - the rendered HTML contains the link;
    - `sendWithResend` (mocked) gets `to`;
    - the idempotency key does not contain the raw token.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the gate, then commit
  `feat(ecommerce): account link tokens, mailer and six account e-mail templates`.

### Task 6: Account flows — register, verify, resend, login, logout, forgot, reset

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/accounts/cartMerge.ts`
- Create: `server/src/services/modules/ecommerce/accounts.ts`. Register it as
  `EcommerceAccountService`.
- Modify: `server/src/services/modules/ecommerce/storefrontSessions.ts`. Add
  `expireAndScrub(sessionId: number): Promise<void>`, reusing `scrubbed()`.
- Modify: `server/src/services/modules/ecommerce/errors.ts`. Add `EcommerceAccountError(code, status, extra?)`.
- Test: `tests/server/ecommerce/domain/accounts/cartMerge.test.ts`,
  `tests/server/ecommerce/accounts.auth.test.ts`

**Interfaces:**
- `mergeCarts(account: StoredCart, guest: StoredCart, maxQuantityPerLine: number): StoredCart`.
  Take the cap from the existing cart line limit in `domain/storefront/limits.ts`.
  - same `variantId`: the quantities are summed and capped;
  - `promotionCodes`: union, preserving order;
  - `giftChoices`, `destination` and `shippingMethod`: the guest's value when non-null or
    non-empty;
  - `locale`: the guest's when set;
  - `email`: null, because the account e-mail is used.
- `readStoredCart(raw: unknown): StoredCart`: malformed input gives `emptyCart()`. Export
  `toStoredCart` from `storefrontSessions.ts` under this name if it is not exported yet.
- `EcommerceAccountService`. Each flow returns the value or throws `EcommerceAccountError`
  with a Global Constraints code.
  - `register(input: { email; password; firstName; lastName; phone?; locale? }): Promise<void>`.
    - It always runs exactly one `passwords.hash`.
    - It sends the e-mail with `void` after its writes, catching and logging the error code
      only.
    - The branches follow the spec: new, guest, registered-unverified, registered-verified
      (`REGISTRATION_ATTEMPT`), and blocked (no e-mail).
    - Policy failure → `WEAK_PASSWORD` with `reason`.
  - `verifyEmail(token: unknown, guest: CheckoutSession, client): Promise<LoginResult>`.
  - `resendVerification(email: unknown): Promise<void>`.
  - `login(input: { email; password }, guest: CheckoutSession, client): Promise<LoginResult>`.
    - `EMAIL_NOT_VERIFIED` comes only after the password is verified.
    - A rehash, when returned, is written.
  - `logout(customerId: number, sessionId: number): Promise<void>`.
  - `forgotPassword(email: unknown): Promise<void>`.
  - `resetPassword(input: { token; password }): Promise<void>`.
- `LoginResult = { token: string; expiresAt: string; customer: AccountProfile }`.
- `AccountProfile = { id; email; pendingEmail; firstName; lastName; phone; locale; createdAt }`.
- The login and verify flows merge `guest.cart` into `customer.cart` with `mergeCarts`, then
  call `sessions().expireAndScrub(guest.id)`.

- [ ] **Step 1: Failing tests:**
  - **`mergeCarts`:**
    - the same variant gets summed quantities, capped at the limit;
    - codes form a union;
    - the guest's destination wins;
    - an empty guest cart keeps the account cart.
  - **`register`, one test per branch:**
    - new: a REGISTERED, unverified customer is created and a verification mail sent;
    - guest: the same row is upgraded with the password set, its orders untouched;
    - unverified: the password is replaced and the mail sent again;
    - verified: nothing is written and a registration-attempt mail is sent;
    - blocked: nothing is written or sent;
    - all five call `hash` exactly once (Review Focus timing).
  - **`login`:**
    - the right password gives a result, and the guest session is scrubbed with the cart
      merged;
    - a wrong password, an unknown e-mail, a GUEST account and a blocked account all give
      `INVALID_CREDENTIALS`, each calling verify once;
    - the right password on an unverified account gives `EMAIL_NOT_VERIFIED`;
    - a pepper rehash is persisted.
  - **`verifyEmail`:**
    - it marks the account verified and returns a session;
    - a reused token, a token whose e-mail no longer matches, and a blocked customer all give
      `TOKEN_INVALID`.
  - **`forgotPassword`:** nothing is sent for GUEST, blocked or unknown accounts.
  - **`resetPassword`:**
    - it sets the hash, sets `emailVerified` and `passwordChangedAt`, calls `revokeAll` with
      `PASSWORD_RESET`, and sends the password-changed mail;
    - a weak password gives `WEAK_PASSWORD`.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.** Match customers by `normalizeEmail` from `domain/email.ts`.
- [ ] **Step 4:** Run the gate, then commit
  `feat(ecommerce): register, verify, login, logout and password recovery flows`.

### Task 7: Private area, customer cart, checkout with login, blocked guards

**Files:**
- Modify: `server/src/services/modules/ecommerce/accounts.ts`. Add the private-area methods.
- Modify: `server/src/services/modules/ecommerce/customers.ts`.
  - `findOrCreate` throws `EcommerceAccountError('CUSTOMER_BLOCKED', 403)` when the matched
    customer is blocked.
  - A newly created customer gets `accountType: 'GUEST'` and the hash from
    `passwords.randomGuestHash()` (skipped when unavailable). Compute the hash before the
    order transaction: add an optional precomputed hash argument to `findOrCreate`, and have
    `orders.ts` compute it before the transaction.
- Modify: `server/src/services/modules/ecommerce/storefrontSessions.ts`.
  `requestEmailVerification` refuses a blocked customer's e-mail with `CUSTOMER_BLOCKED`
  before sending.
- Modify: `server/src/services/modules/ecommerce/storefrontCheckout.ts`. Every cart and order
  method accepts a `CartOwner`:
  - for a guest owner, the behaviour is as today;
  - for a customer owner, it reads and writes `customer.cart`;
  - `createOrder` uses the account e-mail, `emailVerified: true` and the body's name and phone,
    then clears `customer.cart`.
- Modify: `server/src/services/modules/ecommerce/storeCredits.ts` and the promotion usage
  model. Add re-key helpers.
- Test: `tests/server/ecommerce/accounts.private.test.ts`,
  `tests/server/ecommerce/storefrontCheckout.customer.test.ts`, and extensions of
  `customers.test.ts` and `storefrontSessions.test.ts`.

**Interfaces:**
- `type CartOwner = { kind: 'guest'; session: CheckoutSession } | { kind: 'customer'; customer: AccountCustomer; sessionId: number }`.
  Export it from `storefrontCheckout.ts`.
- `EcommerceAccountService`:
  - `getProfile(c: AccountCustomer): Promise<AccountProfile>`.
  - `updateProfile(c, input: { firstName?; lastName?; phone?; locale? }): Promise<AccountProfile>`.
    It ignores any other field.
  - `changePassword(c, sessionId, { currentPassword, newPassword }): Promise<void>`.
    - A wrong current password → `INVALID_CREDENTIALS` with status 400.
    - Success calls `revokeAll(.., 'PASSWORD_CHANGED', sessionId)` and sends the
      password-changed mail.
  - `requestEmailChange(c, { currentPassword, newEmail }): Promise<void>`.
    - It answers `EMAIL_IN_USE` when the new e-mail matches any `emailNormalized` or another
      customer's `pendingEmailNormalized`.
  - `confirmEmailChange(token: unknown): Promise<void>`.
    - It re-checks that the e-mail is free.
    - In one `strapi.db.transaction` it swaps the e-mail and re-keys store credits and promotion
      usage from the old normalized e-mail to the new one.
    - After the transaction it calls `revokeAll(.., 'EMAIL_CHANGED')` on all sessions except
      none, then sends `EMAIL_CHANGED` to the old address.
    - Ruling on the spec: the spec's "revokes the other sessions" has no "current" when the
      confirm runs by token, so all sessions are revoked.
  - `listOrders(c, { page, pageSize }): Promise<{ results; pagination }>`. Results are newest
    first and filtered by `customer.id`. Each item reuses the existing storefront order-status
    view (`domain/storefront/publicViews.ts`) plus `createdAt` and `total`.
  - `getOrder(c, publicId: string)`. A missing order or another customer's order →
    `EcommerceNotFoundError`, which maps to 404.
- `EcommerceCustomerService`:
  - `isBlockedEmail(email: string): Promise<boolean>`, matched by normalized e-mail.
  - The store-credit re-key: `rekeyCustomerEmail(oldNormalized: string, newNormalized: string): Promise<void>`
    on `EcommerceStoreCreditService`, plus the equivalent on promotion usage. Both run inside
    the caller's transaction.

- [ ] **Step 1: Failing tests:**
  - **Blocked e-mails:**
    - `findOrCreate` for a blocked customer's e-mail typed `'  Foo@Bar.com '` throws
      `CUSTOMER_BLOCKED` (Review Focus 3);
    - `requestEmailVerification` on a blocked e-mail throws `CUSTOMER_BLOCKED` and sends
      nothing.
  - **Customer cart:**
    - a customer owner's quote saves to `customer.cart`;
    - a malformed `customer.cart` reads as empty (Review Focus 2);
    - `createOrder` for a customer owner uses the account e-mail even when the body sends
      another, passes `emailVerified: true`, and clears `customer.cart`.
  - **`updateProfile`:** `email` and `blocked` in the input are ignored.
  - **`changePassword`:** a wrong current password gives `INVALID_CREDENTIALS` with status 400.
  - **E-mail change:**
    - `requestEmailChange` to a guest customer's e-mail gives `EMAIL_IN_USE`;
    - `confirmEmailChange` moves a store credit's `emailNormalized` and a promotion usage row to
      the new e-mail;
    - a confirm after the e-mail was taken gives `EMAIL_IN_USE`.
  - **Orders:** `getOrder` with another customer's `publicId` gives
    `EcommerceNotFoundError`.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the gate, including all the existing `storefront*` and `orders.*` tests,
  then commit
  `feat(ecommerce): customer private area, account cart, checkout with login, blocked guards`.

### Task 8: Storefront controller, routes and the access matrix

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/accounts/access.ts`
- Modify: `server/src/controllers/modules/ecommerce/storefront.ts`
- Create: `server/src/controllers/modules/ecommerce/storefrontAccount.ts`. Register it as
  `EcommerceStorefrontAccountController` in `server/src/controllers/index.ts`.
- Modify: `server/src/controllers/modules/ecommerce/storefrontErrors.ts`. Map
  `EcommerceAccountError`, `EcommerceAccountsUnavailableError` (503) and
  `EcommerceRateLimitError` (429 + Retry-After).
- Modify: `server/src/routes/ecommerce/content-api-storefront.ts`. Add the account routes with
  the same policy and middleware.
- Modify: `server/src/services/modules/ecommerce/domain/storefront/rateLimit.ts`. Add these
  rules:

  | Rule | Limits |
  |---|---|
  | `account.register` | email 5 per 60 min, ip 20 per 60 min |
  | `account.email` (resend and forgot) | email 3 per 60 min, ip 20 per 60 min |
  | `account.login` | ip 10 per 1 min; email 5 per 15 min, counted on failure only |
  | `account.token` | ip 20 per 60 min |
  | `account.private` | session 120 per 10 min |
  | `account.password` (change password and e-mail change) | session 5 per 15 min |

  Counting on failure only needs a separate `hit` after a failed login. Add
  `limiter.hit(key)`, or the equivalent, when it is missing.
- Test: `tests/server/ecommerce/domain/accounts/access.test.ts`,
  `tests/server/ecommerce/storefrontAccountController.test.ts`, and an extension of
  `storefrontRoutes.test.ts`.

**Interfaces:**
- `type RouteClass = 'catalog' | 'public-session' | 'account-public' | 'account-private' | 'checkout' | 'order-existing'`.
- `decideAccess(mode, routeClass, auth: { guest: boolean; customer: 'none' | 'valid' | 'invalid' }): { allow: true; as: 'guest' | 'customer' | 'none' } | { allow: false; status: number; code: string }`.
  It implements the spec table exactly:
  - `catalog` → always `{ allow: true, as: 'none' }`;
  - `customer: 'invalid'` on any non-catalog route → 401 `CUSTOMER_SESSION_INVALID`;
  - `account-*` in `GUEST_ONLY` → 403 `ACCOUNTS_DISABLED`;
  - `checkout` in `REGISTERED_ONLY` without a valid customer → 401 `LOGIN_REQUIRED`;
  - `order-existing` → guest or customer in every mode;
  - `account-private` without a valid customer → 401 `LOGIN_REQUIRED`;
  - `public-session` (pickup points; open session always allowed) → guest or customer;
  - a missing guest session where one is needed → the existing `SESSION_INVALID`.
- Routes, all under `/ecommerce/storefront`:

  | Class | Route | Handler | Rule |
  |---|---|---|---|
  | account-public | `POST /account/register` | `register` | `account.register` |
  | account-public | `POST /account/verify-email` | `verifyEmail` | `account.token` |
  | account-public | `POST /account/verify-email/resend` | `resendVerification` | `account.email` |
  | account-public | `POST /account/login` | `login` | `account.login` |
  | account-public | `POST /account/password/forgot` | `forgotPassword` | `account.email` |
  | account-public | `POST /account/password/reset` | `resetPassword` | `account.token` |
  | account-private | `POST /account/logout` | `logout` | |
  | account-private | `GET /account/me` | `me` | |
  | account-private | `PUT /account/me` | `updateMe` | |
  | account-private | `POST /account/password` | `changePassword` | `account.password` |
  | account-private | `POST /account/email` | `requestEmailChange` | `account.password` |
  | account-private | `GET /account/orders` | `orders` | |
  | account-private | `GET /account/orders/:publicId` | `order` | |
  | account-private | `GET /account/sessions` | `sessions` | |
  | account-private | `DELETE /account/sessions/:id` | `revokeSession` | |
  | account-private | `POST /account/sessions/revoke-others` | `revokeOtherSessions` | |
  | account-public, session = guest or customer | `POST /account/email/confirm` | `confirmEmailChange` | `account.token` |

  - The route helper's method type gains `'PUT' | 'DELETE'`.
  - Private routes without a rule of their own use `account.private`.
  - `verifyEmail` and `login` need a guest session (`SESSION_INVALID` otherwise).
  - Success statuses:
    - 202: register, resend and forgot;
    - 204: reset, logout, change password, request e-mail change, confirm, revoke session and
      revoke others;
    - 200: everything else.
- Existing routes map to classes:
  - `catalog`: list and get products, categories and collections;
  - `public-session`: `openSession` and `pickupPoints`;
  - `order-existing`: `paymentLink` and `orderStatus`;
  - `checkout`: everything else.
- `withSession` becomes `withOwner`. It resolves both headers, calls `decideAccess`, and passes
  a `CartOwner` to the checkout service.
- `openSession` still opens a guest session in every mode.

- [ ] **Step 1: Failing tests:**
  - **The matrix:** `access.test.ts` walks every combination of the 3 modes × 6 classes ×
    auth states and asserts the spec table, cell by cell.
  - **Review Focus 1:** an expired customer token plus a valid guest on `cart.quote` in `BOTH`
    gives 401 `CUSTOMER_SESSION_INVALID`.
  - **Review Focus 5:** in `GUEST_ONLY` `GET /account/me` with a valid token gives 403, and the
    session row is still not revoked.
  - **Controller tests:**
    - each handler validates its body and rebuilds it from known fields;
    - login with a wrong password counts the e-mail key, and with a right password does not;
    - register answers 202 for an existing verified e-mail exactly as for a new one;
    - the request body never appears in any log call (spy on `strapi.log`);
    - `DELETE /account/sessions/:id` for another customer's session gives 404.
  - **Routes test:** every new route carries `check-storefront-token` and the module
    middleware.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the gate, plus `npx vitest run`, which is the full suite, then commit
  `feat(ecommerce): storefront account routes and the guest/login access matrix`.

### Task 9: Admin server — block / unblock, set password, e-mail edit rules, RBAC

**Files:**
- Modify: `server/src/services/modules/ecommerce/permissions.ts`.
  - Add `customersBlock` (`ecommerce.customers.block`, displayName "Block and unblock
    customers").
  - Add `customersPassword` (`ecommerce.customers.password`, displayName "Change customer
    passwords").
- Modify: `server/src/services/modules/ecommerce/customers.ts`.
  - Add `block`, `unblock` and `setPassword`.
  - Extend `get` and `list` with `accountType`, `emailVerified`, `blocked`, `blockedAt`,
    `blockedNote` and `blockedBy` (the admin's name). They never include the hash.
  - `list` gains filters `accountType` and `blocked`.
  - `update` applies the spec's e-mail edit rules.
- Modify: `server/src/controllers/modules/ecommerce/customers.ts` and
  `server/src/routes/ecommerce/admin-customers.ts`:
  - `POST /:id/block` with `customersBlock`;
  - `POST /:id/unblock` with `customersBlock`;
  - `PUT /:id/password` with `customersPassword`.
- Modify: the audit calls through `EcommerceAuditService`, following the existing customer
  update audit. Entries carry no secrets.
- Test: extensions of `tests/server/ecommerce/customers.test.ts`, `permissions.test.ts` and
  `ordersRoutes.test.ts`, or a new `customerAdminRoutes.test.ts`.

**Interfaces:**
- `block(id: number, input: { note?: string | null }, actor: { userId: number }): Promise<CustomerView>`.
  It sets the flags and calls `revokeAll(id, 'BLOCKED')`. The note is at most 1000
  characters.
- `unblock(id, actor): Promise<CustomerView>`. It clears the flags and the note.
- `setPassword(id, { password }, actor): Promise<void>`.
  - Only `REGISTERED` and unblocked customers. Otherwise `EcommerceValidationError`, path
    `password`, code `not_allowed`.
  - Policy failures → `EcommerceValidationError` with code `TOO_SHORT`, `TOO_LONG` or
    `EQUALS_EMAIL`.
  - Success sets `passwordChangedAt`, calls `revokeAll(id, 'ADMIN_PASSWORD')` and sends the
    password-changed mail with `void`.
- `update` with a new e-mail:
  - it is refused (path `email`, code `taken`) when the e-mail matches another customer's
    `emailNormalized` or `pendingEmailNormalized`;
  - for a `REGISTERED` customer it sets `emailVerified: false`, calls `revokeAll(id, 'EMAIL_CHANGED')`,
    re-keys store credits and promotion usage, issues a VERIFY_EMAIL token and sends
    `ACCOUNT_VERIFICATION` with `void`.
- Admin order creation for a blocked customer is already refused by Task 7's `findOrCreate`
  guard. Map `CUSTOMER_BLOCKED` in the admin orders controller to a 400 validation error, path
  `customer.email`, code `customer_blocked`.

- [ ] **Step 1: Failing tests:**
  - **`block`:** it revokes all sessions, and `get` then shows `blocked: true` with
    `blockedBy`.
  - **`setPassword`:**
    - on a GUEST customer → `not_allowed`;
    - on a blocked customer → `not_allowed`;
    - success revokes the sessions and stores the hash, which `get` never returns.
  - **Admin order creation:** `orders.create` from the admin with a blocked customer's e-mail
    gives a validation error with code `customer_blocked`.
  - **Routes:** the three new routes require the new actions, and the permissions list
    includes both actions.
  - **`update`:**
    - an e-mail equal to another customer's pending e-mail gives `taken`;
    - for a REGISTERED customer, an e-mail change unverifies the account and revokes its
      sessions.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the gate, then commit
  `feat(ecommerce): block/unblock and set password for customers, with RBAC actions`.

### Task 10: Admin UI — customer record and list

**Files:**
- Modify: `admin/src/ecommerce/pages/customers/CustomerDetailPage.tsx`
- Modify: `admin/src/ecommerce/pages/customers/CustomerListPage.tsx`
- Create: `admin/src/ecommerce/components/customers/BlockCustomerDialog.tsx`
- Create: `admin/src/ecommerce/components/customers/ChangePasswordModal.tsx`
- Modify: the admin RBAC key helper, if new action keys must be listed there
  (`admin/src/ecommerce/utils/rbac.ts`).
- Modify: `admin/src/ecommerce/pages/orders/OrderCreatePage.tsx`. When the chosen customer is
  blocked, show an inline danger message and disable the submit button.
- Modify: `admin/src/core/translations/en.json`, `pt.json`
- Test: `tests/admin/customerAccounts.test.ts`, for pure helpers only: badge selection, and
  password-confirm validation with the server policy codes.

**Interfaces:**
- Consumes the Task 9 routes and the fields on the customer view.
- **Header badges:** "Guest" / "Registered", "E-mail verified" / "E-mail not verified", and
  "Blocked" (danger).
- **Block dialog:**
  - a danger confirmation whose copy lists the consequences: no login, register, password
    recovery or new orders, and sessions ended;
  - an optional internal note in a textarea.
- **Unblock:** a confirmation dialog.
- **Change password modal:**
  - two password inputs, 38px;
  - the client validates the same length rule and that the two values match;
  - server errors map to translated messages.
- **Visibility:** each button shows only with its RBAC action. Change password also requires
  REGISTERED and not blocked.
- **List:** a "Blocked" badge beside the name, plus two filter selects: account type (all,
  guest or registered) and blocked (all, blocked or not blocked).

- [ ] **Step 1: Failing tests** for the pure helpers.
  - `customerBadges({ accountType: 'REGISTERED', emailVerified: false, blocked: true })` gives
    `['registered', 'emailNotVerified', 'blocked']`.
  - `validateNewPassword('short', 'short')` gives `'TOO_SHORT'`.
  - `validateNewPassword('longenough1', 'other')` gives `'MISMATCH'`.
- [ ] **Step 2:** Run the tests. They must fail.
- [ ] **Step 3: Implement** the UI.
- [ ] **Step 4:** Run the gate, including `npm run test:ts:front` and the full `npx vitest run`,
  then commit `feat(ecommerce): customer account badges, block and change password in the admin`.
