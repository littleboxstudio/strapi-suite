# E-commerce: pendentes do plano 1

Lista de itens adiados nas revisões do plano 1 (Base e Produtos), a considerar nos planos seguintes.

## Obrigatórios em planos futuros
- **Plano 3 (Encomendas): stock negativo.** O servidor rejeita `stock < 0`. As encomendas vão descontar stock com incrementos relativos, por isso o plano 3 tem de aceitar o stock negativo que já exista ao gravar um produto e deixar de escrever o `stock` absoluto a partir do formulário (senão há uma corrida com os descontos das encomendas). Uma variante que aparece em encomendas deve ser desativada, nunca apagada.
- **Plano 6 (Storefront): slug regenerado ao renomear.** O slug é gerado de novo sempre que o nome muda, o que altera os URLs públicos. Antes de lançar o storefront é preciso decidir entre slugs estáveis e redirecionamentos.
- **Plano 3: precisão decimal** de `weight`, `width`, `height` e `depth`. Confirmar antes de calcular portes.

## Menores (adiados)
- Task 1: minor (deferred): checkModuleIsActive substring match '/ecommerce' could catch future URLs containing '/ecommerce' — prefer segment match
- Task 1: minor (deferred): registerTrads branching untested (only mergeTranslations)
- Task 2: minor (deferred): contentTypes test doesn't assert min/max/required/types
- Task 2: minor (deferred): no unique (variant,locale)/(product,locale) index on translation tables — service must upsert per locale
- Task 3: minor (deferred): (strapi as any) in permissions.ts; registration not try/catch (boot fails loudly); test doesn't tie computed ids to constants
- Task 4: minor (deferred): integer-only rule for price/stock undocumented; tests miss blank sku / string price / 3rd dup
- Task 5: minor (deferred): orphaned provider file if DB create fails after upload — add cleanup
- Task 5: minor (deferred): stream-only providers lacking upload() unsupported
- Task 5: minor (deferred): no owner guard in service (controller Task 7 enforces productId|variantId)
- Task 5: minor (deferred): position max+1 not atomic; remove() uses current provider not record.provider
- Task 6: minor (deferred, SHOULD FIX in final wave): blanked non-default translation (name/option) isn't deleted — edit appears ignored
- Task 6: minor (deferred, SHOULD FIX in final wave): image files removed inside the transaction before commit — collect and delete after commit
- Task 6: minor (deferred): SKU/NotFound pre-checks outside transaction (race, admin-only)
- Task 6: minor (deferred): slug regenerated on rename (per brief)
- Task 6: minor (deferred): tests written after code (no RED)
- Task 7: minor (deferred): non-numeric :id → NaN to service; productId/variantId exclusivity & NaN; repeated 'file' field array bypasses size check; missing tests (INVALID_IMAGE, invalid transform JSON, upload 201, unknown locale)
- Task 7: minor (deferred): npm run build fails on pre-existing admin error SlugInput.tsx:317 — check before release
- Task 8: minor (deferred): TranslateOutput.failed any / pagination loose types; style slips; no gateway/SaveProduct tests; no RED
- Task 9: minor (deferred): illustration aria-labels hardcoded English; redundant enable buttons when disabled
- Fix: minor (deferred): noStrapiUtilsImport test only matches single-quoted forms
- Task 10: minor (deferred): Table colCount 5 vs 6 columns; Enter submits search form; whitespace search not trimmed; stale rows on error; any-typed onChange; pageWindow untested
- Task 11: minor (deferred, SHOULD FIX in final wave): AI results keyed by variant index while Add/Remove enabled during translate — disable variant edits while translating
- Task 11: minor (deferred): option error hidden in modal when on other locale; failed reload after save replaces editor; no locale-tab error markers; no component tests; ProductEditPage 444 lines
- Task 12: minor (deferred): upload/delete catch blocks drop error (no log); changeHeight uses lockedHeight(next,1/ratio) oddly; Link icon for lock

## Plano 2 (Configurações): pendentes
- **'= {{' em texto:** a regra rejeita também texto normal como 'Total = {{order.total}}' (falso positivo). Restringir a verificação ao interior das tags.
- **Valores sem aspas a começar por texto literal** (`href=https://x/{{a}}`) não são apanhados. O escape de `=`, aspas e backtick limita o impacto.
- **Segredo opcional ilegível:** não pode ser limpo pela UI (o servidor permite).
- **Mensagens de sucesso do teste de ligação** ('Restricted key', 'Key valid (sending access only)') vêm do servidor em inglês e não são traduzidas.
- Task 1: minor (deferred, SHOULD FIX in final wave): decipher without authTagLength 16 / tag length check — add {authTagLength:16} + truncated-tag test
- Task 1: minor (deferred): no tests for v!==1/malformed shape; no RED
- Task 2: minor (deferred): required flags not asserted; displayName 'Ecommerce' vs 'E-commerce'; no RED
- Task 3: minor (deferred): UNREACHABLE for any unexpected status; __resetRegistryForTests in prod code; no RED
- Task 4: minor (deferred): concurrent activations may leave two billing active (no lock); settings.ts ~600 lines (extract validators); exclusivity per category
- Task 5: minor (deferred, SHOULD FIX in final wave): unsafe-HTML false positives (';on…=' in URLs, whitespace-stripped 'Java Script:'); escape '=' and '`' / reject unquoted ={{…}} attribute interpolation
- Task 5: minor (deferred): recursion depth cap; bounded meta regex; duplicate issues under invalid #each
- Task 6: minor (deferred, SHOULD FIX in final wave): fromName not quoted in Resend 'from' (comma/angle brackets)
- Task 6: minor (deferred): concurrent template saves may duplicate snapshot version numbers; 'store credit' vs 'commercial credit' wording
- Task 7: minor (deferred): validation coverage tests for preview/versions/restore routes; NaN ids → integer check; misleading route-order comment; no RED
- Task 8: minor (deferred): duplicate toast + inline errors; unknown details.code falls to raw id; encryption flag via integrations list; country picker no search
- Task 9: minor (deferred): unknown test code shows raw i18n id; delete confirm doesn't name method; switch label shows 'Active' even when off (browser)
- Task 10: minor (deferred, SHOULD FIX in final wave): no unsaved-changes guard on back/route leave/tab close in template editor (useBlocker + beforeunload)
- Task 10: minor (deferred): stale preview on locale switch (bump counter); test email sends saved version (warn if dirty)

## Plano 3 (Clientes e Encomendas): pendentes
- **Corrida rara:** uma gravação de produto que apaga uma variante ao mesmo tempo que uma encomenda é criada pode registar um ORDER_DEDUCT sem desconto (com aviso no log).
- **Cobertura de pagamentos:** substituir uma linha paga por outra do mesmo preço deixa a nova sem cobertura (a 'fatura total' do plano 5 tem de tratar isto).
- **Pesquisa por e-mail:** a pesquisa de encomendas usa o e-mail atual do cliente e não o snapshot da encomenda.
- **Eventos:** são entregues em memória depois do commit, sem outbox; uma falha do processo entre o commit e o envio pode perder um e-mail.
- Task 1: minor (deferred): monetary integers/payment enums without defaults — services must always set them
- Task 3: minor (deferred): two non-gift lines of same variant ambiguity; unknown orderLineId uses INVALID_QUANTITY code
- Task 4: minor (deferred): SKU swap between two existing variants in one save hits unique index; PG nested unique race aborts outer trx (fail-safe)
- Task 5: minor (deferred): ordersCount loads ids per page; update is full replace
- Task 6: minor (deferred, SHOULD FIX in final wave): carriers quoted sequentially without timeout (allSettled + per-quoter timeout → TIMEOUT failure); validate quoter output (integer price ≥0, force providerId); active carrier without quoter/runtime → NOT_CONFIGURED failure; handler error.message logging may leak personal data (log name/code only)
- Task 6: minor (deferred): manual method with empty name; test gaps
- Task 8: minor (deferred): float overflow in allocation beyond ~€950k orders
- Task 9: minor (deferred): quote subtotal is full order subtotal (revisit with shipments); line errors hidden by quote failure in apply (preview fixed)
- Task 10: minor (deferred, SHOULD FIX in final wave): quoteForLines accepts inactive variants (check c.active); page=-1 passes through
- Task 10: minor (deferred): LIKE wildcards in search term; replay returns 201; test gaps
- Task 11: minor (deferred): RBAC isLoading flash; CustomerOrdersSection state not reset on customer change (key=); noResults key reuse; no gateway test
- Task 12: minor (deferred): postalCode not in quote signature; addLine no stock cap; quote error map merge; OrderCreatePage 481 lines
- Task 13: minor (deferred): ConfirmModal lacks onOpenChange (remount workaround); ACTION_NOT_AVAILABLE in AddPayment doesn't refetch; server history descriptions in English with 'cents'
- Task 14: minor (deferred): supplementary modal may show stale order if refetch fails; modal width not set explicitly; INVALID_AMOUNT on shipping.quote message wording

## Plan 4
- P4 Task 6: minor (deferred): dup-key retry inside a caller transaction would abort it on PostgreSQL (guarded by pre-check + order lock)
- P4 Task 6: minor (deferred): with Stripe disabled, cancel can't expire open checkout sessions; their PENDING payments stay on the cancelled order
- P4 Task 6: minor (deferred): stock.ts (plan 3) uses strapi.db.connection instead of a schema-aware connection (PostgreSQL non-default schema)
- P4 Task 6: note: refunds.resume after Stripe's ~24h idempotency window can double-refund if the first call reached Stripe — UI warns the admin
- P4 final review: parked (F6/M3): an order modification can raise the total while a Stripe refund is PROCESSING; when it completes a `due` reappears for money being refunded (block MODIFY while hasPendingRefunds, or require after.excess >= inFlight)
- P4 final review: parked (F10/M7): sendPaymentInstructions has no idempotency key; a double submit / network retry sends two e-mails and two history entries (UI ref guard exists; the Stripe link itself is reused)
- P4 final review: note: refunds made directly in the Stripe dashboard (`charge.refunded` for refunds we didn't create) are ignored by design
- P4 final review: over-refund is recomputed on read: a promoted-from-failed refund can mask a later real amount due after a modification raises the total — persist overRefunded at promotion time

## Plan 5
- Spec 4.15: Moloni foreign-customer handling setting deferred — needs the store accountant's input (OSS / intra-EU / non-EU rules); today non-PT customers are invoiced like domestic ones.
- P5 final review: parked (F4): a carrier deactivated while one of its shipments is PENDING/UNCERTAIN blocks the order — `retry` and `cancel` need an active runtime (`shipping.carrierFor`) and `assertNoPendingShipment` blocks MODIFY/CANCEL; shipments have no "mark failed". Add an issuing-carrier exception (like invoices) or a confirmed "mark failed" action. Low impact today: the only carrier (CTT) is NOT_IMPLEMENTED.
- P5 final: invoice lines can be individually off (order total correct) when an invoiced payment's value sits on a line that later lost value (partial payments, return/modification after invoicing) — would need credit-and-reinvoice of that payment

## Plan 6
- P6 final review: accepted (F4): `GET /promotions/:id` returns `eligibility.emails` in full to holders of `promotions.read` alone (redemptions mask e-mails for the same permission). Accepted: the list is admin-entered configuration and is needed to edit the promotion.
- P6 final review: parked (F5): on create, the third (final) promotion evaluation can change the gift set after the second (last) shipping quote, so the stored shipping price was quoted for a slightly different parcel. Rare and bounded by the two-quote design; add a comment or a `SHIPPING_UNAVAILABLE`-style refusal when the signatures still differ.
- Gift lines at €0 are omitted from invoices (recorded decision). Confirm with the store accountant whether offers must appear on the invoice with a 100% discount.
- Requirement 1.8 (extra verification for high-value or e-mail-restricted promotions) needs a verified storefront identity: plan 7.
- Storefront (plan 7): surface `giftChoices` and the `CodeStatus` messages to the customer.
- The quote should return the gift option names, so the admin order form does not need `promotions.read` to show them.
- The customer-facing order view (plan 7) must expose only `displayName` + amounts of the applied promotions (never the internal name, code of other customers, conditions or snapshot).
- `orders.ts` is ~2650 lines: split `priceCart`/`quote` (promotion pricing) into a sibling module.
- P6 final: modify modal shows a raised discounted line as discounted price × new qty (e.g. €0) before preview; the preview/server add the extra units at full price — show the split in the editor
- P6 final: admin OrderLine type lacks `sourceOrderLineId`

## Plan 7
- Expired checkout-session rows are cleaned opportunistically (≤100 per session open, no cron); rows with orders are scrubbed and kept; with no new-session traffic, expired rows wait for the next open
- Rate limits and verification counters live in one instance's memory (design 9.2); multiple instances need a shared store
- Secure order-access link by e-mail (requirement 2.14) still not implemented (design 4.13)
- Catalog price/name sort happens in memory — revisit beyond a few thousand products
- Unknown request body keys are ignored silently (e.g. `shipping` instead of `shippingMethod` on /cart/quote) — consider rejecting unknown keys to help BFF developers
- Storefront token failures (missing, wrong, expired) all answer 403 (a policy can't throw 401 without @strapi/utils) — documented in docs/ecommerce/storefront-api.md
- A quote that fails validation (e.g. INSUFFICIENT_STOCK) still saves the shopper's cart lines on the session (intended: the cart reflects the selection)

## Plan 8
- CTT Expresso: o preço vem da cotação da API (ainda um stub `NOT_IMPLEMENTED`); reavaliar a tarifação por zona do CTT (serviços, peso, zonas próprias do CTT) quando chegar a documentação da API.
- A exclusividade país → zona (e a verificação de `markets` contra as zonas) é feita no serviço, sem índice na base de dados nem transação comum: duas gravações simultâneas no admin podem pôr o mesmo país em duas zonas, ou retirar dos mercados um país que outra gravação acabou de pôr numa zona (inofensivo na cotação: os mercados são verificados primeiro e vale a primeira zona por posição).
- O storefront não expõe os mercados (nenhum endpoint de países existe hoje); o BFF precisa de os conhecer para o formulário de morada: acrescentar um endpoint público se for preciso.
- O formulário de morada das encomendas no admin lista todos os países; restringir a morada de envio aos mercados (hoje o servidor recusa com `invalid_country`).
- Uma lista de erros que mistura um código de conflito (`ZONE_COUNTRY_CONFLICT`, `MARKET_IN_USE`) com erros de validação responde 409 por inteiro (comportamento de `CONFLICT_CODES` já existente); o admin lê `details.errors` na mesma.
- Transportadoras: só são cotadas as que declaram um campo `zones`; uma definição registada com `registerProvider`/`registerCarrierAdapter` sem esse campo nunca aparece na cotação, sem aviso. Documentar no guia de providers quando existir (ou `strapi.log.warn` uma vez).
- Logótipo: dois uploads simultâneos leem o mesmo logótipo anterior, e o ficheiro do primeiro fica órfão no provider (reler o valor substituído dentro da transação de escrita).
- Zonas: os erros `invalid_country`/`not_in_market` de uma zona não dizem qual o país (o modal já só oferece países dos mercados e fora de outras zonas, por isso só acontecem em corridas).
- CTT ativo sem zonas: apagar a última zona remove `config.zones` do CTT mas deixa-o ativo (o cartão mostra uma integração ativa com um campo obrigatório em falta; a cotação ignora-o e a gravação seguinte falha com `required`). Desativar a integração na mesma transação e registar `deactivated` na auditoria.
- Admin: `Shell` do `EcommerceLayout` usa `height: 100vh`; se o Strapi mostrar um aviso acima da página, aparece uma segunda barra de scroll (e em mobile o `100vh` inclui a barra do browser). Usar `100dvh` com fallback `100vh`, ou dimensionar a partir do pai; verificar com um aviso visível.
