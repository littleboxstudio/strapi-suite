# E-commerce, plano 5: Expedições, entregas, devoluções e faturação Moloni (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o ciclo logístico e fiscal das encomendas:
- **Expedições:** parciais ou integrais, por método manual ou por transportadora, com custo registado, rastreio e etiqueta.
- **Entregas:** confirmação manual (com data e histórico) ou por rastreio da transportadora, e o arquivamento que depende delas.
- **Devoluções** (design 4.5 e 4.12): unidades enviadas, reposição de stock escolhida por linha, montante aprovado para reembolso.
- **Faturação por pagamento** (design 4.4): fatura por pagamento, fatura total, nota de crédito a pedido, PDF pela plataforma.
- **Moloni** a partir da documentação pública (não verificado) e **CTT Expresso** só como estrutura.
- **Notificações** de expedição parcial, expedição integral, entrega e fatura (com o PDF em anexo), pela fila do plano 4.

**Architecture:**
- **Domínio puro** novo em `domain/fulfillment.ts` (quantidades enviadas, reservadas e devolvíveis, valor das devoluções, estado de entrega) e `domain/invoicing.ts` (reconciliação das coberturas, linhas fiscais, cliente fiscal, sugestão de nota de crédito).
- **Contratos de fornecedor:** `CarrierAdapter` (estende o registo de quoters do plano 3) e `BillingProvider`, cada um com um registo próprio. Os serviços de expedição e de faturação só conhecem os contratos.
- **Operações externas em duas fases:** a linha local é criada `PENDING` numa transação (o índice único reserva o pagamento ou as quantidades), a chamada ao fornecedor corre fora da transação e uma segunda transação conclui (`ACTIVE`/`ISSUED`), regista a falha (`FAILED`) ou marca o resultado incerto (`UNCERTAIN`/`PENDING`) para reconciliação manual.
- **Notificações:** os eventos novos entram no `EcommerceEventBus` e na fila em memória do plano 4. O PDF da fatura é obtido ao fornecedor no momento do envio e segue em anexo.

**Tech Stack:** Strapi 5 (Query Engine + knex portável), `fetch` com `timedFetch`, Vitest, React + `@strapi/design-system` v2.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (4.1, 4.2, 4.3, 4.4, 4.5, 4.12, 4.13, 4.15, 7, 9.1, 9.2, 11) e, em `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`, no capítulo Encomendas: 3.3, 3.4, 4.3, 4.4, 9.2 (arquivamento), 9.4, 9.5, 10.2, 10.3, 10.4, 10.10, 11, 12, 13.6, 13.7, 13.8, 13.11, 14.6, 15.2, 15.14, 15.15, 16.4, 16.5.2 e 16.17; no capítulo Configurações: 1.9 e 1.10.

## Global Constraints

- Tudo das Global Constraints dos planos 1 a 4 continua a valer:
  - alterações aditivas; os módulos não-ecommerce não mudam;
  - content-types ocultas (`content-manager` e `content-type-builder` `visible: false`), prefixo `ltb-st-module-ecommerce-*`;
  - nomes de campos em inglês;
  - dinheiro em cêntimos inteiros (EUR);
  - proibido importar `@strapi/utils`;
  - **colunas JSON só recebem objetos** (as listas vão embrulhadas: `{ lines: [...] }`, `{ events: [...] }`), nunca escalares nem arrays soltos;
  - todo o atributo `unique: true` tem também um índice único em `indexes`, com nome ≤ 60 caracteres (o teste `schemaIndexes` impõe-no);
  - qualquer base de dados suportada pelo Strapi (o cliente usa MariaDB): só Query Engine ou knex portável;
  - `en` + `pt` na interface; ilustrações no estilo definido;
  - eventos emitidos dentro da transação com `collector.emit` e entregues com `flush()` depois do commit;
  - encomendas não pagas nunca são canceladas automaticamente; o stock pode ficar negativo.
- **Expedições:**
  - `status = PENDING | ACTIVE | FAILED | CANCELLED`; só `ACTIVE` conta como enviado; `PENDING` e `ACTIVE` contam como **reservado** (não se pode voltar a expedir essas unidades);
  - `deliveryStatus = IN_TRANSIT | DELIVERED | EXCEPTION`; `deliverySource = MANUAL | CARRIER`;
  - a quantidade a expedir por linha é `1 ≤ q ≤ quantity − reservado`;
  - a expedição não muda o stock (já foi descontado na encomenda);
  - expedições anteriores nunca são alteradas para representar modificações (só o estado de entrega, o rastreio e o cancelamento).
- **Entregas:** a entrega confirmada **não** altera o `FulfillmentStatus` nem o `OrderStatus`. O estado de entrega da encomenda é derivado: `NONE | IN_TRANSIT | PARTIALLY_DELIVERED | DELIVERED` (`DELIVERED` só com `FulfillmentStatus = FULFILLED` e todas as expedições `ACTIVE` entregues). Não há cron: o rastreio da transportadora é atualizado pelo botão "Refresh tracking".
- **Arquivar** (design 4.1, já em `availableActions`): `OPEN`, `FULFILLED`, todas as expedições `ACTIVE` com entrega confirmada, `due = 0`, `excess = 0`, sem pagamentos `PENDING` e sem reembolsos `PENDING`/`PROCESSING`.
- **Devoluções:**
  - só sobre unidades enviadas: devolvível por linha = enviado (`ACTIVE`) − `returnedQuantity`;
  - restock escolhido por linha: movimento `RETURN_RESTOCK` (repõe) ou `RETURN_NO_RESTOCK` (não repõe), `operationKey = return:<returnId>:<orderLineId>`;
  - valor aprovado = `Σ (unitPrice − unitDiscount) × q − orderDiscountShareForReturn(...)`; a parte do desconto sai do `orderDiscount` guardado;
  - não executa reembolso: o reembolso usa o `EcommerceRefundService` do plano 4 e continua limitado ao `excess`;
  - não altera expedições nem `FulfillmentStatus`.
- **Faturação (design 4.4):**
  - cada fatura cobre o valor que os seus pagamentos pagaram no momento da liquidação (`payment.coverage`), **reconciliado** com as linhas atuais da encomenda (ver Task 3);
  - só pagamentos `COMPLETED`, só em encomendas `OPEN`; nunca o mesmo pagamento em duas faturas ativas (índice único `invoice-allocation.uniqueKey = payment:<paymentId>`, libertado quando a fatura fica `FAILED`);
  - estados da fatura `PENDING | ISSUED | FAILED | UNCERTAIN`; tipos `INVOICE | CREDIT_NOTE`;
  - um único fornecedor de faturação ativo; sem nenhum → `BILLING_NOT_CONFIGURED`; com mais de um (corrida do plano 2) → `BILLING_PROVIDER_AMBIGUOUS`;
  - um resultado incerto **nunca** é reemitido automaticamente;
  - o PDF é sempre obtido ao fornecedor que emitiu o documento, com as credenciais guardadas (funciona com o fornecedor desativado); não é guardado no Strapi nem no provider de upload;
  - notas de crédito podem ser emitidas em qualquer `OrderStatus` (regularização).
- **Moloni** (design 4.15; requisitos 11.5 e 11.8): API `https://api.moloni.pt/v1`, não verificado:
  - autenticação `grant_type=password`, renovação `grant_type=refresh_token`, token em memória;
  - documento por defeito `FR`; `FT` é seguida de recibo;
  - artigos por `reference = sku`, criados se não existirem; portes com a referência `shippingReference` (por defeito `PORTES`);
  - linhas a 0% sem `exemptionReason` configurado → `BILLING_EXEMPTION_REASON_MISSING`;
  - sem NIF → cliente Consumidor Final com NIF `999999990`; nunca se inventa um NIF;
  - `our_reference = LB-INV-<invoiceId>` (é a chave de reconciliação).
- **CTT Expresso:** só estrutura. O adaptador regista-se no contrato, mas todos os métodos lançam `EcommerceCarrierError('NOT_IMPLEMENTED')`.
- **Cotações de transportadoras** (pendente do plano 3, Task 6): em paralelo (`Promise.allSettled`), 8 s por transportadora (`TIMEOUT`), saída validada (`price` inteiro em `[0, MAX_MONEY_CENTS]`, `tax` em `[0, 100]`, `name` e `serviceId` não vazios, `providerId` forçado), transportadora ativa sem adaptador ou sem runtime → `NOT_CONFIGURED`; nos logs, só o id e o código, nunca a mensagem.
- **E-mails:**
  - `PARTIAL_SHIPMENT` / `FULL_SHIPMENT` por expedição criada (integral quando a encomenda fica `FULFILLED`);
  - `DELIVERY_CONFIRMATION` só quando a encomenda fica totalmente entregue;
  - `INVOICE_AVAILABLE` só para `kind = INVOICE`, com o **PDF em anexo** e sem link de download;
  - nenhum e-mail contém URLs do Strapi (admin, API ou uploads); os únicos URLs permitidos são o `storefrontUrl`, o Stripe e o link de rastreio da transportadora (o `store.logoUrl`, configurado pelo administrador, é aceite tal como está);
  - o administrador pode desligar o aviso ao cliente ao expedir e ao confirmar a entrega (`notifyCustomer`, por defeito `true`).
- **Permissões:** nova ação `ecommerce.invoicing.manage` ("Issue invoices and credit notes"). Expedições, entregas e devoluções usam `orders.manage`; ler PDFs e etiquetas usa `orders.read`.
- **Timeouts:** cotação 8 s; criar expedição 30 s; Moloni 20 s por chamada; restantes chamadas a fornecedores 15 s. Os serviços passam estes timeouts de forma explícita aos adaptadores (o `timedFetch` assume 10 s por defeito).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/ecommerce`.

## Review Focus

1. **Duplo clique em "Ship" ou duas abas a expedir as mesmas unidades:** com o mesmo `idempotencyKey` fica uma só expedição e um só e-mail; com chaves diferentes, a segunda é recusada com `QUANTITY_EXCEEDS_PENDING`. Teste na Task 5.
2. **Devolução sem reposição de stock seguida de cancelamento:** o cancelamento não repõe a unidade danificada (só repõe o que a encomenda ainda tem descontado). Teste na Task 7.
3. **Linha paga substituída por outra do mesmo preço antes de faturar** (pendente do plano 3): a fatura do pagamento mostra a linha nova, o total é o valor pago e a linha removida não aparece. Teste nas Tasks 3 e 9.
4. **Moloni não responde depois de receber o pedido (timeout na emissão):** a fatura fica `UNCERTAIN`, o pagamento não pode ser faturado outra vez e "Reconcile" encontra o documento por `our_reference` e passa-o a `ISSUED`. Teste na Task 9.
5. **Falha a obter o PDF quando a notificação da fatura é enviada:** a fatura continua `ISSUED`, a notificação fica `FAILED` com `INVOICE_PDF_UNAVAILABLE` e "Resend" envia-a com o anexo. Teste na Task 10.

---

### Task 1: Content-types, UIDs, permissão e tipos partilhados

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{shipment,shipment-event,order-return,invoice,invoice-allocation}/{schema.json,index.ts}`
- Modify: `content-types/index.ts`, `config/index.ts` (UIDs `shipment`, `shipmentEvent`, `orderReturn`, `invoice`, `invoiceAllocation`), `permissions.ts` (`invoicingManage`), `events.ts` (`DomainEventType` + `SHIPMENT_CREATED`, `SHIPMENT_DELIVERED`, `RETURN_REGISTERED`, `INVOICE_ISSUED`), `orderHistory.ts` (`OrderHistoryType` + `SHIPMENT_CREATED`, `SHIPMENT_FAILED`, `SHIPMENT_CANCELLED`, `SHIPMENT_DELIVERED`, `SHIPMENT_TRACKING_UPDATED`, `RETURN_REGISTERED`, `INVOICE_ISSUED`, `INVOICE_FAILED`, `INVOICE_UNCERTAIN`, `CREDIT_NOTE_ISSUED`), `errors.ts`, `controllers/modules/ecommerce/errors.ts` (`handleDomainError`), `tests/server/ecommerce/helpers/commerceSetup.ts` (UIDs e relações novas no `fakeDb`)
- Test: `tests/server/ecommerce/fulfillmentContentTypes.test.ts` (`schemaIndexes` e o teste de nomes reservados continuam a passar), `tests/server/ecommerce/permissions.test.ts` (a contagem de `ECOMMERCE_ACTIONS` passa de 10 para 11), `tests/server/ecommerce/fulfillmentErrors.test.ts` (novo: `handleDomainError`)

**Interfaces (relações para tipos anteriores são `manyToOne` unidirecionais):**
- `collectionName` (prefixo `ltb_st_module_ecommerce_`): `shipment` → `ltb_st_module_ecommerce_shipments`, `shipment-event` → `ltb_st_module_ecommerce_shipment_events`, `order-return` → `ltb_st_module_ecommerce_order_returns`, `invoice` → `ltb_st_module_ecommerce_invoices`, `invoice-allocation` → `ltb_st_module_ecommerce_invoice_allocations`.
- `shipment`:
  - `order`, `providerId` (string, required), `serviceId`, `carrierName` (string, required)
  - `status` enum `PENDING,ACTIVE,FAILED,CANCELLED` (default `PENDING`)
  - `items` (json `{ lines: { orderLineId; variantId; sku; name; option; quantity }[] }`)
  - `trackingCode`, `trackingUrl` (text), `externalId`, `shippingCost` (int, default 0), `labelAvailable` (boolean, default false)
  - `deliveryStatus` enum `IN_TRANSIT,DELIVERED,EXCEPTION` (default `IN_TRANSIT`), `deliverySource` enum `MANUAL,CARRIER`, `shippedAt`, `deliveredAt`, `cancelledAt` (datetime)
  - `idempotencyKey` (string, required, unique + índice), `actor`, `error` (text), `metadata` (json)
- `shipment-event`: `shipment`, `order`, `type` enum `CREATED,TRACKING,DELIVERED,TRACKING_UPDATED,CANCELLED`, `code`, `description` (text), `occurredAt`, `source` enum `ADMIN,CARRIER,SYSTEM`, `actor`, `uniqueKey` (string, required, unique + índice).
- `order-return`: `order`, `items` (json `{ lines: { orderLineId; variantId; sku; name; option; quantity; restock: boolean; value }[] }`), `grossValue`, `discountShare`, `refundableValue` (int), `reason` (string), `notes` (text), `idempotencyKey` (string, required, unique + índice), `actor`.
- `invoice`:
  - `order`, `provider` (string), `kind` enum `INVOICE,CREDIT_NOTE`, `documentType` (string: `FR`/`FT`/`NC`), `status` enum `PENDING,ISSUED,FAILED,UNCERTAIN` (default `PENDING`)
  - `externalId`, `number`, `series`, `total` (int), `lines` (json `{ lines: InvoiceLine[] }`), `customerData` (json)
  - `creditedInvoice` (`manyToOne` para `invoice`), `idempotencyKey` (string, required, unique + índice), `ourReference` (string)
  - `issuedAt`, `error` (text), `actor`, `metadata` (json)
- `invoice-allocation`: `invoice`, `payment`, `order`, `amount` (int), `coverage` (json: a cobertura reconciliada usada), `uniqueKey` (string, **nullable**, unique + índice).
- `ECOMMERCE_PERMISSIONS.invoicingManage = plugin::littlebox-strapi-suite.ecommerce.invoicing.manage`, displayName "Issue invoices and credit notes".
- `errors.ts`:
  - `class EcommerceCarrierError(code: 'CARRIER_NOT_CONFIGURED' | 'NOT_IMPLEMENTED' | 'NOT_SUPPORTED' | 'CARRIER_REQUEST_FAILED' | 'CARRIER_UNREACHABLE' | 'TIMEOUT' | 'INVALID_QUOTE', message = code, uncertain = false)`
  - `class EcommerceBillingError(code: 'BILLING_NOT_CONFIGURED' | 'BILLING_PROVIDER_AMBIGUOUS' | 'BILLING_AUTH_FAILED' | 'BILLING_REQUEST_FAILED' | 'BILLING_UNREACHABLE' | 'BILLING_CONFIG_MISSING' | 'BILLING_TAX_NOT_FOUND' | 'BILLING_EXEMPTION_REASON_MISSING' | 'NOT_SUPPORTED' | 'NOTHING_TO_INVOICE' | 'INVOICE_PDF_UNAVAILABLE', message = code, uncertain = false)`
  - as mensagens nunca contêm segredos, URLs nem corpos de resposta dos fornecedores.
  - `controllers/modules/ecommerce/errors.ts`:
    - as duas classes → 400 com `{ code }`, como `EcommercePaymentError`;
    - `CONFLICT_CODES` (409) ganha `QUANTITY_EXCEEDS_PENDING`, `ALREADY_DELIVERED`, `PAYMENT_NOT_INVOICEABLE` e os que a Task 5 introduz (`SHIPMENT_PENDING`, `SHIPMENT_UNCERTAIN`, `SHIPMENT_HAS_RETURNS`); o handler percorre **todos** os `code` de `err.errors`, não só o primeiro. A Task 11 só o consome.
- [ ] TDD como nos planos anteriores (os schemas existem, têm os índices, os enums e as relações; o handler de erros devolve o `code`):
  - `fulfillmentErrors.test.ts`: `EcommerceCarrierError` e `EcommerceBillingError` → 400 `{ code }` sem a mensagem de segredos; um erro de validação com `QUANTITY_EXCEEDS_PENDING` em segundo lugar na lista → 409; `PAYMENT_NOT_INVOICEABLE` → 409;
  - `permissions.test.ts`: `ECOMMERCE_ACTIONS` tem 11 ações e inclui `invoicingManage`. **Commit** `feat(ecommerce): shipment, return and invoice content-types and invoicing permission`

---

### Task 2: Domínio puro de expedições, entregas e devoluções

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/fulfillment.ts`
- Modify: `server/src/services/modules/ecommerce/domain/orders.ts` (`ShipmentLike.status` passa a `ShipmentStatus`; `shippedQuantities` conta só `ACTIVE`)
- Test: `tests/server/ecommerce/domain/fulfillment.test.ts`, `tests/server/ecommerce/domain/orders.test.ts` (caso `PENDING` não conta como enviado)

**Interfaces:**
- `type ShipmentStatus = 'PENDING' | 'ACTIVE' | 'FAILED' | 'CANCELLED'`; `type DeliveryStatus = 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION'`; `type OrderDeliveryStatus = 'NONE' | 'IN_TRANSIT' | 'PARTIALLY_DELIVERED' | 'DELIVERED'`.
- `reservedQuantities(shipments: ShipmentLike[]): Map<number, number>`: `ACTIVE` + `PENDING`.
- `validateShipmentRequest(lines: { id: number; quantity: number }[], reserved: Map<number, number>, request: { orderLineId: number; quantity: number }[]): ValidationIssue[]`, com os códigos:
  - `required` (pedido vazio), `duplicate_line`, `unknown_line`, `invalid_quantity` (inteiro ≥ 1);
  - `QUANTITY_EXCEEDS_PENDING` (path `lines.<i>.quantity`, quando `q > quantity − reservado`).
- `remainingShippingCost(shippingTotal: number, shipments: { status: ShipmentStatus; shippingCost: number }[]): number` = `max(0, shippingTotal − Σ shippingCost das ACTIVE)` (pré-preenchimento do custo da expedição).
- `previousShipmentsCost(shipments): number` = `Σ shippingCost` das `ACTIVE` (requisito 16.5.2).
- `orderDeliveryStatus(fulfillment: FulfillmentStatus, shipments: { status; deliveryStatus }[]): OrderDeliveryStatus`:
  - sem `ACTIVE` → `NONE`;
  - nenhuma entregue → `IN_TRANSIT`;
  - todas entregues e `FULFILLED` → `DELIVERED`;
  - senão → `PARTIALLY_DELIVERED`.
- `validateDeliveryDate(deliveredAt: unknown, shippedAt: string, now: Date): ValidationIssue[]`, com os códigos `invalid_date`, `before_shipment` e `in_future` (tolerância de 5 min).
- `returnableQuantities(lines: { id: number; returnedQuantity: number }[], shipped: Map<number, number>): Map<number, number>` = `max(0, enviado − devolvido)`.
- `validateReturnRequest(returnable: Map<number, number>, request: { orderLineId; quantity; restock }[]): ValidationIssue[]`, com os códigos `required`, `duplicate_line`, `unknown_line`, `invalid_quantity`, `invalid_restock` (não booleano) e `QUANTITY_EXCEEDS_RETURNABLE`.
- `computeReturn(lines: (LineAmounts & { id: number })[], orderDiscount: number, request: { orderLineId; quantity }[]): { items: { orderLineId; quantity; value }[]; grossValue: number; discountShare: number; refundableValue: number }`:
  - `value = (unitPrice − unitDiscount) × quantity`;
  - `discountShare = orderDiscountShareForReturn(lines, orderDiscount, request)` (já existe; `lines` no estado anterior à devolução);
  - `refundableValue = grossValue − discountShare`.
- [ ] **Step 1: Failing tests:**
  - 10 encomendadas, 4 `ACTIVE` + 3 `PENDING` → pedido de 4 dá `QUANTITY_EXCEEDS_PENDING`, pedido de 3 passa;
  - `shippedQuantities` ignora `PENDING`, `FAILED` e `CANCELLED`;
  - `orderDeliveryStatus`: duas expedições, uma entregue → `PARTIALLY_DELIVERED`; ambas entregues mas `PARTIALLY_FULFILLED` → `PARTIALLY_DELIVERED`; ambas e `FULFILLED` → `DELIVERED`;
  - `computeReturn` com desconto de encomenda de 10 € sobre 100 € e devolução de 20 € → `discountShare = 200`, `refundableValue = 1800`;
  - `returnableQuantities` com 5 enviadas e 2 devolvidas → 3; devolver 4 → `QUANTITY_EXCEEDS_RETURNABLE`;
  - `remainingShippingCost(500, [ACTIVE 300, CANCELLED 200])` → 200;
  - `validateDeliveryDate` antes de `shippedAt` → `before_shipment`;
  - códigos de validação: `required`, `duplicate_line`, `unknown_line`, `invalid_quantity` (0, -1 e 1.5) em `validateShipmentRequest` e em `validateReturnRequest`; `invalid_restock` (`'yes'`); `validateDeliveryDate` com `'abc'` → `invalid_date`;
  - `orderDeliveryStatus` sem `ACTIVE` → `NONE`, com `ACTIVE` por entregar → `IN_TRANSIT`; `previousShipmentsCost([ACTIVE 300, ACTIVE 200, CANCELLED 900])` → 500.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): fulfillment, delivery and return domain rules`

---

### Task 3: Domínio puro de faturação

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/invoicing.ts`
- Test: `tests/server/ecommerce/domain/invoicing.test.ts`

**Interfaces:**
- `type InvoiceLine = { orderLineId: number | null; kind: 'ITEM' | 'SHIPPING'; sku: string; name: string; quantity: number; total: number /* cêntimos, IVA incluído */; tax: number; partial: boolean }`
- `type ReconciledCoverage = { paymentId: number; lines: { orderLineId: number; value: number }[]; shipping: number; value: number; excluded: number }`
- `type InvoicedCoverage = { lines: { orderLineId: number; value: number }[]; shipping: number }`.
- `toInvoicedCoverage(allocationCoverage: unknown): InvoicedCoverage`: converte o `coverage` guardado na `invoice-allocation` (um `ReconciledCoverage`, `shipping` em número); malformado → `{ lines: [], shipping: 0 }`.
- `toPaymentCoverage(coverage: unknown): { lines: { orderLineId: number; value: number }[]; shipping: number } | null`: converte o `payment.coverage` do plano 3 (`PaymentCoverage`, `shipping: { value, tax }` → `shipping.value`); em falta ou malformado → `null`. A conversão faz-se à entrada de `reconcileCoverages`; a `invoice-allocation.coverage` persiste sempre o `ReconciledCoverage`.
- `reconcileCoverages(order: CoverageOrderState, payments: { id: number; amount: number; coverage: unknown }[], invoiced: Map<number, InvoicedCoverage>): Map<number, ReconciledCoverage>`. `payments` são os `COMPLETED` por ordem de liquidação (`completedAt`, depois `id`). O algoritmo (não é determinado pelos testes):
  1. Capacidade atual de cada linha = o seu valor devido (`lineDue`, calculado como em `computeCoverage`: líquido menos a parte do desconto de encomenda); a capacidade dos portes = `shippingTotal`.
  2. **Primeira passagem**, por ordem: a fonte de cada pagamento é a cobertura da sua fatura ativa (`invoiced`), se existir, ou a sua `coverage`.
     - **Pagamento com alocação ativa:** usa a cobertura guardada **tal como está**, sem `min` nem realocação do órfão. Consome capacidade só nas linhas que ainda existem, por `min(valor, capacidade)`, apenas para que os outros pagamentos vejam a capacidade restante. O excedente (linha reduzida ou removida depois de faturar) aparece em `overInvoiced` e resolve-se com nota de crédito.
     - **Pagamento sem alocação:** cada valor numa linha que ainda existe consome `min(valor, capacidade)`. O resto é **órfão**: valor de linhas removidas ou reduzidas, ou a totalidade quando a `coverage` está em falta ou malformada.
  3. **Segunda passagem**, por ordem: o órfão de cada pagamento não faturado é realocado com `allocateProportionally(min(órfão, Σ capacidade), capacidades)`, até ao limite da capacidade restante. O que sobra vai para `excluded` (excedente reembolsável, nunca faturado).
  - `value = Σ lines + shipping`.
- `invoiceableByPayment(reconciled: Map<number, ReconciledCoverage>, allocatedPaymentIds: Set<number>): Map<number, number>`: o valor por faturar de cada pagamento (0 se já tiver alocação ativa).
- `buildInvoiceLines(coverages: ReconciledCoverage[], order: CoverageOrderState & { lines: { id; sku; name; option: string | null }[] }, shipping: { name: string; reference: string; tax: number }): InvoiceLine[]`:
  - junta as coberturas por `orderLineId` (pela ordem das linhas); os portes ficam em último lugar;
  - se `lineDue = 0` ou `value = 0`, a linha é saltada **antes** de calcular `units` (sem divisão por zero);
  - `units = effectiveQty × value / lineDue`: se for inteiro ≥ 1, então `quantity = units` e `partial = false`; senão `quantity = 1` e `partial = true`;
  - `name = option ? "<name> - <option>" : name`; omite as linhas com `total = 0`.
- `invoiceCustomer(billing: Address | null, customer: { firstName; lastName; email }): InvoiceCustomer`, com `InvoiceCustomer = { name; nif: string | null; address; postalCode; city; country; email }`:
  - `name = company || firstName lastName`;
  - `nif` só quando existe (nunca inventado).
- `overInvoiced(order: CoverageOrderState, issued: { kind: 'INVOICE' | 'CREDIT_NOTE'; lines: InvoiceLine[] }[]): Map<number | 'SHIPPING', number>` = `max(0, faturado − creditado − lineDue atual)` por linha e para os portes. Numa encomenda cancelada, todos os `lineDue` são 0.
- `suggestCreditNote(invoice: { lines: InvoiceLine[] }, alreadyCredited: number[], over: Map<number | 'SHIPPING', number>): number[]`: por índice de linha, `min(total − creditado, over restante)`.
- `validateCreditNoteRequest(invoice, alreadyCredited, request: { lines: { index; value }[]; reason }): ValidationIssue[]`, com os códigos `required`, `unknown_line`, `invalid_amount` e `exceeds_creditable`.
- `issueDate(now: Date, timeZone: string): string`, no formato `YYYY-MM-DD` no fuso horário da loja.
- [ ] **Step 1: Failing tests:**
  - **Review Focus 3:** pagamento de 2000 a cobrir a linha A (2000); a A é removida e a B (2000) acrescentada → a reconciliação dá `{ B: 2000 }` e `excluded = 0`;
  - linha reduzida de 3 para 1 depois do pagamento total → a reconciliação dá 1/3 do valor e `excluded` = o resto (excedente);
  - pagamento parcial de 50% em duas linhas com IVA de 23% e 6% → valores proporcionais e `partial = true`;
  - pagamento total sem desconto → `quantity` = unidades, `partial = false`;
  - pagamento já faturado mantém a sua cobertura fixa e um segundo pagamento recebe só a capacidade restante;
  - pagamento faturado a cobrir a linha A (2000), com A depois reduzida para 1000 → a cobertura do pagamento continua a 2000 (sem clamp), a capacidade restante de A para os outros é 0 e `overInvoiced` dá 1000;
  - `coverage` nula → o pagamento inteiro é realocado;
  - `toInvoicedCoverage` converte o `ReconciledCoverage` guardado (`shipping` em número) e devolve `{ lines: [], shipping: 0 }` para lixo; `toPaymentCoverage` converte `shipping: { value, tax }` para número e `null` para `coverage` em falta;
  - linha com `lineDue = 0` (ou cobertura com `value = 0`) é omitida sem `NaN`/`Infinity`;
  - `invoiceCustomer` sem NIF → `nif: null`; com empresa → nome da empresa;
  - `overInvoiced`: faturado 2000, creditado 500, `lineDue` atual 1000 → 500; encomenda cancelada (todos os `lineDue` 0) → o faturado menos o creditado; os portes contam à parte (`'SHIPPING'`);
  - `validateCreditNoteRequest`: `required` (sem linhas ou sem `reason`), `unknown_line` (índice inexistente), `invalid_amount` (0, negativo, não inteiro), `exceeds_creditable` (valor acima de `total − creditado`);
  - `suggestCreditNote` depois de uma devolução de 1 de 2 unidades faturadas → metade dessa linha;
  - `issueDate` às 23:30 UTC de 31/12 em `Europe/Lisbon` (inverno) → `YYYY-12-31`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): payment-based invoice reconciliation and credit note rules`

---

### Task 4: Contrato de transportadoras, cotações robustas e CTT (estrutura)

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/carriers/types.ts`, `providers/carriers/cttExpresso.ts`, `providers/carriers/index.ts` (adaptadores de origem, como `registry.ts` faz com as definições)
- Modify: `server/src/services/modules/ecommerce/shipping.ts`
- Test: `tests/server/ecommerce/shipping.test.ts` (acrescentar), `tests/server/ecommerce/providers/cttExpresso.test.ts`

**Interfaces:**
- `types.ts`:
  - `CarrierShipmentRequest = { ourReference: string /* LB-SHP-<shipmentId> */; orderReference: string; serviceId: string; destination: Address; contact: { name: string; email: string; phone?: string }; items: ShippingQuoteRequest['items'] }`
  - `CarrierShipmentResult = { externalId: string; trackingCode: string | null; trackingUrl: string | null; cost: number | null; labelAvailable: boolean }`
  - `CarrierTrackingEvent = { code: string; description: string; occurredAt: string; delivered: boolean }`
  - `CarrierAdapter = { quote?(req, rt): Promise<ShippingOption[]>; createShipment?(req: CarrierShipmentRequest, rt): Promise<CarrierShipmentResult>; cancelShipment?(externalId: string, rt): Promise<void>; getLabel?(externalId: string, rt): Promise<{ filename: string; content: Buffer }>; track?(s: { externalId: string; trackingCode: string | null }, rt): Promise<CarrierTrackingEvent[]> }`
- `shipping.ts`:
  - `registerCarrierAdapter(providerId, adapter)`, que junta ao adaptador existente;
  - `registerCarrierQuoter(id, q)` passa a ser `registerCarrierAdapter(id, { quote: q })`;
  - `getCarrierAdapter(id): CarrierAdapter | undefined`;
  - `__resetCarrierQuotersForTests` repõe os adaptadores de origem.
  - O serviço expõe `carrierFor(providerId): Promise<{ adapter: CarrierAdapter; runtime: ProviderRuntime }>`. Lança `CARRIER_NOT_CONFIGURED` se o fornecedor estiver inativo, sem runtime ou sem adaptador, e `NOT_SUPPORTED` quando faltar o método pedido (verificação no serviço de expedições). O nome do erro é `CARRIER_NOT_CONFIGURED`; na **cotação** a falha da transportadora regista-se com o código `NOT_CONFIGURED` (mapeamento explícito em `quote`).
  - `quote` com as regras das Global Constraints:
    - as transportadoras correm em paralelo, cada uma limitada por `QUOTE_TIMEOUT_MS = 8000`;
    - falhas `TIMEOUT`, `NOT_CONFIGURED`, `INVALID_QUOTE` (as opções inválidas são descartadas e há uma falha por transportadora) ou o `code` do erro (por defeito `QUOTE_FAILED`);
    - o `manual` não passa por adaptador;
    - um adaptador registado **sem** `quote` é ignorado na cotação (sem falha e sem opções); uma transportadora ativa sem adaptador ou sem runtime dá a falha `NOT_CONFIGURED` (muda o `continue` silencioso atual; o teste existente "a failing carrier does not hide manual methods" tem de continuar a passar).
- `cttExpresso.ts`: `cttExpressoAdapter: CarrierAdapter` com os 5 métodos a lançar `EcommerceCarrierError('NOT_IMPLEMENTED', 'CTT Expresso integration is not implemented yet.')`. A definição de fornecedor (plano 2) não muda.
- [ ] **Step 1: Failing tests:**
  - um quoter que nunca resolve → falha `TIMEOUT` em ~8 s (timers falsos) e as opções manuais continuam a ser devolvidas;
  - preço `12.5`, preço negativo e `name` vazio → descartados com `INVALID_QUOTE`; as válidas mantêm-se;
  - um quoter que devolve `providerId: 'other'` → forçado ao id real;
  - transportadora ativa sem adaptador → `NOT_CONFIGURED`;
  - CTT ativo → falha `NOT_IMPLEMENTED` e os métodos manuais aparecem;
  - o log não contém a mensagem do erro;
  - `carrierFor`: fornecedor inativo, sem runtime ou sem adaptador → `CARRIER_NOT_CONFIGURED`; adaptador sem o método pedido → `NOT_SUPPORTED`; ativo e completo → `{ adapter, runtime }`;
  - `registerCarrierAdapter` junta métodos ao adaptador existente; `getCarrierAdapter` devolve-o; `registerCarrierQuoter(id, q)` equivale a `registerCarrierAdapter(id, { quote: q })`; `__resetCarrierQuotersForTests` repõe só o CTT de origem.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): carrier adapter contract, hardened quotes and CTT Expresso stub`

---

### Task 5: Expedições (serviço) e integração nas encomendas

**Files:**
- Create: `server/src/services/modules/ecommerce/shipments.ts` (`EcommerceShipmentService`)
- Modify: `server/src/services/modules/ecommerce/orders.ts`:
  - `loadShipments` lê as `shipment` reais e fornece a cada uma `status`, `deliveryStatus` e `delivered` (`deliveryStatus === 'DELIVERED'`), porque `ShipmentLike` e `orderDeliveryStatus` precisam de ambos;
  - o cancelamento da encomenda é recusado com `SHIPMENT_PENDING` quando existe uma expedição `PENDING` ou `UNCERTAIN`;
  - `allShipmentsDelivered` considera só as `ACTIVE`;
  - `OrderLineView` ganha `reserved` e `returnable`, e `pending = quantity − reserved`;
  - `OrderView.shipments: ShipmentView[]` e `OrderView.shipping: { remainingCost: number; deliveryStatus: OrderDeliveryStatus }`;
  - `resolveShipping` usa `previousShipmentsCost(...)` em vez de `0` e cota com `subtotal` = Σ valor líquido das unidades pendentes (pendente do plano 3, Task 9). **Os itens cotados e o `subtotal` usam a mesma quantidade por linha: `quantity − reservado`** (a que `pending` já usa), para que as unidades `PENDING`/reservadas não sejam cotadas sem serem contadas no preço.
- Modify: `server/src/services/index.ts`
- Test: `tests/server/ecommerce/shipments.test.ts`, `tests/server/ecommerce/orders.modify.test.ts` (custo das expedições anteriores)

**Interfaces:**
- `type ShipmentInput = { lines: { orderLineId: number; quantity: number }[]; method: { mode: 'MANUAL'; carrierName: string; trackingCode?: string; trackingUrl?: string } | { mode: 'CARRIER' }; shippingCost: number; notifyCustomer: boolean; idempotencyKey: string }`
- `ShipmentView = { id; status; providerId; serviceId; carrierName; items: { orderLineId; sku; name; option; quantity }[]; trackingCode; trackingUrl; shippingCost; labelAvailable; deliveryStatus; deliverySource; shippedAt; deliveredAt; cancelledAt; error; createdAt; events: { type; description; occurredAt; source }[] }`
- `EcommerceShipmentService.create(orderId, input, actor): Promise<ShipmentView>`:
  - **Validação:**
    - `trackingUrl` só `http(s)` e ≤ 2000 caracteres (`invalid_url`);
    - `carrierName` com 1 a 120 caracteres;
    - `shippingCost` em cêntimos, de 0 a `MAX_MONEY_CENTS`.
  - **Idempotência:** se já existir uma expedição com o mesmo `idempotencyKey`, devolve-a. Numa violação do índice único, devolve a vencedora.
  - **Transação 1:**
    - `lockOrder`, `computeOrderState`, `assertAction('SHIP')`;
    - `validateShipmentRequest` contra `reservedQuantities`;
    - `items` com o snapshot de sku, nome e opção.
  - **`MANUAL`:**
    - na mesma transação: `providerId 'manual'`, `status ACTIVE`, `shippedAt` agora;
    - `shipment-event CREATED` (`uniqueKey shp:<id>:created`), histórico `SHIPMENT_CREATED` e `recalculate`;
    - esta cauda (evento, histórico, `recalculate`, emissão) vive **numa única função privada** `recordShipmentCreated(trx, shipment, order, notify)`, usada pelo modo `MANUAL` e pela transação 2 do `CARRIER`;
    - emite `SHIPMENT_CREATED { shipmentId, full: fulfillmentStatus === 'FULFILLED', notify, pending: { orderLineId; quantity }[] }`.
  - **`CARRIER`:** o fornecedor é o `shippingMethod.providerId` da encomenda e o `serviceId` é o da encomenda.
    - O `carrierFor` com `createShipment` é verificado **antes** de criar a linha.
    - A transação 1 cria a linha `PENDING` (`carrierName` = nome do método).
    - Depois chama `createShipment` com `ourReference = LB-SHP-<id>` e o timeout explícito de 30 s (`CREATE_SHIPMENT_TIMEOUT_MS = 30000`, passado ao adaptador; o `timedFetch` assume 10 s se não for passado).
    - Transação 2 (`lockOrder`): relê a encomenda e a linha. Se a encomenda já não está `OPEN` ou a linha já não está `PENDING`, marca a expedição `FAILED` com `error 'ORDER_CHANGED'` (guardando o `externalId` devolvido), histórico `SHIPMENT_FAILED`, **não** a passa a `ACTIVE` e lança `ORDER_CHANGED`. Caso contrário, consoante o resultado:
      - sucesso → `ACTIVE`, com o resultado do adaptador (`shippingCost = result.cost ?? input.shippingCost`), e `recordShipmentCreated`;
      - erro definitivo → `FAILED` (`error` = código), histórico `SHIPMENT_FAILED`, e relança o erro;
      - erro `uncertain` → continua `PENDING` com `error 'UNCERTAIN'` e é devolvida.
- `retry(shipmentId, actor)`: só `PENDING` com `UNCERTAIN`; repete `createShipment` com o mesmo `ourReference` (as transportadoras deduplicam pela referência; fica documentado).
- `cancel(shipmentId, { reason }, actor)`:
  - permitido em `FAILED`, `PENDING` com `externalId` ou `ACTIVE` não entregue, numa encomenda que não esteja `ARCHIVED`;
  - uma `PENDING`/`UNCERTAIN` **sem** `externalId` é recusada com `SHIPMENT_UNCERTAIN` (a expedição pode ter sido criada na transportadora: o administrador usa `retry`); nunca passa a `CANCELLED` em silêncio;
  - para cada linha, o enviado depois de cancelar tem de continuar ≥ `returnedQuantity`, senão `SHIPMENT_HAS_RETURNS`;
  - uma `ACTIVE` ou `PENDING` com `externalId` chama `cancelShipment` com 15 s (`NOT_SUPPORTED` → erro, nada muda);
  - passa a `CANCELLED`, com `cancelledAt`, evento de expedição (`uniqueKey shp:<id>:cancelled`), histórico `SHIPMENT_CANCELLED` e `recalculate` (o `FulfillmentStatus` pode recuar);
  - não envia e-mail.
- `getLabel(shipmentId): Promise<{ filename; content: Buffer }>`: só `ACTIVE` com `labelAvailable`; usa `carrierFor(...).getLabel`.
- `listForOrder(orderId): Promise<ShipmentView[]>`, usado por `orders.get`.
- [ ] **Step 1: Failing tests:**
  - **Review Focus 1** (a mesma chave → uma expedição e um evento; chaves diferentes com quantidades que se sobrepõem → `QUANTITY_EXCEEDS_PENDING`);
  - 10 unidades: expedir 4 → `PARTIALLY_FULFILLED` e evento com `full: false`; expedir 6 → `FULFILLED` e `full: true`;
  - encomenda não liquidada → `ACTION_NOT_AVAILABLE`;
  - `CARRIER` com o CTT → `NOT_IMPLEMENTED`, expedição `FAILED` e nada enviado;
  - adaptador simulado com timeout → `PENDING`/`UNCERTAIN`; `retry` com sucesso → `ACTIVE`;
  - cancelar uma expedição com unidades devolvidas → `SHIPMENT_HAS_RETURNS`;
  - cancelar a única expedição → `UNFULFILLED`;
  - a expedição não cria movimentos de stock;
  - modificação com `RECALCULATE` depois de uma expedição com custo de 600: com a cotação simulada de 800 e 1000 cobrados → `newCharged = 1400` (exemplo do requisito 16.5.2);
  - `resolveShipping` com uma reserva `PENDING`: os itens cotados e o `subtotal` excluem as unidades reservadas (mesma base `quantity − reservado`);
  - validação: `trackingUrl` `javascript:` ou com mais de 2000 caracteres → `invalid_url`; `carrierName` vazio ou com 121 caracteres recusado; `shippingCost` -1 e `MAX_MONEY_CENTS + 1` recusados;
  - `notifyCustomer: false` → o evento `SHIPMENT_CREATED` leva `notify: false`; nenhuma notificação;
  - `labelAvailable` + `getLabel` → devolve `filename` e `content`; sem `labelAvailable` ou em expedição não `ACTIVE` → erro;
  - encomenda alterada (cancelada) entre a transação 1 e a 2 → expedição `FAILED` com `ORDER_CHANGED`, nunca `ACTIVE`; cancelar uma encomenda com uma expedição `PENDING` → `SHIPMENT_PENDING`;
  - `cancel` de uma `PENDING`/`UNCERTAIN` sem `externalId` → `SHIPMENT_UNCERTAIN`, estado inalterado; com `externalId` → `cancelShipment` chamado e `CANCELLED`;
  - `uniqueKey` dos eventos: `shp:<id>:created` no `create` e `shp:<id>:cancelled` no `cancel`;
  - o adaptador simulado recebe o timeout explícito de 30 s no `createShipment`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): manual and carrier shipments with fulfillment status`

---

### Task 6: Entregas, rastreio e arquivamento

**Files:**
- Modify: `server/src/services/modules/ecommerce/shipments.ts`
- Test: `tests/server/ecommerce/deliveries.test.ts`

**Interfaces:**
- `confirmDelivery(shipmentId, input: { deliveredAt: string; notifyCustomer: boolean }, actor): Promise<ShipmentView>`:
  - só expedições `ACTIVE`; `validateDeliveryDate`; encomenda não `ARCHIVED`;
  - na transação: `lockOrder` e um `updateMany` condicional (`deliveryStatus ≠ DELIVERED`); com 0 linhas → `ALREADY_DELIVERED`;
  - grava `DELIVERED`, `deliveredAt`, `deliverySource MANUAL`, `shipment-event DELIVERED` (`uniqueKey shp:<id>:delivered`, source `ADMIN`, actor) e histórico `SHIPMENT_DELIVERED` ("Delivery confirmed manually", com a data);
  - emite `SHIPMENT_DELIVERED { shipmentId, deliveredAt, allDelivered: orderDeliveryStatus(...) === 'DELIVERED', notify: notifyCustomer && orderStatus === 'OPEN' }`.
- `updateTracking(shipmentId, { trackingCode?: string | null; trackingUrl?: string | null }, actor)`:
  - qualquer expedição não `CANCELLED`, com as mesmas validações da criação;
  - evento `TRACKING_UPDATED` (`uniqueKey shp:<id>:tracking:<uuid>`, um por ocorrência) e histórico `SHIPMENT_TRACKING_UPDATED`;
  - sem e-mail.
- `refreshTracking(shipmentId, actor): Promise<ShipmentView>`:
  - só expedições de transportadora `ACTIVE`; nas manuais → `NOT_SUPPORTED`;
  - `track(...)`: cada evento é inserido com `uniqueKey = trk:<shipmentId>:<code>:<occurredAt>` (os duplicados são ignorados);
  - o primeiro evento `delivered` numa expedição ainda não entregue passa-a a `DELIVERED` com `deliverySource CARRIER`, `deliveredAt = occurredAt` e actor `carrier:<providerId>`, com o `shipment-event DELIVERED` (`uniqueKey shp:<id>:delivered`), e emite `SHIPMENT_DELIVERED` como acima (com `notify` só em `OPEN`).
- O arquivamento não muda de código: usa o `allShipmentsDelivered` real da Task 5.
- [ ] **Step 1: Failing tests:**
  - duas expedições que completam a encomenda; confirmar a primeira → `allDelivered: false`; confirmar a segunda → `true`; `ARCHIVE` passa a disponível (com tudo pago);
  - confirmar duas vezes → `ALREADY_DELIVERED` e um só evento;
  - data futura → `in_future`;
  - `refreshTracking` com eventos repetidos não duplica as linhas; um evento `delivered` marca a entrega;
  - `refreshTracking` numa expedição manual → `NOT_SUPPORTED`;
  - a confirmação não altera o `FulfillmentStatus` nem o `OrderStatus`;
  - `uniqueKey`: `confirmDelivery` grava `shp:<id>:delivered`; dois `updateTracking` seguidos geram duas chaves `shp:<id>:tracking:<uuid>` distintas;
  - `updateTracking`: grava o código e o link, rejeita `javascript:` (`invalid_url`), recusa uma expedição `CANCELLED` e não envia e-mail.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): manual delivery confirmation, carrier tracking and archive eligibility`

---

### Task 7: Devoluções (serviço)

**Files:**
- Create: `server/src/services/modules/ecommerce/returns.ts` (`EcommerceReturnService`)
- Modify: `server/src/services/modules/ecommerce/stock.ts` (`RETURN_NO_RESTOCK` entra em `ORDER_NET_TYPES`: as unidades devolvidas sem reposição deixam de estar "descontadas" pela encomenda), `orders.ts` (`OrderView.returns: ReturnView[]`), `services/index.ts`
- Test: `tests/server/ecommerce/returns.test.ts`, `tests/server/ecommerce/stock.test.ts` (acrescentar)

**Interfaces:**
- `type ReturnInput = { lines: { orderLineId: number; quantity: number; restock: boolean }[]; reason: string /* 1–200 */; notes?: string; idempotencyKey: string }`
- `ReturnView = { id; items: { orderLineId; sku; name; option; quantity; restock; value }[]; grossValue; discountShare; refundableValue; reason; notes; actor; createdAt }`
- `EcommerceReturnService.register(orderId, input, actor): Promise<{ return: ReturnView; refundable: number }>`:
  - idempotente por `idempotencyKey` (devolve a existente);
  - numa transação:
    - `lockOrder`, `computeOrderState`, `assertAction('REGISTER_RETURN')`;
    - `validateReturnRequest(returnableQuantities(...))`;
    - `computeReturn` com as linhas e o `orderDiscount` antes da devolução;
    - grava a `order-return`;
    - cada linha: `returnedQuantity += q`;
    - `orderDiscount −= discountShare`; os totais são recalculados com `computeTotals` e gravados com o `updateMany` condicional em `orderStatus ≠ ARCHIVED`;
    - stock: `RETURN_RESTOCK` (+q) ou `RETURN_NO_RESTOCK` (+q, sem alterar o stock), `operationKey = return:<returnId>:<orderLineId>`. **Numa encomenda `CANCELLED`, `restock` é forçado a `false`**, porque o cancelamento já repôs tudo;
    - histórico `RETURN_REGISTERED` (com linhas, restock e valor) e `recalculate`;
    - emite `RETURN_REGISTERED { returnId, refundableValue }` (sem e-mail).
  - `refundable = refundableAmount(summary, inFlight)` depois da devolução, para a UI oferecer o reembolso (pelo fluxo do plano 4, motivo `RETURN`, valor `min(refundableValue, refundable)`).
- `listForOrder(orderId): Promise<ReturnView[]>`.
- [ ] **Step 1: Failing tests:**
  - **Review Focus 2:** 3 unidades enviadas; devolver 1 sem reposição e cancelar → `CANCEL_RESTOCK` de 2 e o stock só sobe 2;
  - devolver 1 com reposição → stock +1, total −valor, `excess` = valor e `REFUND` disponível;
  - pedido repetido com a mesma chave → uma devolução e um movimento por linha;
  - devolver mais do que o enviado menos o devolvido → `QUANTITY_EXCEEDS_RETURNABLE`;
  - a devolução não altera as expedições nem o `FulfillmentStatus`;
  - encomenda com desconto de encomenda → o `orderDiscount` baixa pela parte calculada;
  - encomenda cancelada → movimento `RETURN_NO_RESTOCK` mesmo com `restock: true`;
  - `reason` vazio ou com 201 caracteres → recusado (`required`/`too_long`);
  - encomenda `ARCHIVED` → `ACTION_NOT_AVAILABLE`;
  - a devolução grava a entrada de histórico `RETURN_REGISTERED` (linhas, restock e valor) e emite `RETURN_REGISTERED { returnId, refundableValue }`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): register returns with per-line restock and refundable value`

---

### Task 8: Contrato de faturação e fornecedor Moloni (não verificado)

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/billing/types.ts`, `providers/billing/index.ts` (registo: `getBillingProvider(id)`, `registerBillingProvider(p)`, `__resetBillingProvidersForTests`; **regista `moloniProvider` à importação**, como `providers/carriers/index.ts` faz com o CTT, e o reset repõe-no), `providers/billing/moloni/client.ts`, `providers/billing/moloni/provider.ts`
- Modify: `providers/definitions/moloni.ts`: campos opcionais `paymentMethodId`, `storeCreditPaymentMethodId`, `productCategoryId`, `measurementUnitId` (number) e `shippingReference` (string, default `PORTES`); traduções `en`/`pt` dos rótulos na Task 13.
- Test: `tests/server/ecommerce/providers/moloniClient.test.ts`, `tests/server/ecommerce/providers/moloniProvider.test.ts`

**Interfaces:**
- `types.ts`:
  - `InvoiceDraft = { kind: 'INVOICE' | 'CREDIT_NOTE'; ourReference: string; orderReference: string /* "#1001" */; date: string /* YYYY-MM-DD */; locale: string; customer: InvoiceCustomer; lines: InvoiceLine[]; total: number; payments: { method: 'STRIPE' | 'MANUAL' | 'STORE_CREDIT'; amount: number; date: string }[]; original?: { externalId: string; total: number } /* notas de crédito */; reason?: string }`
  - `IssuedDocument = { externalId: string; number: string; series: string | null; documentType: string; total: number | null; issuedAt: string; warnings: string[] }`
  - `BillingProvider = { id: string; capabilities: { creditNotes: boolean; findByReference: boolean }; issue(draft, rt): Promise<IssuedDocument>; getDocument(externalId, rt): Promise<IssuedDocument>; getPdf(externalId, rt): Promise<Buffer>; findByReference(ourReference, rt): Promise<IssuedDocument | null> }`
- Clientes fora de Portugal (design 4.15): fora de âmbito neste plano — emitidos como os nacionais (país da morada de faturação, IVA da encomenda tal como está); fica em ecommerce-followups.md.
- `client.ts`: `createMoloniClient(rt: ProviderRuntime): { call<T>(path: string, body?: Record<string, unknown>, opts?: { write?: boolean }): Promise<T> }`:
  - token em cache no módulo, por `clientId:username` (`{ accessToken, refreshToken, expiresAt }`):
    - renova 60 s antes de expirar;
    - uma resposta de token inválido força um novo `grant` e uma única repetição;
    - `__resetMoloniTokensForTests`;
  - pedido `POST https://api.moloni.pt/v1/<path>/?access_token=<t>&json=true` com corpo JSON, `company_id = config.companyId` acrescentado, timeout de 20 s passado como 4.º argumento de `timedFetch(url, init, label, 20000)`;
  - o callback do `timedFetch` **não lança**: devolve `{ status, body }` e o mapeamento para erros de faturação faz-se **depois** da chamada (o `timedFetch` devolve `null` para qualquer exceção, o que fundiria `BILLING_AUTH_FAILED` e `BILLING_REQUEST_FAILED` em `BILLING_UNREACHABLE`);
  - **erros:**
    - `grant` recusado → `BILLING_AUTH_FAILED`;
    - corpo em array `[{ code, field, description }]` ou `{ valid: 0 }` → `BILLING_REQUEST_FAILED`, com uma mensagem só com `field:code` (nunca `description`, nunca valores);
    - `null` do `timedFetch` (timeout ou rede, indistinguíveis) → `BILLING_UNREACHABLE`, ou `uncertain = true` quando `opts.write`;
    - campos obrigatórios em falta → `BILLING_CONFIG_MISSING` (`Missing fields: …`).
- `provider.ts`: `moloniProvider: BillingProvider` (`creditNotes: true`, `findByReference: true`):
  - **Lookups em cache** por empresa durante 1 h:
    - `taxes/getAll`, por `value`; sem correspondência → `BILLING_TAX_NOT_FOUND`;
    - `countries/getAll`, por ISO2;
    - `documentSets/getAll`, `paymentMethods/getAll`, `productCategories/getAll` e `measurementUnits/getAll`: usa o valor configurado, ou o primeiro devolvido;
    - lista vazia → `BILLING_CONFIG_MISSING`.
  - **Cliente:**
    - com NIF: `customers/getByVat`; se não existir, `customers/getNextNumber` seguido de `customers/insert`;
    - sem NIF: o cliente com NIF `999999990` (criado como "Consumidor Final" se não existir).
  - **Artigo por linha:** `products/getByReference { reference: sku, exact: 1 }`; se não existir, `products/insert` (`type` 1 para produto, 2 para portes, `has_stock 0`, preço líquido, imposto ou `exemption_reason`).
  - **Linhas do documento:**
    - `qty = quantity`;
    - `price` = líquido unitário (`total × 100 / (100 + tax) / quantity / 100`, 4 casas decimais);
    - `taxes [{ tax_id }]` ou `exemption_reason`; uma linha a 0% sem `exemptionReason` → `BILLING_EXEMPTION_REASON_MISSING`, antes de qualquer escrita.
  - **`issue`:**
    - `INVOICE` + `FR`: `invoiceReceipts/insert`, com `payments` (`storeCreditPaymentMethodId ?? paymentMethodId` para `STORE_CREDIT`).
    - `INVOICE` + `FT`: `invoices/insert` e depois `receipts/insert` com `associated_documents`. Uma falha do recibo fica em `warnings: ['RECEIPT_FAILED']` e o documento conta como emitido.
    - `CREDIT_NOTE`: `creditNotes/insert` com `associated_documents [{ associated_id: original.externalId, value: total }]`.
    - Os três levam `status: 1`, `our_reference`, `notes: "Order <orderReference>"` e são chamadas `write`.
    - Depois, `documents/getOne` dá o número (`<document_set_name>/<number>`) e o total. Se o total diferir do rascunho, acrescenta `TOTAL_MISMATCH:<diff>` a `warnings`.
  - **`getPdf`:** `documents/getPDFLink`, depois `GET` do `url` (com `https:` à frente se começar por `//`), 15 s. Se não começar por `%PDF` → `BILLING_REQUEST_FAILED`.
  - **`findByReference`:** `documents/getAll { our_reference }`. Primeiro resultado → `getDocument`; nenhum → `null`.
- [ ] **Step 1: Failing tests** (`fetch` simulado):
  - o `grant` é pedido uma vez para duas chamadas; o token expirado é renovado com `refresh_token`;
  - o corpo de erro em array dá `BILLING_REQUEST_FAILED` sem `description` nem segredos na mensagem;
  - um timeout numa chamada `write` → `uncertain: true`;
  - FR com cliente sem NIF usa `999999990`;
  - artigo inexistente → `products/insert` antes do documento;
  - linha a 0% sem motivo → `BILLING_EXEMPTION_REASON_MISSING` e nenhum `insert` chamado;
  - `getPdf` devolve os bytes; um HTML devolve erro;
  - a `notes` e a `our_reference` seguem no documento;
  - `grant` recusado → `BILLING_AUTH_FAILED` (não `BILLING_UNREACHABLE`); corpo de erro em array → `BILLING_REQUEST_FAILED`; `fetch` que rejeita → `BILLING_UNREACHABLE` (e `uncertain` nas escritas);
  - FT: `invoices/insert` seguido de `receipts/insert` com `associated_documents`; recibo a falhar → documento emitido com `warnings: ['RECEIPT_FAILED']`;
  - nota de crédito: `creditNotes/insert` com `associated_documents [{ associated_id, value }]`;
  - `findByReference`: com resultado → `getDocument`; sem → `null`;
  - imposto sem correspondência → `BILLING_TAX_NOT_FOUND`; total devolvido diferente do rascunho → `warnings` com `TOTAL_MISMATCH:<diff>`;
  - lookups em cache: duas emissões seguidas chamam `taxes/getAll` uma só vez (e outra vez depois de 1 h, com timers falsos);
  - importar `providers/billing/index.ts` deixa `getBillingProvider('moloni')` resolvido.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): billing provider contract and Moloni provider (unverified)`

---

### Task 9: Faturação (serviço)

**Files:**
- Create: `server/src/services/modules/ecommerce/invoices.ts` (`EcommerceInvoiceService`)
- Modify:
  - `orders.ts`:
    - `computeOrderState` carrega as alocações ativas (`uniqueKey` não nulo) e as faturas `ISSUED`/`PENDING`/`UNCERTAIN`;
    - `hasUninvoicedCompletedPayments` = algum pagamento com `invoiceableByPayment > 0`;
    - os pagamentos da `OrderView` ganham `invoice: { invoiceable: number; invoiceId: number | null; status: string | null }`;
    - `OrderView.invoices: InvoiceView[]`, `OrderView.billing: { active: boolean; providerId: string | null }`.
  - `services/index.ts`.
- Test: `tests/server/ecommerce/invoices.test.ts`

**Interfaces:**
- `InvoiceView = { id; kind; documentType; status; provider; number; series; total; lines: InvoiceLine[]; creditedInvoiceId: number | null; credited: number /* total das NC emitidas sobre esta */; paymentIds: number[]; error; warnings: string[]; issuedAt; createdAt }`
- `EcommerceInvoiceService`:
  - `activeProvider(): Promise<{ provider: BillingProvider; runtime: ProviderRuntime }>`:
    - `getActiveProviders('billing')`: 0 → `BILLING_NOT_CONFIGURED`; > 1 → `BILLING_PROVIDER_AMBIGUOUS`;
    - sem implementação registada → `BILLING_NOT_CONFIGURED`.
  - `preview(orderId, scope: { type: 'PAYMENT'; paymentId: number } | { type: 'TOTAL' }): Promise<{ lines: InvoiceLine[]; total: number; paymentIds: number[] }>` (sem escrita).
  - `issue(orderId, scope, input: { idempotencyKey: string }, actor): Promise<InvoiceView>`:
    1. Repetição da mesma chave → devolve a fatura existente.
    2. `activeProvider()`.
    3. Transação 1:
       - `lockOrder`, `computeOrderState`;
       - `OPEN`, senão `ACTION_NOT_AVAILABLE`;
       - pagamento `COMPLETED` com `invoiceable > 0`, senão `PAYMENT_NOT_INVOICEABLE`; `TOTAL` = todos os que tenham valor por faturar, e com nenhum → `NOTHING_TO_INVOICE`;
       - `reconcileCoverages` com `payments[].coverage` convertido por `toPaymentCoverage` e `invoiced` = `toInvoicedCoverage(allocation.coverage)` das alocações ativas;
       - `buildInvoiceLines` sobre o resultado, e `invoiceCustomer` a partir da `billingAddress` e do snapshot do cliente;
       - cria a `invoice` `PENDING` (`ourReference = LB-INV-<id>`, `lines`, `customerData`, `total`) e uma `invoice-allocation` por pagamento (`uniqueKey = payment:<id>`, `amount`, `coverage`). Uma violação do índice → `PAYMENT_NOT_INVOICEABLE`.
    4. `provider.issue(draft)`, fora da transação; `date = issueDate(now, store.timezone)`; `payments` = valor faturado por pagamento, com a data de `completedAt`.
    5. Transação 2, consoante o resultado:
       - sucesso → `ISSUED` (`externalId`, `number`, `series`, `documentType`, `issuedAt`, `metadata.warnings`, `metadata.locale`), histórico `INVOICE_ISSUED` e evento `INVOICE_ISSUED { invoiceId, kind: 'INVOICE' }`;
       - erro definitivo → `FAILED` (`error` = código), alocações com `uniqueKey = null` e histórico `INVOICE_FAILED`, e relança o erro;
       - `uncertain` → `UNCERTAIN`, alocações mantidas, histórico `INVOICE_UNCERTAIN`, e devolve a vista.
  - `reconcile(invoiceId, input: { markFailed?: boolean }, actor)`, só para `UNCERTAIN` ou `PENDING` com mais de 2 min:
    - `findByReference(ourReference)`: encontrado → `ISSUED` + evento `INVOICE_ISSUED { invoiceId, kind: invoice.kind }` (o `kind` da própria fatura, para que uma nota de crédito reconciliada não envie e-mail); `null` → `FAILED` e alocações libertadas;
    - sem capacidade `findByReference`, ou erro → o estado mantém-se e o erro é relançado. `markFailed: true` liberta à mão, depois de o administrador confirmar que o documento não existe no fornecedor (histórico com o actor).
  - `getPdf(invoiceId): Promise<{ filename: string; content: Buffer }>`:
    - só `ISSUED`; usa o fornecedor de `invoice.provider` com `getRuntime` (mesmo inativo);
    - `filename = <number com [^A-Za-z0-9._-] → _>.pdf`;
    - falha → `INVOICE_PDF_UNAVAILABLE`.
  - `creditNotePreview(invoiceId): Promise<{ lines: InvoiceLine[]; creditable: number[]; suggested: number[] }>`.
  - `issueCreditNote(invoiceId, input: { lines: { index: number; value: number }[]; reason: string; idempotencyKey: string }, actor): Promise<InvoiceView>`:
    - só sobre uma `INVOICE` `ISSUED`, com `capabilities.creditNotes`, em qualquer `OrderStatus`;
    - `validateCreditNoteRequest`;
    - linhas = as da fatura original com `total = value`, mantendo a proporção de `quantity` (quantidade 1 e `partial` quando não é inteira);
    - o rascunho `CREDIT_NOTE` reutiliza o `customerData` da fatura original como `customer`, o `locale` de `metadata.locale` da original, `payments: []` e `original = { externalId, total }`;
    - o mesmo fluxo em duas fases, sem alocações; histórico `CREDIT_NOTE_ISSUED`;
    - emite `INVOICE_ISSUED { invoiceId, kind: 'CREDIT_NOTE' }` (não envia e-mail).
  - `listForOrder(orderId): Promise<InvoiceView[]>`.
- [ ] **Step 1: Failing tests** (fornecedor simulado registado no registo de faturação):
  - **Review Focus 3** de ponta a ponta (a fatura emitida tem a linha nova e `total` = pago);
  - **Review Focus 4** (timeout → `UNCERTAIN`; um segundo `issue` do mesmo pagamento → `PAYMENT_NOT_INVOICEABLE`; `reconcile` encontrado → `ISSUED`; `reconcile` com `null` → `FAILED` e o pagamento volta a ser faturável);
  - erro definitivo → `FAILED`, o botão reaparece (`invoiceable > 0`) e o erro chega ao chamador;
  - sem fornecedor ativo → `BILLING_NOT_CONFIGURED` e nenhuma linha criada;
  - dois ativos → `BILLING_PROVIDER_AMBIGUOUS`;
  - "fatura total" com dois pagamentos (um já faturado) → só o outro;
  - encomenda `PARTIALLY_PAID` com um pagamento liquidado → faturável;
  - encomenda cancelada → `ACTION_NOT_AVAILABLE` para emitir, mas a nota de crédito é permitida;
  - nota de crédito acima do creditável → `exceeds_creditable`;
  - `INVOICE_TOTAL` aparece nas ações só com pagamentos por faturar;
  - `getPdf` com o fornecedor desativado continua a funcionar;
  - repetir `issue` com a mesma `idempotencyKey` devolve a mesma fatura e chama o fornecedor uma só vez; o mesmo para `issueCreditNote`;
  - `reconcile` com `markFailed: true` liberta as alocações e regista o actor no histórico; `reconcile` de uma nota de crédito encontrada emite `INVOICE_ISSUED` com `kind: 'CREDIT_NOTE'` (sem e-mail);
  - `getPdf` de uma fatura que não está `ISSUED` → erro; o `filename` troca `/` e espaços por `_` (`FR 2025/1` → `FR_2025_1.pdf`);
  - nota de crédito sobre uma fatura não `ISSUED`, ou sobre um fornecedor sem `creditNotes` → `NOT_SUPPORTED`/`ACTION_NOT_AVAILABLE`;
  - o rascunho da nota de crédito leva o `customerData` da original e `payments: []`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): payment-based invoicing, total invoice, credit notes and reconciliation`

---

### Task 10: Notificações de expedição, entrega e fatura

**Files:**
- Modify: `server/src/services/modules/ecommerce/notificationData.ts`, `notifications.ts`, `email/catalog.ts` (nova variável `shipment.allTracking`, lista com `carrier`, `trackingCode` e `trackingUrl`, só em `FULL_SHIPMENT`, com dados de exemplo), `email/defaults/fullShipment.ts` (lista as referências de rastreio de todas as expedições quando há mais do que uma; requisito 13.7)
- Test: `tests/server/ecommerce/notificationData.test.ts`, `tests/server/ecommerce/notifications.test.ts`, `tests/server/ecommerce/email/catalog.test.ts` (acrescentar)

**Interfaces:**
- `NotificationTemplateType` e `NOTIFICATION_TEMPLATE_TYPES` passam a incluir `PARTIAL_SHIPMENT`, `FULL_SHIPMENT`, `DELIVERY_CONFIRMATION` e `INVOICE_AVAILABLE`.
- `templateForEvent`:

| Evento | Template |
|---|---|
| `SHIPMENT_CREATED` (`notify !== false`) | `FULL_SHIPMENT` se `full`, senão `PARTIAL_SHIPMENT` |
| `SHIPMENT_DELIVERED` (`allDelivered && notify !== false`) | `DELIVERY_CONFIRMATION` |
| `INVOICE_ISSUED` (`kind === 'INVOICE'`) | `INVOICE_AVAILABLE` |
| `RETURN_REGISTERED` | nenhum |

- `NotificationExtra` ganha:
  - `shipment` (a linha da expedição);
  - `shipments` (as `ACTIVE` da encomenda, para `allTracking`);
  - `invoice` (`{ id, number }`).
- `buildTemplateData`:
  - **`shipment.items`:** os itens da expedição.
  - **`shipment.pendingItems`:** vêm de `event.payload.pending`, com o nome, a opção e o sku das linhas da encomenda; não são recalculados no envio.
  - **`shipment.carrier`, `trackingCode`, `trackingUrl`:** `''` quando são nulos.
  - **`delivery.date`:** o `deliveredAt` do evento, no fuso horário da loja.
  - **`invoice.number`.**
  - **`attachment: { kind: 'INVOICE_PDF', invoiceId }`:** só no `INVOICE_AVAILABLE`, fora do catálogo; é usado pelo envio.
- `notifications.ts`:
  - `prepare` carrega a expedição, as expedições e a fatura pelos ids do evento.
  - `deliver` chama `attachmentsFor(row)` antes do envio. Para `INVOICE_AVAILABLE` usa `EcommerceInvoiceService.getPdf(attachment.invoiceId)` e envia `attachments: [{ filename, content, contentType: 'application/pdf' }]`. Se falhar → `FAILED` com `error 'INVOICE_PDF_UNAVAILABLE'` (sem `throw`); o `resend` volta a tentar com o mesmo `payload`.
- [ ] **Step 1: Failing tests:**
  - **Review Focus 5;**
  - duas expedições parciais geram dois `PARTIAL_SHIPMENT` (eventos distintos); a que completa gera `FULL_SHIPMENT`;
  - `notify: false` → nenhuma notificação;
  - `SHIPMENT_DELIVERED` com `allDelivered: false` → nenhuma; com `true` → uma `DELIVERY_CONFIRMATION`;
  - a nota de crédito não envia e-mail;
  - o e-mail da fatura leva o anexo PDF;
  - o HTML renderizado de cada template deste plano não contém `/admin`, `/api/`, `/uploads` nem `littlebox-strapi-suite`, e todo o `href`/`src` começa por `store.url`, pelo link de rastreio da transportadora ou pelo Stripe (o `store.logoUrl`, configurado pelo administrador, é aceite tal como está e fica documentado no teste); o `INVOICE_AVAILABLE` não tem nenhum `href` além de `store.url`;
  - `buildTemplateData` cobre todas as variáveis do catálogo dos 4 tipos.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): shipment, delivery and invoice e-mails with PDF attachment`

---

### Task 11: API admin (expedições, entregas, devoluções e faturas)

**Files:**
- Create: `server/src/controllers/modules/ecommerce/{shipments,returns,invoices}.ts`, `server/src/routes/ecommerce/admin-fulfillment.ts`, `server/src/routes/ecommerce/admin-invoices.ts`
- Modify: `server/src/routes/admin-api.ts` (spreads), `server/src/controllers/index.ts`
- Test: `tests/server/ecommerce/fulfillmentRoutes.test.ts`, `tests/server/ecommerce/fulfillmentController.test.ts`, `tests/server/ecommerce/invoicesController.test.ts`

**Rotas** (middleware de módulo ativo; `o-read` = `ordersRead`, `o-manage` = `ordersManage`, `inv` = `invoicingManage`; os caminhos estáticos vêm antes dos `/:id`):

| Método | Path | Perm. | Corpo / resposta |
|---|---|---|---|
| POST | `/admin/ecommerce/orders/:id/shipments` | o-manage | `ShipmentInput` → 201 `ShipmentView` |
| POST | `/admin/ecommerce/shipments/:id/deliver` | o-manage | `{ deliveredAt, notifyCustomer }` |
| POST | `/admin/ecommerce/shipments/:id/tracking` | o-manage | `{ trackingCode?, trackingUrl? }` |
| POST | `/admin/ecommerce/shipments/:id/refresh-tracking` | o-manage | — |
| POST | `/admin/ecommerce/shipments/:id/retry` | o-manage | — |
| POST | `/admin/ecommerce/shipments/:id/cancel` | o-manage | `{ reason }` |
| GET | `/admin/ecommerce/shipments/:id/label` | o-read | PDF |
| POST | `/admin/ecommerce/orders/:id/returns` | o-manage | `ReturnInput` → 201 `{ return, refundable }` |
| GET | `/admin/ecommerce/orders/:id/invoice-preview?scope=PAYMENT&paymentId=` ou `?scope=TOTAL` | o-read | `{ lines, total, paymentIds }` |
| POST | `/admin/ecommerce/orders/:id/invoices` | inv | `{ scope: 'PAYMENT', paymentId, idempotencyKey } \| { scope: 'TOTAL', idempotencyKey }` → 201 |
| POST | `/admin/ecommerce/invoices/:id/reconcile` | inv | `{ markFailed? }` |
| GET | `/admin/ecommerce/invoices/:id/pdf` | o-read | PDF |
| GET | `/admin/ecommerce/invoices/:id/credit-note/preview` | o-read | |
| POST | `/admin/ecommerce/invoices/:id/credit-note` | inv | `{ lines: [{ index, value }], reason, idempotencyKey }` → 201 |

- Validação no controller com `validation.ts`:
  - ids inteiros ≥ 1 (400 `Invalid id`);
  - `idempotencyKey` obrigatório (≤ `MAX_KEY`);
  - quantidades e valores inteiros;
  - `notifyCustomer` booleano (por defeito `true`).
- **Respostas PDF:**
  - `ctx.type = 'application/pdf'`;
  - `Content-Disposition: attachment; filename="<filename>"`;
  - `Cache-Control: private, no-store`;
  - `ctx.body = Buffer`.
- Os erros passam pelo `handleDomainError` alargado na Task 1. Códigos de conflito 409: `QUANTITY_EXCEEDS_PENDING`, `ALREADY_DELIVERED` e `PAYMENT_NOT_INVOICEABLE`.
- [ ] **Step 1: Failing tests:**
  - cada rota tem a policy e a ação certas, e o middleware de módulo;
  - corpo inválido → 400 com `errors`;
  - `PAYMENT_NOT_INVOICEABLE` → 409;
  - o PDF sai com os cabeçalhos certos;
  - `EcommerceBillingError` → 400 com `code` e sem segredos.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): admin API for shipments, deliveries, returns and invoices`

---

### Task 12: Admin: expedições, entregas e devoluções

**Files:**
- Modify: `ecommerceOrdersGateway.ts`, `orderTypes.ts` (`ShipmentView`, `ReturnView`, `OrderView.shipping`, `OrderLineView.reserved/returnable`), `usecases/orders/*` (um por rota nova), `utils/orderDetail.ts` (`ToolbarAction` + `SHIP` e `REGISTER_RETURN` com `canManage`; códigos novos em `API_ERROR_CODES`), `OrderHeader.tsx` (variantes), `OrderDetailPage.tsx` (substitui o `SectionPlaceholder` de expedições), `OrderLinesTable.tsx` (enviado/encomendado e "Faltam enviar N unidades", requisito 4.3), `RefundModal.tsx` (prop opcional `initial?: { reason: RefundReason; amount?: number }`)
- Create: `admin/src/ecommerce/components/orders/{ShipOrderModal,ShipmentsSection,DeliveryModal,TrackingModal,RegisterReturnModal}.tsx`, `admin/src/ecommerce/utils/shipmentForm.ts`, `admin/src/ecommerce/utils/returnForm.ts`
- Modify: `admin/src/core/translations/{en,pt}.json`
- Test: `tests/admin/ecommerce/shipmentForm.test.ts`, `tests/admin/ecommerce/returnForm.test.ts`, `tests/admin/ecommerce/orderDetail.test.ts` (acrescentar)

**Comportamento:**
- **`ShipOrderModal`** (requisitos 10.4 e 12.6):
  - tabela das linhas com `pending > 0`: fotografia, nome, SKU, encomendado, enviado, pendente e quantidade a expedir (por defeito o pendente, limitada a ele);
  - método:
    - "Manual": transportadora em texto livre, por defeito o nome do método da encomenda, mais código e link de rastreio opcionais;
    - "Carrier": só quando o `providerId` da encomenda não é `manual`;
  - custo da expedição, pré-preenchido com `shipping.remainingCost`;
  - checkbox "Notify customer", ligada por defeito;
  - `idempotencyKey` por abertura;
  - os erros mostram as mensagens traduzidas (`NOT_IMPLEMENTED` explica que a integração CTT ainda não existe).
- **`ShipmentsSection`** (requisito 9.5):
  - indicador do estado de entrega da encomenda (`NONE` … `DELIVERED`);
  - uma linha por expedição: data, transportadora, itens, código e link de rastreio (link externo), custo, estado, estado de entrega e eventos expandíveis;
  - ações conforme o estado:
    - "Confirm delivery": `DeliveryModal` com a data/hora (por defeito agora) e a opção de notificar;
    - "Edit tracking" (`TrackingModal`);
    - "Refresh tracking", só em transportadoras;
    - "Label", que descarrega pelo gateway com `responseType: 'blob'` e abre num separador novo para imprimir;
    - "Retry", em `PENDING` incerto;
    - "Cancel", com confirmação e motivo;
  - estado vazio com ilustração.
- **`RegisterReturnModal`:**
  - linhas com `returnable > 0`: quantidade (0 até devolvível) e checkbox "Return to stock" (desligada e explicada quando a encomenda está cancelada);
  - motivo (obrigatório) e notas;
  - mostra o valor estimado (`Σ (unitPrice − unitDiscount) × q`, com a nota de que o desconto de encomenda é descontado no servidor);
  - depois de gravar, mostra o `refundableValue` e, com `canRefund` e `refundable > 0`, o botão "Refund now", que abre o `RefundModal` com `initial = { reason: 'RETURN', amount: min(refundableValue, refundable) }`.
- **Funções puras:**
  - `shipmentForm.ts`: `defaultShipLines(lines)`, `validateShipForm(form, lines) → Record<path, code>`, `isHttpUrl(s)`;
  - `returnForm.ts`: `defaultReturnLines(lines, orderStatus)`, `validateReturnForm(form, lines)`, `estimatedReturnValue(form, lines)`.
- [ ] **Step 1: Failing tests** das funções puras:
  - quantidade acima do pendente;
  - URL `javascript:` → `invalid_url`;
  - devolução vazia → `required`;
  - encomenda cancelada → `restock: false`;
  - `allowedToolbarActions` com `SHIP`/`REGISTER_RETURN` e sem `canManage`.
- [ ] Implementação, testes, os dois `tsc` e `npm run build`. **Commit** `feat(ecommerce): shipments, deliveries and returns UI`

---

### Task 13: Admin: faturas, notas de crédito e definições Moloni

**Files:**
- Modify: o gateway, `orderTypes.ts` (`InvoiceView`, `payments[].invoice`, `OrderView.billing`), `usecases/orders/*`, `PaymentsTable.tsx` ("Generate invoice" por linha quando `invoice.invoiceable > 0`), `OrderDetailPage.tsx` (substitui o `SectionPlaceholder` de faturas; o `ConfirmModal` de arquivar avisa quando há pagamentos por faturar), `utils/rbac.ts` (`INVOICING_MANAGE_ACTION`), `utils/orderDetail.ts` (`API_ERROR_CODES` com os códigos de faturação: `BILLING_*`, `INVOICE_PDF_UNAVAILABLE`, `PAYMENT_NOT_INVOICEABLE`, `NOTHING_TO_INVOICE`, `exceeds_creditable`), `admin/src/core/translations/{en,pt}.json` (inclui os rótulos dos 5 campos Moloni novos)
- Create: `admin/src/ecommerce/hooks/useInvoicingPermissions.ts`, `admin/src/ecommerce/components/orders/{InvoicesSection,IssueInvoiceModal,CreditNoteModal}.tsx`, `admin/src/ecommerce/utils/invoiceForm.ts`
- Test: `tests/admin/ecommerce/invoiceForm.test.ts`

**Comportamento:**
- **`IssueInvoiceModal`** (por pagamento ou "Generate total invoice"):
  - carrega o `invoice-preview` e mostra as linhas (nome, quantidade, total, IVA, marca "partial") e o total;
  - "Issue" emite com um `idempotencyKey` por abertura;
  - o resultado `UNCERTAIN` mostra um aviso a explicar a reconciliação.
- **`InvoicesSection`:**
  - "Generate total invoice", visível com `INVOICE_TOTAL` nas ações;
  - tabela com número, tipo (fatura / nota de crédito), data, total, estado, avisos (`RECEIPT_FAILED`, `TOTAL_MISMATCH`) e erro;
  - ações:
    - "Download PDF" (blob);
    - "Reconcile" em `UNCERTAIN`/`PENDING`, com uma segunda opção "Mark as failed" que pede confirmação explícita de que o documento não existe no fornecedor;
    - "Credit note" em faturas `ISSUED`.
- **`CreditNoteModal`:** linhas da fatura com valor creditável e campo de valor pré-preenchido com o `suggested`, motivo obrigatório, total.
- **Sem fornecedor de faturação ativo** (`billing.active = false`): os botões ficam desativados com uma dica a apontar para a secção existente Settings → Billing (`ecommerce.settings.sections.billing`).
- **Sem `invoicing.manage`:** os botões ficam escondidos.
- **`invoiceForm.ts`:** `validateCreditNoteForm(form, creditable)`, `creditNoteTotal(form)`, `invoiceStatusTone(status)`.
- [ ] **Step 1: Failing tests:**
  - valor acima do creditável;
  - total 0 → `required`;
  - motivo vazio → `required`.
- [ ] Implementação, testes, os dois `tsc` e `npm run build`. **Commit** `feat(ecommerce): invoices and credit notes UI`

---

### Task 14: Verificação final do plano 5

- [ ] `npx vitest run`, `npm run test:ts:back`, `npm run test:ts:front` e `npm run build` limpos.
- [ ] No Strapi de teste (`~/Projects/littlebox-plugins/strapi/backend-base`, MariaDB, reiniciado):
  1. As tabelas novas e os índices únicos existem (`ltb_st_module_ecommerce_shipments`, `ltb_st_module_ecommerce_shipment_events`, `ltb_st_module_ecommerce_order_returns`, `ltb_st_module_ecommerce_invoices`, `ltb_st_module_ecommerce_invoice_allocations`).
  2. Numa encomenda paga com 3 unidades, expedir 2 por método manual com rastreio dá `PARTIALLY_FULFILLED`; expedir a restante dá `FULFILLED`. Ficam as notificações `PARTIAL_SHIPMENT` e `FULL_SHIPMENT` (`SKIPPED` sem Resend). As quantidades "2 / 3" e "Faltam enviar" aparecem na tabela de produtos.
  3. Confirmar a entrega da primeira expedição não gera e-mail de entrega; confirmar a segunda gera uma `DELIVERY_CONFIRMATION`, o indicador mostra "Delivered" e "Archive" aparece. Arquivar funciona.
  4. Noutra encomenda enviada: devolver 1 unidade sem reposição e 1 com reposição. O stock só sobe 1, aparece "Refund" com o valor aprovado e o reembolso por transferência deixa `due = excess = 0`.
  5. Com o CTT ativo, o formulário de criação manual de encomenda continua a mostrar os métodos manuais. "Ship" por transportadora numa encomenda CTT (se existir) mostra o erro `NOT_IMPLEMENTED` claro.
  6. Sem fornecedor de faturação ativo, "Generate invoice" está desativado com a dica. Com o Moloni ativo e credenciais falsas, a emissão mostra `BILLING_AUTH_FAILED`, a fatura fica `FAILED` e o botão volta a estar disponível.
  7. O `payload` das notificações criadas e o HTML do e-mail de teste do `INVOICE_AVAILABLE` não contêm `localhost:1337`, `/admin` nem `/api/`.
- [ ] Commit de correções: `chore(ecommerce): plan 5 verification fixes`
