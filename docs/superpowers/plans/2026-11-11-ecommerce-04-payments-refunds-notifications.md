# E-commerce, plano 4: Stripe, reembolsos, vales de crédito e notificações (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o ciclo financeiro das encomendas e as notificações:
- **Stripe:** Checkout Sessions para pagamentos e links de pagamento complementar, com webhooks assinados e idempotentes.
- **Instruções de pagamento:** manuais ou Stripe, enviadas por e-mail.
- **Reembolsos:** transferência manual, vale de crédito ou Stripe, com estados, limites e associação aos pagamentos de origem.
- **Vales de crédito com saldo** (design 4.7): emissão, pagamento com vale, devolução de saldo no cancelamento.
- **Serviço central de notificações por e-mail:** orientado a eventos, idempotente, com histórico e reenvio.

**Re-partição dos planos [Escolha técnica]:** as expedições, entregas, devoluções e faturação (Moloni) passam para o **plano 5**, porque as devoluções dependem de expedições. As promoções passam para o plano 6 e a API do storefront para o plano 7.

**Architecture:**
- **Stripe:** `StripeClient` com `fetch`. Pedidos `application/x-www-form-urlencoded` com `Idempotency-Key` e verificação de assinatura HMAC-SHA256 dos webhooks feita no plugin, sem SDK.
- **Webhooks:** rota pública `content-api`. O corpo cru é capturado antes do body parser do Strapi por um middleware de servidor registado em `register()`. Cada evento é registado numa tabela com `eventId` único.
- **Domínio dos reembolsos:** puro (limites, distribuição pelos pagamentos Stripe, estado agregado).
- **Notificações:** subscrevem o `EcommerceEventBus` do plano 3 e enviam pelo Resend (plano 2), com uma chave única por `eventId:type`.

**Tech Stack:** Strapi 5, `node:crypto`, `fetch`, Vitest, React + `@strapi/design-system` v2.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (4.6, 4.7, 4.10, 4.13, 4.14, 9.2) e, nos requisitos (`docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`): capítulo Encomendas pontos 7, 8, 10.7–10.9, 13, 15 e 16.8 a 16.14.

## Global Constraints

- Tudo das Global Constraints dos planos 1 a 3 continua a valer:
  - alterações aditivas;
  - content-types ocultas;
  - dinheiro em cêntimos;
  - sem `@strapi/utils`;
  - JSON só com objetos ou arrays;
  - sem nomes reservados (createdBy, …);
  - `en` + `pt`.
- **Unicidade:** todo o atributo `unique: true` tem também um índice único em `indexes` (o teste `schemaIndexes` impõe-no).
- **Stripe** (design 4.6 e 4.14):
  - Checkout Sessions em EUR com `payment_method_types` omitido (métodos automáticos da conta), `expires_at = now + 23h55m` (abaixo do máximo de 24 h), `metadata { orderId, paymentId, purpose }`, `success_url`/`cancel_url` = `storefrontUrl` + caminhos das definições, com `?order={publicId}`.
  - O link dos e-mails é o **`url` da sessão** (nunca uma URL do Strapi).
  - **Uma sessão ativa por valor em dívida:** reutilizar se `status=open`, o valor for igual e faltar mais de 1 h para expirar; senão expirar a anterior e criar uma nova.
  - **Reembolsos:** `POST /v1/refunds` com `payment_intent`, `amount` e `Idempotency-Key`.
- **Webhooks:**
  - eventos tratados: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `refund.updated`, `refund.failed`;
  - assinatura `Stripe-Signature` verificada com o `webhookSecret` e tolerância de 300 s;
  - idempotência pelo `event.id`;
  - resposta 200 rápida também para eventos ignorados; 400 para assinatura inválida.
- **Uma liquidação só é registada por confirmação do Stripe** (webhook ou leitura da sessão no servidor). O regresso do cliente ao site não conta.
- **Reembolsos:**
  - estados `PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED`;
  - métodos `MANUAL_TRANSFER | STORE_CREDIT | STRIPE`;
  - nunca acima de `summary.excess` (o excedente líquido recebido sobre o total; numa encomenda cancelada o total efetivo é 0), menos os reembolsos `PENDING`/`PROCESSING` em curso;
  - Stripe só sobre pagamentos `STRIPE` `COMPLETED`, cada um limitado ao seu valor menos o já reembolsado;
  - o dinheiro devolvido nunca altera os pagamentos originais;
  - um reembolso não mexe no stock (requisito 15.15).
- **Vales de crédito (design 4.7):**
  - código aleatório de 12 caracteres alfanuméricos maiúsculos, sem caracteres ambíguos (`0 O 1 I`), formato `XXXX-XXXX-XXXX`;
  - valem só para o e-mail normalizado do cliente;
  - têm saldo e validade (por defeito +12 meses) e um ledger de movimentos com `operationKey` único;
  - o consumo é uma diminuição condicional (`balance >= valor`) **estrita**, que nunca ultrapassa o saldo;
  - pagar com vale cria um `payment` `STORE_CREDIT` `COMPLETED` (com cobertura por valor, `computeCoverage`);
  - **o cancelamento** de uma encomenda com pagamentos `STORE_CREDIT` cria automaticamente, na mesma transação, um reembolso `STORE_CREDIT` `COMPLETED` por cada um, e repõe o saldo.
- **Notificações:**
  - chave única `notif:<eventId>:<type>`;
  - estados `SENT | FAILED | SKIPPED` (`SKIPPED` quando o Resend não está ativo ou o cliente não tem e-mail);
  - uma falha nunca reverte a operação comercial;
  - reenvio manual no admin;
  - valores monetários formatados no locale da encomenda (`Intl.NumberFormat(locale,{style:'currency',currency:'EUR'})`);
  - **zeros passam como string vazia** em `payment.amountDue` e `order.discount`;
  - o idioma é o da encomenda, com fallback (plano 2).
- Novas permissões: `ecommerce.refunds.manage` (reembolsos e vales) e `ecommerce.payments.manage` (links Stripe e instruções). Ler encomendas continua a usar `orders.read`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Webhook repetido** (o Stripe reenvia o mesmo `event.id`): o pagamento é liquidado e notificado uma única vez. Teste na Task 5.
2. **Reembolso Stripe de 30 € numa encomenda com dois pagamentos Stripe de 20 € cada:** é distribuído pelos dois (o mais recente primeiro) e nenhum ultrapassa o seu valor. Teste na Task 3.
3. **Pedir um link Stripe duas vezes para a mesma dívida:** a mesma sessão é reutilizada. Depois de mudar a dívida, a sessão anterior é expirada. Teste na Task 4.
4. **Pagar com um vale de saldo insuficiente, ou com um e-mail diferente do do vale:** é recusado, e o saldo e os pagamentos ficam iguais. Teste na Task 6.
5. **Resend em baixo no momento do evento:** a operação conclui, a notificação fica `FAILED` e "Reenviar" envia-a. Teste na Task 7.

---

### Task 1: Content-types, UIDs e permissões

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{refund,store-credit,store-credit-movement,stripe-session,notification,webhook-event}/{schema.json,index.ts}`
- Modify: `content-types/index.ts`, `config/index.ts` (UIDs `refund`, `storeCredit`, `storeCreditMovement`, `stripeSession`, `notification`, `webhookEvent`), `permissions.ts` (`refundsManage`, `paymentsManage`)
- Test: `tests/server/ecommerce/paymentsContentTypes.test.ts` (o `schemaIndexes` e o teste de nomes reservados têm de continuar a passar)

**Interfaces (atributos, todos com relações unidirecionais `manyToOne` quando apontam para tipos de planos anteriores):**
- `refund`:
  - `order`, `payment` (pagamento de origem; opcional para `STORE_CREDIT` emitido como compensação)
  - `method` enum `MANUAL_TRANSFER,STORE_CREDIT,STRIPE`
  - `kind` enum `MONEY,STORE_CREDIT`
  - `status` enum dos 5 (default `PENDING`)
  - `amount` (int, required), `currency`
  - `reason` (string), `description` (text), `reference`, `externalId`
  - `idempotencyKey` (string unique + índice), `storeCredit` (opcional)
  - `actor`, `completedAt`, `metadata` (json)
- `store-credit`:
  - `code` (string, required, unique + índice), `customer`, `emailNormalized` (índice não único)
  - `initialAmount`, `balance` (int), `currency`, `expiresAt` (datetime)
  - `status` enum `ACTIVE,VOID` (default `ACTIVE`; expirado é derivado de `expiresAt`)
  - `sourceOrder`, `sourceRefund`, `conditions` (text), `actor`
- `store-credit-movement`:
  - `storeCredit`, `type` enum `ISSUE,CONSUME,RESTORE,ADJUST`, `amount` (int com sinal)
  - `order`, `payment`, `refund`
  - `operationKey` (string, required, unique + índice), `actor`
- `stripe-session`:
  - `order`, `payment`, `sessionId` (string, required, unique + índice), `paymentIntentId`, `url` (text)
  - `amount`, `status` enum `OPEN,COMPLETE,EXPIRED` (default `OPEN`), `expiresAt`
  - `purpose` enum `CHECKOUT,SUPPLEMENTARY`
- `notification`:
  - `order`, `type` (string, um dos 12 tipos de template), `eventId`
  - `uniqueKey` (string, required, unique + índice)
  - `recipient`, `locale`
  - `status` enum `SENT,FAILED,SKIPPED`
  - `providerMessageId`, `error` (text), `attempts` (int, default 0), `sentAt`
  - `payload` (json): os dados de template usados, sem segredos
- `webhook-event`: `provider` (string), `eventId` (string, required, unique + índice), `type`, `status` enum `PROCESSED,IGNORED,FAILED`, `error` (text).
- Ações RBAC: `ecommerce.refunds.manage` e `ecommerce.payments.manage` (displayNames "Manage refunds and store credit", "Manage payment links and instructions").
- [ ] TDD como nos planos anteriores. **Commit** `feat(ecommerce): payments, refunds, store credit and notification content-types`

---

### Task 2: Cliente Stripe e verificação de assinatura

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/payments/stripeClient.ts`
- Test: `tests/server/ecommerce/providers/stripeClient.test.ts`

**Interfaces:**
- `createStripeClient(rt: ProviderRuntime)` devolve:
  - `createCheckoutSession(p: { amount: number; currency: 'EUR'; description: string; customerEmail?: string; successUrl: string; cancelUrl: string; expiresAt: number /*unix s*/; metadata: Record<string,string>; idempotencyKey: string }): Promise<{ id; url; status; expiresAt; paymentIntentId: string | null }>`, com `mode=payment` e um único `line_items[0]` de `price_data`;
  - `retrieveCheckoutSession(id)` → `{ id; status: 'open'|'complete'|'expired'; paymentStatus: 'paid'|'unpaid'|'no_payment_required'; paymentIntentId; amountTotal; metadata }`;
  - `expireCheckoutSession(id)`, que ignora o erro "already expired/complete";
  - `createRefund(p: { paymentIntentId; amount; idempotencyKey; metadata })` → `{ id; status: 'pending'|'succeeded'|'failed'|'canceled'|'requires_action' }`.
- Detalhes do pedido:
  - corpo codificado como formulário (`metadata[orderId]=…`, `line_items[0][price_data][unit_amount]=…`);
  - cabeçalhos `Authorization: Bearer <secretKey>`, `Stripe-Version: 2024-06-20` e `Idempotency-Key`;
  - timeout de 15 s (`timedFetch` do plano 2).
  - Erros → `EcommercePaymentError(code: 'STRIPE_NOT_CONFIGURED' | 'STRIPE_REQUEST_FAILED' | 'STRIPE_UNREACHABLE', message sem segredos)`, acrescentado a `errors.ts`.
- `verifyStripeSignature(rawBody: Buffer, header: string, secret: string, nowSec = Date.now()/1000, toleranceSec = 300): boolean`:
  - o cabeçalho tem a forma `t=…,v1=…[,v1=…]`;
  - o HMAC-SHA256 hex de `${t}.${rawBody}` é comparado com `timingSafeEqual`;
  - rejeita fora da tolerância.
- [ ] **Step 1: Failing tests** (`fetch` simulado):
  - a codificação do formulário (incluindo `metadata` aninhado) e os cabeçalhos;
  - um 401 dá `STRIPE_REQUEST_FAILED` sem a chave na mensagem;
  - um erro de rede dá `STRIPE_UNREACHABLE`;
  - `verifyStripeSignature`: assinatura válida → true; corpo alterado → false; `t` antigo (400 s) → false; vários `v1`, um deles válido → true.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): Stripe REST client and webhook signature verification`

---

### Task 3: Domínio puro de reembolsos e vales

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/refunds.ts`, `server/src/services/modules/ecommerce/domain/storeCredit.ts`
- Test: `tests/server/ecommerce/domain/refunds.test.ts`, `tests/server/ecommerce/domain/storeCredit.test.ts`

**Interfaces:**
- `refundableAmount(summary: FinancialSummary, inFlightRefunds: number): number`, igual a `max(0, summary.excess − inFlight)`.
- `type RefundSource = { paymentId: number; method: 'STRIPE' | 'MANUAL' | 'STORE_CREDIT'; status: PaymentRecordStatus; amount: number; refundedOrInFlight: number; paymentIntentId: string | null; completedAt: string }`
- `allocateStripeRefund(amount: number, sources: RefundSource[]): { allocations: { paymentId; paymentIntentId; amount }[]; unallocated: number }`:
  - só aceita `STRIPE` `COMPLETED` com `paymentIntentId`;
  - percorre do mais recente (`completedAt` desc, depois `paymentId` desc) para o mais antigo;
  - o limite por pagamento é `amount − refundedOrInFlight`.
- `validateRefundRequest(input: { amount; method; reason }, ctx: { refundable; stripeAvailable }): { path; code }[]`, com os códigos:
  - `invalid_amount` (inteiro > 0);
  - `exceeds_refundable`;
  - `required` (motivo);
  - `stripe_unavailable` (sem pagamentos Stripe com saldo, ou o valor Stripe disponível é menor que o pedido).
- `generateStoreCreditCode(random: (n:number)=>Buffer): string`, no formato das Global Constraints, alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- `storeCreditUsable(credit: { status; balance; expiresAt; emailNormalized }, email: string, now: Date): { ok: true } | { ok: false; code: 'STORE_CREDIT_NOT_FOUND' | 'STORE_CREDIT_EXPIRED' | 'STORE_CREDIT_EMAIL_MISMATCH' | 'STORE_CREDIT_EMPTY' | 'STORE_CREDIT_VOID' }`
- [ ] **Step 1: Failing tests:**
  - Review Focus 2 (30 € sobre 20 € + 20 €: 20 € do mais recente e 10 € do outro);
  - os pagamentos `MANUAL` são ignorados pelo Stripe;
  - `refundableAmount` com um reembolso em curso;
  - os códigos de validação;
  - o código gerado bate com `/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/`;
  - `storeCreditUsable`: e-mail diferente, expirado, saldo 0, anulado.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): refund allocation and store credit domain rules`

---

### Task 4: Links Stripe e instruções de pagamento

**Files:**
- Create: `server/src/services/modules/ecommerce/stripePayments.ts` (`EcommerceStripePaymentService`)
- Modify: `server/src/services/modules/ecommerce/payments.ts` (`sendPaymentInstructions`)
- Test: `tests/server/ecommerce/stripePayments.test.ts`

**Interfaces:**
- `EcommerceStripePaymentService.getOrCreatePaymentLink(orderId, opts: { purpose: 'CHECKOUT' | 'SUPPLEMENTARY'; actor }): Promise<{ url; expiresAt; sessionId; amount; reused: boolean }>`:
  - pré-condições: Stripe ativo, senão `STRIPE_NOT_CONFIGURED`; encomenda `OPEN`; `due > 0`, senão `NOTHING_DUE`; `storefrontUrl` definido, senão `STOREFRONT_URL_MISSING`.
  - Procura uma `stripe-session` `OPEN` desta encomenda: se tiver o mesmo `amount` e expirar daqui a mais de 1 h, reutiliza-a. Caso contrário, expira as abertas (Stripe e linha → `EXPIRED`, os pagamentos `PENDING` ligados → `CANCELLED`) e cria uma nova.
  - Criar uma nova sessão implica:
    - um `payment` `STRIPE`/`PENDING` com `amount = due` e `externalId = sessionId`;
    - uma `stripe-session` `OPEN`;
    - histórico `PAYMENT_CREATED` ("Stripe payment link created").
  - `Idempotency-Key = session:<orderId>:<due>:<n>`, em que `n` é o número de sessões já criadas para a encomenda.
- `EcommercePaymentService.sendPaymentInstructions(orderId, input: { mode: 'MANUAL'; instructions: string } | { mode: 'STRIPE' }, actor)`:
  - `SEND_PAYMENT_INSTRUCTIONS` disponível;
  - `MANUAL` exige instruções com 1 a 5000 caracteres;
  - `STRIPE` chama `getOrCreatePaymentLink(SUPPLEMENTARY)` (`CHECKOUT` se ainda não houver nenhum pagamento);
  - histórico `PAYMENT_INSTRUCTIONS_SENT`;
  - emite o novo evento `PAYMENT_INSTRUCTIONS_SENT` com `{ mode, instructions?, url?, expiresAt?, amountDue, supplementary: boolean /* já existia pagamento COMPLETED */ }`;
  - nunca marca nada como liquidado;
  - devolve `{ url?, expiresAt? }`.
- Acrescentar `PAYMENT_INSTRUCTIONS_SENT`, `REFUND_STARTED`, `REFUND_COMPLETED`, `REFUND_FAILED` e `STORE_CREDIT_ISSUED` ao `DomainEventType` (`events.ts`).
- [ ] **Step 1: Failing tests** (`stripeClient` simulado): Review Focus 3; sem `storefrontUrl` → erro; a dívida muda → a sessão anterior é expirada e o pagamento `PENDING` passa a `CANCELLED`; as instruções manuais emitem o evento sem link; Stripe inativo → `STRIPE_NOT_CONFIGURED`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): Stripe payment links and payment instructions`

---

### Task 5: Webhook Stripe

**Files:**
- Create: `server/src/middlewares/ecommerceRawBody.ts` (registado em `register.ts` com `strapi.server.use`, como o `createTabsMiddleware`), `server/src/services/modules/ecommerce/stripeWebhooks.ts` (`EcommerceStripeWebhookService`), `server/src/controllers/modules/ecommerce/stripeWebhook.ts`, `server/src/routes/ecommerce/content-api-webhooks.ts`
- Modify: `server/src/register.ts` (só a linha nova), `server/src/routes/content-api.ts` (spread), `server/src/controllers/index.ts`
- Test: `tests/server/ecommerce/stripeWebhooks.test.ts`, `tests/server/ecommerce/rawBody.test.ts`

**Interfaces:**
- **Middleware `ecommerceRawBody`:**
  - para `POST` em `/api/littlebox-strapi-suite/ecommerce/stripe/webhook`, lê o corpo cru do pedido, guarda-o em `ctx.state.ecommerceRawBody: Buffer` e repõe um stream com os mesmos bytes, para o body parser seguinte continuar a funcionar;
  - para os outros caminhos, não faz nada;
  - limite de 1 MB → 413.
  - **Verificar no Strapi real** que o middleware corre antes do `strapi::body`. Se não correr, usar a alternativa documentada: `ctx.request.body[Symbol.for('unparsedBody')]` quando o anfitrião ativar `includeUnparsed`, com o aviso correspondente no ecrã de definições.
- **Rota:** `POST /ecommerce/stripe/webhook`, com `auth: false` e o middleware de módulo ativo (403 com o módulo desligado).
- **`EcommerceStripeWebhookService.handle(rawBody, signature)`:**
  - assinatura inválida, ou `webhookSecret` em falta → `EcommercePaymentError('WEBHOOK_SIGNATURE_INVALID')` → 400;
  - `event.id` já registado → `{ duplicate: true }` → 200;
  - caso contrário, numa transação, regista o `webhook-event` (o `eventId` único fecha corridas: em violação, devolve `duplicate`) e trata o evento.
- **`checkout.session.completed` com `payment_status=paid`, ou `async_payment_succeeded`:**
  - encontra a `stripe-session` pelo `sessionId`;
  - o pagamento `PENDING` passa a `COMPLETED`, com `completedAt`, `externalId = paymentIntentId` e `coverage = computeCoverage(...)` calculada **no momento da liquidação**;
  - a sessão passa a `COMPLETE`;
  - `recalculate`, histórico `PAYMENT_COMPLETED` (actor `webhook:stripe`) e evento `PAYMENT_COMPLETED`.
  - `completed` com `unpaid` (pagamento assíncrono, como o Multibanco) mantém `PENDING` e regista apenas o `paymentIntentId`.
- **`async_payment_failed`:** pagamento `FAILED` e sessão `EXPIRED`.
- **`checkout.session.expired`:** sessão `EXPIRED`; o pagamento `PENDING` passa a `CANCELLED`.
- **`charge.refunded`, `refund.updated` e `refund.failed`:** atualizam o reembolso pelo `externalId` (re_…):
  - `succeeded` → `COMPLETED` (`recalculate`, evento `REFUND_COMPLETED`);
  - `failed`/`canceled` → `FAILED` (evento `REFUND_FAILED`).
- Outros eventos → `IGNORED`. Um erro no tratamento → `webhook-event` `FAILED` e 500 (o Stripe volta a tentar). Um evento cuja sessão não seja deste plugin → `IGNORED`.
- [ ] **Step 1: Failing tests:**
  - Review Focus 1;
  - assinatura inválida → 400;
  - pagamento assíncrono (`completed` não pago, depois `async_payment_succeeded`) → `COMPLETED` uma só vez;
  - `expired` → `CANCELLED`;
  - reembolso `succeeded`;
  - o middleware guarda o corpo cru e o parser seguinte continua a ver o JSON (teste com koa simulado).
- [ ] Steps 2–5, mais uma **verificação no Strapi real**: o controlador do plano envia um evento assinado com um `webhookSecret` de teste via `curl` (ver a Task 10).
- [ ] **Commit** `feat(ecommerce): signed, idempotent Stripe webhooks`

---

### Task 6: Vales de crédito e reembolsos (serviço)

**Files:**
- Create: `server/src/services/modules/ecommerce/storeCredits.ts` (`EcommerceStoreCreditService`), `server/src/services/modules/ecommerce/refunds.ts` (`EcommerceRefundService`)
- Modify: `server/src/services/modules/ecommerce/orders.ts`:
  - `computeOrderState` passa a ler os reembolsos reais;
  - os reembolsos `PENDING`/`PROCESSING` alimentam `hasPendingRefunds`;
  - `cancel` chama `releaseStoreCreditOnCancel` dentro da transação.
- Modify: `server/src/services/modules/ecommerce/payments.ts` (`addStoreCreditPayment`)
- Test: `tests/server/ecommerce/storeCredits.test.ts`, `tests/server/ecommerce/refunds.test.ts`

**Interfaces:**
- **`EcommerceStoreCreditService`:**
  - `issue({ customerId, amount, expiresAt?, conditions?, sourceOrderId?, sourceRefundId?, actor, operationKey })`:
    - gera um código único (nova tentativa em caso de colisão no índice);
    - `balance = amount`, movimento `ISSUE`;
    - evento `STORE_CREDIT_ISSUED`.
  - `consume({ code, email, amount, orderId, paymentId, operationKey })`: valida com `storeCreditUsable` e faz um decremento condicional via knex (`UPDATE … SET balance = balance - ? WHERE id = ? AND balance >= ?`). Se afetar 0 linhas → `STORE_CREDIT_INSUFFICIENT`. Regista o movimento `CONSUME`.
  - `restore({ storeCreditId, amount, refundId, operationKey })`: incremento e movimento `RESTORE`.
  - `listForCustomer(customerId)`, `get(id)` com movimentos, `list({ page, search })` (código ou e-mail), `void(id, actor)`.
- **`EcommercePaymentService.addStoreCreditPayment(orderId, { code, idempotencyKey }, actor)`:**
  - `ADD_PAYMENT` disponível;
  - `amount = min(due, saldo)`;
  - numa transação: cria o `payment` `STORE_CREDIT` `COMPLETED` (com a cobertura) e chama `consume`;
  - histórico e evento `PAYMENT_COMPLETED`.
  - O e-mail usado é o do snapshot da encomenda (Review Focus 4).
- **`EcommerceRefundService`:**
  - `preview(orderId)` → `{ orderTotal; received: paid; refunded; inFlight; refundable; stripeRefundable; hasStripe }` (requisito 15.5).
  - `create(orderId, input: { method; amount; reason; description?; reference?; expiresAt?; idempotencyKey }, actor)` valida com `validateRefundRequest`. Por método:
    - `MANUAL_TRANSFER`: o reembolso fica `COMPLETED` (`kind: MONEY`), com histórico `REFUND_COMPLETED` e evento `REFUND_COMPLETED`.
    - `STORE_CREDIT`: chama `issue(...)` e o reembolso fica `COMPLETED` (`kind: STORE_CREDIT`, `storeCredit`), com os eventos `STORE_CREDIT_ISSUED` e `REFUND_COMPLETED`.
    - `STRIPE`: `allocateStripeRefund` gera um reembolso por alocação (`PROCESSING`, `payment` de origem, `idempotencyKey = <key>:<paymentId>`) e `createRefund`. Se a resposta for `succeeded`, passa logo a `COMPLETED`; com `pending`, fica `PROCESSING` e emite `REFUND_STARTED`; com `failed`, passa a `FAILED`.
  - Se `create` for repetido com o mesmo `idempotencyKey`, devolve os reembolsos existentes.
  - `list(orderId)` devolve a vista do requisito 15.11, com motivo, descrição, responsável e pagamento associado.
  - `releaseStoreCreditOnCancel(orderId, actor)` (chamado em `cancel`): para cada pagamento `STORE_CREDIT` `COMPLETED` com saldo por devolver, cria um reembolso `STORE_CREDIT` `COMPLETED` e chama `restore`, com `operationKey = cancel-credit:<paymentId>`.
  - Reembolsar um pagamento `STORE_CREDIT` por `create` (método `STORE_CREDIT`, `payment` de origem) também usa `restore` sobre o vale original. **[Escolha técnica]** A modal do admin escolhe automaticamente o vale original quando o excedente provém de pagamentos com vale.
- [ ] **Step 1: Failing tests:**
  - Review Focus 4;
  - consumo concorrente simulado (`UPDATE` afeta 0 linhas → recusado);
  - cancelar uma encomenda paga com vale repõe o saldo e cria um reembolso `COMPLETED`, e um segundo cancelamento não repõe nada;
  - transferência manual → `REFUNDED`/`PARTIALLY_REFUNDED`;
  - Stripe `pending` → `PROCESSING`, depois webhook `succeeded` → `COMPLETED`;
  - valor acima do reembolsável → `exceeds_refundable`;
  - o reembolso não cria movimentos de stock.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): store credit vouchers and refunds (manual, store credit, Stripe)`

---

### Task 7: Serviço central de notificações

**Files:**
- Create: `server/src/services/modules/ecommerce/notifications.ts` (`EcommerceNotificationService`), `server/src/services/modules/ecommerce/notificationData.ts` (puro: dados de template por evento)
- Modify: `server/src/bootstrap.ts` (subscrever o bus quando o módulo arranca)
- Test: `tests/server/ecommerce/notifications.test.ts`, `tests/server/ecommerce/notificationData.test.ts`

**Interfaces:**
- Correspondência evento → template:

| Evento | Template |
|---|---|
| `ORDER_CREATED` | `ORDER_CONFIRMATION` |
| `PAYMENT_COMPLETED` | `PAYMENT_CONFIRMATION` |
| `PAYMENT_INSTRUCTIONS_SENT` | `SUPPLEMENTARY_PAYMENT` se `supplementary`, senão `PAYMENT_INSTRUCTIONS` |
| `ORDER_CANCELLED` | `CANCELLATION` |
| `REFUND_STARTED` | `REFUND_STARTED` |
| `REFUND_COMPLETED` (só `kind: MONEY`) | `REFUND_COMPLETED` |
| `STORE_CREDIT_ISSUED` | `STORE_CREDIT_ISSUED` |

  As expedições, entregas e faturas chegam no plano 5.

- `buildTemplateData(type, ctx: { order: OrderView; store: StoreSettings; event: DomainEvent; extra })` é **puro**:
  - preenche exatamente as variáveis do catálogo do plano 2;
  - formata o dinheiro no locale da encomenda;
  - zeros passam como `''` em `payment.amountDue` e `order.discount`;
  - `payment.link` / `payment.expiresAt` vêm do evento;
  - `refund.isPartial` passa como `'yes'` ou `''`;
  - datas formatadas no fuso horário da loja (`Intl.DateTimeFormat(locale,{ dateStyle:'medium', timeZone })`).
- `EcommerceNotificationService.handle(event)`:
  - escolhe o template e calcula `uniqueKey`;
  - se já existir uma notificação `SENT` com essa chave, não faz nada;
  - destinatário = e-mail do snapshot;
  - sem Resend ativo → `SKIPPED` (`error: 'EMAIL_NOT_CONFIGURED'`);
  - senão chama `render(type, order.locale, data)` e `sendWithResend` com `idempotencyKey = uniqueKey`, e regista `SENT`/`FAILED` (com `attempts++`);
  - nunca lança; os erros são registados;
  - histórico da encomenda `NOTIFICATION_SENT` / `NOTIFICATION_FAILED`.
- `resend(notificationId, actor)` reenvia uma notificação `FAILED` ou `SKIPPED` com o mesmo `payload`. Se a chave já estiver `SENT`, devolve-a sem reenviar.
- `listForOrder(orderId)`.
- O subscritor é registado em `bootstrap` (`EcommerceEventBus.subscribe('*', …)`) e só atua com o módulo ativo.
- [ ] **Step 1: Failing tests:**
  - Review Focus 5;
  - um evento duplicado não envia duas vezes;
  - `SKIPPED` sem Resend;
  - `buildTemplateData` cobre todas as variáveis de cada tipo deste plano (cada caminho do catálogo existe nos dados);
  - formatação `pt-PT` (`29,90 €`) e `en` (`€29.90`);
  - os zeros passam como vazio;
  - `REFUND_STARTED` sem a frase "has been refunded".
- [ ] Steps 2–5. **Commit** `feat(ecommerce): event-driven customer email notifications`

---

### Task 8: API admin (pagamentos, reembolsos, vales, notificações)

**Files:**
- Create: `server/src/controllers/modules/ecommerce/{refunds,storeCredits,notifications}.ts`, `server/src/routes/ecommerce/admin-refunds.ts`
- Modify: `server/src/controllers/modules/ecommerce/orders.ts` e `routes/ecommerce/admin-orders.ts` (novas rotas de pagamentos), `admin-api.ts`, `controllers/index.ts`
- Test: `tests/server/ecommerce/refundsRoutes.test.ts`, `refundsController.test.ts`

**Rotas** (middleware ativo; `o-read` = `ordersRead`, `pay` = `paymentsManage`, `ref` = `refundsManage`, `c-read` = `customersRead`):

| Método | Path | Perm. |
|---|---|---|
| POST | `/admin/ecommerce/orders/:id/payment-link` | pay → `{ url, expiresAt, amount, reused }` |
| POST | `/admin/ecommerce/orders/:id/payment-instructions` | pay (`{ mode, instructions? }`) |
| POST | `/admin/ecommerce/orders/:id/store-credit-payment` | o-manage (`{ code, idempotencyKey }`) |
| GET | `/admin/ecommerce/orders/:id/refunds/preview` | o-read |
| GET | `/admin/ecommerce/orders/:id/refunds` | o-read |
| POST | `/admin/ecommerce/orders/:id/refunds` | ref |
| GET | `/admin/ecommerce/orders/:id/notifications` | o-read |
| POST | `/admin/ecommerce/notifications/:id/resend` | o-manage |
| GET | `/admin/ecommerce/store-credits?page&search` | c-read |
| GET | `/admin/ecommerce/store-credits/:id` | c-read |
| POST | `/admin/ecommerce/store-credits` | ref (`{ customerId, amount, expiresAt?, conditions?, idempotencyKey }`) |
| POST | `/admin/ecommerce/store-credits/:id/void` | ref |
| GET | `/admin/ecommerce/customers/:id/store-credits` | c-read |
| GET | `/admin/ecommerce/settings/stripe-webhook` | settingsRead → `{ path: '/api/littlebox-strapi-suite/ecommerce/stripe/webhook', events: [...] }` (só para mostrar no admin) |

- O `OrderView` passa a incluir os `refunds` reais e um `notificationsSummary` com `{ sent, failed, skipped }`.
- [ ] TDD de rotas e controllers. **Commit** `feat(ecommerce): admin API for payment links, refunds, store credit and notifications`

---

### Task 9: Admin: pagamentos, reembolsos, vales e notificações na encomenda

**Files:**
- Modify: o gateway e os tipos (`ecommerceOrdersGateway.ts`, `orderTypes.ts`), `OrderDetailPage.tsx`, `OrderHeader.tsx` (ações `SEND_PAYMENT_INSTRUCTIONS` e `REFUND`), `SupplementaryPaymentModal.tsx` (ativa Manual e Stripe), `AddPaymentModal.tsx` (separador "Store credit": código → `store-credit-payment`)
- Create: `admin/src/ecommerce/components/orders/{PaymentInstructionsModal,RefundModal,RefundsTable,NotificationsSection}.tsx`, `admin/src/ecommerce/components/customers/CustomerStoreCredits.tsx`, `admin/src/ecommerce/utils/refundForm.ts`
- Modify: `CustomerDetailPage.tsx` (secção de vales com a lista e "Issue store credit"); `SettingsPage` → separador Payments mostra o URL do webhook (`window.location.origin` + `path`) e os eventos a configurar no Stripe
- Test: `tests/admin/ecommerce/refundForm.test.ts`

**Comportamento:**
- **`PaymentInstructionsModal`** (requisitos 10.9 e 16.8), usado pela ação e pelo `SupplementaryPaymentModal`:
  - opções Manual (textarea pré-preenchida com um texto exemplo traduzido com referência e valor) ou Stripe (gera o link e mostra-o com botão Copiar);
  - "Send" chama `payment-instructions`;
  - o resultado mostra se o e-mail foi enfileirado (consultar as notificações a seguir).
- **`RefundModal`** (requisito 15.5):
  - mostra a referência, o total atual, o recebido, o já reembolsado, o em processamento e o máximo reembolsável;
  - campos: valor (por defeito o máximo), motivo (select com cancelamento, produto removido, quantidade reduzida, indisponível, devolução e outro), descrição;
  - método: transferência (referência), vale (validade, por defeito +12 meses, e condições) ou Stripe (só ativo com `hasStripe`, mostrando o reembolsável Stripe);
  - passo de resumo antes de confirmar;
  - `idempotencyKey` por abertura.
- **`RefundsTable`** (requisito 15.11): referência, método, valor, data, estado, id externo e Ver (os detalhes incluem motivo, descrição, responsável e pagamento associado).
- **`NotificationsSection`:** tipo, destinatário, estado, data e o botão "Resend" em `FAILED`/`SKIPPED`.
- **Cliente:** vales com código, saldo, validade e estado; "Issue store credit" abre uma modal; "Void" pede confirmação.
- As permissões RBAC escondem as ações (`payments.manage`, `refunds.manage`).
- [ ] Testes puros (`validateRefundForm`, `defaultInstructionsText`), implementação, testes, `tsc` e build. **Commit** `feat(ecommerce): refunds, payment instructions, store credit and notifications UI`

---

### Task 10: Verificação final do plano 4

- [ ] `npx vitest run`, os dois `tsc` e `npm run build` limpos.
- [ ] No Strapi de teste (MariaDB, reiniciado):
  1. As tabelas e os índices únicos novos existem.
  2. O webhook com assinatura gerada localmente (`webhookSecret` de teste gravado nas definições; corpo e assinatura `t=…,v1=HMAC` calculados em node) responde 200 e marca um pagamento `PENDING` como `COMPLETED`. O mesmo evento repetido não duplica, e uma assinatura errada dá 400.
  3. Sem chave Stripe real, "Payment link" mostra o erro `STRIPE_REQUEST_FAILED` de forma clara.
  4. As instruções manuais criam uma notificação `SKIPPED`, porque o Resend não está ativo.
  5. Um reembolso por transferência numa encomenda cancelada e paga resulta em `REFUNDED`.
  6. Emitir um vale e pagar outra encomenda com ele: o saldo baixa. Cancelar essa encomenda: o saldo é reposto.
- [ ] Commit de correções: `chore(ecommerce): plan 4 verification fixes`
