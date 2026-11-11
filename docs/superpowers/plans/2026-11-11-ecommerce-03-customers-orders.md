# E-commerce, plano 3: Clientes e núcleo das Encomendas (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os **Clientes** (identificação automática por e-mail, listagem, ficha, edição) e o **núcleo das Encomendas**:
- os três estados independentes;
- o cálculo financeiro;
- o stock com *ledger* de movimentos;
- a criação manual de encomendas;
- os pagamentos manuais;
- a modificação de encomendas, com stock, portes e simulação;
- o cancelamento e o arquivamento;
- o histórico;
- o ecrã de gestão da encomenda.

Expedições, faturação, Stripe, reembolsos, devoluções, vales e notificações por e-mail ficam para o plano 4. Promoções ficam para o plano 5.

**Architecture:** As regras ficam em **funções puras** de domínio, testadas exaustivamente:
- totais e resumo financeiro;
- `PaymentStatus` e `FulfillmentStatus`;
- ações disponíveis;
- transições de estado;
- simulação de modificação.

Os serviços Strapi orquestram transações, persistência, stock e histórico. Um **bus de eventos** em memória entrega os eventos de domínio **depois do commit**; o plano 4 liga-lhe as notificações. Um **serviço central de portes** devolve opções a partir dos métodos manuais (plano 2) e expõe um ponto de registo para transportadoras (plano 4).

**Tech Stack:** Strapi 5 (Query Engine + knex portável para incrementos de stock), React + `@strapi/design-system` v2, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (secções 2.x, 4.1, 4.8, 4.9, 4.10, 4.11, 4.12, 5, 9.2) e, em `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`, os pontos 1 a 10, 14, 16 e 17 do capítulo Encomendas.

## Global Constraints

- Tudo das Global Constraints dos planos 1 e 2 continua a valer:
  - alterações aditivas;
  - content-types ocultas;
  - prefixo `ltb-st-module-ecommerce-*`;
  - nomes em inglês;
  - dinheiro em cêntimos inteiros (EUR);
  - proibido `@strapi/utils` no servidor;
  - erros de domínio com as classes do plugin;
  - `en` + `pt` na interface;
  - ilustrações no estilo definido.
- **Colunas JSON recebem sempre objeto, array ou `null`**, nunca escalares soltos (MariaDB `json_valid`). O `tests/server/ecommerce/helpers/fakeDb.ts` impõe esta regra.
- Bases de dados: SQLite, Postgres e MySQL/MariaDB. O cliente usa MariaDB. Só Query Engine ou knex portável.
- **Identificadores técnicos estáveis em inglês:**
  - `OrderStatus = OPEN | ARCHIVED | CANCELLED`
  - `PaymentStatus = PENDING | PARTIALLY_PAID | PAID | PARTIALLY_REFUNDED | REFUNDED`
  - `FulfillmentStatus = UNFULFILLED | PARTIALLY_FULFILLED | FULFILLED`
  - pagamento individual: `PENDING | COMPLETED | CANCELLED | FAILED`
  - Nunca usar traduções na lógica.
- **Concorrência (design 9.2, decisão):**
  - stock sem mecanismo de concorrência: valida e depois desconta com incremento relativo (`stock = stock - n`); pode ficar negativo;
  - clientes sem índice único: procurar o mais antigo com o e-mail normalizado ou criar;
  - idempotência por `operationKey` / `idempotencyKey` únicos.
- **Stock negativo é aceite** ao gravar um produto (corrige o pendente do plano 1). O formulário de produto deixa de escrever `stock` absoluto em variantes existentes: a edição de stock passa a ser um **ajuste** (movimento `MANUAL_ADJUST` com delta). Detalhe na Task 4.
- **`PaymentStatus` (design 4.10):** com `paid` = liquidados, `refunded` = reembolsos concluídos (0 neste plano), `net = paid − refunded` e `total` = total atual:
  1. `refunded>0 && net<=0` → `REFUNDED`
  2. `refunded>0` → `PARTIALLY_REFUNDED`
  3. `paid==0` → `PENDING`
  4. `net<total` → `PARTIALLY_PAID`
  5. senão `PAID`
- **Totais:**
  - `effectiveQty = quantity − returnedQuantity`
  - `itemsOriginal = Σ unitPrice·effectiveQty`
  - `productDiscount = Σ unitDiscount·effectiveQty`
  - `subtotal = itemsOriginal − productDiscount`
  - `orderDiscount` guardado (≤ subtotal)
  - `shippingTotal = shippingOriginal − shippingDiscount`
  - `total = subtotal − orderDiscount + shippingTotal`
  - `due = max(0, total − net)`
  - `excess = max(0, net − total)`
  - Todos os preços incluem IVA.
- **Referência da encomenda:** inteiro sequencial a partir de `1001`, mostrado como `#1001`. A referência pública opaca `publicId` é gerada com `crypto.randomUUID()`.
- O `locale` da encomenda é guardado. Cada linha guarda o snapshot de `name`, `option`, `sku`, `unitPrice`, `tax` e `imageUrl` nesse locale.
- **Histórico só de inserção.** Cada entrada tem:
  - `type`, `description` (texto em inglês legível)
  - `previousValue` / `newValue` (objeto)
  - `actor` (`user:<id>` | `system` | `storefront` | `webhook:<provider>`)
  - `operationId`
- **Eventos de domínio** emitidos depois do commit, com `id` único (`crypto.randomUUID()`): `ORDER_CREATED`, `PAYMENT_COMPLETED`, `ORDER_MODIFIED`, `ORDER_CANCELLED`, `ORDER_ARCHIVED`, `STOCK_MOVED`.
- Permissões novas: `ecommerce.orders.read`, `ecommerce.orders.manage`, `ecommerce.customers.read`, `ecommerce.customers.manage`.
- Listagens com 50 por página, paginação no servidor.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/ecommerce`.

## Review Focus

1. **Modificar reduzindo uma quantidade abaixo do já enviado:** rejeitado com `QUANTITY_BELOW_SHIPPED`. Neste plano não há expedições, mas a regra fica no domínio e é testada com expedições simuladas. Teste na Task 6.
2. **Cancelar duas vezes (duplo clique):** o stock é reposto uma única vez. Teste na Task 8 (`operationKey` determinístico `cancel:<orderId>:<variantId>`).
3. **Pagamento manual registado duas vezes com a mesma referência e o mesmo `idempotencyKey`** (clique duplo): fica um só pagamento. Teste na Task 8.
4. **Encomenda paga e modificada para um total maior:** passa a `PARTIALLY_PAID`, `due` é a diferença e o `FulfillmentStatus` não muda. Teste na Task 2.
5. **Cliente muda o e-mail na ficha:** as encomendas antigas mantêm o snapshot do e-mail original, e a pesquisa por e-mail encontra o cliente pelo novo. Teste na Task 5.

---

### Task 1: Content-types, UIDs e permissões de clientes e encomendas

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{customer,order,order-line,payment,stock-movement,order-history}/{schema.json,index.ts}`
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (UIDs `customer`, `order`, `orderLine`, `payment`, `stockMovement`, `orderHistory`), `server/src/services/modules/ecommerce/permissions.ts` (`ordersRead`, `ordersManage`, `customersRead`, `customersManage`)
- Test: `tests/server/ecommerce/ordersContentTypes.test.ts`, `tests/server/ecommerce/permissions.test.ts`

**Interfaces (atributos):**
- `customer`: `firstName`, `lastName` (string, required), `email` (string, required), `emailNormalized` (string, required; índice não único `ecommerce_customer_email_idx`), `phone` (string), `orders` oneToMany → order.
- `order`:
  - **identificação:** `reference` (integer, required, unique), `publicId` (string, required, unique), `customer` manyToOne, `locale` (string, required)
  - **estados:** `orderStatus` (enumeration `OPEN,ARCHIVED,CANCELLED`, default `OPEN`), `paymentStatus` (enumeration dos 5, default `PENDING`), `fulfillmentStatus` (enumeration dos 3, default `UNFULFILLED`)
  - **snapshots (json):** `customerSnapshot` `{firstName,lastName,email,phone}`, `shippingAddress`, `billingAddress` (`{firstName,lastName,company,nif,line1,line2,postalCode,city,country,phone}`)
  - **valores (integers):** `currency` (string, default `EUR`), `itemsOriginal`, `productDiscount`, `subtotal`, `orderDiscount`, `shippingOriginal`, `shippingDiscount`, `shippingTotal`, `total`
  - **portes:** `shippingTax` (decimal), `shippingMethod` (json `{providerId, serviceId, name, price, tax}`)
  - **outros:** `promotions` (json array, default `[]`; preenchido no plano 5), `source` (enumeration `admin,storefront`), `notes` (text), `idempotencyKey` (string, unique), `cancelledAt`, `archivedAt` (datetime)
  - **relações:** `lines`, `payments`, `history` oneToMany
- `order-line`: `order` manyToOne, `variant` manyToOne (opcional), `variantId`, `productId` (integer), `sku`, `name`, `option` (string), `imageUrl` (string), `unitPrice`, `unitDiscount` (integer, default 0), `quantity` (integer, required), `returnedQuantity` (integer, default 0), `tax` (decimal), `isGift` (boolean, default false), `promotionRefs` (json array, default `[]`), `position` (integer).
- `payment`: `order` manyToOne, `method` (enumeration `STRIPE,MANUAL,STORE_CREDIT`), `status` (enumeration `PENDING,COMPLETED,CANCELLED,FAILED`), `amount` (integer, required), `currency` (string), `reference`, `externalId` (string), `idempotencyKey` (string, unique), `coverage` (json, ver design 4.4), `completedAt` (datetime), `actor` (string), `metadata` (json).
- `stock-movement`: `variant` manyToOne, `variantId` (integer), `order` manyToOne (opcional), `type` (enumeration `ORDER_DEDUCT,ORDER_RESTOCK,CANCEL_RESTOCK,RETURN_RESTOCK,RETURN_NO_RESTOCK,MANUAL_ADJUST`), `quantity` (integer, com sinal: negativo = sai do stock), `operationKey` (string, required, unique), `reason` (string), `actor` (string).
- `order-history`: `order` manyToOne, `type` (string, required), `description` (text), `previousValue` (json), `newValue` (json), `actor` (string), `operationId` (string).
- Relações inversas declaradas nos dois lados. Todas ocultas e sem draft/publish.
- [ ] TDD como no plano 2, Task 2. **Commit** `feat(ecommerce): customers and orders content-types and permissions`

---

### Task 2: Domínio puro das encomendas

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/orders.ts`
- Test: `tests/server/ecommerce/domain/orders.test.ts`

**Interfaces:**
- Tipos exportados: `OrderStatus`, `PaymentStatus`, `FulfillmentStatus`, `PaymentRecordStatus` (as constantes das Global Constraints, também como arrays `ORDER_STATUSES` …).
- `type LineAmounts = { unitPrice: number; unitDiscount: number; quantity: number; returnedQuantity: number }`
- `computeTotals(lines: LineAmounts[], order: { orderDiscount: number; shippingOriginal: number; shippingDiscount: number }): { itemsOriginal; productDiscount; subtotal; orderDiscount /* limitado a subtotal */; shippingTotal; total }`
- `type PaymentLike = { status: PaymentRecordStatus; amount: number }`
- `type RefundLike = { status: 'COMPLETED' | string; amount: number; kind: 'MONEY' | 'STORE_CREDIT' }`. Os reembolsos de vale contam como `refunded` (design 4.10).
- `financialSummary(total: number, payments: PaymentLike[], refunds: RefundLike[]): { total; paid; pendingPayments; refunded; net; due; excess }`. Os pendentes não contam.
- `derivePaymentStatus(summary): PaymentStatus` (regra das Global Constraints)
- `type ShipmentLike = { status: 'ACTIVE' | 'CANCELLED'; items: { orderLineId: number; quantity: number }[]; delivered: boolean }`
- `shippedQuantities(shipments: ShipmentLike[]): Map<number, number>` (ignora os `CANCELLED`)
- `deriveFulfillmentStatus(lines: { id: number; quantity: number }[], shipped: Map<number, number>): FulfillmentStatus`. Usa `quantity` encomendada, não `effectiveQty` (design 4.12). Sem linhas → `UNFULFILLED`.
- `canTransition(from: OrderStatus, to: OrderStatus): boolean`. Só `OPEN→CANCELLED` e `OPEN→ARCHIVED`.
- `type OrderActionKey = 'SHIP' | 'MODIFY' | 'CANCEL' | 'REFUND' | 'ADD_PAYMENT' | 'SEND_PAYMENT_INSTRUCTIONS' | 'ARCHIVE' | 'REGISTER_RETURN' | 'INVOICE_TOTAL'`
- `availableActions(input: { orderStatus; paymentStatus; fulfillmentStatus; summary; hasUnshippedQuantity: boolean; hasShippedUnreturned: boolean; allShipmentsDelivered: boolean; hasPendingPayments: boolean; hasPendingRefunds: boolean; hasUninvoicedCompletedPayments: boolean }): OrderActionKey[]`. Regras (requisitos 10.x e design 4.1 e 4.5):
  - `SHIP`: `OPEN` && `PAID` && `hasUnshippedQuantity`
  - `MODIFY`: `OPEN` && fulfillment ≠ `FULFILLED`
  - `CANCEL`: `OPEN`
  - `REFUND`: `summary.excess > 0`. Inclui encomendas canceladas: aí o total passa a contar como 0 (ver `financialSummary` com `orderCancelled`).
  - `ADD_PAYMENT`: `OPEN` && `due > 0`
  - `SEND_PAYMENT_INSTRUCTIONS`: `OPEN` && `due > 0`
  - `ARCHIVE`: `OPEN` && `FULFILLED` && `allShipmentsDelivered` && `due == 0` && `excess == 0` && `!hasPendingPayments` && `!hasPendingRefunds`
  - `REGISTER_RETURN`: `hasShippedUnreturned` && orderStatus ≠ `ARCHIVED`
  - `INVOICE_TOTAL`: `hasUninvoicedCompletedPayments` && `OPEN`
- `financialSummary` aceita uma opção `{ orderCancelled?: boolean }`. Quando é verdadeira, `total` passa a 0 para efeitos de `due` e `excess` (o dinheiro pago fica todo elegível para devolução e nada fica em dívida), e o `total` original é devolvido à parte como `orderTotal`. **[Escolha técnica]** Coerente com os requisitos 10.7 e 15.3.
- [ ] **Step 1: Failing tests** (valores exatos):
  - `computeTotals` com 2×50 € (`5000`), desconto de linha `1000`/un., `orderDiscount 1300`, portes `800` com desconto `800` → `itemsOriginal 10000`, `productDiscount 2000`, `subtotal 8000`, `orderDiscount 1300`, `shippingTotal 0`, `total 6700`.
  - `orderDiscount` maior que o subtotal → limitado.
  - Linha com `returnedQuantity 1` de 2 → conta 1.
  - `financialSummary(12500, [COMPLETED 10000, PENDING 2500], [])` → `paid 10000`, `pendingPayments 2500`, `due 2500`, `PARTIALLY_PAID`.
  - Pago 10000, total 10000 e reembolso COMPLETED 10000 → `REFUNDED`.
  - Pago 10000, reembolso 3000 e total 7000 → `PARTIALLY_REFUNDED`, `due 0`.
  - Review Focus 4: pago 10000, total passa a 12500 → `PARTIALLY_PAID`, `due 2500`.
  - `deriveFulfillmentStatus`: 10 encomendadas e 4 enviadas → `PARTIALLY_FULFILLED`; 10/10 → `FULFILLED`; depois de acrescentar uma linha → `PARTIALLY_FULFILLED`; expedição `CANCELLED` ignorada.
  - `canTransition` tabela completa (9 pares).
  - `availableActions` para:
    - encomenda nova não paga → `[MODIFY, CANCEL, ADD_PAYMENT, SEND_PAYMENT_INSTRUCTIONS]`
    - paga e não enviada → inclui `SHIP`, não inclui `ADD_PAYMENT`
    - `FULFILLED` sem todas entregues → sem `ARCHIVE`
    - `FULFILLED` com todas entregues e saldo 0 → inclui `ARCHIVE`
    - cancelada e paga → `[REFUND]` (mais `REGISTER_RETURN` se houver enviadas)
    - arquivada → `[]`
- [ ] **Steps 2–5:** RED → implement → GREEN → **Commit** `feat(ecommerce): order domain rules (totals, statuses, actions)`

---

### Task 3: Simulação de modificação (domínio puro)

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/orderModification.ts`
- Test: `tests/server/ecommerce/domain/orderModification.test.ts`

**Interfaces:**
- `type ExistingLine = LineAmounts & { id: number; variantId: number; sku: string; name: string; option: string; tax: number; shipped: number; isGift: boolean }`
- `type ModificationInput = { lines: { orderLineId?: number; variantId: number; quantity: number }[]; shipping: { mode: 'KEEP' } | { mode: 'RECALCULATE'; quote: number /* cotação nova só para o pendente */; previousShipmentsCost: number } | { mode: 'MANUAL'; amount: number }; addresses?: { shipping?: Address; billing?: Address } }`
- `type CatalogVariant = { variantId; sku; name; option; unitPrice; tax; imageUrl; stock; active }`
- `simulateModification(current: { lines: ExistingLine[]; orderDiscount; shippingOriginal; shippingDiscount; payments: PaymentLike[]; refunds: RefundLike[] }, input: ModificationInput, catalog: Map<number, CatalogVariant>): ModificationResult`, com:
  - `type ModificationResult = { errors: { path: string; code: 'QUANTITY_BELOW_SHIPPED' | 'INSUFFICIENT_STOCK' | 'VARIANT_UNAVAILABLE' | 'INVALID_QUANTITY' | 'INVALID_AMOUNT' }[]; before: Totals & { paid; due; excess }; after: Totals & { paid; due; excess }; lineChanges: { kind: 'ADDED' | 'REMOVED' | 'QUANTITY_CHANGED' | 'UNCHANGED'; orderLineId?; variantId; previousQuantity; newQuantity }[]; stockMovements: { variantId; quantity /* com sinal */ }[]; shipping: { mode; previousCharged; newCharged; previousShipmentsCost?; quote? }; discountWarnings: { code: 'ORDER_DISCOUNT_CAPPED' }[]; outcome: 'DUE' | 'REFUNDABLE' | 'NONE'; difference: number }`
  - **Regras (design 4.8 e requisito 16):**
    - Linhas existentes mantêm `unitPrice` e `unitDiscount`.
    - Linhas novas usam o preço atual do catálogo com `unitDiscount 0`.
    - Remover uma linha = quantidade 0.
    - Uma quantidade abaixo de `shipped` dá `QUANTITY_BELOW_SHIPPED`.
    - Aumentos validam `stock >= aumento`, senão `INSUFFICIENT_STOCK`.
    - Variante inativa ou ausente numa linha **nova** dá `VARIANT_UNAVAILABLE`.
    - `orderDiscount` mantém o valor, limitado ao novo subtotal, com aviso.
    - Portes:
      - `KEEP` = mantém os portes cobrados;
      - `RECALCULATE`: `newCharged = previousShipmentsCost + quote` e o desconto de portes passa a 0;
      - `MANUAL`: `amount` ≥ 0, também com desconto 0.
    - Linhas de oferta (`isGift`) não podem ser alteradas: `INVALID_QUANTITY`.
- [ ] **Step 1: Failing tests:**
  - O exemplo do requisito 16.5.2: portes 1000, expedições 600, cotação 800 → 1400, diferença +400.
  - O exemplo 16.7: pago 10000, mais 2500 em produto e +400 de portes → `due 2900`, `outcome DUE`.
  - O exemplo 16.9: remove 3000 → `REFUNDABLE 3000`.
  - Review Focus 1.
  - Stock insuficiente.
  - Movimentos previstos 2→5 dão `-3` e 5→3 dão `+2`.
  - `KEEP` sem alteração de linhas → `NONE`.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): order modification simulation`

---

### Task 4: Serviço de stock, ajustes manuais e stock negativo nos produtos

**Files:**
- Create: `server/src/services/modules/ecommerce/stock.ts` (`EcommerceStockService`)
- Modify: `server/src/services/modules/ecommerce/domain/catalog.ts` (`stock` aceita qualquer inteiro, incluindo negativo), `server/src/services/modules/ecommerce/products.ts` (variantes **existentes**: `stock` passa a ser ignorado no `update`; o novo campo opcional `stockAdjustment` (inteiro ≠ 0) gera um `MANUAL_ADJUST`; variantes **novas** continuam a aceitar `stock` inicial), os tipos admin, `admin/src/ecommerce/components/VariantModal.tsx` e `utils/variantDraft.ts` (variantes existentes mostram o stock atual só de leitura e um campo "Adjust stock (+/−)")
- Test: `tests/server/ecommerce/stock.test.ts`, plus updates em `products.test.ts`, `catalog.test.ts` e `tests/admin/ecommerce/*`

**Interfaces:**
- `EcommerceStockService.move(input: { variantId: number; quantity: number /* com sinal */; type: StockMovementType; operationKey: string; orderId?: number; reason?: string; actor: string }): Promise<{ applied: boolean }>`
  - Se já existir um movimento com o mesmo `operationKey`, devolve `{applied:false}` sem alterar nada.
  - Senão, cria o movimento e aplica `UPDATE variants SET stock = stock + quantity` via `strapi.db.connection(<tabela>)` com `.increment('stock', quantity)`. Usa o nome da tabela do metadata (`strapi.db.metadata.get(uid).tableName`), dentro da transação corrente (`strapi.db.transaction` expõe `trx`; usar `.transacting(trx)` quando existir).
  - `RETURN_NO_RESTOCK` regista com `quantity` e não altera o stock.
- `netDeductedForOrder(orderId): Promise<Map<number /*variantId*/, number /*unidades ainda descontadas*/>>`, para o cancelamento. Soma `ORDER_DEDUCT` (negativos), `ORDER_RESTOCK`/`CANCEL_RESTOCK`/`RETURN_RESTOCK` (positivos) e ignora `RETURN_NO_RESTOCK`.
- `available(variantIds: number[]): Promise<Map<number, number>>`
- [ ] **Step 1: Failing tests:**
  - O mesmo `operationKey` duas vezes aplica uma vez só.
  - Incremento negativo leva o stock abaixo de 0 sem erro.
  - `netDeductedForOrder` com deduções, uma reposição parcial e um `RETURN_NO_RESTOCK`.
  - Ao gravar um produto com uma variante a −2, não há erro.
  - `stockAdjustment +5` cria `MANUAL_ADJUST` e soma 5.
  - O `update` com `stock` diferente numa variante existente não o altera.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): stock ledger service; negative stock and stock adjustments`

---

### Task 5: Clientes (serviço)

**Files:**
- Create: `server/src/services/modules/ecommerce/customers.ts` (`EcommerceCustomerService`)
- Test: `tests/server/ecommerce/customers.test.ts`

**Interfaces:**
- `normalizeEmail(email: string): string` (trim + minúsculas). `isValidEmail(email)`, reutilizado do helper do plano 2 se existir.
- `findOrCreate(input: { firstName; lastName; email; phone? }): Promise<{ id: number; created: boolean }>`: procura pelo `emailNormalized` (mais antigo, `orderBy id asc`); se não existir, cria. Nunca atualiza os dados de um cliente existente.
- `list({ page, search }): Promise<{ results: { id; firstName; lastName; email; ordersCount }[]; pagination }>`: pesquisa `$containsi` em `emailNormalized` com o termo normalizado; 50 por página; ordenado por `id desc`.
- `get(id)`, devolve `{ id; firstName; lastName; email; phone; createdAt; updatedAt }`.
- `update(id, input, actor)`: valida os campos obrigatórios e o e-mail. Se outro cliente tiver o mesmo `emailNormalized` → `EcommerceValidationError [{path:'email', code:'duplicate_email'}]`. Faz audit (`EcommerceAuditService`, área `customers`, `changedFields`).
- `listOrders(customerId, { page, search /* referência, numérica ou '#1001' */ })`: 50 por página; cada linha com `{ id, reference, createdAt, total, orderStatus, paymentStatus, fulfillmentStatus }`.
- `lastOrderAddresses(customerId): Promise<{ shippingAddress; billingAddress } | null>`
- [ ] **Step 1: Failing tests:**
  - `findOrCreate` com `'Ana@X.pt '` e depois `'ana@x.pt'` → o mesmo id.
  - `update` para um e-mail de outro cliente → `duplicate_email`.
  - Review Focus 5 (o snapshot da encomenda mantém-se; a pesquisa pelo e-mail novo encontra o cliente).
  - Pesquisa por `#1001` e por `1001`.
  - Paginação com 60 clientes.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): customer service`

---

### Task 6: Serviço central de portes e bus de eventos

**Files:**
- Create: `server/src/services/modules/ecommerce/shipping.ts` (`EcommerceShippingService`), `server/src/services/modules/ecommerce/events.ts` (`EcommerceEventBus`)
- Test: `tests/server/ecommerce/shipping.test.ts`, `tests/server/ecommerce/events.test.ts`

**Interfaces:**
- `type ShippingQuoteRequest = { country: string; postalCode?: string; items: { variantId: number; quantity: number; weight: number; width: number; height: number; depth: number }[]; subtotal: number; locale: string }`
- `type ShippingOption = { providerId: string; serviceId: string; name: string; price: number; tax: number; estimatedDays?: number }`
- `type CarrierQuoter = (req: ShippingQuoteRequest, runtime: ProviderRuntime) => Promise<ShippingOption[]>`
- `EcommerceShippingService`:
  - `registerCarrierQuoter(providerId: string, quoter: CarrierQuoter)`, usado pelo plano 4;
  - `quote(req): Promise<{ options: ShippingOption[]; failures: { providerId: string; code: string }[] }>`:
    - opções dos métodos manuais ativos (`providerId:'manual'`, `serviceId:String(method.id)`, nome no locale com fallback para o locale por defeito, `price` e `tax` do método), filtradas por `countries` contém `req.country` e por `shippingCountries` da loja;
    - mais cada transportadora ativa com `quoter` registado;
    - uma falha numa transportadora entra em `failures` e não impede as outras;
    - nunca inventa preços;
    - ordena por `price` asc e depois por `name`.
  - `findOption(req, providerId, serviceId)`: recalcula e devolve a opção, ou `null` (o backend é a autoridade).
- `EcommerceEventBus`:
  - `subscribe(type: DomainEventType | '*', handler: (event: DomainEvent) => Promise<void>)`;
  - `collector()` devolve `{ emit(event), flush(): Promise<void> }`. Os serviços chamam `emit` dentro da transação e `flush()` só depois do commit.
  - Os handlers correm em sequência. Um erro num handler é registado com `strapi.log.error` (sem dados pessoais) e não propaga.
  - `type DomainEvent = { id: string; type: DomainEventType; orderId?: number; occurredAt: string; payload: Record<string, unknown> }`
- [ ] **Step 1: Failing tests:**
  - Métodos manuais filtrados por país.
  - Transportadora a falhar não esconde os manuais.
  - Ordenação.
  - `findOption` com id inexistente → `null`.
  - `collector` não chama handlers antes do `flush`.
  - Um handler a lançar não impede os outros.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): central shipping quotes and domain event bus`

---

### Task 7: Serviço de encomendas: criação, consulta e histórico

**Files:**
- Create: `server/src/services/modules/ecommerce/orders.ts` (`EcommerceOrderService`), `server/src/services/modules/ecommerce/orderHistory.ts` (`EcommerceOrderHistoryService`)
- Test: `tests/server/ecommerce/orders.create.test.ts`

**Interfaces:**
- `EcommerceOrderHistoryService.record(entry: { orderId; type: string; description: string; previousValue?: object | null; newValue?: object | null; actor: string; operationId?: string }): Promise<void>`. Os tipos de histórico usados neste plano: `ORDER_CREATED`, `ORDER_STATUS_CHANGED`, `PAYMENT_STATUS_CHANGED`, `FULFILLMENT_STATUS_CHANGED`, `LINE_ADDED`, `LINE_REMOVED`, `LINE_QUANTITY_CHANGED`, `ADDRESS_CHANGED`, `SHIPPING_CHANGED`, `ORDER_DISCOUNT_CHANGED`, `PAYMENT_CREATED`, `PAYMENT_COMPLETED`, `STOCK_MOVED`, `ORDER_CANCELLED`, `ORDER_ARCHIVED`.
- `type CreateOrderInput = { customer: { firstName; lastName; email; phone? }; shippingAddress: Address; billingAddress: Address; locale: string; lines: { variantId: number; quantity: number }[]; shipping: { providerId: string; serviceId: string }; notes?: string; idempotencyKey?: string }`
- `type Address = { firstName; lastName; company?; nif?; line1; line2?; postalCode; city; country /* ISO alfa-2 */; phone? }`
- `EcommerceOrderService.create(input, ctx: { actor: string; source: 'admin' | 'storefront' }): Promise<{ id; reference; publicId }>`, numa transação:
  1. Valida (campos obrigatórios, e-mail, país em `shippingCountries`, quantidades inteiras ≥ 1, variantes repetidas somadas).
  2. Lê as variantes ativas de produtos ativos e preços/taxas atuais.
  3. Valida o stock (`available >= quantidade`; erro `INSUFFICIENT_STOCK` por linha).
  4. Obtém a opção de portes por `EcommerceShippingService.findOption` (inexistente → `SHIPPING_UNAVAILABLE`).
  5. `findOrCreate` do cliente.
  6. Atribui a referência (`max(reference)+1`, mínimo 1001; colisão no índice único → nova tentativa até 3 vezes).
  7. Cria a encomenda (snapshots, totais via `computeTotals`, estados iniciais) e as linhas (snapshot no locale da encomenda, com fallback para o locale por defeito).
  8. Desconta o stock (`ORDER_DEDUCT`, `operationKey = order:<orderId>:create:<variantId>`).
  9. Histórico `ORDER_CREATED`.
  10. Emite `ORDER_CREATED` após o commit.
  - `idempotencyKey` repetido (guardado em `order.metadata`? Não: guardado num `stock-movement`? Não). **[Escolha técnica]** Acrescentar à content-type `order` o atributo `idempotencyKey` (string, unique). Se já existir uma encomenda com essa chave, é devolvida sem criar outra.
- `get(id): Promise<OrderView>`. `OrderView` inclui:
  - os dados da encomenda;
  - as linhas com `shipped` (0 neste plano) e `pending`;
  - os pagamentos;
  - `summary` (`financialSummary`), refunds `[]` e invoices `[]`;
  - shipments `[]` (o plano 4 preenche);
  - `availableActions` (de `availableActions`, com os sinalizadores calculados);
  - o histórico ordenado do mais recente para o mais antigo.
- `list({ page, search, orderStatus?, paymentStatus?, fulfillmentStatus? })`: 50 por página, `reference desc`. Pesquisa por referência (`#1001`/`1001`) ou e-mail do cliente (snapshot). Devolve `{ id, reference, orderStatus, paymentStatus, fulfillmentStatus, total, createdAt, customerName }`.
- `recalculate(orderId, trx)` (interno): recalcula `paymentStatus` e `fulfillmentStatus` a partir dos dados e regista no histórico `*_STATUS_CHANGED` quando mudam, com `previousValue`/`newValue`.
- [ ] **Step 1: Failing tests:**
  - Criação feliz: totais, referência 1001 e depois 1002, stock descontado, movimento criado, histórico, evento emitido após o commit.
  - Stock insuficiente → erro e nada criado.
  - Mesma `idempotencyKey` → mesma encomenda e um único desconto de stock.
  - Snapshot da linha no locale `pt` com fallback.
  - `list` com pesquisa por `#1002` e pelo e-mail.
  - `get` devolve `availableActions` de uma encomenda nova `[MODIFY, CANCEL, ADD_PAYMENT, SEND_PAYMENT_INSTRUCTIONS]`.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): order creation, listing, detail and history`

---

### Task 8: Pagamentos manuais, cancelamento e arquivamento

**Files:**
- Modify: `server/src/services/modules/ecommerce/orders.ts`
- Create: `server/src/services/modules/ecommerce/payments.ts` (`EcommercePaymentService`)
- Test: `tests/server/ecommerce/orders.lifecycle.test.ts`

**Interfaces:**
- `EcommercePaymentService.addManualPayment(orderId, input: { amount: number; reference?: string; methodLabel?: string; idempotencyKey: string }, actor)`:
  - pré-condição: `ADD_PAYMENT` disponível (senão `ACTION_NOT_AVAILABLE`);
  - `amount` inteiro > 0 (pode exceder o `due`; o excedente fica elegível para reembolso);
  - cria um `payment` `MANUAL`/`COMPLETED` com `completedAt` e `coverage` (design 4.4: as linhas e portes acrescentados desde a cobertura anterior, calculados por `computeCoverage(order, previousPayments)`);
  - histórico `PAYMENT_CREATED` e `PAYMENT_COMPLETED`; `recalculate`; evento `PAYMENT_COMPLETED`;
  - `idempotencyKey` repetido devolve o pagamento existente.
- `computeCoverage` (pura, em `domain/orders.ts`, com testes próprios): o primeiro pagamento cobre todas as linhas e os portes do momento; os seguintes cobrem o delta (linhas novas ou aumentos, diferença de portes positiva) entre o estado atual e a soma das coberturas anteriores. Formato `{ lines: { orderLineId; quantity; unitPrice; unitDiscount; tax }[]; shipping: { amount; tax }; amount: number }`.
- `EcommerceOrderService.cancel(orderId, actor)`:
  - `CANCEL` disponível; `OPEN→CANCELLED`, `cancelledAt`;
  - para cada variante em `netDeductedForOrder`, um `CANCEL_RESTOCK` com `operationKey = cancel:<orderId>:<variantId>`;
  - histórico; evento `ORDER_CANCELLED` (payload com `amountPaid`);
  - um segundo cancelamento → `ACTION_NOT_AVAILABLE`, sem repor stock (Review Focus 2).
- `EcommerceOrderService.archive(orderId, actor)`: `ARCHIVE` disponível; `OPEN→ARCHIVED`; histórico; evento.
- Erros de ação → `EcommerceValidationError [{ path: 'action', code: 'ACTION_NOT_AVAILABLE' }]`.
- [ ] **Step 1: Failing tests:**
  - Pagamento total → `PAID`, `SHIP` disponível.
  - Pagamento parcial → `PARTIALLY_PAID`.
  - Review Focus 3.
  - Cancelamento repõe o stock e um segundo cancelamento falha sem efeitos.
  - Cancelada e paga → `availableActions` inclui `REFUND` e `excess = paid`.
  - `archive` indisponível numa encomenda `UNFULFILLED`.
  - `computeCoverage`: primeiro pagamento, depois uma modificação +1 linha e +400 de portes, segundo pagamento cobre só o delta.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): manual payments, cancellation and archiving`

---

### Task 9: Modificação de encomendas (serviço)

**Files:**
- Modify: `server/src/services/modules/ecommerce/orders.ts`
- Test: `tests/server/ecommerce/orders.modify.test.ts`

**Interfaces:**
- `EcommerceOrderService.previewModification(orderId, input: ModificationInput): Promise<ModificationResult>`. Pré-condição `MODIFY`. Usa o catálogo atual e as quantidades enviadas (0 neste plano, via `shippedQuantities` sobre as expedições, vazias até ao plano 4). Para `RECALCULATE`, obtém a `quote` com `EcommerceShippingService.findOption` sobre os itens **pendentes** e a morada (atualizada, se houver), usando o `providerId`/`serviceId` da encomenda. Falha → erro `SHIPPING_QUOTE_FAILED` (o admin pode manter ou definir manualmente). `previousShipmentsCost` é 0 neste plano.
- `EcommerceOrderService.applyModification(orderId, input, actor, operationId: string)`. Na transação:
  1. volta a simular e rejeita se houver `errors`;
  2. atualiza linhas, moradas, portes e `orderDiscount` (com o limite);
  3. regista movimentos de stock (`ORDER_DEDUCT`/`ORDER_RESTOCK` com `operationKey = modify:<operationId>:<variantId>`);
  4. recalcula os totais e os estados;
  5. histórico por alteração (linha adicionada/removida/quantidade, moradas, portes com modo, totais antes/depois, diferença);
  6. emite `ORDER_MODIFIED` com `{ outcome, difference }`.
  - Devolve `{ order: OrderView; outcome; difference }`.
  - O mesmo `operationId` repetido devolve o resultado sem reaplicar (guardar `operationId` no histórico `ORDER_MODIFIED`; se já existir, devolve o estado atual).
- [ ] **Step 1: Failing tests:**
  - Acrescentar uma linha a uma encomenda paga → `PARTIALLY_PAID`, stock descontado da diferença, histórico.
  - Reduzir de 5 para 3 → reposição de 2.
  - Morada alterada → histórico `ADDRESS_CHANGED` com antes e depois.
  - Portes `MANUAL 0`.
  - `RECALCULATE` com o método manual atual.
  - Repetir o `operationId` não duplica.
  - Encomenda `CANCELLED` → `ACTION_NOT_AVAILABLE`.
- [ ] **Steps 2–5** e **Commit** `feat(ecommerce): order modification with stock, shipping options and history`

---

### Task 10: API admin de clientes e encomendas

**Files:**
- Create: `server/src/controllers/modules/ecommerce/{customers,orders}.ts`, `server/src/routes/ecommerce/{admin-customers,admin-orders}.ts`
- Modify: `admin-api.ts`, `controllers/index.ts`, `routes/ecommerce/admin-products.ts` (o `GET /admin/ecommerce/locales` passa a aceitar qualquer uma das permissões `productsRead`, `settingsRead`, `ordersRead` ou `customersRead`; a policy `admin::hasPermissions` com várias ações é OU)
- Test: `tests/server/ecommerce/ordersRoutes.test.ts`, `ordersController.test.ts`

**Rotas** (com o middleware ativo; `c-read`/`c-manage` = clientes, `o-read`/`o-manage` = encomendas):

| Método | Path | Perm. |
|---|---|---|
| GET | `/admin/ecommerce/customers?page&search` | c-read |
| GET/PUT | `/admin/ecommerce/customers/:id` | c-read / c-manage |
| GET | `/admin/ecommerce/customers/:id/orders?page&search` | c-read |
| GET | `/admin/ecommerce/customers/:id/last-addresses` | o-manage |
| GET | `/admin/ecommerce/orders?page&search&orderStatus&paymentStatus&fulfillmentStatus` | o-read |
| POST | `/admin/ecommerce/orders` | o-manage (body `CreateOrderInput`; `idempotencyKey` obrigatório no admin) |
| GET | `/admin/ecommerce/orders/:id` | o-read |
| POST | `/admin/ecommerce/orders/shipping-quote` | o-manage (body `{ country, postalCode?, lines:[{variantId,quantity}], locale }`, que o servidor completa com peso e dimensões) |
| GET | `/admin/ecommerce/orders/variant-search?q&locale` | o-manage (pesquisa por nome/SKU; até 20 variantes ativas com `{variantId, productId, name, option, sku, price, stock, imageUrl}`) |
| POST | `/admin/ecommerce/orders/:id/payments` | o-manage |
| POST | `/admin/ecommerce/orders/:id/cancel` | o-manage |
| POST | `/admin/ecommerce/orders/:id/archive` | o-manage |
| POST | `/admin/ecommerce/orders/:id/modification/preview` | o-manage |
| POST | `/admin/ecommerce/orders/:id/modification` | o-manage (body `ModificationInput & { operationId }`) |

- `actor = 'user:' + ctx.state.user.id`. Os ids numéricos são validados (`NaN` → 400).
- [ ] TDD das rotas e dos controllers (mapeamento de erros, actor, validação de ids). **Commit** `feat(ecommerce): admin API for customers and orders`

---

### Task 11: Admin: clientes

**Files:**
- Create: `admin/src/ecommerce/gateways/ecommerceOrdersGateway.ts` (clientes e encomendas, todas as rotas da Task 10), `admin/src/ecommerce/usecases/orders/*.ts`, `admin/src/ecommerce/orderTypes.ts`
- Create: `admin/src/ecommerce/pages/customers/{CustomerListPage,CustomerDetailPage}.tsx`, `admin/src/ecommerce/illustrations/{EmptyCustomers,EmptyCustomerOrders}.tsx`
- Create: `admin/src/ecommerce/components/orders/StatusBadges.tsx` (`OrderStatusBadge`, `PaymentStatusBadge` e `FulfillmentStatusBadge`, com cores distintas por estado e texto traduzido)
- Modify: `EcommerceApp.tsx` (rotas `customers`, `customers/:id`), Registry, traduções
- Test: `tests/admin/ecommerce/statusBadges.test.ts` (mapa estado → variante de cor e chave i18n)

**Comportamento (requisito 17.8 a 17.15):**
- **Lista:** colunas nome (nome + apelido), e-mail e Edit; 50 por página; pesquisa por e-mail; estado vazio com ilustração e "No customers yet." / "Ainda não existem clientes.".
- **Ficha:** formulário com nome, apelido, e-mail e telefone (Save; erros por campo, incluindo `duplicate_email`).
- **Encomendas do cliente:** tabela com referência, data, total, os três badges e View; 50 por página; pesquisa por referência; estado vazio "This customer has no orders yet." / "Este cliente ainda não tem encomendas.".
- **Criar encomenda:** navega para `orders/new?customerId=<id>`.
- **Permissões:** sem `customers.manage`, os campos ficam só de leitura (`rbacKey` do plano 2: `canManage`).
- [ ] Testes puros, implementação, testes, `tsc` e build. **Commit** `feat(ecommerce): customers admin`

---

### Task 12: Admin: lista de encomendas e criação manual

**Files:**
- Create: `admin/src/ecommerce/pages/orders/{OrderListPage,OrderCreatePage}.tsx`, `admin/src/ecommerce/components/orders/{AddressFields,VariantPicker,OrderLinesEditor,TotalsPreview}.tsx`, `admin/src/ecommerce/illustrations/EmptyOrders.tsx`, `admin/src/ecommerce/utils/orderForm.ts`
- Modify: `EcommerceApp.tsx` (rotas `orders`, `orders/new`, `orders/:id`), traduções
- Test: `tests/admin/ecommerce/orderForm.test.ts`

**Comportamento:**
- **Lista (requisito 2):** referência `#1001`, os três badges, total, data e View. Filtros por estado (três `SingleSelect` opcionais) e pesquisa por referência ou e-mail. Estado vazio com a ilustração e "No orders yet." / "Ainda não existem encomendas.". Botão "Create order".
- **Criação (requisito 17.16 a 17.19):** formulário com:
  - cliente (nome, apelido, e-mail, telefone), pré-preenchido quando há `customerId` (GET cliente);
  - idioma (locales do Strapi);
  - morada de entrega e de faturação (`AddressFields`; a faturação inclui `company` e `nif`; checkbox "Billing same as shipping"). Com `customerId`, um botão "Use addresses from last order" (GET `last-addresses`).
  - `VariantPicker` (pesquisa com *debounce* 300 ms; mostra o stock; não deixa adicionar com stock 0, mas mostra-o);
  - `OrderLinesEditor` (quantidade, remover, subtotal por linha);
  - portes: botão "Get shipping options" chama `shipping-quote` e `SingleSelect` das opções (nome e preço); as falhas por transportadora aparecem como aviso;
  - `TotalsPreview` (subtotal, portes e total, calculados localmente para pré-visualização; o servidor é a autoridade);
  - "Create order" envia `idempotencyKey` (`crypto.randomUUID()` gerado uma vez por formulário) e, em sucesso, abre `orders/:id`;
  - erros por campo e por linha (`INSUFFICIENT_STOCK`).
- Helpers puros testados: `sumPreviewTotals(lines, shippingPrice)`, `copyAddress`, `validateOrderForm`.
- [ ] Testes, implementação, `tsc` e build. **Commit** `feat(ecommerce): order list and manual order creation`

---

### Task 13: Admin: ecrã de gestão da encomenda

**Files:**
- Create: `admin/src/ecommerce/pages/orders/OrderDetailPage.tsx`, `admin/src/ecommerce/components/orders/{OrderHeader,OrderLinesTable,FinancialSummary,AddressCard,CustomerCard,PaymentsTable,AddPaymentModal,CancelOrderModal,HistoryTimeline,SectionPlaceholder}.tsx`
- Test: `tests/admin/ecommerce/orderDetail.test.ts` (helpers puros: `formatShippedProgress(10,3)`, `pendingLabel`, `historyEntryText`)

**Comportamento (requisitos 3 a 8):**
- **Cabeçalho:** referência, os três badges independentes, data de criação e barra de ações. As ações vêm de `availableActions`. **Neste plano** são mostradas `MODIFY`, `CANCEL`, `ADD_PAYMENT` e `ARCHIVE`. As restantes (`SHIP`, `REFUND`, `SEND_PAYMENT_INSTRUCTIONS`, `REGISTER_RETURN`, `INVOICE_TOTAL`) ficam para o plano 4: o componente mapeia ação → botão e ignora as que ainda não tem.
- **Produtos:**
  - colunas fotografia, produto (nome + opção), SKU, preço unitário (original riscado quando `unitDiscount > 0`, mais o final), quantidade, enviada (`10 / 3`) e total;
  - aviso "7 units left to ship" / "Faltam enviar 7 unidades";
  - linhas de oferta com badge "Promotional gift" / "Oferta promocional" (dados do plano 5).
- **Resumo financeiro:** subtotal original, descontos de produtos, desconto na encomenda, subtotal após descontos, portes originais, desconto nos portes, total, pago, reembolsado, valor líquido recebido, em dívida e elegível para devolução. As linhas a 0 de descontos e reembolsos ficam escondidas.
- **Cliente e moradas:** dados do cliente (snapshot) com link para a ficha. Moradas de entrega e de faturação separadas, sempre ambas.
- **Pagamentos:** tabela com método, valor, referência, estado, data e ações (vazio por agora). `AddPaymentModal` tem valor (`parseMoneyToCents`, por defeito o `due`), referência e método (texto livre), e envia o `idempotencyKey`.
- **Faturas, expedições, reembolsos e promoções:** `SectionPlaceholder` com texto neutro "Nothing here yet" e ilustração pequena. São substituídos nos planos 4 e 5.
- **Histórico:** linha temporal (data e hora, utilizador ou processo, descrição; antes/depois quando existir).
- **Arquivar** e **Cancelar** pedem confirmação (`ConfirmModal`). Cancelar explica que não é feito reembolso automático.
- [ ] Testes, implementação, `tsc` e build. **Commit** `feat(ecommerce): order management screen`

---

### Task 14: Admin: modificar encomenda

**Files:**
- Create: `admin/src/ecommerce/components/orders/{ModifyOrderModal,ModificationSummary,SupplementaryPaymentModal}.tsx`, `admin/src/ecommerce/utils/modification.ts`
- Test: `tests/admin/ecommerce/modification.test.ts`

**Comportamento (requisito 16):**
- `ModifyOrderModal` (modal grande ou página em ecrã cheio):
  - edição das linhas (quantidade, remover, adicionar com `VariantPicker`);
  - moradas (`AddressFields`, ambas);
  - portes com três opções (Keep, Recalculate, Manual). Recalculate mostra o resultado da pré-visualização; Manual tem campo de valor;
  - botão "Review changes" chama `modification/preview`.
- `ModificationSummary` (requisito 16.15): tabela antes/depois (produtos, quantidades, subtotal, portes, total, valor recebido, diferença), produtos adicionados e removidos, quantidades alteradas, moradas alteradas, modo dos portes (com custos anteriores e cotação), movimentos de stock previstos e avisos (`ORDER_DISCOUNT_CAPPED`). Os erros (`QUANTITY_BELOW_SHIPPED`, `INSUFFICIENT_STOCK`, `VARIANT_UNAVAILABLE`, `SHIPPING_QUOTE_FAILED`) aparecem na linha ou campo.
- "Confirm" envia a modificação com `operationId` (`crypto.randomUUID()` por abertura do modal).
- **Depois de gravar:**
  - `outcome DUE` → abre automaticamente o `SupplementaryPaymentModal` (requisito 16.7/16.8). Mostra a referência, o total atualizado, o já liquidado e o valor em dívida. Tem três opções: Manual instructions (caixa de texto), Stripe payment link e Send later. **Neste plano**, Manual e Stripe aparecem desativados com a nota "Available once email/Stripe are configured" (o plano 4 liga-os). Send later fecha o modal, e a dívida mantém-se.
  - `outcome REFUNDABLE` → aviso de que existe valor elegível para devolução (a ação Refund chega no plano 4).
- Helper puro testado: `buildModificationInput(formState)`.
- [ ] Testes, implementação, `tsc` e build. **Commit** `feat(ecommerce): modify order flow with summary and supplementary payment modal`

---

### Task 15: Verificação final do plano 3

- [ ] `npx vitest run`, os dois `tsc` e `npm run build` limpos.
- [ ] No Strapi de teste (MariaDB), reiniciado:
  1. Criar uma encomenda manual para um cliente novo: o cliente é criado e o stock baixa.
  2. Segunda encomenda com o mesmo e-mail em maiúsculas: o mesmo cliente.
  3. Na ficha da encomenda, os três estados aparecem corretos.
  4. Adicionar um pagamento parcial (`PARTIALLY_PAID`) e depois o restante (`PAID`).
  5. Modificar a encomenda acrescentando um produto: `PARTIALLY_PAID`, abre o modal de pagamento complementar e "Send later" mantém a dívida.
  6. Cancelar: o stock é reposto; um segundo clique não muda nada.
  7. No histórico, todos os eventos aparecem.
  8. A lista de encomendas tem filtros e pesquisa.
  9. A ficha do cliente lista as encomendas.
  10. Editar o stock de um produto com ajuste +5 gera o movimento.
- [ ] Commit de correções: `chore(ecommerce): plan 3 verification fixes`
