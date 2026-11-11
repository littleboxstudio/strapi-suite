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
- **Entrada HTTP:** rotas `content-api` em `/api/littlebox-strapi-suite/ecommerce/storefront/...` (o middleware `check-module-is-active` já reconhece `/ecommerce/`), com a policy nova `check-storefront-token` e `auth: false`. O controller `EcommerceStorefrontController` valida, aplica o rate limiting (depois da policy, por isso o `X-Storefront-Client-IP` só é lido em pedidos com token válido), resolve a sessão do cabeçalho `X-Checkout-Session` e mapeia os erros.
- **Autenticação do BFF [Escolha técnica, decorre do design 8]:** um **API token do Strapi** escolhido nas Configurações (`storefrontApiTokenId`). A policy reutiliza o mesmo serviço `admin::api-token` que `check-api-token` (hash + `getByAccessKey`), mas não copia a sua lógica: exige o prefixo `Bearer `, compara `Number(token.id) === storefrontApiTokenId`, aceita só `kind` `content-api` ou nulo e compara a validade com `new Date(expiresAt).getTime() > Date.now()` (o `check-api-token` compara texto com `Date`, o que nunca expira). A policy existente `check-api-token` não serve nem muda: só aceita tokens `read-only` e é usada pelos outros módulos. Recomenda-se um token `custom` sem permissões, que não dá acesso a mais nada no Strapi. Sem token escolhido, todas as rotas do storefront respondem 403.

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
- **Cabeçalhos:** `Authorization: Bearer <token do BFF>`, `X-Checkout-Session: <token da sessão>`, `Idempotency-Key: <chave>` (criação de encomenda) e `X-Storefront-Client-IP: <IP do browser>` (posto pelo BFF, que **sobrescreve** sempre o valor e nunca reencaminha o do browser; um só IP, validado com `net.isIP`). O `X-Forwarded-For` é **ignorado** pelo Strapi (qualquer cliente o pode forjar); está documentado no contrato do BFF.
- **Rate limiting em memória** (design 8 e 9.2): válido só com uma instância do Strapi (documentado). Os limites por IP só se aplicam quando o BFF envia um `X-Storefront-Client-IP` válido; sem ele aplicam-se só os limites por sessão e por e-mail (o IP do BFF nunca é usado como chave, para não limitar a loja inteira). O armazenamento é limitado (`maxKeys`): ao encher, apaga primeiro as janelas já terminadas e depois as mais antigas por `resetAt`, e as chaves por sessão e por e-mail nunca são apagadas antes das chaves por IP. Resposta 429 com `Retry-After` e `details.code = 'RATE_LIMITED'`.
- **API só servidor a servidor:** o browser nunca chama o Strapi diretamente (nem o token do BFF nem a API do storefront existem do lado do browser); por isso não se configura CORS para o storefront e o contrato do BFF documenta que as origens do browser não devem ser acrescentadas ao `strapi::cors`.
- **Vale de crédito no checkout sem e-mail verificado:** o código do vale (12 caracteres, 60 bits) é o segredo e está ligado ao e-mail do vale; com `order.create` e `storeCredit.check` limitados, aceita-se que não seja exigida verificação do e-mail. Decisão documentada em `docs/ecommerce/storefront-api.md` (Task 10).
- **Retenção de dados das sessões:** as sessões expiradas são apagadas (ou esvaziadas, se tiverem encomendas) de forma oportunista, em lotes de no máximo 100, quando uma sessão é aberta; não há cron (Task 7).
- **Verificação de e-mail:** o código de 6 dígitos é guardado só como HMAC-SHA256 com um segredo do servidor derivado de `LTB_ECOMMERCE_ENCRYPTION_KEY`, comparado em tempo constante, com TTL de 10 min e no máximo 5 tentativas contadas de forma atómica (Tasks 4 e 8).
- **Erros públicos:** o formato de erro do Strapi (`{ data: null, error: { status, name, message, details: { code, errors? } } }`). Sessão em falta, malformada, desconhecida ou expirada → 401 `SESSION_INVALID` (sem distinguir). Encomenda de outra sessão ou inexistente → 404 `ORDER_NOT_FOUND` (sem distinguir). Os eventos de segurança (`SESSION_INVALID`, `ORDER_ACCESS_DENIED`, `RATE_LIMITED`, `VERIFICATION_LOCKED`) vão para `strapi.log.warn` com o nome da regra e sem dados pessoais nem tokens; não se grava nada na base de dados por cada recusa.
- **`toPublicStoreCreditError`** em todas as respostas do storefront que envolvem vales (`STORE_CREDIT_EMAIL_MISMATCH` → `STORE_CREDIT_NOT_FOUND`).
- **Estados de código públicos:** `CUSTOMER_LIMIT_REACHED` e `EMAIL_NOT_ELIGIBLE` saem como `NOT_ELIGIBLE` (não revelam se um e-mail já comprou ou está numa lista, requisito 2.16); `INACTIVE` e `SCHEDULED` saem como `NOT_FOUND` (não confirmam que o código existe), `EXPIRED` mantém-se. A máscara aplica-se a **todas** as respostas do storefront, incluindo os erros de `POST /orders` (`storefrontErrors.ts` converte os erros de promoções em `PROMOTION_CODE_INVALID` com o estado público; o serviço de encomendas do admin não muda). Com `emailVerified: false` o limite por cliente nunca é avaliado (as promoções com `perCustomerLimit` exigem e-mail verificado), para não revelar se um e-mail já comprou.
- **Spec [Escolha técnica, supera o design 8]:** o design 8 manda reutilizar `check-api-token` e o caminho `/api/littlebox-strapi-suite/storefront/...`. Isso fica superado por uma policy própria `check-storefront-token` e pelo caminho `/ecommerce/storefront`: o `check-api-token` aceita qualquer token `read-only` (o mesmo que o site público usa para os menus) e deixaria esse token criar encomendas, e não pode mudar (2.3); e um caminho `/storefront` sem `/ecommerce/` faria `getModuleName` lançar 500. O spec não é editado; esta linha regista a divergência.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (os subagentes podem assinar com o seu próprio modelo). Branch `feat/ecommerce`.

## Review Focus

1. **Duplo clique ou retry do BFF na criação, e a mesma `Idempotency-Key` noutra sessão:** a repetição na mesma sessão devolve a mesma encomenda (um só `ORDER_DEDUCT`, uma só redemption); a mesma chave enviada por outra sessão nunca devolve a encomenda alheia (a chave guardada é `sf:<sessionId>:<chave>`) e cria a sua própria. Teste na Task 9.
2. **`publicId` de uma encomenda de outra sessão** em `/orders/:publicId/status` e `/orders/:publicId/payment`: 404 `ORDER_NOT_FOUND`, igual ao de um `publicId` inexistente, sem link Stripe criado e com o evento `ORDER_ACCESS_DENIED` no log. Testes nas Tasks 7 e 9.
3. **Sessão expirada depois da encomenda:** o estado e o pagamento respondem 401 `SESSION_INVALID`, mas a encomenda continua `OPEN`, `PENDING`, com o stock descontado e a promoção reservada (nada é cancelado). Teste na Task 9.
4. **Fugas de informação nas respostas públicas:** a cotação e o estado da encomenda nunca têm o `name` interno de uma promoção, o código administrativo de uma `AUTOMATIC`, a `snapshot`, contagens de stock ou ids internos; um código esgotado por cliente e um código fora da lista de e-mails dão os dois `NOT_ELIGIBLE`; um vale de outro e-mail dá `STORE_CREDIT_NOT_FOUND`. Testes nas Tasks 4 e 9.
5. **BFF sem `X-Storefront-Client-IP` (ou com um valor inválido), e `X-Forwarded-For` forjado:** 1000 pedidos de catálogo de clientes diferentes atrás do mesmo BFF não recebem 429 (sem chave de IP), mesmo com `X-Forwarded-For` diferente em cada um; com `X-Storefront-Client-IP: 203.0.113.7` o 601.º pedido num minuto recebe 429 com `Retry-After`; um token do BFF inválido recebe 403 antes de qualquer contagem. Testes nas Tasks 4 e 10.

---

### Task 1: Content-types, definições do storefront e slugs estáveis

**Files:**
- Create: `server/src/content-types/modules/ecommerce/checkout-session/{schema.json,index.ts}`
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (UID `checkoutSession`), `content-types/modules/ecommerce/order/schema.json` (relação `checkoutSession`), `content-types/modules/ecommerce/promotion/schema.json` (`requireVerifiedEmail`), `services/modules/ecommerce/settings.ts` (`StoreSettings` + validação), `services/modules/ecommerce/products.ts` (slug estável), `tests/server/ecommerce/helpers/commerceSetup.ts` (UID, relação `order.checkoutSession`, `enforceUnique`)
- Test: `tests/server/ecommerce/storefrontContentTypes.test.ts`, `tests/server/ecommerce/settings.test.ts` (acrescentar e **atualizar** o `toEqual` dos defaults completos, ~linha 387, com os dois campos novos) e `tests/server/ecommerce/products.test.ts` (acrescentar)

**Interfaces:**
- `checkout-session` (`collectionName` `ltb_st_module_ecommerce_checkout_sessions`): `tokenHash` (string, required, unique + índice `ecommerce_checkout_session_token_unique`), `status` enum `ACTIVE,EXPIRED` (default `ACTIVE`), `expiresAt` (datetime, required), `lastUsedAt` (datetime), `cart` (json, objeto), `emailVerification` (json, objeto), `verificationAttempts` (integer, default 0; coluna escalar para o incremento condicional da Task 8, que não é portável sobre JSON), `verifiedEmail` (string, e-mail normalizado ou nulo). Sem campo de loja (design 2.1).
- `order.checkoutSession`: `manyToOne` unidirecional para `checkout-session` (uma sessão pode ter várias encomendas; a autorização compara este id).
- `promotion.requireVerifiedEmail`: boolean, default `false`.
- `StoreSettings` ganha `storefrontApiTokenId: number | null` (default `null`) e `checkoutSessionTtlHours: number` (default `168`). Validação: `storefrontApiTokenId` nulo ou inteiro ≥ 1 que exista em `strapi.service('admin::api-token').getById` (senão `invalid_token`); `checkoutSessionTtlHours` inteiro em `[1, 720]` (senão `invalid_number`). A verificação do token é assíncrona, em `updateStoreSettings`, antes da transação.
- **Slugs estáveis** (pendente do plano 1): ao gravar um produto, uma tradução que já existe mantém o seu `slug` mesmo que o `name` mude; o slug só é gerado quando a tradução é criada (ou quando o guardado está vazio). Uma tradução apagada e criada de novo recebe um slug novo.

- [ ] **Step 1: Failing tests:**
  - o schema `checkout-session` existe, está oculto, tem o enum, o índice único com nome ≤ 60, as colunas JSON e `verificationAttempts` integer com default 0; `order` tem a relação `checkoutSession` `manyToOne` sem `inversedBy`; `promotion.requireVerifiedEmail` com default `false`; `schemaIndexes` continua a passar;
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
- `requiresVerifiedEmail(p: Pick<PromotionDefinition, 'requireVerifiedEmail' | 'eligibility' | 'conditions' | 'perCustomerLimit'>): boolean` em `availability.ts` = `requireVerifiedEmail` **ou** `eligibility.mode === 'EMAILS'` **ou** alguma folha `EMAIL` nas condições (a qualquer profundidade) **ou** `perCustomerLimit !== null` (senão o limite por cliente, avaliado com um e-mail não verificado, deixaria sondar se um e-mail já comprou). Com `emailVerified: false`, o limite por cliente nunca é avaliado para nenhuma candidata.
- `BlockReason` ganha `'EMAIL_NOT_VERIFIED'` (logo `CodeStatus` também).
- `EvaluationInput.emailVerified?: boolean`: **ausente = confiável** (admin, plano 6 sem mudanças); `false` = storefront sem e-mail verificado.
- No passo 2 do `evaluatePromotions`, para cada candidata com `emailVerified === false && requiresVerifiedEmail(c)`: `candidateBlock` corre com `email: null` (estado e limite global continuam a ser verificados, o limite por cliente não), e, se não houver bloqueio, a candidata é rejeitada com `EMAIL_NOT_VERIFIED` **antes** da elegibilidade e das condições (assim a resposta é igual para qualquer e-mail e não revela se o e-mail está na lista).
- Admin: na secção Elegibilidade, caixa "Require a verified e-mail at checkout" / "Exigir e-mail verificado no checkout", com a ajuda "Always on for promotions restricted to e-mails or with a per-customer limit. Recommended for high-value or single-use promotions." / "Sempre ativa nas promoções restritas a e-mails ou com limite por cliente. Recomendada para promoções de valor elevado ou de utilização única."; em modo `EMAILS` (ou com limite por cliente definido) aparece marcada e desativada. `CodeStatus` `EMAIL_NOT_VERIFIED` traduzido no admin.

- [ ] **Step 1: Failing tests:**
  - `requiresVerifiedEmail`: flag → verdadeiro; `EMAILS` → verdadeiro; `EMAIL contains '@empresa.pt'` dentro de um grupo de nível 2 → verdadeiro; `perCustomerLimit: 1` → verdadeiro; nada disto → falso;
  - motor: promoção com `perCustomerLimit: 1` e `emailVerified: false` → `EMAIL_NOT_VERIFIED` tanto para um e-mail que já comprou como para um que não (resposta igual, o limite por cliente não é avaliado); com `emailVerified: true` e o e-mail que já comprou → `CUSTOMER_LIMIT_REACHED`;
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
- Create: `server/src/services/modules/ecommerce/orderPricing.ts`, `server/src/services/modules/ecommerce/orderPricingHelpers.ts` (ficheiro folha, sem imports de `orders.ts` nem de `orderPricing.ts`)
- Modify: `services/modules/ecommerce/orders.ts`, `admin/src/ecommerce/orderTypes.ts`, `admin/src/ecommerce/utils/orderForm.ts` (`giftSelectors`), `admin/src/ecommerce/pages/orders/OrderCreatePage.tsx` (`variantLabel` cai para os nomes de `giftOptions`)
- Test: `tests/server/ecommerce/orders.promotions.test.ts`, `tests/server/ecommerce/orders.create.test.ts` (acrescentar), `tests/admin/ecommerce/orderForm.test.ts` (acrescentar e **editar**: os fixtures de `OrderQuote` e os testes existentes de `giftSelectors` ganham `giftOptions`, que passa a ser obrigatório)

**Interfaces:**
- **Divisão de `orders.ts`** (pendente do plano 6), primeiro como refactor puro com os testes existentes verdes: `createOrderPricing(deps: { strapi: Core.Strapi; loadCatalog; promotions; shipping; stock; getStoreSettings; service; getDefaultLocale; clean; num }): { priceCart; quote; assertLinesAvailable; assertPricedStock; assertCodesUsable }` em `orderPricing.ts` (`service`, `getDefaultLocale`, `clean` e `num` são injetados, para `orderPricing.ts` não importar `orders.ts`); `orders.ts` constrói-o uma vez e continua a exportar `quote` e a usar as mesmas funções em `create`. O novo ficheiro folha `orderPricingHelpers.ts` exporta `normalizeLines`, `normalizePromotionFields`, `quantitiesByVariant`, `giftSignature` e os tipos `MergedLine` e `CatalogVariant`; `orders.ts` e `orderPricing.ts` importam-nos de lá (sem ciclo de imports; `isValidEmail` vem de `domain/email.ts`).
- `OrderQuoteInput` e `CreateOrderInput` ganham `emailVerified?: boolean`, passado ao motor por `priceCart` (ausente = confiável).
- `OrderQuoteLine` ganha `tax: number` (do catálogo).
- `OrderQuote` ganha `giftOptions: QuoteGiftOption[]`:
  - `type QuoteGiftOption = { promotionId: number; benefitIndex: number; quantity: number; selectedVariantId: number | null; variants: { variantId: number; sku: string; name: string; option: string | null; imageUrl: string | null; available: boolean }[] }`;
  - uma entrada por benefício `BUY_X_GET_Y` em modo `GIFT` das promoções **aplicadas**, com todas as variantes de `variantIds` (nomes no locale da cotação, `available` = ativa e com `GiftOption.available ≥ quantity`); `selectedVariantId` = a variante da linha de oferta desse benefício.
- **Portes e ofertas (pendente F5 do plano 6):** se as ofertas da avaliação final diferirem das ofertas usadas na última cotação de portes, `priceCart` lança `{ path: 'shipping', code: 'SHIPPING_UNAVAILABLE' }` em vez de gravar portes cotados para outro volume.
- Admin: `giftSelectors(quote)` lê `quote.giftOptions` (só os benefícios com 2 ou mais variantes) e o painel mostra os nomes vindos da cotação; deixa de precisar de `promotions.read` para os rótulos. Cada seletor é identificado por `promotionId` + `benefitIndex` (duas ofertas `GIFT` na mesma promoção não se confundem); `benefitIndex` mantém-se também na cotação pública (Task 4).

- [ ] **Step 1: Failing tests:**
  - refactor: `npx vitest run tests/server/ecommerce` verde antes e depois de mover o código (nenhum teste muda nesse passo);
  - `quote` de "compre 2 A, receba B ou C" (C sem stock) → `giftOptions[0]` com B `available: true`, C `available: false`, nomes no locale `pt`, `selectedVariantId` = B;
  - as linhas da cotação trazem `tax`;
  - promoção com `requireVerifiedEmail` e `emailVerified: false` → o código fica `EMAIL_NOT_VERIFIED` na cotação e `create` com o mesmo código → 400 `PROMOTION_CODE_INVALID` com `detail 'EMAIL_NOT_VERIFIED'`; sem `emailVerified` → aplicada;
  - quoter simulado que devolve preços diferentes consoante o volume, montado para que a avaliação final mude as ofertas outra vez → `SHIPPING_UNAVAILABLE` e nenhuma encomenda;
  - admin: `giftSelectors` com `giftOptions` de 2 variantes → um seletor com os nomes; com 1 variante → nenhum; dois benefícios `GIFT` da mesma promoção (`benefitIndex` 0 e 1) → dois seletores distintos.
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
- `STOREFRONT_RATE_RULES: Record<RateRuleName, { session?: RateRule; ip?: RateRule; email?: RateRule }>` com estes valores (min = 60 000 ms):

| Regra | Por sessão | Por IP | Por e-mail |
|---|---|---|---|
| `session.create` | — | 20 / 60 min | — |
| `catalog` | — | 600 / 1 min | — |
| `cart.quote` | 120 / 10 min | 600 / 10 min | — |
| `discount.apply` | 20 / 10 min | 60 / 60 min | — |
| `storeCredit.check` | 10 / 10 min | 30 / 60 min | — |
| `email.send` | 3 / 15 min | 10 / 60 min | 5 / 60 min |
| `email.confirm` | 10 / 15 min | 30 / 60 min | 5 / 60 min |
| `order.create` | 5 / 10 min | 20 / 60 min | — |
| `order.read` | 120 / 10 min | — | — |

- `createRateLimiter(opts?: { now?: () => number; maxKeys?: number /* 50_000 */ }): { hit(key: string, rule: RateRule): { allowed: boolean; retryAfterSec: number }; size(): number }`: janela fixa por chave (`count`, `resetAt`); um pedido recusado não conta. O mapa é limitado: acima de `maxKeys`, varre primeiro as janelas já terminadas e, se ainda faltar espaço, apaga as chaves com `resetAt` mais antigo (a janela mais antiga), **começando pelas chaves por IP (`:ip:`)**: as chaves por sessão (`:s:`) e por e-mail (`:e:`) só são apagadas se já não houver chaves por IP, para que um cliente com muitos IPs não consiga apagar os contadores de sessão e de e-mail. `retryAfterSec` = `ceil((resetAt − now) / 1000)`, mínimo 1. Uma instância só (documentado).
- `rateKeys(rule: RateRuleName, ctx: { sessionId: number | null; ip: string | null; email?: string | null }): { key: string; rule: RateRule }[]`: `<rule>:s:<sessionId>`, `<rule>:ip:<ip>` e `<rule>:e:<sha256(emailNormalizado)>` (o e-mail nunca fica em claro na chave), só para as dimensões definidas **e** conhecidas.
**Interfaces (`session.ts`):**
- `SESSION_TOKEN_BYTES = 32`; `generateSessionToken(random: (n: number) => Buffer): string` (base64url sem padding, 43 caracteres); `isWellFormedSessionToken(raw: unknown): raw is string` (`/^[A-Za-z0-9_-]{43}$/`); `hashSessionToken(token: string): string` (SHA-256 hex).
- `VERIFICATION_CODE_TTL_MS = 10 * 60_000`, `VERIFICATION_MAX_ATTEMPTS = 5`; `generateVerificationCode(randomInt: (max: number) => number): string` (6 dígitos com zeros à esquerda).
- `deriveVerificationSecret(encryptionKey: string): Buffer` = HMAC-SHA256 da chave `LTB_ECOMMERCE_ENCRYPTION_KEY` (a mesma que cifra as credenciais do módulo) com a etiqueta fixa `'storefront-email-verification'`; `verificationCodeHash(secret: Buffer, sessionId: number, emailNormalized: string, code: string): string` (HMAC-SHA256 hex de `<sessionId>:<email>:<code>` com `secret`; sem segredo, 10^6 códigos seriam descobertos por força bruta offline se a base de dados vazasse); `verificationCodeMatches(expectedHex: string, actualHex: string): boolean` com `crypto.timingSafeEqual` (comprimentos diferentes → falso, sem lançar).
- `sessionExpiry(createdAt: Date, ttlHours: number): Date`.

**Interfaces (`tax.ts`):**
- `type VatRow = { rate: number; base: number; vat: number; gross: number }`
- `vatBreakdown(items: { amount: number; rate: number }[]): VatRow[]`: soma o bruto por taxa; `base` = meio para cima de `gross × 100 / (100 + rate)` (em inteiros: taxa com até 2 casas → pontos base); `vat = gross − base`; ordenado por taxa; taxas com bruto 0 omitidas.
- `quoteVatItems(q: { lines: { unitPrice: number; unitDiscount: number; quantity: number; tax: number }[]; orderDiscount: number; shippingTotal: number | null; shippingTax: number | null }): { amount: number; rate: number }[]`: valor de cada linha `(unitPrice − unitDiscount) × quantity`, o `orderDiscount` repartido pelas linhas com `allocateProportionally` (de `domain/orders.ts`) e os portes (`shippingTotal` à `shippingTax`) quando não são nulos.

**Interfaces (`publicViews.ts`):**
- `type PublicCodeStatus = 'APPLIED' | 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'EMAIL_NOT_VERIFIED' | 'EXPIRED' | 'USAGE_LIMIT_REACHED' | 'CONDITIONS_NOT_MET' | 'CONFLICT' | 'NO_BENEFIT' | 'AWAITING_SHIPPING'`
- `toPublicCodeStatus(s: CodeStatus): PublicCodeStatus` (`CUSTOMER_LIMIT_REACHED`, `EMAIL_NOT_ELIGIBLE` → `NOT_ELIGIBLE`; `INACTIVE` e `SCHEDULED` → `NOT_FOUND`, para não confirmar que o código existe; `EXPIRED` mantém-se; os restantes iguais; todos os membros de `PublicCodeStatus` são alcançáveis). `CodeStatus` vem do plano 6, com `EMAIL_NOT_VERIFIED` (Task 2).
- `codeStatusMessage(status: PublicCodeStatus, locale: string): string`: dicionário `en` e `pt` (locale `pt-*` → `pt`; outro → `en`). Textos fixos, por exemplo `CONFLICT`: "This code cannot be combined with the promotions already applied; we kept the best combination for you." / "Este código não pode ser combinado com as promoções já aplicadas; mantivemos a melhor combinação para si."; `EMAIL_NOT_VERIFIED`: "Confirm your e-mail address to use this code." / "Confirme o seu endereço de e-mail para usar este código."; `AWAITING_SHIPPING`: "This code applies to shipping: choose a delivery method." / "Este código aplica-se aos portes: escolha um método de entrega.". Um texto por estado, nos dois idiomas.
- O domínio não importa ficheiros de serviço: `publicViews.ts` declara `QuoteSource` e `OrderStatusSource`, os subconjuntos estruturais de `OrderQuote` (Task 3) e de `OrderView` que usa, com `AppliedPromotion` e `CodeStatus` de `domain/promotions`; um teste de tipos (`const _q: QuoteSource = {} as OrderQuote`) num ficheiro de teste garante que continuam atribuíveis.
- `type PublicQuote` e `toPublicQuote(q: QuoteSource, ctx: { locale: string; defaultLocale: string; enteredCodes: string[]; shippingOptions: PublicShippingOption[] | null }): PublicQuote`:
  - `lines: { variantId; productId; sku; name; option; imageUrl; unitPrice; unitDiscount; quantity; total; tax; isGift; promotionIds: number[] }[]`;
  - `promotions: { promotionId; name /* displayNameFor */; code: string | null /* só em CODE */; amount; classes }[]`;
  - `codes: { code; status: PublicCodeStatus; message: string }[]` (só os introduzidos);
  - `giftOptions` (de `OrderQuote.giftOptions`, Task 3, **com** `benefitIndex`: sem ele, dois benefícios `GIFT` da mesma promoção seriam indistinguíveis);
  - `totals` (os da `OrderQuote`), `taxes: VatRow[]` (de `vatBreakdown(quoteVatItems(…))`), `currency: 'EUR'`;
  - `shippingOptions`, `selectedShipping: PublicShippingOption | null`. `type PublicShippingOption = { providerId; serviceId; name; price; estimatedDays: number | null }`.
- `type PaymentResult = 'PAID' | 'PROCESSING' | 'UNPAID' | 'CANCELLED'`; `paymentResult(o: { orderStatus; paymentStatus; due: number; hasPendingStripePayment: boolean }): PaymentResult` (por esta ordem: `CANCELLED` → `CANCELLED`; `due ≤ 0` → `PAID`; pagamento Stripe `PENDING` com sessão `COMPLETE` → `PROCESSING`; senão `UNPAID`).
- `type PublicOrderStatus = { publicId; reference: string /* '#1001' */; createdAt; locale; orderStatus; paymentStatus; paymentResult: PaymentResult; currency: 'EUR'; totals: { itemsOriginal; productDiscount; subtotal; orderDiscount; shippingTotal; total; paid: number; due: number }; lines: { name; option; sku; quantity; unitPrice; unitDiscount; total; isGift }[]; promotions: { name; amount }[]; shipping: { name: string } | null }`; `toPublicOrderStatus(view: OrderStatusSource, ctx: { defaultLocale: string; hasPendingStripePayment: boolean }): PublicOrderStatus` (promoções só com `displayNameFor` e `amount`, pendente do plano 6).

**Interfaces (`request.ts`):**
- `CLIENT_IP_HEADER = 'x-storefront-client-ip'`; `clientIpFrom(raw: unknown): string | null`: o valor do cabeçalho `X-Storefront-Client-IP` (posto pelo BFF), sem espaços, aceite só se for **um único** IP com `net.isIP` ≠ 0 (uma lista com vírgulas ou um zone id → `null`). O `X-Forwarded-For` nunca é lido.
- `sanitizeSearchTerm(raw: unknown): string`: `trim`, remove `%`, `_` e `\` (os curingas do `LIKE` não são escapados de forma portável), máximo 100 caracteres.

- [ ] **Step 1: Failing tests:**
  - **Review Focus 5 (parte):** `rateKeys('catalog', { sessionId: null, ip: null })` → `[]`; com `ip: '203.0.113.7'` → uma chave; limitador com relógio fixo e `catalog.ip` → 600 permitidos, o 601.º recusado com `retryAfterSec` > 0; avançar 60 s → permitido; `clientIpFrom('203.0.113.7')` → `'203.0.113.7'`; `'203.0.113.7, 10.0.0.1'`, `'fe80::1%eth0'`, `'not-an-ip'`, `''`, `undefined` → `null`; o módulo `request.ts` não referencia `x-forwarded-for`;
  - `rateKeys('email.send', { sessionId: 1, ip: null, email: 'ana@x.pt' })` → duas chaves (`s` e `e`), a do e-mail com hash (sem `ana@x.pt` em claro); a regra `email.send` por e-mail recusa a 6.ª em 60 min mesmo com sessões diferentes;
  - recusas não contam; com `maxKeys: 3` e quatro chaves, `size()` ≤ 3; **ordem de remoção:** janelas terminadas primeiro; depois, entre janelas ativas, a chave por IP de `resetAt` mais antigo, e uma chave por sessão e uma por e-mail ativas sobrevivem enquanto existir alguma chave por IP;
  - `generateSessionToken` com bytes fixos dá 43 caracteres base64url e o mesmo hash SHA-256 conhecido; `isWellFormedSessionToken('abc')` → falso;
  - `generateVerificationCode(() => 42)` → `'000042'`; `verificationCodeHash` com o mesmo `(sessionId, email, code)` é estável, muda com outro segredo e não é o SHA-256 simples dos mesmos dados; `deriveVerificationSecret` é determinístico por chave; `verificationCodeMatches` → verdadeiro para hashes iguais, falso para diferentes e para comprimentos diferentes (sem lançar);
  - `vatBreakdown([{ amount: 12300, rate: 23 }, { amount: 1060, rate: 6 }])` → `[{ rate: 6, base: 1000, vat: 60, gross: 1060 }, { rate: 23, base: 10000, vat: 2300, gross: 12300 }]`; taxa 0 → `vat: 0`; `quoteVatItems` reparte um `orderDiscount` de 1000 por linhas de 6000 e 4000 → 5400 e 3600 e acrescenta os portes;
  - **Review Focus 4 (parte):** `toPublicCodeStatus('CUSTOMER_LIMIT_REACHED')` e `('EMAIL_NOT_ELIGIBLE')` → `NOT_ELIGIBLE`; `('INACTIVE')` e `('SCHEDULED')` → `NOT_FOUND`; `('EXPIRED')` → `EXPIRED`; `toPublicQuote` de uma cotação com uma promoção `AUTOMATIC` (`code: 'CAMP-INT'`, `name: 'Interno'`, `displayName: { pt: 'Verão' }`) e locale `pt` → `promotions[0]` é `{ name: 'Verão', code: null, … }` e o JSON não contém `Interno`, `CAMP-INT`, `snapshot` nem `stock`;
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

> **Cronologia dos eventos [decisão]:** `applyStoreCredit` corre **depois** do registo de histórico `ORDER_CREATED` e do `collector.emit(ORDER_CREATED)` que fecham a tentativa de `create` (ainda dentro da mesma transação), para o histórico e os e-mails ficarem por ordem: `ORDER_CREATED` e só depois `PAYMENT_COMPLETED`. Qualquer recusa continua a desfazer a transação inteira.

**Interfaces:**
- `EcommercePaymentService.applyStoreCredit(p: { orderId: number; code: string; idempotencyKey: string; actor: string; operationId: string; collector: { emit(e: any): void } }): Promise<PaymentView>`: o corpo transacional de `addStoreCreditPayment` extraído sem mudanças de comportamento (bloqueio da encomenda, `assertAction('ADD_PAYMENT')`, `storeCreditUsable`, `amount = min(due, saldo)`, pagamento `STORE_CREDIT` `COMPLETED`, `consume` condicional, histórico, `recalculate`, evento `PAYMENT_COMPLETED`). **Exige uma transação ambiente** (junta-se a ela; não faz `flush`). `addStoreCreditPayment` passa a abrir a transação e chamá-la.
- `CreateOrderInput.storeCreditCode?: string` (≤ 64): dentro da transação de `create`, depois das linhas, do stock, do `reserve` das promoções, do histórico `ORDER_CREATED` e do `collector.emit` desse evento (no fim da tentativa), `payments().applyStoreCredit({ orderId, code, idempotencyKey: '<chave da encomenda ou uuid>:store-credit', actor, operationId, collector })`. Qualquer recusa (`STORE_CREDIT_*`) desfaz a encomenda inteira: nada criado, stock e capacidade intactos. `STORE_CREDIT_INSUFFICIENT` → 409 (já em `CONFLICT_CODES`).
- `CreateOrderContext.checkoutSessionId?: number`: gravado em `order.checkoutSession` na mesma transação.
- `create` devolve também `total: number` (o gravado), para o storefront responder sem uma segunda leitura: `{ id; reference; publicId; total }` (também na repetição por `idempotencyKey`: `findByIdempotencyKey` passa a selecionar `total`).
- O vale de crédito no checkout **não exige e-mail verificado**: o código (12 caracteres) é o segredo e está ligado ao e-mail da encomenda (`STORE_CREDIT_EMAIL_MISMATCH` caso contrário); aceite e documentado (Global Constraints e Task 10).

- [ ] **Step 1: Failing tests:**
  - encomenda de 5000 com um vale de 3000 do mesmo e-mail → criada, pagamento `STORE_CREDIT` 3000 `COMPLETED`, saldo 0, `paymentStatus PARTIALLY_PAID`, e um só evento `ORDER_CREATED` e um `PAYMENT_COMPLETED` entregues depois do commit, **por esta ordem** (`ORDER_CREATED` antes de `PAYMENT_COMPLETED`, tanto nos eventos entregues como no histórico da encomenda);
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
- `type PublicImage = { url: string; width: number; height: number; alt: string }` (`alt` = nome do produto no locale pedido, com recurso ao locale por defeito; o schema de imagem não tem campo `alt` e não se cria nenhum)
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
  - `alt` das imagens = o nome do produto no locale pedido (`pt`), e o do locale por defeito quando falta a tradução;
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
- `type CheckoutSession = { id: number; expiresAt: string; cart: StoredCart; verifiedEmail: string | null; emailVerification: Record<string, unknown>; verificationAttempts: number }`
- `open(currentToken: string | null): Promise<{ token: string | null; expiresAt: string; reused: boolean }>` (requisito 2.3): um token atual válido → `{ token: null, reused: true }` (o BFF já o tem; o Strapi não o conhece em claro); senão cria uma sessão `ACTIVE` com `tokenHash`, `expiresAt = sessionExpiry(agora, checkoutSessionTtlHours)`, `cart: EMPTY_CART`, `emailVerification: {}`, `verificationAttempts: 0` e devolve o token **uma única vez**. Antes de criar, chama `purgeExpired()` (falha só registada no log, nunca falha o `open`).
- `purgeExpired(limit = 100): Promise<number>` (retenção de dados pessoais, sem cron): no máximo `limit` (≤ 100) sessões com `status ACTIVE` e `expiresAt < agora` por chamada; as **sem encomendas** são apagadas; as **com encomendas** não se apagam (a relação da encomenda mantém-se) mas ficam `EXPIRED` com `cart: EMPTY_CART`, `emailVerification: {}`, `verifiedEmail: null` e `verificationAttempts: 0`. Devolve quantas tratou. Nunca toca em encomendas (requisito 2.13). `resolve` também esvazia (mesmo `cart`, `emailVerification`, `verifiedEmail`) a sessão que marca `EXPIRED`.
- `resolve(token: unknown): Promise<CheckoutSession | null>`: token malformado → `null` sem consultar a base de dados; procura por `tokenHash`; `status !== 'ACTIVE'` ou `expiresAt ≤ agora` → `null` (e marca `EXPIRED` com um `update` condicional); atualiza `lastUsedAt` só se o anterior tiver mais de 60 s.
- `saveCart(sessionId: number, cart: StoredCart): Promise<void>` e `clearCart(sessionId: number): Promise<void>` (mantém `email`, `destination` e `locale`; limpa linhas, códigos e escolhas).
- `isEmailVerified(s: CheckoutSession, email: string): boolean` = `s.verifiedEmail === normalizeEmail(email)`.
- `findOwnedOrder(s: CheckoutSession, publicId: unknown): Promise<{ id: number; publicId: string } | null>`: `publicId` tem de ser um UUID; procura `{ publicId, checkoutSession: { id: s.id } }`; não encontrado → `null` e `strapi.log.warn('[ecommerce:storefront] ORDER_ACCESS_DENIED')` (sem o `publicId` nem o token).
- A expiração da sessão nunca toca em encomendas (requisito 2.13).

- [ ] **Step 1: Failing tests:**
  - `open(null)` → token de 43 caracteres; a linha guarda só o SHA-256 (o token em claro não aparece em nenhuma coluna); `expiresAt` = agora + 168 h (com `checkoutSessionTtlHours: 2` → 2 h);
  - `open(tokenVálido)` → `{ token: null, reused: true }` e nenhuma linha nova; `open('lixo')` → sessão nova;
  - **retenção:** com 150 sessões expiradas sem encomendas, um `open` apaga exatamente 100 (restam 50, mais a nova) e um segundo `open` apaga as outras 50; uma sessão expirada **com** encomenda fica `EXPIRED` com `cart`, `emailVerification` e `verifiedEmail` vazios, e a encomenda não muda; sessões ainda válidas não se tocam; se o `purgeExpired` lançar, o `open` cria a sessão na mesma e regista o erro;
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
- Modify: `services/modules/ecommerce/email/catalog.ts` (`EMAIL_TEMPLATE_TYPES` + `'EMAIL_VERIFICATION'`, variáveis e dados de exemplo), `email/defaults/index.ts`, `services/modules/ecommerce/storefrontSessions.ts`, `notificationData.ts` (só se a exaustividade dos tipos o exigir: `EMAIL_VERIFICATION` nunca é uma notificação, nenhum evento lhe corresponde), `admin/src/ecommerce/settingsTypes.ts` (`EmailTemplateType` + `'EMAIL_VERIFICATION'`), `admin/src/ecommerce/utils/emailTemplateEditor.ts` (`EMAIL_TEMPLATE_TYPES` + `'EMAIL_VERIFICATION'`, senão `isEmailTemplateType` rejeita-o e o editor fica inacessível), `admin/src/core/translations/{en,pt}.json` (`.name` **e** `.description` do modelo, seguindo o padrão dos outros)
- Test: `tests/server/ecommerce/email/catalog.test.ts`, `tests/server/ecommerce/email/templates.test.ts`, `tests/server/ecommerce/storefrontSessions.test.ts` (acrescentar), `tests/admin/ecommerce/emailTemplateEditor.test.ts` (criar)

**Interfaces:**
- Modelo `EMAIL_VERIFICATION` (inglês de origem, traduzível como os outros): variáveis `verification.code`, `verification.validMinutes`, `customer.email`; assunto "Your verification code - {{store.name}}"; corpo com o código em destaque (`callout`), "This code expires in {{verification.validMinutes}} minutes." e "If you did not request it, ignore this e-mail.". Sem botão nem link.
- `requestEmailVerification(s: CheckoutSession, input: { email: unknown; locale: string }): Promise<{ expiresAt: string }>`:
  - e-mail inválido → `invalid_email`; Resend inativo → `EcommerceEmailError('EMAIL_NOT_CONFIGURED')`;
  - **sem reiniciar as tentativas:** se já existe uma verificação pendente para o **mesmo** e-mail e ainda dentro do TTL do código, o pedido de novo código (`resend`) gera um código novo mas **mantém** `verificationAttempts` (e portanto o bloqueio); `verificationAttempts` só volta a 0 quando o e-mail é outro ou a verificação anterior já expirou;
  - gera o código, grava `emailVerification = { emailNormalized, codeHash, expiresAt }` com `codeHash = verificationCodeHash(deriveVerificationSecret(LTB_ECOMMERCE_ENCRYPTION_KEY), sessionId, emailNormalized, code)` (HMAC-SHA256, Task 4; o código nunca é gravado em claro, nem em `notification`), renderiza com `EcommerceEmailTemplateService.render('EMAIL_VERIFICATION', locale, { customer: { email }, verification: { code, validMinutes: '10' } })` e envia com `sendWithResend` (`idempotencyKey: 'verify:<sessionId>:<codeHash>'`); falha do envio → `EMAIL_SEND_FAILED` e a verificação pendente é limpa.
- `confirmEmailVerification(s: CheckoutSession, input: { email: unknown; code: unknown }): Promise<{ verified: true }>`:
  - sem verificação pendente, outro e-mail ou expirada → `{ path: 'code', code: 'VERIFICATION_CODE_INVALID' }`;
  - `verificationAttempts ≥ VERIFICATION_MAX_ATTEMPTS` → `VERIFICATION_LOCKED` (a verificação só volta a ser possível quando o e-mail ou o código expiram: pedir outro código não desbloqueia) e `log.warn`;
  - a tentativa é **contada antes de comparar** o hash, de forma atómica sobre a coluna escalar: `updateMany` condicional com `where { id, verificationAttempts: <valor lido> }` (e `< VERIFICATION_MAX_ATTEMPTS`) que grava `valor lido + 1`; se afetar 0 linhas (confirmações paralelas) relê e repete, e ao atingir o limite → `VERIFICATION_LOCKED`. Só depois se compara;
  - código errado → `VERIFICATION_CODE_INVALID`;
  - certo → `verifiedEmail = emailNormalized`, `emailVerification = {}` e `verificationAttempts = 0`. Comparação do HMAC com `verificationCodeMatches` (tempo constante).

- [ ] **Step 1: Failing tests:**
  - o catálogo tem 13 tipos, `EMAIL_VERIFICATION` com variáveis e exemplo; o HTML por defeito renderiza com os dados de exemplo e não contém `/admin`, `/api/` nem `littlebox-strapi-suite`;
  - `requestEmailVerification` com Resend simulado → um envio para o e-mail, o HTML contém o código e a linha da sessão não contém o código em claro;
  - Resend inativo → `EMAIL_NOT_CONFIGURED`;
  - confirmar com o código certo → `verifiedEmail` normalizado; `isEmailVerified(s, ' Ana@X.pt ')` → verdadeiro;
  - código errado 5 vezes → a 6.ª tentativa, mesmo com o código certo, → `VERIFICATION_LOCKED`;
  - **reenvio não reinicia:** 3 erros, novo `requestEmailVerification` para o mesmo e-mail dentro do TTL, mais 2 erros → a 3.ª tentativa seguinte → `VERIFICATION_LOCKED` (`verificationAttempts` continua em 5); um pedido para outro e-mail começa em 0;
  - **atomicidade:** com `verificationAttempts` em 4, duas confirmações em paralelo (`Promise.all`) com o código errado → no máximo uma é contada como 5.ª tentativa e a outra dá `VERIFICATION_LOCKED`, nunca 6 tentativas comparadas;
  - o `codeHash` gravado não é o SHA-256 simples de `<sessionId>:<email>:<código>` (é o HMAC com o segredo derivado), e trocar o segredo invalida o código pendente;
  - admin: `isEmailTemplateType('EMAIL_VERIFICATION')` → verdadeiro; `EMAIL_TEMPLATE_TYPES` inclui-o;
  - código expirado → `VERIFICATION_CODE_INVALID`; confirmar para outro e-mail → `VERIFICATION_CODE_INVALID`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/email tests/server/ecommerce/storefrontSessions.test.ts` → FAIL.
- [ ] **Step 3:** Modelo, catálogo e os dois métodos.
- [ ] **Step 4:** → PASS; `npm run test:ts:back` e `npm run test:ts:front` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): e-mail verification codes for checkout sessions`

---

### Task 9: Checkout do storefront: cotação, códigos, vale, encomenda, pagamento e estado

**Files:**
- Create: `server/src/services/modules/ecommerce/storefrontCheckout.ts`
- Modify: `server/src/services/index.ts`, `server/src/services/modules/ecommerce/stripePayments.ts` (exporta o helper `hasPendingCompletedStripeSession(orderId)`), `tests/server/ecommerce/helpers/commerceSetup.ts` (regista os três serviços do storefront)
- Test: `tests/server/ecommerce/storefrontCheckout.test.ts`

**Interfaces:**
- `type StorefrontCartInput = { lines; locale; email?; promotionCodes?; giftChoices?; destination?: { country: string; postalCode?: string } | null; shippingMethod?: { providerId: string; serviceId: string } | null }` (a forma é validada no controller, Task 10).
- `quote(s: CheckoutSession, input: StorefrontCartInput): Promise<PublicQuote>`:
  - usa um `price(s, input)` privado (cota sem gravar); `quote` grava o carrinho na sessão (`saveCart`) antes de cotar, para o BFF o recuperar com `GET /cart` mesmo que a cotação falhe;
  - com `destination`: `shippingOptions` = `EcommerceOrderService.quoteForLines({ country, postalCode, lines, locale }).options` (as `failures` não saem); sem `destination` → `null`;
  - `EcommerceOrderService.quote({ …, email, shipping: destination && shippingMethod ? { …destination, …shippingMethod } : null, emailVerified: email ? isEmailVerified(s, email) : false })` e `toPublicQuote`;
  - um carrinho vazio (`lines: []`, permitido nas rotas de cotação, Task 10; é o que acontece depois de `clearCart`) → `PublicQuote` vazio (totais 0) sem chamar o serviço de encomendas.
- `applyDiscount(s, input: StorefrontCartInput & { code: unknown }): Promise<{ code: string; status: PublicCodeStatus; message: string; applied: boolean; quote: PublicQuote }>` (requisito 1.6): cota com `promotionCodes ∪ [code]` (normalizado, ≤ 5) pelo mesmo motor através de `price()` (**sem** `saveCart`); não reserva nada; só quando `applied` grava o carrinho com o código. Um código não aplicado nunca fica gravado.
- `checkStoreCredit(input: { code: unknown; email: unknown }): Promise<{ balance: number; expiresAt: string | null }>`: lê o vale por código e aplica `storeCreditUsable`; qualquer recusa → `EcommerceValidationError` com `toPublicStoreCreditError(code)` em `path 'code'`.
- `type StorefrontOrderInput = { customer: { firstName; lastName; email; phone? }; shippingAddress; billingAddress?: Address | null /* nulo = igual à de entrega */; locale; lines; shippingMethod: { providerId; serviceId }; promotionCodes?; giftChoices?; expectedTotal: number /* obrigatório */; storeCreditCode?: string; notes?: string }`
- `placeOrder(s, input: StorefrontOrderInput, idempotencyKey: string): Promise<{ publicId: string; reference: string; total: number; due: number; paymentStatus: PaymentStatus }>`:
  - `EcommerceOrderService.create({ …, shipping: shippingMethod, idempotencyKey: 'sf:<sessionId>:<idempotencyKey>', emailVerified: isEmailVerified(s, customer.email) }, { actor: 'storefront', source: 'storefront', checkoutSessionId: s.id })`;
  - erros `STORE_CREDIT_*` passam por `toPublicStoreCreditError`; **não** se exige e-mail verificado para o vale (o código é o segredo, ligado ao e-mail; decisão documentada, Global Constraints);
  - os erros de promoções saem do serviço como estão; é `storefrontErrors.ts` (Task 10) que os mascara;
  - depois do sucesso, `clearCart` (falha só registada no log); `due` e `paymentStatus` lidos de `computeOrderState`.
- `paymentLink(s, publicId): Promise<{ url: string; expiresAt: string; amount: number; reused: boolean }>`: `findOwnedOrder` (nulo → `EcommerceNotFoundError`) e `getOrCreatePaymentLink(orderId, { actor: 'storefront' })` (o serviço escolhe `CHECKOUT`/`SUPPLEMENTARY`, reutiliza a sessão válida para o mesmo montante e nunca aceita um valor do frontend); só estes quatro campos saem (nunca o `sessionId` do Stripe).
- `orderStatus(s, publicId): Promise<PublicOrderStatus>`: `findOwnedOrder`, depois monta o `OrderStatusSource` a partir de `EcommerceOrderService.computeOrderState` e das linhas e promoções da encomenda (**não** usa `get()`, que carrega envios, devoluções, faturas e faturação inexistentes numa resposta pública) e chama `toPublicOrderStatus`. `hasPendingStripePayment` vem de `stripePayments.hasPendingCompletedStripeSession(orderId)`: verdadeiro se existe um pagamento `STRIPE` `PENDING` da encomenda cuja `stripe-session` está `COMPLETE` (o `OrderView.payments` não traz o estado da sessão).

- [ ] **Step 1: Failing tests** (`setupCommerce` com os serviços do storefront; Stripe simulado como nos testes de `stripePayments`):
  - **Review Focus 1:** `placeOrder` duas vezes com a mesma chave na mesma sessão → o mesmo `publicId`, um só `ORDER_DEDUCT`; a mesma chave noutra sessão → outro `publicId`, e a encomenda da primeira sessão não aparece na resposta;
  - **Review Focus 2:** `orderStatus` e `paymentLink` com o `publicId` de outra sessão → `EcommerceNotFoundError`, sem chamada ao Stripe;
  - **Review Focus 3:** encomenda criada; a sessão passa a expirada (`expiresAt` no passado) → `resolve` dá `null`; a encomenda continua `OPEN`/`PENDING`, o stock descontado e a redemption `RESERVED`;
  - **Review Focus 4:** `checkStoreCredit` com o código certo e outro e-mail → `STORE_CREDIT_NOT_FOUND`; `placeOrder` com esse vale → `STORE_CREDIT_NOT_FOUND` e nada criado; a resposta da cotação com um código esgotado por cliente → `NOT_ELIGIBLE` e a mensagem `en`;
  - `quote` grava o carrinho; `GET` posterior (`resolve(...).cart`) devolve-o; com `destination` sem método → `shippingOptions` preenchido e `selectedShipping: null`; com método → `totals.shippingTotal` e uma linha de IVA dos portes em `taxes`;
  - `applyDiscount` com `VERAO20` aplicável → `applied: true`, sem redemption criada e o carrinho gravado contém o código; com um código inexistente, ou existente mas não aplicado (ex. `CONDITIONS_NOT_MET`) → o carrinho gravado **não** o contém (nenhum `saveCart` com o código);
  - `quote` e `applyDiscount` com `lines: []` → `PublicQuote` vazio, sem chamar `EcommerceOrderService.quote`;
  - `orderStatus` de uma encomenda com pagamento Stripe `PENDING` e `stripe-session` `COMPLETE` → `paymentResult: 'PROCESSING'`; com a sessão ainda `OPEN` → `UNPAID`; a resposta não contém envios, devoluções, faturas nem histórico;
  - promoção com `perCustomerLimit: 1` e o e-mail de um cliente que já comprou, sem verificação → `EMAIL_NOT_VERIFIED` (igual ao de um e-mail que nunca comprou);
  - vale de um cliente, `placeOrder` com o e-mail do vale **sem** verificar o e-mail → criada e paga com o vale (não exige verificação);
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

**Policy `check-storefront-token`:** `Authorization` tem de começar por `Bearer ` (senão `false`); `t = valor.slice('Bearer '.length)` → `strapi.service('admin::api-token')`: `hash(t)`, `getByAccessKey`; aceite só se `Number(token.id) === storefrontApiTokenId` das definições (não nulo), `kind` for `content-api` ou nulo (os tokens de tipo admin partilham `getByAccessKey` e são recusados) e, se `expiresAt` existir, `new Date(expiresAt).getTime() > Date.now()` (não se copia a comparação de `check-api-token`); qualquer outra coisa → `false` (403 do Strapi). Não lê `X-Storefront-Client-IP` nem conta nada. Os testes fazem de `strapi.service` o acessor que o código usa.

**Rotas** (todas com `auth: false`, `policies: ['check-storefront-token']`, `middlewares: ['plugin::littlebox-strapi-suite.check-module-is-active']`; prefixo `/ecommerce/storefront`; `S` = sessão obrigatória):

| Método | Path | S | Regra | Corpo / resposta |
|---|---|---|---|---|
| GET | `/products?page=&pageSize=&search=&sort=&locale=` | — | `catalog` | `{ results, pagination }` |
| GET | `/products/:slug?locale=` | — | `catalog` | `PublicProduct` |
| POST | `/checkout/session` | opcional | `session.create` | 201 `{ token, expiresAt }` ou 200 `{ token: null, expiresAt, reused: true }` |
| GET | `/cart` | S | `cart.quote` | `StoredCart` |
| POST | `/cart/quote` | S | `cart.quote` | `StorefrontCartInput` (0–100 linhas; vazio → `PublicQuote` vazio) → `PublicQuote` |
| POST | `/discounts/apply` | S | `discount.apply` | `StorefrontCartInput & { code }` (0–100 linhas) → resultado |
| POST | `/store-credit/check` | S | `storeCredit.check` | `{ code, email }` → `{ balance, expiresAt }` |
| POST | `/checkout/email-verification` | S | `email.send` | `{ email, locale }` → 202 `{ expiresAt }` |
| POST | `/checkout/email-verification/confirm` | S | `email.confirm` | `{ email, code }` → `{ verified: true }` |
| POST | `/orders` | S | `order.create` | `StorefrontOrderInput` + `Idempotency-Key` → 201 |
| POST | `/orders/:publicId/payment` | S | `order.read` | → `{ url, expiresAt, amount, reused }` |
| GET | `/orders/:publicId/status` | S | `order.read` | `PublicOrderStatus` |

- **Controller:** um `rateLimiter` por processo (`createRateLimiter()`); para cada pedido, `rateKeys(regra, { sessionId, ip: clientIpFrom(cabeçalho X-Storefront-Client-IP), email })` (o `X-Forwarded-For` nunca é lido; `email` = o do corpo, só nas rotas `email.send` e `email.confirm`) e `hit` em todas as chaves; recusa → 429 `{ code: 'RATE_LIMITED', retryAfter }` + `Retry-After` e `log.warn` com a regra. Nas rotas `S`, a sessão é resolvida antes do limite por sessão; sessão nula → 401 `SESSION_INVALID`. `POST /checkout/session` lê o cabeçalho opcional.
- **Nota (revisão da Task 4, fix round 1):** as chaves por IP são normalizadas por `rateKeys` (`ipRateKeyPart`): IPv6 mapeado em IPv4 (`::ffff:a.b.c.d`) → o IPv4; outro IPv6 → o prefixo /64. Sem um `X-Storefront-Client-IP` válido, `session.create` conta num único balde partilhado `session.create:ip:unknown` (20 / 60 min para a loja toda), para que um BFF que se esqueça do cabeçalho não crie sessões ilimitadas; as outras regras continuam sem chave de IP (Review Focus 5). O contrato do BFF (`docs/ecommerce/storefront-api.md`) documenta as duas coisas. As chaves com e-mail (SHA-256 sem sal) nunca vão para o log. Os nomes de promoções públicos nunca usam o `name` interno: `displayName[locale]` → `displayName[defaultLocale]` → "Promotion"/"Promoção" (`publicPromotionName`).
- **Validação de entrada** (`validation.ts` reutilizado; mensagem `'Invalid request'`): `lines` com `variantId` e `quantity` inteiros em `[1, 1000]`: 0–100 em `/cart/quote` e `/discounts/apply` (a lista vazia dá uma cotação vazia), 1–100 em `/orders`; `promotionFields` (Task 10 do plano 6) para códigos, `giftChoices` e `expectedTotal`; em `/orders` o `expectedTotal` é obrigatório; `Idempotency-Key` obrigatório, 8–100 caracteres `[A-Za-z0-9_:-]` (senão 400 `invalid_idempotency_key`); `email` ≤ 254; `code` de promoção ≤ 40 e de vale ≤ 64; `country` `^[A-Z]{2}$`; `postalCode` ≤ 20; `notes` ≤ 1000; `locale` via `resolveLocale`; `:publicId` UUID. Campos desconhecidos são ignorados (nunca passados aos serviços: preços, descontos, estados ou stock vindos do pedido não existem na entrada).
- **`handleStorefrontError(ctx, err)`:** validação → 400/409 como `handleDomainError` com `withCode: true`, com `ACTION_NOT_AVAILABLE` também em 409. **Máscara dos códigos** (só aqui; `orders.ts` e o admin não mudam): os erros de promoções vindos de `create` (`PROMOTION_CODE_INVALID` com o `CodeStatus` em bruto, `PROMOTION_UNAVAILABLE` com `path` `promotions.<id>`) nunca saem como estão. Cada um sai como `{ path: 'promotionCodes.<i>', code: 'PROMOTION_CODE_INVALID', detail: toPublicCodeStatus(status) }` (400), com `<i>` o índice do código introduzido; só `USAGE_LIMIT_REACHED` sai como 409 `PROMOTION_UNAVAILABLE`; nunca sai um id de promoção, `CUSTOMER_LIMIT_REACHED`, `EMAIL_NOT_ELIGIBLE`, `INACTIVE` nem `SCHEDULED`; `EcommerceNotFoundError` → 404 `ORDER_NOT_FOUND` nas rotas de encomenda, `NOT_FOUND` no catálogo; `EcommercePaymentError`: `STRIPE_NOT_CONFIGURED`, `STOREFRONT_URL_MISSING` → 503; `STRIPE_UNREACHABLE`, `STRIPE_REQUEST_FAILED` → 502; `NOTHING_DUE`, `PAYMENT_PENDING` → 409; `EcommerceEmailError` `EMAIL_NOT_CONFIGURED` → 503, `EMAIL_SEND_FAILED` → 502; `EcommerceCarrierError` → 502; outro → relançado (500 genérico do Strapi, sem detalhes).
- **`docs/ecommerce/storefront-api.md`** (contrato do BFF, requisitos 2.4, 2.15 e design 8): criação do token `custom` sem permissões e escolha nas Configurações; cabeçalhos; o cookie do BFF (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `localStorage`) e a proteção CSRF no BFF (token anti-CSRF ou verificação de `Origin` nas operações que alteram dados; `SameSite` não chega); **a API do storefront é só servidor a servidor: o browser nunca a chama** (o token do BFF nunca vai para o browser, não se configura CORS para ela e as origens do storefront não se acrescentam ao `strapi::cors`); o `X-Storefront-Client-IP`: o BFF **sobrescreve** sempre o cabeçalho com o IP do browser (um só IP) e nunca reencaminha o valor que o browser enviou, o Strapi ignora o `X-Forwarded-For`, e sem o cabeçalho só há limites por sessão e por e-mail; o vale de crédito no checkout não exige e-mail verificado (o código de 12 caracteres é o segredo, ligado ao e-mail do vale, e as rotas estão limitadas); a tabela de rotas, regras e códigos de erro; o fluxo de checkout (sessão → cotação → verificação de e-mail quando pedida → encomenda com `expectedTotal` → pagamento → página de sucesso com `?order=<publicId>` → estado); a página de sucesso não prova o pagamento; as imagens relativas servidas pelo BFF; rate limiting válido só com uma instância; sem link de acesso por e-mail nesta versão (design 4.13).

- [ ] **Step 1: Failing tests:**
  - policy: sem cabeçalho, cabeçalho sem o prefixo `Bearer ` (o token cru), token desconhecido, token expirado (`expiresAt` como texto ISO no passado) e token válido mas não escolhido (id diferente, incluindo o `read-only` dos outros módulos) → `false`; token de `kind` admin → `false`; o escolhido (`content-api`, incluindo `custom`, com `id` numérico ou em texto) → `true`; com `expiresAt` no futuro → `true`; sem `storefrontApiTokenId` → `false`;
  - rotas: as 12 com o handler, `auth: false`, a policy e o middleware certos; todas incluídas em `content-api.ts`; as rotas antigas de `content-api.ts` mantêm-se iguais (mesmo número e `check-api-token`);
  - **Review Focus 5:** controller com um limitador real e relógio fixo: 1000 `GET /products` sem `X-Storefront-Client-IP` → nenhum 429, mesmo com `X-Forwarded-For` diferente em cada pedido; com `X-Storefront-Client-IP: 203.0.113.7` → o 601.º é 429 com `Retry-After` e `details.code 'RATE_LIMITED'`; com `X-Forwarded-For: 203.0.113.7` e sem o cabeçalho próprio → nenhum limite por IP;
  - e-mail: 6 `POST /checkout/email-verification` para o mesmo e-mail em sessões diferentes (IP diferente) → o 6.º é 429 (regra `email.send` por e-mail); idem `confirm`;
  - **máscara em `POST /orders`:** código com `CUSTOMER_LIMIT_REACHED` (e-mail que já comprou) e código restrito a uma lista de e-mails com outro e-mail (`EMAIL_NOT_ELIGIBLE`) → a mesma resposta 400 `PROMOTION_CODE_INVALID` com `detail 'NOT_ELIGIBLE'` e `path 'promotionCodes.0'`; código desativado ou agendado → `detail 'NOT_FOUND'`; só `USAGE_LIMIT_REACHED` → 409 `PROMOTION_UNAVAILABLE`; o corpo não contém `promotions.` nem ids de promoção;
  - `/cart/quote` e `/discounts/apply` com `lines: []` → 200 com cotação vazia; `/orders` com `lines: []` → 400;
  - `order.create`: a 6.ª criação na mesma sessão em 10 min → 429;
  - sem `X-Checkout-Session` numa rota `S` → 401 `SESSION_INVALID`;
  - `/orders` sem `Idempotency-Key` → 400 `invalid_idempotency_key`; sem `expectedTotal` → 400; `lines` com `quantity 0` → 400; um campo `unitPrice` no corpo não chega ao serviço;
  - `STRIPE_NOT_CONFIGURED` → 503; `NOTHING_DUE` → 409; `ORDER_NOT_FOUND` → 404;
  - nenhuma resposta de sucesso dos testes contém `/admin` nem `littlebox-strapi-suite`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/storefrontPolicy.test.ts tests/server/ecommerce/storefrontRoutes.test.ts tests/server/ecommerce/storefrontController.test.ts` → FAIL.
- [ ] **Step 3:** Policy, controller, erros, rotas e o documento.
- [ ] **Step 4:** → PASS; `npm run test:ts:back` limpo; `npx vitest run` verde.
- [ ] **Step 5: Commit** `feat(ecommerce): storefront API routes with BFF token, sessions and rate limits`

---

### Task 11: Admin: secção "Storefront" nas Configurações

**Files:**
- Create: `admin/src/ecommerce/pages/settings/StorefrontSettings.tsx`, `admin/src/ecommerce/utils/storefrontSettings.ts`
- Modify: `server/src/routes/ecommerce/admin-settings.ts` (`GET /storefront/api-tokens`), `server/src/controllers/modules/ecommerce/settings.ts` (`listApiTokens`), `admin/src/ecommerce/settingsTypes.ts` (`StoreSettings` ganha `storefrontApiTokenId?: number | null` e `checkoutSessionTtlHours?: number`, **opcionais** no tipo do admin), `admin/src/ecommerce/utils/settingsForm.ts` (`buildStoreSettingsInput` passa os dois campos do valor carregado, para o `PUT /store` das outras secções não os perder), o gateway das definições (`listApiTokens`), `admin/src/ecommerce/pages/settings/SettingsPage.tsx` (`SETTINGS_SECTIONS` + `'storefront'`), `admin/src/core/translations/{en,pt}.json`
- Test: `tests/admin/ecommerce/storefrontSettings.test.ts`, `tests/admin/ecommerce/settingsForm.test.ts` (o fixture tipado `StoreSettings` e `buildStoreSettingsInput` passam a cobrir os dois campos), `tests/server/ecommerce/settingsRoutes.test.ts` e `settingsController.test.ts` (acrescentar)

**Interfaces:**
- `GET /admin/ecommerce/settings/storefront/api-tokens` (`settingsRead`) → `{ id: number; name: string; type: 'read-only' | 'full-access' | 'custom'; expiresAt: string | null }[]` de `admin::api-token.list(ctx.state.user)` (o serviço exige o utilizador admin que chama; um admin que não seja super admin só vê os tokens que criou ou sem dono; nunca `accessKey` nem permissões).
- `storefrontSettings.ts`: `tokenWarning(token: { type; expiresAt } | null, now: Date): 'FULL_ACCESS' | 'READ_ONLY' | 'EXPIRES_SOON' | 'EXPIRED' | null` (`read-only` → `READ_ONLY`: é o token do site público, que não deve conduzir o checkout; expira em menos de 14 dias → `EXPIRES_SOON`); `storefrontBasePath = '/api/littlebox-strapi-suite/ecommerce/storefront'`; `validateTtlHours(raw: string): number | 'invalid_number'`.
- **Ecrã** (separador "Storefront" / "Storefront", entre "General" e "Payments"):
  - texto curto sobre o BFF ("Only your storefront server calls this API. Never put this token in the browser." / "Só o servidor do seu storefront chama esta API. Nunca coloque este token no browser.");
  - `SingleSelect` do token (nome e tipo), com aviso para `full-access` e para `read-only` ("Prefer a custom token with no permissions" / "Prefira um token personalizado sem permissões"; o `read-only` é o que o site público usa para os menus) e para tokens a expirar; sem tokens → `EmptySection` com a ilustração existente, o texto "No API tokens yet." / "Ainda não existem API tokens." e o link para *Settings → API Tokens* do Strapi;
  - "Session lifetime (hours)" / "Validade das sessões (horas)", 1–720;
  - bloco de leitura com o caminho base e os cabeçalhos (`Authorization`, `X-Checkout-Session`, `Idempotency-Key`, `X-Storefront-Client-IP`), como o `StripeWebhookInfo`;
  - grava com `PUT /store` (`storefrontApiTokenId`, `checkoutSessionTtlHours`); `invalid_token` e `invalid_number` traduzidos; só leitura sem `settings.manage`.

- [ ] **Step 1: Failing tests:** a rota tem `settingsRead`; `listApiTokens` não devolve `accessKey` e chama o serviço com o utilizador do pedido; `tokenWarning` para `full-access`, `read-only` (`READ_ONLY`), expirado, a expirar em 3 dias e `custom` sem validade (`null`); `validateTtlHours('0')` e `'abc'` → `invalid_number`, `'24'` → 24; `SETTINGS_SECTIONS` inclui `'storefront'` na segunda posição; `buildStoreSettingsInput` de um `StoreSettings` com `storefrontApiTokenId: 5` e `checkoutSessionTtlHours: 24` mantém os dois valores (e sem eles compila e não os inventa).
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
  12. Rate limiting: 21 `POST /checkout/session` com `X-Storefront-Client-IP: 203.0.113.7` → o 21.º é 429 com `Retry-After`; 30 pedidos de catálogo sem esse cabeçalho (e com `X-Forwarded-For` variável) → nenhum 429; 6 pedidos de verificação de e-mail para o mesmo e-mail → o 6.º é 429.
  12b. Retenção: com sessões expiradas na tabela (`UPDATE … expires_at` no passado, mais de 100), abrir uma sessão apaga no máximo 100 por chamada; a sessão expirada com encomenda fica sem `cart` nem e-mail.
  13. Procurar `/admin`, `localhost:1337` e `littlebox-strapi-suite` em todas as respostas guardadas pelo script → nenhuma ocorrência (as imagens do provider local aparecem como `/uploads/...`).
  14. Os módulos antigos (Menus, Slugs, Traduções) continuam a responder como antes.
- [ ] Acrescentar a `docs/superpowers/plans/ecommerce-followups.md` (secção "Plan 7") os pendentes encontrados e estes, já conhecidos:
  - as linhas de `checkout-session` expiradas são apagadas de forma oportunista (até 100 por abertura de sessão, sem cron); as que têm encomendas ficam esvaziadas mas não são apagadas, e se o tráfego de novas sessões for nulo as expiradas só são tratadas na abertura seguinte;
  - o rate limiting e os contadores vivem na memória de uma instância (design 9.2); com várias instâncias seria preciso um armazenamento partilhado;
  - o link seguro de acesso à encomenda por e-mail (requisito 2.14) continua por implementar (design 4.13);
  - a ordenação do catálogo por preço e nome é feita em memória: rever se o catálogo passar de alguns milhares de produtos.
- [ ] Commit de correções: `chore(ecommerce): plan 7 verification fixes`
