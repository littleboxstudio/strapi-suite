# Customer event log — design

Approved in chat on 2026-11-27. Branch `feat/ecommerce`.

## Intent

The store owner wants to see what happened on a customer's account (who did what, when, from
where) in the customer record: the customer's own actions and every change made by a backoffice
user.

## Owner's decisions

- Logged customer actions: login, failed login attempts, logout, order placed, password recovery,
  data changes (old and new value; for the password only the fact that it changed).
- Backoffice changes to the customer record are logged too; every event records who did it.
- Every event records the IP and the device (user agent).
- Kept while the customer record exists (no expiry).
- Shown in the last section of the customer record: 50 events per page, newest first, previous /
  next arrows, a free-text search at the top and a filter by event type.

## Events (my calls, confirmed by "avance")

| Type | When | Actor | Details |
|---|---|---|---|
| `ACCOUNT_REGISTERED` | register creates or upgrades the account | customer | — |
| `EMAIL_VERIFIED` | verification link used | customer | — |
| `LOGIN` | login session opened (login or verification) | customer | — |
| `LOGIN_FAILED` | login refused for an existing customer | customer | `reason`: `INVALID_PASSWORD`, `EMAIL_NOT_VERIFIED`, `BLOCKED`, `NOT_REGISTERED` |
| `LOGOUT` | logout | customer | — |
| `SESSION_REVOKED` | customer ends one / all other sessions | customer | `scope`: `ONE`, `OTHERS` |
| `ORDER_PLACED` | order created (storefront or admin), not on an idempotent replay | customer or admin | `orderId`, `reference` |
| `PASSWORD_RESET_REQUESTED` | reset link sent | customer | — |
| `PASSWORD_RESET` | password set from the reset link | customer | — |
| `PASSWORD_CHANGED` | customer changes it, or an admin sets it | customer or admin | — (never a password) |
| `PROFILE_UPDATED` | profile (storefront) or record (admin) changed | customer or admin | `changes: [{ field, from, to }]` |
| `EMAIL_CHANGE_REQUESTED` | customer asks for a new e-mail | customer | `newEmail` |
| `EMAIL_CHANGED` | new e-mail confirmed by link | customer | `changes` with `email` |
| `BLOCKED` / `UNBLOCKED` | admin blocks / unblocks | admin | `note` (block) |

Actor `ANONYMOUS` (review ruling): a storefront request nobody proved — failed logins, reset
requests, registrations and guest checkouts — is stored with the IP and device but no name, so an
attacker is never shown as the customer. Events proven by a login session or by a link sent to
the customer's e-mail are `CUSTOMER` with the name. Registering over an unverified account logs
the replaced name and phone (`changes`) and a `PASSWORD_CHANGED` (never for a guest record, whose
random password nobody knew).

A failed login with an e-mail that has no customer is not logged (no record to attach it to).
Rate-limited attempts never reach the service and are not logged.

## Storage

Content type `customer-event` (`ltb_st_module_ecommerce_customer_events`): `customerId`
(integer, indexed with `createdAt`), `type`, `actorType` (`CUSTOMER` / `ANONYMOUS` / `ADMIN` / `SYSTEM`),
`actorId`, `actorName` (snapshot at write time), `ip`, `userAgent` (255 max), `details` (json),
`searchText` (lowercased text the free search matches: type, reason, field names and values,
new e-mail, order reference, IP, user agent, actor name). The full IP is stored (owner's call).

## Behaviour

- `EcommerceCustomerEventService.record(customerId, type, { actor, details })` captures the
  request's client synchronously (`strapi.requestContext`): for a customer actor, the storefront
  headers `X-Storefront-Client-IP` / `X-Storefront-Client-User-Agent`; for an admin, the request
  IP and `User-Agent`. The write is not awaited by the action; a failure never breaks the action and is
  logged by error name only.
- `list(customerId, { page, search, type })`: 50 per page, newest first.
- Admin route `GET /admin/ecommerce/customers/:id/events` with the customers read permission.
  Events are never edited or deleted from the API.

## Admin UI

Last section of the customer record: search field (debounced) and type filter at the top; table
with date, event, details, who, IP, device (browser and OS, the full user agent as tooltip);
"Page X of Y" with previous / next arrows. It reloads after a change made on the same page, and
the search and filter stay hidden while the log is empty.
