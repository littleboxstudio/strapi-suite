# E-commerce, plano 7: API do Storefront e sessões anónimas (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os capítulos "1. API do Storefront" e "2. Autorização de Sessões Anónimas no Checkout" dos requisitos, adaptados ao storefront Next.js com BFF (design 8):
- **API pública mínima** chamada só pelo BFF (servidor a servidor): catálogo, cotação do carrinho (promoções, ofertas, portes, IVA), aplicação de códigos, consulta de vale de crédito, criação de encomendas idempotente, início do pagamento Stripe e consulta do resultado.
- **Sessões anónimas** opacas (token aleatório, só o hash guardado) que guardam o carrinho e autorizam apenas as encomendas criadas nessa sessão.
- **Requisito 1.8** das Promoções: verificação do e-mail por código enviado por e-mail, exigida pelas promoções restritas a e-mails ou marcadas como de valor elevado.
- **Pendentes do plano 6** endereçados ao plano 7: `toPublicStoreCreditError` e rate limiting na consulta de vales, vista do cliente só com `displayName` + valores, `giftChoices` e mensagens dos `CodeStatus`, nomes das ofertas na cotação, divisão de `orders.ts`, slugs estáveis.
- **Admin:** secção "Storefront" nas Configurações (token do BFF, validade das sessões), opção "Require verified e-mail" nas promoções e o modelo de e-mail `EMAIL_VERIFICATION`.

**Architecture:**
- **Domínio puro** novo em `server/src/services/modules/ecommerce/domain/storefront/` (sem Strapi): `rateLimit.ts` (janelas fixas em memória, relógio injetável), `session.ts` (tokens, códigos de verificação, hashes), `tax.ts` (IVA incluído por taxa), `publicViews.ts` (projeções públicas, estados de código públicos e mensagens `en`/`pt`), `request.ts` (IP do cliente, termo de pesquisa).
- **Serviços:** `EcommerceStorefrontSessionService` (`storefrontSessions.ts`: sessões, carrinho, verificação de e-mail, posse de encomendas), `EcommerceStorefrontCatalogService` (`storefrontCatalog.ts`) e `EcommerceStorefrontCheckoutService` (`storefrontCheckout.ts`: cotação, códigos, vale, encomenda, pagamento, estado). Só encaminham para os serviços existentes (requisito 2.18): `EcommerceOrderService.quote/create/get`, `EcommerceStripePaymentService.getOrCreatePaymentLink`, `EcommerceStoreCreditService`, `EcommerceOrderService.quoteForLines`.
- **Entrada HTTP:** rotas `content-api` em `/api/littlebox-strapi-suite/ecommerce/storefront/...` (o middleware `check-module-is-active` já reconhece `/ecommerce/`), com a policy nova `check-storefront-token` e `auth: false`. O controller `EcommerceStorefrontController` valida, aplica o rate limiting (depois da policy, por isso o `X-Forwarded-For` só é lido em pedidos com token válido), resolve a sessão do cabeçalho `X-Checkout-Session` e mapeia os erros.
- **Autenticação do BFF [Escolha técnica, decorre do design 8]:** um **API token do Strapi** escolhido nas Configurações (`storefrontApiTokenId`). A policy reutiliza o mesmo serviço `admin::api-token` que `check-api-token` (hash + `getByAccessKey` + validade), mas aceita só o token escolhido, de qualquer tipo. A policy existente `check-api-token` não serve nem muda: só aceita tokens `read-only` e é usada pelos outros módulos. Recomenda-se um token `custom` sem permissões, que não dá acesso a mais nada no Strapi. Sem token escolhido, todas as rotas do storefront respondem 403.

**Tech Stack:** Strapi 5 (Query Engine + knex portável), `node:crypto` (`randomBytes`, `randomInt`, `createHash`), `node:net` (`isIP`), Vitest, React + `@strapi/design-system` v2.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (2.2, 2.3, 2.6, 2.7, 3.1, 3.2, 3.3, 4.7, 4.9, 4.11, 4.13, 4.14, 5, 6, 8, 9.1, 9.2) e, em `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`, o capítulo **APIs** ("1. API do Storefront", 1.1–1.13, e "2. Autorização de Sessões Anónimas no Checkout", 2.1–2.19), mais Promoções 1.8, 1.28, 1.29, 2.15–2.18 e 2.23. Pendentes: `docs/superpowers/plans/ecommerce-followups.md`.

## Global Constraints

- Tudo das Global Constraints dos planos 1 a 6 continua a valer:
  - alterações aditivas; os módulos não-ecommerce e as suas rotas (`check-api-token`, `/modules/*`) não mudam;
  - content-types ocultas (`content-manager` e `content-type-builder` `visible: false`), prefixo `ltb-st-module-ecommerce-*`, relações novas `manyToOne` unidirecionais;
  - nomes de campos em inglês; `en` + `pt` na interface; ilustrações no estilo definido (reutilizar `EmptySection`);
  - dinheiro em cêntimos inteiros (EUR), **preços com IVA incluído**, `MAX_MONEY_CENTS`;
  - proibido importar `@strapi/utils`;
  - **colunas JSON só recebem objetos** (`checkout-session.cart = { lines, promotionCodes, giftChoices, email, destination, shippingMethod, locale }`, `emailVerification = { … }` ou `{}`);
  - todo o atributo `unique: true` tem um índice único em `indexes`, com nome ≤ 60 caracteres (`schemaIndexes`);
  - qualquer base de dados suportada pelo Strapi (o cliente usa MariaDB): só Query Engine ou knex portável; **nunca se continua uma transação depois de uma violação de índice único**: verifica-se antes, e uma violação sobe para o ciclo de tentativas de `create` (`MAX_CREATE_ATTEMPTS`), que também repete os conflitos transitórios (`isTransientTxConflict`);
  - eventos emitidos dentro da transação com `collector.emit` e entregues com `flush()` depois do commit.
- **Capacidade estrita** (design 9.2): promoções e vales nunca ultrapassam a capacidade; recusa → HTTP 409 com `PROMOTION_UNAVAILABLE` ou `STORE_CREDIT_INSUFFICIENT`; a encomenda não é criada e o stock não é descontado. O stock pode ficar negativo em concorrência (sem mecanismo). **Encomendas não pagas nunca são canceladas automaticamente**, nem quando a sessão expira (requisito 2.13).
- **Nada de URLs do backoffice** (design 4.13): nenhuma resposta do storefront nem e-mail contém `/admin`, o URL do Strapi ou `littlebox-strapi-suite`. Os links de pagamento são o URL da Checkout Session do Stripe. As imagens vão com o `url` guardado pelo provider de upload, sem prefixo de host (um caminho relativo `/uploads/...` do provider local é servido pelo BFF, documentado).
- **Sem dados internos nas respostas públicas:** nunca `id` interno de encomenda, cliente ou pagamento (a encomenda é identificada pelo `publicId`), nunca `name` interno, `snapshot`, condições ou código administrativo de promoções `AUTOMATIC`, nunca contagens de stock, custos, auditoria ou histórico.
- **Cabeçalhos:** `Authorization: Bearer <token do BFF>`, `X-Checkout-Session: <token da sessão>`, `Idempotency-Key: <chave>` (criação de encomenda) e `X-Forwarded-For: <IP do browser>` (posto pelo BFF; só o primeiro valor, validado com `net.isIP`).
- **Rate limiting em memória** (design 8 e 9.2): válido só com uma instância do Strapi (documentado). Os limites por IP só se aplicam quando o BFF envia um `X-Forwarded-For` válido; sem ele aplicam-se só os limites por sessão (o IP do BFF nunca é usado como chave, para não limitar a loja inteira). Resposta 429 com `Retry-After` e `details.code = 'RATE_LIMITED'`.
- **Erros públicos:** o formato de erro do Strapi (`{ data: null, error: { status, name, message, details: { code, errors? } } }`). Sessão em falta, malformada, desconhecida ou expirada → 401 `SESSION_INVALID` (sem distinguir). Encomenda de outra sessão ou inexistente → 404 `ORDER_NOT_FOUND` (sem distinguir). Os eventos de segurança (`SESSION_INVALID`, `ORDER_ACCESS_DENIED`, `RATE_LIMITED`, `VERIFICATION_LOCKED`) vão para `strapi.log.warn` com o nome da regra e sem dados pessoais nem tokens; não se grava nada na base de dados por cada recusa.
- **`toPublicStoreCreditError`** em todas as respostas do storefront que envolvem vales (`STORE_CREDIT_EMAIL_MISMATCH` → `STORE_CREDIT_NOT_FOUND`).
- **Estados de código públicos:** `CUSTOMER_LIMIT_REACHED` e `EMAIL_NOT_ELIGIBLE` saem como `NOT_ELIGIBLE` (não revelam se um e-mail já comprou ou está numa lista, requisito 2.16).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (os subagentes podem assinar com o seu próprio modelo). Branch `feat/ecommerce`.

## Review Focus

1. **Duplo clique ou retry do BFF na criação, e a mesma `Idempotency-Key` noutra sessão:** a repetição na mesma sessão devolve a mesma encomenda (um só `ORDER_DEDUCT`, uma só redemption); a mesma chave enviada por outra sessão nunca devolve a encomenda alheia (a chave guardada é `sf:<sessionId>:<chave>`) e cria a sua própria. Teste na Task 9.
2. **`publicId` de uma encomenda de outra sessão** em `/orders/:publicId/status` e `/orders/:publicId/payment`: 404 `ORDER_NOT_FOUND`, igual ao de um `publicId` inexistente, sem link Stripe criado e com o evento `ORDER_ACCESS_DENIED` no log. Testes nas Tasks 7 e 9.
3. **Sessão expirada depois da encomenda:** o estado e o pagamento respondem 401 `SESSION_INVALID`, mas a encomenda continua `OPEN`, `PENDING`, com o stock descontado e a promoção reservada (nada é cancelado). Teste na Task 9.
4. **Fugas de informação nas respostas públicas:** a cotação e o estado da encomenda nunca têm o `name` interno de uma promoção, o código administrativo de uma `AUTOMATIC`, a `snapshot`, contagens de stock ou ids internos; um código esgotado por cliente e um código fora da lista de e-mails dão os dois `NOT_ELIGIBLE`; um vale de outro e-mail dá `STORE_CREDIT_NOT_FOUND`. Testes nas Tasks 4 e 9.
5. **BFF sem `X-Forwarded-For` (ou com um valor inválido):** 1000 pedidos de catálogo de clientes diferentes atrás do mesmo BFF não recebem 429 (sem chave de IP); com `X-Forwarded-For: 203.0.113.7` o 601.º pedido num minuto recebe 429 com `Retry-After`; um token do BFF inválido recebe 403 antes de qualquer contagem. Testes nas Tasks 4 e 10.

---

### Task 1: Content-types, definições do storefront e slugs estáveis

**Files:**
- Create: `server/src/content-types/modules/ecommerce/checkout-session/{schema.json,index.ts}`
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (UID `checkoutSession`), `content-types/modules/ecommerce/order/schema.json` (relação `checkoutSession`), `content-types/modules/ecommerce/promotion/schema.json` (`requireVerifiedEmail`), `services/modules/ecommerce/settings.ts` (`StoreSettings` + validação), `services/modules/ecommerce/products.ts` (slug estável), `tests/server/ecommerce/helpers/commerceSetup.ts` (UID, relação `order.checkoutSession`, `enforceUnique`)
- Test: `tests/server/ecommerce/storefrontContentTypes.test.ts`, `tests/server/ecommerce/settings.test.ts` e `tests/server/ecommerce/products.test.ts` (acrescentar)

**Interfaces:**
- `checkout-session` (`collectionName` `ltb_st_module_ecommerce_checkout_sessions`): `tokenHash` (string, required, unique + índice `ecommerce_checkout_session_token_unique`), `status` enum `ACTIVE,EXPIRED` (default `ACTIVE`), `expiresAt` (datetime, required), `lastUsedAt` (datetime), `cart` (json, objeto), `emailVerification` (json, objeto), `verifiedEmail` (string, e-mail normalizado ou nulo). Sem campo de loja (design 2.1).
- `order.checkoutSession`: `manyToOne` unidirecional para `checkout-session` (uma sessão pode ter várias encomendas; a autorização compara este id).
- `promotion.requireVerifiedEmail`: boolean, default `false`.
- `StoreSettings` ganha `storefrontApiTokenId: number | null` (default `null`) e `checkoutSessionTtlHours: number` (default `168`). Validação: `storefrontApiTokenId` nulo ou inteiro ≥ 1 que exista em `strapi.service('admin::api-token').getById` (senão `invalid_token`); `checkoutSessionTtlHours` inteiro em `[1, 720]` (senão `invalid_number`). A verificação do token é assíncrona, em `updateStoreSettings`, antes da transação.
- **Slugs estáveis** (pendente do plano 1): ao gravar um produto, uma tradução que já existe mantém o seu `slug` mesmo que o `name` mude; o slug só é gerado quando a tradução é criada (ou quando o guardado está vazio). Uma tradução apagada e criada de novo recebe um slug novo.

- [ ] **Step 1: Failing tests:**
  - o schema `checkout-session` existe, está oculto, tem o enum, o índice único com nome ≤ 60 e as colunas JSON; `order` tem a relação `checkoutSession` `manyToOne` sem `inversedBy`; `promotion.requireVerifiedEmail` com default `false`; `schemaIndexes` continua a passar;
  - `getStoreSettings()` sem linhas → `storefrontApiTokenId: null`, `checkoutSessionTtlHours: 168`;
  - `updateStoreSettings({ checkoutSessionTtlHours: 0 })` e `721` → `invalid_number`; `{ storefrontApiTokenId: 99 }` com `getById` a devolver `null` → `invalid_token`; com um token existente → gravado;
  - produto "Caneca" (slug `caneca`) renomeado para "Caneca Azul" → o slug continua `caneca`; uma tradução `pt` nova recebe o slug gerado do seu nome.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontContentTypes.test.ts tests/server/ecommerce/settings.test.ts tests/server/ecommerce/products.test.ts` → FAIL.
- [ ] **Step 3:** Schemas, registos, UID, campos de definições e slug estável; `commerceSetup` com a tabela nova.
- [ ] **Step 4:** Os mesmos testes → PASS; `npx vitest run tests/server/ecommerce` continua verde.
- [ ] **Step 5: Commit** `feat(ecommerce): checkout session content-type, storefront settings and stable slugs`

---

### Task 2: Promoções: e-mail verificado (requisito 1.8)

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/promotions/{types,definition,availability,engine}.ts`, `services/modules/ecommerce/promotions.ts` (`toCandidate`, criação/edição, `PromotionView`), `admin/src/ecommerce/promotionTypes.ts`, `admin/src/ecommerce/utils/promotionForm.ts`, `admin/src/ecommerce/components/promotions/EligibilityFields.tsx`, `admin/src/core/translations/{en,pt}.json`
- Test: `tests/server/ecommerce/domain/promotions/{definition,availability,engine}.test.ts`, `tests/server/ecommerce/promotions.test.ts`, `tests/admin/ecommerce/promotionForm.test.ts` (acrescentar)

**Interfaces:**
- `PromotionDefinition.requireVerifiedEmail: boolean` (e `PromotionInput`; ausente na entrada → `false`; não booleano → `invalid`).
- `requiresVerifiedEmail(p: Pick<PromotionDefinition, 'requireVerifiedEmail' | 'eligibility' | 'conditions'>): boolean` em `availability.ts` = `requireVerifiedEmail` **ou** `eligibility.mode === 'EMAILS'` **ou** alguma folha `EMAIL` nas condições (a qualquer profundidade).
- `BlockReason` ganha `'EMAIL_NOT_VERIFIED'` (logo `CodeStatus` também).
- `EvaluationInput.emailVerified?: boolean`: **ausente = confiável** (admin, plano 6 sem mudanças); `false` = storefront sem e-mail verificado.
- No passo 2 do `evaluatePromotions`, para cada candidata com `emailVerified === false && requiresVerifiedEmail(c)`: `candidateBlock` corre com `email: null` (estado e limite global continuam a ser verificados, o limite por cliente não), e, se não houver bloqueio, a candidata é rejeitada com `EMAIL_NOT_VERIFIED` **antes** da elegibilidade e das condições (assim a resposta é igual para qualquer e-mail e não revela se o e-mail está na lista).
- Admin: na secção Elegibilidade, caixa "Require a verified e-mail at checkout" / "Exigir e-mail verificado no checkout", com a ajuda "Always on for promotions restricted to e-mails. Recommended for high-value or single-use promotions." / "Sempre ativa nas promoções restritas a e-mails. Recomendada para promoções de valor elevado ou de utilização única."; em modo `EMAILS` aparece marcada e desativada. `CodeStatus` `EMAIL_NOT_VERIFIED` traduzido no admin.

- [ ] **Step 1: Failing tests:**
  - `requiresVerifiedEmail`: flag → verdadeiro; `EMAILS` → verdadeiro; `EMAIL contains '@empresa.pt'` dentro de um grupo de nível 2 → verdadeiro; nada disto → falso;
  - motor: código restrito a `ana@x.pt` com `emailVerified: false` e e-mail `ana@x.pt` → `EMAIL_NOT_VERIFIED`; o mesmo com `bruno@x.pt` → também `EMAIL_NOT_VERIFIED`; com `emailVerified: true` e `bruno@x.pt` → `EMAIL_NOT_ELIGIBLE`; com `emailVerified` ausente → o comportamento do plano 6 (aplicada para `ana@x.pt`);
  - promoção esgotada (`USAGE_LIMIT_REACHED`) com `emailVerified: false` → continua `USAGE_LIMIT_REACHED`;
  - automática sem restrições com `emailVerified: false` → aplicada;
  - serviço: criar com `requireVerifiedEmail: true` grava, `get` devolve-o, e `loadCandidates` passa-o ao motor; uma linha antiga sem o campo → `false`;
  - admin: `toPromotionInput` inclui `requireVerifiedEmail`; `promotionFormFromView` lê-o.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/domain/promotions tests/server/ecommerce/promotions.test.ts tests/admin/ecommerce/promotionForm.test.ts` → FAIL.
- [ ] **Step 3:** Implementar o domínio, o serviço e o campo no formulário.
- [ ] **Step 4:** → PASS; `npm run test:ts:back` e `npm run test:ts:front` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): verified e-mail requirement for restricted promotions`

---

### Task 3: Encomendas: módulo de preços, ofertas com nomes, IVA por linha e e-mail verificado

**Files:**
- Create: `server/src/services/modules/ecommerce/orderPricing.ts`
- Modify: `services/modules/ecommerce/orders.ts`, `admin/src/ecommerce/orderTypes.ts`, `admin/src/ecommerce/utils/orderForm.ts` (`giftSelectors`), `admin/src/ecommerce/pages/orders/OrderCreatePage.tsx` (`variantLabel` cai para os nomes de `giftOptions`)
- Test: `tests/server/ecommerce/orders.promotions.test.ts`, `tests/server/ecommerce/orders.create.test.ts`, `tests/admin/ecommerce/orderForm.test.ts` (acrescentar)

**Interfaces:**
- **Divisão de `orders.ts`** (pendente do plano 6), primeiro como refactor puro com os testes existentes verdes: `createOrderPricing(deps: { strapi: Core.Strapi; loadCatalog; promotions; shipping; stock; getStoreSettings }): { priceCart; quote; assertLinesAvailable; assertPricedStock; assertCodesUsable }` em `orderPricing.ts`; `orders.ts` constrói-o uma vez e continua a exportar `quote` e a usar as mesmas funções em `create`. `CatalogVariant` e `MergedLine` passam a ser exportados de `orderPricing.ts`.
- `OrderQuoteInput` e `CreateOrderInput` ganham `emailVerified?: boolean`, passado ao motor por `priceCart` (ausente = confiável).
- `OrderQuoteLine` ganha `tax: number` (do catálogo).
- `OrderQuote` ganha `giftOptions: QuoteGiftOption[]`:
  - `type QuoteGiftOption = { promotionId: number; benefitIndex: number; quantity: number; selectedVariantId: number | null; variants: { variantId: number; sku: string; name: string; option: string | null; imageUrl: string | null; available: boolean }[] }`;
  - uma entrada por benefício `BUY_X_GET_Y` em modo `GIFT` das promoções **aplicadas**, com todas as variantes de `variantIds` (nomes no locale da cotação, `available` = ativa e com `GiftOption.available ≥ quantity`); `selectedVariantId` = a variante da linha de oferta desse benefício.
- **Portes e ofertas (pendente F5 do plano 6):** se as ofertas da avaliação final diferirem das ofertas usadas na última cotação de portes, `priceCart` lança `{ path: 'shipping', code: 'SHIPPING_UNAVAILABLE' }` em vez de gravar portes cotados para outro volume.
- Admin: `giftSelectors(quote)` lê `quote.giftOptions` (só os benefícios com 2 ou mais variantes) e o painel mostra os nomes vindos da cotação; deixa de precisar de `promotions.read` para os rótulos.

- [ ] **Step 1: Failing tests:**
  - refactor: `npx vitest run tests/server/ecommerce` verde antes e depois de mover o código (nenhum teste muda nesse passo);
  - `quote` de "compre 2 A, receba B ou C" (C sem stock) → `giftOptions[0]` com B `available: true`, C `available: false`, nomes no locale `pt`, `selectedVariantId` = B;
  - as linhas da cotação trazem `tax`;
  - promoção com `requireVerifiedEmail` e `emailVerified: false` → o código fica `EMAIL_NOT_VERIFIED` na cotação e `create` com o mesmo código → 400 `PROMOTION_CODE_INVALID` com `detail 'EMAIL_NOT_VERIFIED'`; sem `emailVerified` → aplicada;
  - quoter simulado que devolve preços diferentes consoante o volume, montado para que a avaliação final mude as ofertas outra vez → `SHIPPING_UNAVAILABLE` e nenhuma encomenda;
  - admin: `giftSelectors` com `giftOptions` de 2 variantes → um seletor com os nomes; com 1 variante → nenhum.
- [ ] **Step 2:** Os testes novos → FAIL.
- [ ] **Step 3:** Mover o código para `orderPricing.ts` (commit intermédio opcional `refactor(ecommerce): move cart pricing out of orders.ts`), depois acrescentar `tax`, `giftOptions`, `emailVerified` e a guarda das ofertas.
- [ ] **Step 4:** → PASS; os dois `tsc` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): gift option names, line VAT and verified e-mail in order pricing`

---

### Task 4: Domínio do storefront: rate limiting, tokens, IVA e projeções públicas

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/storefront/{rateLimit,session,tax,publicViews,request,index}.ts`
- Test: `tests/server/ecommerce/domain/storefront/{rateLimit,session,tax,publicViews,request}.test.ts`

**Interfaces (`rateLimit.ts`):**
- `type RateRule = { limit: number; windowMs: number }`
- `type RateRuleName = 'session.create' | 'catalog' | 'cart.quote' | 'discount.apply' | 'storeCredit.check' | 'email.send' | 'email.confirm' | 'order.create' | 'order.read'`
- `STOREFRONT_RATE_RULES: Record<RateRuleName, { session?: RateRule; ip?: RateRule }>` com estes valores (min = 60 000 ms):

| Regra | Por sessão | Por IP |
|---|---|---|
| `session.create` | — | 20 / 60 min |
| `catalog` | — | 600 / 1 min |
| `cart.quote` | 120 / 10 min | 600 / 10 min |
| `discount.apply` | 20 / 10 min | 60 / 60 min |
| `storeCredit.check` | 10 / 10 min | 30 / 60 min |
| `email.send` | 3 / 15 min | 10 / 60 min |
| `email.confirm` | 10 / 15 min | 30 / 60 min |
| `order.create` | 5 / 10 min | 20 / 60 min |
| `order.read` | 120 / 10 min | — |

- `createRateLimiter(opts?: { now?: () => number; maxKeys?: number /* 50_000 */ }): { hit(key: string, rule: RateRule): { allowed: boolean; retryAfterSec: number }; size(): number }`: janela fixa por chave (`count`, `resetAt`); um pedido recusado não conta; acima de `maxKeys`, varre as janelas terminadas e, se ainda faltar espaço, apaga as chaves mais antigas (ordem de inserção do `Map`). `retryAfterSec` = `ceil((resetAt − now) / 1000)`, mínimo 1.
- `rateKeys(rule: RateRuleName, ctx: { sessionId: number | null; ip: string | null }): { key: string; rule: RateRule }[]`: `<rule>:s:<sessionId>` e `<rule>:ip:<ip>`, só para as dimensões definidas **e** conhecidas.

**Interfaces (`session.ts`):**
- `SESSION_TOKEN_BYTES = 32`; `generateSessionToken(random: (n: number) => Buffer): string` (base64url sem padding, 43 caracteres); `isWellFormedSessionToken(raw: unknown): raw is string` (`/^[A-Za-z0-9_-]{43}$/`); `hashSessionToken(token: string): string` (SHA-256 hex).
- `VERIFICATION_CODE_TTL_MS = 10 * 60_000`, `VERIFICATION_MAX_ATTEMPTS = 5`; `generateVerificationCode(randomInt: (max: number) => number): string` (6 dígitos com zeros à esquerda); `verificationCodeHash(sessionId: number, emailNormalized: string, code: string): string` (SHA-256 hex de `<sessionId>:<email>:<code>`).
- `sessionExpiry(createdAt: Date, ttlHours: number): Date`.

**Interfaces (`tax.ts`):**
- `type VatRow = { rate: number; base: number; vat: number; gross: number }`
- `vatBreakdown(items: { amount: number; rate: number }[]): VatRow[]`: soma o bruto por taxa; `base` = meio para cima de `gross × 100 / (100 + rate)` (em inteiros: taxa com até 2 casas → pontos base); `vat = gross − base`; ordenado por taxa; taxas com bruto 0 omitidas.
- `quoteVatItems(q: { lines: { unitPrice: number; unitDiscount: number; quantity: number; tax: number }[]; orderDiscount: number; shippingTotal: number | null; shippingTax: number | null }): { amount: number; rate: number }[]`: valor de cada linha `(unitPrice − unitDiscount) × quantity`, o `orderDiscount` repartido pelas linhas com `allocateProportionally` (de `domain/orders.ts`) e os portes (`shippingTotal` à `shippingTax`) quando não são nulos.

**Interfaces (`publicViews.ts`):**
- `type PublicCodeStatus = 'APPLIED' | 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'EMAIL_NOT_VERIFIED' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'USAGE_LIMIT_REACHED' | 'CONDITIONS_NOT_MET' | 'CONFLICT' | 'NO_BENEFIT' | 'AWAITING_SHIPPING'`
- `toPublicCodeStatus(s: CodeStatus): PublicCodeStatus` (`CUSTOMER_LIMIT_REACHED`, `EMAIL_NOT_ELIGIBLE` → `NOT_ELIGIBLE`; `INACTIVE` → `NOT_FOUND`, para não confirmar códigos desativados; os restantes iguais). `CodeStatus` vem do plano 6, com `EMAIL_NOT_VERIFIED` (Task 2).
- `codeStatusMessage(status: PublicCodeStatus, locale: string): string`: dicionário `en` e `pt` (locale `pt-*` → `pt`; outro → `en`). Textos fixos, por exemplo `CONFLICT`: "This code cannot be combined with the promotions already applied; we kept the best combination for you." / "Este código não pode ser combinado com as promoções já aplicadas; mantivemos a melhor combinação para si."; `EMAIL_NOT_VERIFIED`: "Confirm your e-mail address to use this code." / "Confirme o seu endereço de e-mail para usar este código."; `AWAITING_SHIPPING`: "This code applies to shipping: choose a delivery method." / "Este código aplica-se aos portes: escolha um método de entrega.". Um texto por estado, nos dois idiomas.
- O domínio não importa ficheiros de serviço: `publicViews.ts` declara `QuoteSource` e `OrderStatusSource`, os subconjuntos estruturais de `OrderQuote` (Task 3) e de `OrderView` que usa, com `AppliedPromotion` e `CodeStatus` de `domain/promotions`; um teste de tipos (`const _q: QuoteSource = {} as OrderQuote`) num ficheiro de teste garante que continuam atribuíveis.
- `type PublicQuote` e `toPublicQuote(q: QuoteSource, ctx: { locale: string; defaultLocale: string; enteredCodes: string[]; shippingOptions: PublicShippingOption[] | null }): PublicQuote`:
  - `lines: { variantId; productId; sku; name; option; imageUrl; unitPrice; unitDiscount; quantity; total; tax; isGift; promotionIds: number[] }[]`;
  - `promotions: { promotionId; name /* displayNameFor */; code: string | null /* só em CODE */; amount; classes }[]`;
  - `codes: { code; status: PublicCodeStatus; message: string }[]` (só os introduzidos);
  - `giftOptions` (de `OrderQuote.giftOptions`, Task 3, sem `benefitIndex`);
  - `totals` (os da `OrderQuote`), `taxes: VatRow[]` (de `vatBreakdown(quoteVatItems(…))`), `currency: 'EUR'`;
  - `shippingOptions`, `selectedShipping: PublicShippingOption | null`. `type PublicShippingOption = { providerId; serviceId; name; price; estimatedDays: number | null }`.
- `type PaymentResult = 'PAID' | 'PROCESSING' | 'UNPAID' | 'CANCELLED'`; `paymentResult(o: { orderStatus; paymentStatus; due: number; hasPendingStripePayment: boolean }): PaymentResult` (por esta ordem: `CANCELLED` → `CANCELLED`; `due ≤ 0` → `PAID`; pagamento Stripe `PENDING` com sessão `COMPLETE` → `PROCESSING`; senão `UNPAID`).
- `type PublicOrderStatus = { publicId; reference: string /* '#1001' */; createdAt; locale; orderStatus; paymentStatus; paymentResult: PaymentResult; currency: 'EUR'; totals: { itemsOriginal; productDiscount; subtotal; orderDiscount; shippingTotal; total; paid: number; due: number }; lines: { name; option; sku; quantity; unitPrice; unitDiscount; total; isGift }[]; promotions: { name; amount }[]; shipping: { name: string } | null }`; `toPublicOrderStatus(view: OrderStatusSource, ctx: { defaultLocale: string; hasPendingStripePayment: boolean }): PublicOrderStatus` (promoções só com `displayNameFor` e `amount`, pendente do plano 6).

**Interfaces (`request.ts`):**
- `clientIpFrom(xff: unknown): string | null`: primeiro valor separado por vírgulas, sem espaços, aceite só se `net.isIP` ≠ 0.
- `sanitizeSearchTerm(raw: unknown): string`: `trim`, remove `%`, `_` e `\` (os curingas do `LIKE` não são escapados de forma portável), máximo 100 caracteres.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 5 (parte):** `rateKeys('catalog', { sessionId: null, ip: null })` → `[]`; com `ip: '203.0.113.7'` → uma chave; limitador com relógio fixo e `catalog.ip` → 600 permitidos, o 601.º recusado com `retryAfterSec` > 0; avançar 60 s → permitido; `clientIpFrom('203.0.113.7, 10.0.0.1')` → `'203.0.113.7'`; `'not-an-ip'`, `''`, `undefined` → `null`;
  - recusas não contam; com `maxKeys: 3` e quatro chaves, `size()` ≤ 3;
  - `generateSessionToken` com bytes fixos dá 43 caracteres base64url e o mesmo hash SHA-256 conhecido; `isWellFormedSessionToken('abc')` → falso;
  - `generateVerificationCode(() => 42)` → `'000042'`;
  - `vatBreakdown([{ amount: 12300, rate: 23 }, { amount: 1060, rate: 6 }])` → `[{ rate: 6, base: 1000, vat: 60, gross: 1060 }, { rate: 23, base: 10000, vat: 2300, gross: 12300 }]`; taxa 0 → `vat: 0`; `quoteVatItems` reparte um `orderDiscount` de 1000 por linhas de 6000 e 4000 → 5400 e 3600 e acrescenta os portes;
  - **Review Focus 4 (parte):** `toPublicCodeStatus('CUSTOMER_LIMIT_REACHED')` e `('EMAIL_NOT_ELIGIBLE')` → `NOT_ELIGIBLE`; `('INACTIVE')` → `NOT_FOUND`; `toPublicQuote` de uma cotação com uma promoção `AUTOMATIC` (`code: 'CAMP-INT'`, `name: 'Interno'`, `displayName: { pt: 'Verão' }`) e locale `pt` → `promotions[0]` é `{ name: 'Verão', code: null, … }` e o JSON não contém `Interno`, `CAMP-INT`, `snapshot` nem `stock`;
  - `codeStatusMessage('CONFLICT', 'pt-PT')` é o texto `pt`; `'fr'` → `en`; cada `PublicCodeStatus` tem texto nos dois idiomas;
  - `paymentResult`: cancelada → `CANCELLED`; `due 0` → `PAID`; Multibanco por confirmar → `PROCESSING`;
  - `toPublicOrderStatus` não tem `customer`, `history`, `payments`, `id` nem moradas; `reference` = `'#1001'`;
  - `sanitizeSearchTerm(' 50%_off\\ ')` → `'50off'`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/domain/storefront` → FAIL.
- [ ] **Step 3:** Implementar os cinco ficheiros e o barrel.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): storefront domain (rate limits, session tokens, VAT breakdown, public views)`

---

### Task 5: Criação de encomendas: vale de crédito atómico e sessão de checkout

**Files:**
- Modify: `server/src/services/modules/ecommerce/payments.ts`, `services/modules/ecommerce/orders.ts`
- Test: `tests/server/ecommerce/orders.create.test.ts`, `tests/server/ecommerce/storeCredits.test.ts` (acrescentar)

**Interfaces:**
- `EcommercePaymentService.applyStoreCredit(p: { orderId: number; code: string; idempotencyKey: string; actor: string; operationId: string; collector: { emit(e: any): void } }): Promise<PaymentView>`: o corpo transacional de `addStoreCreditPayment` extraído sem mudanças de comportamento (bloqueio da encomenda, `assertAction('ADD_PAYMENT')`, `storeCreditUsable`, `amount = min(due, saldo)`, pagamento `STORE_CREDIT` `COMPLETED`, `consume` condicional, histórico, `recalculate`, evento `PAYMENT_COMPLETED`). **Exige uma transação ambiente** (junta-se a ela; não faz `flush`). `addStoreCreditPayment` passa a abrir a transação e chamá-la.
- `CreateOrderInput.storeCreditCode?: string` (≤ 64): dentro da transação de `create`, depois das linhas, do stock e do `reserve` das promoções, `payments().applyStoreCredit({ orderId, code, idempotencyKey: '<chave da encomenda ou uuid>:store-credit', actor, operationId, collector })`. Qualquer recusa (`STORE_CREDIT_*`) desfaz a encomenda inteira: nada criado, stock e capacidade intactos. `STORE_CREDIT_INSUFFICIENT` → 409 (já em `CONFLICT_CODES`).
- `CreateOrderContext.checkoutSessionId?: number`: gravado em `order.checkoutSession` na mesma transação.
- `create` devolve também `total: number` (o gravado), para o storefront responder sem uma segunda leitura: `{ id; reference; publicId; total }` (também na repetição por `idempotencyKey`).

- [ ] **Step 1: Failing tests:**
  - encomenda de 5000 com um vale de 3000 do mesmo e-mail → criada, pagamento `STORE_CREDIT` 3000 `COMPLETED`, saldo 0, `paymentStatus PARTIALLY_PAID`, e um só evento `ORDER_CREATED` e um `PAYMENT_COMPLETED` entregues depois do commit;
  - vale de 8000 numa encomenda de 5000 → paga 5000, saldo 3000, `PAID`;
  - vale de outro e-mail → `STORE_CREDIT_EMAIL_MISMATCH` (o serviço não muda; o storefront mapeia-o, Task 9) e nenhuma encomenda, nenhum movimento de stock, nenhuma redemption;
  - saldo consumido por outra compra entre a cotação e a criação (o `UPDATE` condicional não afeta linhas) → 409 `STORE_CREDIT_INSUFFICIENT`, nada criado e a promoção reservada desfeita;
  - repetir o `create` com a mesma `idempotencyKey` → a mesma encomenda, o saldo baixa uma só vez;
  - `checkoutSessionId: 7` → `order.checkoutSession` = 7;
  - `addStoreCreditPayment` no admin continua a passar os testes existentes.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/orders.create.test.ts tests/server/ecommerce/storeCredits.test.ts` → FAIL.
- [ ] **Step 3:** Extrair `applyStoreCredit` e ligá-lo a `create`.
- [ ] **Step 4:** → PASS; `npx vitest run tests/server/ecommerce` verde.
- [ ] **Step 5: Commit** `feat(ecommerce): store credit applied atomically on order creation`

---

### Task 6: Catálogo público

**Files:**
- Create: `server/src/services/modules/ecommerce/storefrontCatalog.ts`
- Modify: `server/src/services/index.ts`
- Test: `tests/server/ecommerce/storefrontCatalog.test.ts`

**Interfaces:**
- `resolveLocale(raw: unknown): Promise<string>`: vazio → locale por defeito; um locale não configurado no i18n → `EcommerceValidationError` `{ path: 'locale', code: 'invalid_locale' }`.
- `type PublicImage = { url: string; width: number; height: number; alt: string }`
- `type PublicProductListItem = { id: number; slug: string; name: string; shortDescription: string; image: PublicImage | null; priceMin: number; priceMax: number; currency: 'EUR'; available: boolean }`
- `type PublicVariant = { id: number; option: string; sku: string; price: number; taxRate: number; available: boolean; images: PublicImage[] }`
- `type PublicProduct = { id: number; slug: string; slugs: Record<string, string>; name: string; shortDescription: string; description: string /* HTML da allow-list */; images: PublicImage[]; currency: 'EUR'; priceMin: number; priceMax: number; available: boolean; variants: PublicVariant[] }`
- `listProducts(q: { page?: unknown; pageSize?: unknown; search?: unknown; sort?: unknown; locale: string }): Promise<{ results: PublicProductListItem[]; pagination: { page; pageSize; total; pageCount } }>`:
  - só produtos `active` com pelo menos uma variante `active`; os preços e a disponibilidade contam só as variantes ativas; `available` = alguma variante ativa com `stock > 0`;
  - `page` ≥ 1 (default 1), `pageSize` em `[1, 50]` (default 24); `search` passa por `sanitizeSearchTerm` e procura `$containsi` no `name` de qualquer locale ou no `sku` das variantes ativas;
  - `sort` ∈ `newest` (default, `id desc`), `price_asc`, `price_desc`, `name_asc` (outro → 400 `invalid_sort`); o preço e o nome ordenam-se em memória sobre os ids filtrados (uma loja tem poucos milhares de produtos), depois paginam-se;
  - textos no locale pedido com recurso ao locale por defeito; imagem = a primeira do produto, senão a da primeira variante ativa.
- `getProduct(slug: string, locale: string): Promise<PublicProduct>`: procura o slug no locale pedido e depois no locale por defeito; produto inexistente, inativo ou sem variantes ativas → `EcommerceNotFoundError`; `variants` só as ativas, por `position`; a galeria de uma variante vazia usa a do produto (design 3.1); `slugs` = slug por locale (para `hreflang`).
- Nenhum campo de stock, peso, dimensões, datas ou ids de imagem/tradução sai daqui.

- [ ] **Step 1: Failing tests:**
  - produto inativo, e produto ativo só com variantes inativas → fora da lista e 404 no detalhe;
  - variante sem stock e outra com stock → `available: true`; todas sem stock → `false`; o JSON não contém `stock`;
  - `priceMin`/`priceMax` ignoram a variante inativa de 1 €;
  - pesquisa `'50%'` não rebenta e encontra "50 Anos"; pesquisa por SKU encontra o produto;
  - `sort=price_desc` com três produtos e `pageSize 2` → a ordem certa entre páginas; `sort=foo` → `invalid_sort`;
  - detalhe em `pt` sem tradução `pt` → textos `en`; o slug `en` também encontra o produto quando pedido em `pt`;
  - variante sem galeria → as imagens do produto;
  - `locale: 'fr'` não configurado → `invalid_locale`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontCatalog.test.ts` → FAIL.
- [ ] **Step 3:** Implementar e registar o serviço.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): public storefront catalog`

---

### Task 7: Sessões anónimas, carrinho e posse de encomendas

**Files:**
- Create: `server/src/services/modules/ecommerce/storefrontSessions.ts`
- Modify: `server/src/services/index.ts`, `tests/server/ecommerce/helpers/commerceSetup.ts` (regista o serviço)
- Test: `tests/server/ecommerce/storefrontSessions.test.ts`

**Interfaces:**
- `type StoredCart = { lines: { variantId: number; quantity: number }[]; promotionCodes: string[]; giftChoices: Record<string, number>; email: string | null; destination: { country: string; postalCode?: string } | null; shippingMethod: { providerId: string; serviceId: string } | null; locale: string | null }`; `EMPTY_CART`.
- `type CheckoutSession = { id: number; expiresAt: string; cart: StoredCart; verifiedEmail: string | null; emailVerification: Record<string, unknown> }`
- `open(currentToken: string | null): Promise<{ token: string | null; expiresAt: string; reused: boolean }>` (requisito 2.3): um token atual válido → `{ token: null, reused: true }` (o BFF já o tem; o Strapi não o conhece em claro); senão cria uma sessão `ACTIVE` com `tokenHash`, `expiresAt = sessionExpiry(agora, checkoutSessionTtlHours)`, `cart: EMPTY_CART`, `emailVerification: {}` e devolve o token **uma única vez**.
- `resolve(token: unknown): Promise<CheckoutSession | null>`: token malformado → `null` sem consultar a base de dados; procura por `tokenHash`; `status !== 'ACTIVE'` ou `expiresAt ≤ agora` → `null` (e marca `EXPIRED` com um `update` condicional); atualiza `lastUsedAt` só se o anterior tiver mais de 60 s.
- `saveCart(sessionId: number, cart: StoredCart): Promise<void>` e `clearCart(sessionId: number): Promise<void>` (mantém `email`, `destination` e `locale`; limpa linhas, códigos e escolhas).
- `isEmailVerified(s: CheckoutSession, email: string): boolean` = `s.verifiedEmail === normalizeEmail(email)`.
- `findOwnedOrder(s: CheckoutSession, publicId: unknown): Promise<{ id: number; publicId: string } | null>`: `publicId` tem de ser um UUID; procura `{ publicId, checkoutSession: { id: s.id } }`; não encontrado → `null` e `strapi.log.warn('[ecommerce:storefront] ORDER_ACCESS_DENIED')` (sem o `publicId` nem o token).
- A expiração da sessão nunca toca em encomendas (requisito 2.13).

- [ ] **Step 1: Failing tests:**
  - `open(null)` → token de 43 caracteres; a linha guarda só o SHA-256 (o token em claro não aparece em nenhuma coluna); `expiresAt` = agora + 168 h (com `checkoutSessionTtlHours: 2` → 2 h);
  - `open(tokenVálido)` → `{ token: null, reused: true }` e nenhuma linha nova; `open('lixo')` → sessão nova;
  - `resolve` de um token expirado → `null` e a linha passa a `EXPIRED`; de um token desconhecido → `null`; de `'x'` → `null` sem `findOne`;
  - `lastUsedAt` não é reescrito em duas resoluções no mesmo minuto;
  - `saveCart` grava um objeto; `clearCart` mantém o e-mail;
  - **Review Focus 2 (parte):** `findOwnedOrder` de uma encomenda de outra sessão → `null` e um `log.warn` com `ORDER_ACCESS_DENIED`; a da própria sessão → `{ id, publicId }`; `publicId` que não é UUID → `null` sem consulta.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontSessions.test.ts` → FAIL.
- [ ] **Step 3:** Implementar e registar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): anonymous checkout sessions with server-side cart`

---

### Task 8: Verificação do e-mail por código

**Files:**
- Create: `server/src/services/modules/ecommerce/email/defaults/emailVerification.ts`
- Modify: `services/modules/ecommerce/email/catalog.ts` (`EMAIL_TEMPLATE_TYPES` + `'EMAIL_VERIFICATION'`, variáveis e dados de exemplo), `email/defaults/index.ts`, `services/modules/ecommerce/storefrontSessions.ts`, `notificationData.ts` (só se a exaustividade dos tipos o exigir: `EMAIL_VERIFICATION` nunca é uma notificação, nenhum evento lhe corresponde), `admin/src/core/translations/{en,pt}.json` (nome do modelo)
- Test: `tests/server/ecommerce/email/catalog.test.ts`, `tests/server/ecommerce/email/templates.test.ts`, `tests/server/ecommerce/storefrontSessions.test.ts` (acrescentar)

**Interfaces:**
- Modelo `EMAIL_VERIFICATION` (inglês de origem, traduzível como os outros): variáveis `verification.code`, `verification.validMinutes`, `customer.email`; assunto "Your verification code - {{store.name}}"; corpo com o código em destaque (`callout`), "This code expires in {{verification.validMinutes}} minutes." e "If you did not request it, ignore this e-mail.". Sem botão nem link.
- `requestEmailVerification(s: CheckoutSession, input: { email: unknown; locale: string }): Promise<{ expiresAt: string }>`:
  - e-mail inválido → `invalid_email`; Resend inativo → `EcommerceEmailError('EMAIL_NOT_CONFIGURED')`;
  - gera o código, grava `emailVerification = { emailNormalized, codeHash, expiresAt, attempts: 0 }` (o código nunca é gravado em claro, nem em `notification`), renderiza com `EcommerceEmailTemplateService.render('EMAIL_VERIFICATION', locale, { customer: { email }, verification: { code, validMinutes: '10' } })` e envia com `sendWithResend` (`idempotencyKey: 'verify:<sessionId>:<codeHash>'`); falha do envio → `EMAIL_SEND_FAILED` e a verificação pendente é limpa.
- `confirmEmailVerification(s: CheckoutSession, input: { email: unknown; code: unknown }): Promise<{ verified: true }>`:
  - sem verificação pendente, outro e-mail ou expirada → `{ path: 'code', code: 'VERIFICATION_CODE_INVALID' }`;
  - `attempts ≥ VERIFICATION_MAX_ATTEMPTS` → `VERIFICATION_LOCKED` (é preciso pedir outro código) e `log.warn`;
  - código errado → incremento condicional de `attempts` e `VERIFICATION_CODE_INVALID`;
  - certo → `verifiedEmail = emailNormalized` e `emailVerification = {}`. Comparação por hash.

- [ ] **Step 1: Failing tests:**
  - o catálogo tem 13 tipos, `EMAIL_VERIFICATION` com variáveis e exemplo; o HTML por defeito renderiza com os dados de exemplo e não contém `/admin`, `/api/` nem `littlebox-strapi-suite`;
  - `requestEmailVerification` com Resend simulado → um envio para o e-mail, o HTML contém o código e a linha da sessão não contém o código em claro;
  - Resend inativo → `EMAIL_NOT_CONFIGURED`;
  - confirmar com o código certo → `verifiedEmail` normalizado; `isEmailVerified(s, ' Ana@X.pt ')` → verdadeiro;
  - código errado 5 vezes → a 6.ª tentativa, mesmo com o código certo, → `VERIFICATION_LOCKED`;
  - código expirado → `VERIFICATION_CODE_INVALID`; confirmar para outro e-mail → `VERIFICATION_CODE_INVALID`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/email tests/server/ecommerce/storefrontSessions.test.ts` → FAIL.
- [ ] **Step 3:** Modelo, catálogo e os dois métodos.
- [ ] **Step 4:** → PASS; `npm run test:ts:back` limpo.
- [ ] **Step 5: Commit** `feat(ecommerce): e-mail verification codes for checkout sessions`

---

### Task 9: Checkout do storefront: cotação, códigos, vale, encomenda, pagamento e estado

**Files:**
- Create: `server/src/services/modules/ecommerce/storefrontCheckout.ts`
- Modify: `server/src/services/index.ts`, `tests/server/ecommerce/helpers/commerceSetup.ts` (regista os três serviços do storefront)
- Test: `tests/server/ecommerce/storefrontCheckout.test.ts`

**Interfaces:**
- `type StorefrontCartInput = { lines; locale; email?; promotionCodes?; giftChoices?; destination?: { country: string; postalCode?: string } | null; shippingMethod?: { providerId: string; serviceId: string } | null }` (a forma é validada no controller, Task 10).
- `quote(s: CheckoutSession, input: StorefrontCartInput): Promise<PublicQuote>`:
  - grava o carrinho na sessão (`saveCart`) antes de cotar, para o BFF o recuperar com `GET /cart` mesmo que a cotação falhe;
  - com `destination`: `shippingOptions` = `EcommerceOrderService.quoteForLines({ country, postalCode, lines, locale }).options` (as `failures` não saem); sem `destination` → `null`;
  - `EcommerceOrderService.quote({ …, email, shipping: destination && shippingMethod ? { …destination, …shippingMethod } : null, emailVerified: email ? isEmailVerified(s, email) : false })` e `toPublicQuote`;
  - um carrinho vazio → `PublicQuote` vazio (totais 0) sem chamar o serviço de encomendas.
- `applyDiscount(s, input: StorefrontCartInput & { code: unknown }): Promise<{ code: string; status: PublicCodeStatus; message: string; applied: boolean; quote: PublicQuote }>` (requisito 1.6): cota com `promotionCodes ∪ [code]` (normalizado, ≤ 5) pelo mesmo motor; não reserva nada; o código só fica no carrinho gravado quando `applied`.
- `checkStoreCredit(input: { code: unknown; email: unknown }): Promise<{ balance: number; expiresAt: string | null }>`: lê o vale por código e aplica `storeCreditUsable`; qualquer recusa → `EcommerceValidationError` com `toPublicStoreCreditError(code)` em `path 'code'`.
- `type StorefrontOrderInput = { customer: { firstName; lastName; email; phone? }; shippingAddress; billingAddress?: Address | null /* nulo = igual à de entrega */; locale; lines; shippingMethod: { providerId; serviceId }; promotionCodes?; giftChoices?; expectedTotal: number /* obrigatório */; storeCreditCode?: string; notes?: string }`
- `placeOrder(s, input: StorefrontOrderInput, idempotencyKey: string): Promise<{ publicId: string; reference: string; total: number; due: number; paymentStatus: PaymentStatus }>`:
  - `EcommerceOrderService.create({ …, shipping: shippingMethod, idempotencyKey: 'sf:<sessionId>:<idempotencyKey>', emailVerified: isEmailVerified(s, customer.email) }, { actor: 'storefront', source: 'storefront', checkoutSessionId: s.id })`;
  - erros `STORE_CREDIT_*` passam por `toPublicStoreCreditError`;
  - depois do sucesso, `clearCart` (falha só registada no log); `due` e `paymentStatus` lidos de `computeOrderState`.
- `paymentLink(s, publicId): Promise<{ url: string; expiresAt: string; amount: number; reused: boolean }>`: `findOwnedOrder` (nulo → `EcommerceNotFoundError`) e `getOrCreatePaymentLink(orderId, { actor: 'storefront' })` (o serviço escolhe `CHECKOUT`/`SUPPLEMENTARY`, reutiliza a sessão válida para o mesmo montante e nunca aceita um valor do frontend); só estes quatro campos saem (nunca o `sessionId` do Stripe).
- `orderStatus(s, publicId): Promise<PublicOrderStatus>`: `findOwnedOrder`, `EcommerceOrderService.get` e `toPublicOrderStatus` (`hasPendingStripePayment` = algum pagamento `STRIPE` `PENDING` com sessão `COMPLETE`).

- [ ] **Step 1: Failing tests** (`setupCommerce` com os serviços do storefront; Stripe simulado como nos testes de `stripePayments`):
  - **Review Focus 1:** `placeOrder` duas vezes com a mesma chave na mesma sessão → o mesmo `publicId`, um só `ORDER_DEDUCT`; a mesma chave noutra sessão → outro `publicId`, e a encomenda da primeira sessão não aparece na resposta;
  - **Review Focus 2:** `orderStatus` e `paymentLink` com o `publicId` de outra sessão → `EcommerceNotFoundError`, sem chamada ao Stripe;
  - **Review Focus 3:** encomenda criada; a sessão passa a expirada (`expiresAt` no passado) → `resolve` dá `null`; a encomenda continua `OPEN`/`PENDING`, o stock descontado e a redemption `RESERVED`;
  - **Review Focus 4:** `checkStoreCredit` com o código certo e outro e-mail → `STORE_CREDIT_NOT_FOUND`; `placeOrder` com esse vale → `STORE_CREDIT_NOT_FOUND` e nada criado; a resposta da cotação com um código esgotado por cliente → `NOT_ELIGIBLE` e a mensagem `en`;
  - `quote` grava o carrinho; `GET` posterior (`resolve(...).cart`) devolve-o; com `destination` sem método → `shippingOptions` preenchido e `selectedShipping: null`; com método → `totals.shippingTotal` e uma linha de IVA dos portes em `taxes`;
  - `applyDiscount` com `VERAO20` aplicável → `applied: true`, sem redemption criada; com um código inexistente → `NOT_FOUND` e o carrinho gravado não o contém;
  - promoção restrita a e-mails: sem verificação → `EMAIL_NOT_VERIFIED`; depois de `confirmEmailVerification` → aplicada, e `placeOrder` cria a encomenda com ela;
  - `expectedTotal` diferente → 409 `TOTAL_CHANGED` (do plano 6), nada criado;
  - vale que cobre tudo → `placeOrder` devolve `due: 0`, `paymentStatus: 'PAID'`, e `paymentLink` → `NOTHING_DUE`;
  - `paymentLink` duas vezes → o mesmo `url` com `reused: true` na segunda; o URL é o do Stripe simulado;
  - `orderStatus` depois do webhook `checkout.session.completed` simulado → `paymentResult: 'PAID'`; as promoções vêm com o `displayName` do locale da encomenda e o `amount`;
  - `placeOrder` cria o cliente pelo e-mail normalizado (ou reutiliza o existente) e a resposta é igual nos dois casos.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontCheckout.test.ts` → FAIL.
- [ ] **Step 3:** Implementar e registar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): storefront checkout service (quote, codes, store credit, orders, payment, status)`

---

### Task 10: Policy do BFF, controller, rotas, rate limiting e documentação do contrato

**Files:**
- Create: `server/src/policies/check-storefront-token.ts`, `server/src/controllers/modules/ecommerce/storefront.ts` (`EcommerceStorefrontController`), `server/src/controllers/modules/ecommerce/storefrontErrors.ts`, `server/src/routes/ecommerce/content-api-storefront.ts`, `docs/ecommerce/storefront-api.md`
- Modify: `server/src/policies/index.ts` (entrada nova), `server/src/routes/content-api.ts` (spread), `server/src/controllers/index.ts`
- Test: `tests/server/ecommerce/storefrontPolicy.test.ts`, `tests/server/ecommerce/storefrontRoutes.test.ts`, `tests/server/ecommerce/storefrontController.test.ts`

**Policy `check-storefront-token`:** `Authorization: Bearer <t>` → `strapi.service('admin::api-token')`: `hash(t)`, `getByAccessKey`, não expirado e `id === storefrontApiTokenId` das definições; qualquer outra coisa → `false` (403 do Strapi). Não lê `X-Forwarded-For` nem conta nada.

**Rotas** (todas com `auth: false`, `policies: ['check-storefront-token']`, `middlewares: ['plugin::littlebox-strapi-suite.check-module-is-active']`; prefixo `/ecommerce/storefront`; `S` = sessão obrigatória):

| Método | Path | S | Regra | Corpo / resposta |
|---|---|---|---|---|
| GET | `/products?page=&pageSize=&search=&sort=&locale=` | — | `catalog` | `{ results, pagination }` |
| GET | `/products/:slug?locale=` | — | `catalog` | `PublicProduct` |
| POST | `/checkout/session` | opcional | `session.create` | 201 `{ token, expiresAt }` ou 200 `{ token: null, expiresAt, reused: true }` |
| GET | `/cart` | S | `cart.quote` | `StoredCart` |
| POST | `/cart/quote` | S | `cart.quote` | `StorefrontCartInput` → `PublicQuote` |
| POST | `/discounts/apply` | S | `discount.apply` | `StorefrontCartInput & { code }` → resultado |
| POST | `/store-credit/check` | S | `storeCredit.check` | `{ code, email }` → `{ balance, expiresAt }` |
| POST | `/checkout/email-verification` | S | `email.send` | `{ email, locale }` → 202 `{ expiresAt }` |
| POST | `/checkout/email-verification/confirm` | S | `email.confirm` | `{ email, code }` → `{ verified: true }` |
| POST | `/orders` | S | `order.create` | `StorefrontOrderInput` + `Idempotency-Key` → 201 |
| POST | `/orders/:publicId/payment` | S | `order.read` | → `{ url, expiresAt, amount, reused }` |
| GET | `/orders/:publicId/status` | S | `order.read` | `PublicOrderStatus` |

- **Controller:** um `rateLimiter` por processo (`createRateLimiter()`); para cada pedido, `rateKeys(regra, { sessionId, ip: clientIpFrom(cabeçalho X-Forwarded-For) })` e `hit` em todas as chaves; recusa → 429 `{ code: 'RATE_LIMITED', retryAfter }` + `Retry-After` e `log.warn` com a regra. Nas rotas `S`, a sessão é resolvida antes do limite por sessão; sessão nula → 401 `SESSION_INVALID`. `POST /checkout/session` lê o cabeçalho opcional.
- **Validação de entrada** (`validation.ts` reutilizado; mensagem `'Invalid request'`): `lines` 1–100 com `variantId` e `quantity` inteiros em `[1, 1000]`; `promotionFields` (Task 10 do plano 6) para códigos, `giftChoices` e `expectedTotal`; em `/orders` o `expectedTotal` é obrigatório; `Idempotency-Key` obrigatório, 8–100 caracteres `[A-Za-z0-9_:-]` (senão 400 `invalid_idempotency_key`); `email` ≤ 254; `code` de promoção ≤ 40 e de vale ≤ 64; `country` `^[A-Z]{2}$`; `postalCode` ≤ 20; `notes` ≤ 1000; `locale` via `resolveLocale`; `:publicId` UUID. Campos desconhecidos são ignorados (nunca passados aos serviços: preços, descontos, estados ou stock vindos do pedido não existem na entrada).
- **`handleStorefrontError(ctx, err)`:** validação → 400/409 como `handleDomainError` com `withCode: true`, com `ACTION_NOT_AVAILABLE` também em 409; `EcommerceNotFoundError` → 404 `ORDER_NOT_FOUND` nas rotas de encomenda, `NOT_FOUND` no catálogo; `EcommercePaymentError`: `STRIPE_NOT_CONFIGURED`, `STOREFRONT_URL_MISSING` → 503; `STRIPE_UNREACHABLE`, `STRIPE_REQUEST_FAILED` → 502; `NOTHING_DUE`, `PAYMENT_PENDING` → 409; `EcommerceEmailError` `EMAIL_NOT_CONFIGURED` → 503, `EMAIL_SEND_FAILED` → 502; `EcommerceCarrierError` → 502; outro → relançado (500 genérico do Strapi, sem detalhes).
- **`docs/ecommerce/storefront-api.md`** (contrato do BFF, requisitos 2.4, 2.15 e design 8): criação do token `custom` sem permissões e escolha nas Configurações; cabeçalhos; o cookie do BFF (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `localStorage`) e a proteção CSRF no BFF (token anti-CSRF ou verificação de `Origin` nas operações que alteram dados; `SameSite` não chega); CORS desnecessário no Strapi; o `X-Forwarded-For` posto pelo BFF; a tabela de rotas, regras e códigos de erro; o fluxo de checkout (sessão → cotação → verificação de e-mail quando pedida → encomenda com `expectedTotal` → pagamento → página de sucesso com `?order=<publicId>` → estado); a página de sucesso não prova o pagamento; as imagens relativas servidas pelo BFF; rate limiting válido só com uma instância; sem link de acesso por e-mail nesta versão (design 4.13).

- [ ] **Step 1: Failing tests:**
  - policy: sem cabeçalho, token desconhecido, token expirado e token válido mas não escolhido → `false`; o escolhido (de qualquer tipo, incluindo `custom`) → `true`; sem `storefrontApiTokenId` → `false`;
  - rotas: as 12 com o handler, `auth: false`, a policy e o middleware certos; todas incluídas em `content-api.ts`; as rotas antigas de `content-api.ts` mantêm-se iguais (mesmo número e `check-api-token`);
  - **Review Focus 5:** controller com um limitador real e relógio fixo: 1000 `GET /products` sem `X-Forwarded-For` → nenhum 429; com `X-Forwarded-For: 203.0.113.7` → o 601.º é 429 com `Retry-After` e `details.code 'RATE_LIMITED'`;
  - `order.create`: a 6.ª criação na mesma sessão em 10 min → 429;
  - sem `X-Checkout-Session` numa rota `S` → 401 `SESSION_INVALID`;
  - `/orders` sem `Idempotency-Key` → 400 `invalid_idempotency_key`; sem `expectedTotal` → 400; `lines` com `quantity 0` → 400; um campo `unitPrice` no corpo não chega ao serviço;
  - `STRIPE_NOT_CONFIGURED` → 503; `NOTHING_DUE` → 409; `PROMOTION_UNAVAILABLE` → 409 com o `detail`; `ORDER_NOT_FOUND` → 404;
  - nenhuma resposta de sucesso dos testes contém `/admin` nem `littlebox-strapi-suite`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontPolicy.test.ts tests/server/ecommerce/storefrontRoutes.test.ts tests/server/ecommerce/storefrontController.test.ts` → FAIL.
- [ ] **Step 3:** Policy, controller, erros, rotas e o documento.
- [ ] **Step 4:** → PASS; `npm run test:ts:back` limpo; `npx vitest run` verde.
- [ ] **Step 5: Commit** `feat(ecommerce): storefront API routes with BFF token, sessions and rate limits`

---

### Task 11: Admin: secção "Storefront" nas Configurações

**Files:**
- Create: `admin/src/ecommerce/pages/settings/StorefrontSettings.tsx`, `admin/src/ecommerce/utils/storefrontSettings.ts`
- Modify: `server/src/routes/ecommerce/admin-settings.ts` (`GET /storefront/api-tokens`), `server/src/controllers/modules/ecommerce/settings.ts` (`listApiTokens`), `admin/src/ecommerce/settingsTypes.ts`, o gateway das definições (`listApiTokens`), `admin/src/ecommerce/pages/settings/SettingsPage.tsx` (`SETTINGS_SECTIONS` + `'storefront'`), `admin/src/core/translations/{en,pt}.json`
- Test: `tests/admin/ecommerce/storefrontSettings.test.ts`, `tests/server/ecommerce/settingsRoutes.test.ts` e `settingsController.test.ts` (acrescentar)

**Interfaces:**
- `GET /admin/ecommerce/settings/storefront/api-tokens` (`settingsRead`) → `{ id: number; name: string; type: 'read-only' | 'full-access' | 'custom'; expiresAt: string | null }[]` de `admin::api-token.list()` (nunca `accessKey` nem permissões).
- `storefrontSettings.ts`: `tokenWarning(token: { type; expiresAt } | null, now: Date): 'FULL_ACCESS' | 'EXPIRES_SOON' | 'EXPIRED' | null` (expira em menos de 14 dias → `EXPIRES_SOON`); `storefrontBasePath = '/api/littlebox-strapi-suite/ecommerce/storefront'`; `validateTtlHours(raw: string): number | 'invalid_number'`.
- **Ecrã** (separador "Storefront" / "Storefront", entre "General" e "Payments"):
  - texto curto sobre o BFF ("Only your storefront server calls this API. Never put this token in the browser." / "Só o servidor do seu storefront chama esta API. Nunca coloque este token no browser.");
  - `SingleSelect` do token (nome e tipo), com aviso para `full-access` ("Prefer a custom token with no permissions") e para tokens a expirar; sem tokens → `EmptySection` com a ilustração existente, o texto "No API tokens yet." / "Ainda não existem API tokens." e o link para *Settings → API Tokens* do Strapi;
  - "Session lifetime (hours)" / "Validade das sessões (horas)", 1–720;
  - bloco de leitura com o caminho base e os cabeçalhos (`Authorization`, `X-Checkout-Session`, `Idempotency-Key`, `X-Forwarded-For`), como o `StripeWebhookInfo`;
  - grava com `PUT /store` (`storefrontApiTokenId`, `checkoutSessionTtlHours`); `invalid_token` e `invalid_number` traduzidos; só leitura sem `settings.manage`.

- [ ] **Step 1: Failing tests:** a rota tem `settingsRead`; `listApiTokens` não devolve `accessKey`; `tokenWarning` para `full-access`, expirado, a expirar em 3 dias e `custom` sem validade (`null`); `validateTtlHours('0')` e `'abc'` → `invalid_number`, `'24'` → 24; `SETTINGS_SECTIONS` inclui `'storefront'` na segunda posição.
- [ ] **Step 2:** Os testes → FAIL.
- [ ] **Step 3:** Implementação e traduções `en` + `pt`.
- [ ] **Step 4:** → PASS; os dois `tsc` e `npm run build` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): storefront settings (BFF token and session lifetime)`

---

### Task 12: Verificação final do plano 7

- [ ] `npx vitest run`, `npm run test:ts:back`, `npm run test:ts:front` e `npm run build` limpos.
- [ ] No Strapi de teste (`~/Projects/littlebox-plugins/strapi/backend-base`, MariaDB, reiniciado). **Sem chamadas a redes externas:** a integração Stripe fica com a chave falsa mas **inativa** (o pagamento deve responder 503 `STRIPE_NOT_CONFIGURED`), Resend e Moloni inativos. Um script `node` no scratchpad faz de BFF com `fetch` para `http://localhost:1337/api/littlebox-strapi-suite/ecommerce/storefront` e imprime cada estado e corpo:
  1. Tabela `ltb_st_module_ecommerce_checkout_sessions` com o índice único; a coluna de relação da encomenda com a sessão existe.
  2. Com o módulo desligado → 403 em `/products`; ligado e sem token escolhido → 403; criar no Strapi um API token `custom` sem permissões, escolhê-lo em *Settings → Storefront* (ver o aviso ao escolher um `full-access`, o estado vazio sem tokens, e os textos em `en` e `pt`) → 200. O token `read-only` dos outros módulos continua a servir `/modules/menus` e não serve o storefront.
  3. Catálogo: lista, pesquisa, `sort=price_asc`, detalhe por slug em `en` e `pt`; um produto renomeado no admin mantém o slug; nenhum campo `stock`; um produto inativo dá 404.
  4. `POST /checkout/session` → token; reenviar com o cabeçalho → `reused: true`; na tabela só existe o hash.
  5. `POST /cart/quote` com duas linhas, `destination: { country: 'PT' }` → `shippingOptions` com o método manual; com o método → totais, `taxes` (23% e portes), `GET /cart` devolve o carrinho.
  6. `POST /discounts/apply` com o código de 20% → `APPLIED`; com um código inexistente → `NOT_FOUND` e a mensagem `pt` quando `locale: 'pt'`; uma promoção restrita a e-mails → `EMAIL_NOT_VERIFIED`; `POST /checkout/email-verification` → 503 `EMAIL_NOT_CONFIGURED` (Resend inativo).
  7. `POST /store-credit/check` com o código de um vale e outro e-mail → `STORE_CREDIT_NOT_FOUND`.
  8. `POST /orders` com `expectedTotal` certo e `Idempotency-Key` → 201 com `publicId` e `reference`; repetir → o mesmo `publicId`; no admin a encomenda aparece com `source storefront`, o cliente criado, o stock descontado e a promoção reservada; com `expectedTotal` errado → 409 `TOTAL_CHANGED`.
  9. Encomenda paga com um vale do mesmo e-mail → `paymentStatus PAID` sem Stripe; vale de outro e-mail → 400 `STORE_CREDIT_NOT_FOUND` e nenhuma encomenda nova.
  10. `GET /orders/:publicId/status` → só `displayName` e valores das promoções, sem ids internos nem moradas; com o `publicId` de outra sessão → 404 `ORDER_NOT_FOUND`; `POST /orders/:publicId/payment` → 503 `STRIPE_NOT_CONFIGURED`.
  11. Expirar a sessão no MariaDB (`UPDATE … SET expires_at = NOW() - INTERVAL 1 HOUR`) → `status` responde 401 `SESSION_INVALID` e a encomenda continua `OPEN`/`PENDING` no admin.
  12. Rate limiting: 21 `POST /checkout/session` com `X-Forwarded-For: 203.0.113.7` → o 21.º é 429 com `Retry-After`; 30 pedidos de catálogo sem `X-Forwarded-For` → nenhum 429.
  13. Procurar `/admin`, `localhost:1337` e `littlebox-strapi-suite` em todas as respostas guardadas pelo script → nenhuma ocorrência (as imagens do provider local aparecem como `/uploads/...`).
  14. Os módulos antigos (Menus, Slugs, Traduções) continuam a responder como antes.
- [ ] Acrescentar a `docs/superpowers/plans/ecommerce-followups.md` (secção "Plan 7") os pendentes encontrados e estes, já conhecidos:
  - linhas de `checkout-session` expiradas não são apagadas (não há cron); uma limpeza das sessões sem encomendas fica por fazer;
  - o rate limiting e os contadores vivem na memória de uma instância (design 9.2); com várias instâncias seria preciso um armazenamento partilhado;
  - o link seguro de acesso à encomenda por e-mail (requisito 2.14) continua por implementar (design 4.13);
  - a ordenação do catálogo por preço e nome é feita em memória: rever se o catálogo passar de alguns milhares de produtos.
- [ ] Commit de correções: `chore(ecommerce): plan 7 verification fixes`
