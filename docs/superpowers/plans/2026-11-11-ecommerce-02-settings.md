# E-commerce, plano 2: Configurações (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a secção **Settings** do e-commerce: dados da loja, credenciais cifradas e mascaradas das integrações (Stripe, Moloni, CTT Expresso só estrutura, Resend), métodos de entrega manuais e modelos de e-mail editáveis por idioma, com pré-visualização, envio de teste, histórico de versões e reposição do padrão.

**Architecture:** Um **registo de fornecedores** (`providers/registry.ts`) declara cada integração (categoria, campos, campos sensíveis, exclusividade, teste de ligação). O `EcommerceSettingsService` persiste a configuração não sensível e os segredos cifrados (AES-256-GCM) numa content-type própria, devolve-os sempre mascarados ao admin e entrega-os decifrados apenas aos serviços do servidor, com cache invalidada a cada alteração. Os modelos de e-mail usam um motor de templates mínimo e seguro (`{{var}}`, `{{#each}}`, `{{#if}}`), com padrões em inglês no código e personalizações por locale na base de dados.

**Tech Stack:** Strapi 5, `node:crypto`, `fetch` nativo (Stripe, Resend, Moloni, sem SDKs neste plano), React + `@strapi/design-system` v2, `@uiw/react-codemirror` (já presente no Strapi) + `@codemirror/lang-html`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (secções 2.1, 2.9, 2.10, 4.3, 4.13, 4.15, 4.16, 7, 9.2) e o capítulo **Configurações** de `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`.

## Global Constraints

- Tudo o que vale para o plano 1 continua a valer (`docs/superpowers/plans/2026-11-11-ecommerce-01-foundation-products.md`, secção Global Constraints): ficheiros partilhados só com alterações aditivas, content-types ocultas no CM/CTB, prefixo `ltb-st-module-ecommerce-*`, nomes em inglês, dinheiro em cêntimos, ilustrações no estilo definido, `en` + `pt` na interface.
- **Proibido** importar `@strapi/utils` no servidor (há um teste que o impede). Erros de domínio usam classes do plugin (`server/src/services/modules/ecommerce/errors.ts`).
- **Mascaramento:** 3 primeiros caracteres + `********` + 4 últimos; `********` se o valor tiver 8 ou menos caracteres (o mesmo `maskSecret` de `server/src/services/app/setting.ts`, reutilizado e não copiado).
- **Cifragem:** AES-256-GCM com IV aleatório de 12 bytes. A chave vem de `strapi.config.get('plugin::littlebox-strapi-suite').ecommerce?.encryptionKey` ou, em falta, de `process.env.LTB_ECOMMERCE_ENCRYPTION_KEY`. A chave de 32 bytes é derivada com SHA-256 da string configurada. Sem chave, gravar segredos falha com `ENCRYPTION_KEY_MISSING`, e o resto continua a funcionar.
- Nenhum segredo sai do servidor: nem nas respostas da API, nem em logs, nem em mensagens de erro, nem no histórico de auditoria. Não existe endpoint para revelar um segredo.
- Guardar sem preencher um campo secreto mantém o valor antigo. Um valor igual à sua própria máscara nunca é aceite como novo segredo.
- Apenas um fornecedor de **faturação** ativo de cada vez. Várias **transportadoras** podem estar ativas ao mesmo tempo.
- Alterações produzem efeito sem rebuild nem reinício (cache invalidada na gravação).
- Modelos de e-mail: padrões em **inglês**, uma personalização opcional por locale configurado no Strapi. Sem execução de código nos templates.
- Os e-mails nunca contêm URLs do Strapi/backoffice (design 4.13): as únicas URLs vêm de `storefrontUrl`, do Stripe ou do `logoUrl` configurado.
- Permissões: `plugin::littlebox-strapi-suite.ecommerce.settings.read` e `.settings.manage`.
- Sem CAPTCHA nem Key Vault.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/ecommerce`.

## Review Focus

1. **Mudança da chave de cifragem depois de haver segredos guardados:** decifrar falha. O utilizador espera ver a integração como "credenciais inválidas, volte a introduzir" e não um erro 500. Teste na Task 4 (`getIntegrations` marca `secretsStatus: 'unreadable'`).
2. **Admin cola o valor mascarado de volta no campo e grava:** o segredo antigo mantém-se. Teste na Task 4.
3. **Template com `<script>`, `onclick=` ou `href="javascript:..."`:** a gravação é rejeitada com erro claro. Teste na Task 5.
4. **Template com variável inexistente (`{{order.refrence}}`):** a gravação é rejeitada a indicar a variável. Teste na Task 5.
5. **Ativar o Moloni quando outro fornecedor de faturação está ativo:** o anterior fica desativado na mesma operação. Teste na Task 4.

---

### Task 1: Cifragem e mascaramento de segredos

**Files:**
- Create: `server/src/services/modules/ecommerce/secrets.ts`
- Modify: `server/src/services/app/setting.ts` (só exportar `maskSecret`, se ainda não estiver exportado; não alterar comportamento)
- Test: `tests/server/ecommerce/secrets.test.ts`

**Interfaces:**
- Produces:
  - `resolveEncryptionKey(strapi): Buffer | null`
  - `encryptSecret(plain: string, key: Buffer): EncryptedValue` com `type EncryptedValue = { v: 1; iv: string; tag: string; data: string }` (base64)
  - `decryptSecret(value: EncryptedValue, key: Buffer): string`, que lança `EcommerceSecretError('SECRET_UNREADABLE')` se a chave ou a tag não baterem certo
  - `maskSecret` reexportado de `services/app/setting.ts`
  - `isMaskedEcho(input: string, stored: string): boolean`, verdadeiro quando `input === maskSecret(stored)`
- Adicionar a `errors.ts`: `EcommerceSecretError(code: 'ENCRYPTION_KEY_MISSING' | 'SECRET_UNREADABLE')`.

- [ ] **Step 1: Failing tests**
  - Ida e volta com a mesma chave.
  - Duas cifragens do mesmo texto dão `iv`/`data` diferentes.
  - Chave errada → `SECRET_UNREADABLE`.
  - `data` adulterado → `SECRET_UNREADABLE`.
  - `maskSecret('sk_test_1234567890abcd') === 'sk_********abcd'`
  - `maskSecret('short') === '********'`
  - `isMaskedEcho('sk_********abcd', 'sk_test_1234567890abcd') === true`
  - `resolveEncryptionKey` com config ausente e env ausente → `null`; com env `'abc'` → Buffer de 32 bytes igual a `sha256('abc')`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): secret encryption and masking`

---

### Task 2: Content-types, UIDs e permissões das configurações

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{integration,store-setting,manual-shipping-method,email-template,email-template-version,audit-log}/{schema.json,index.ts}`
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (UIDs `integration`, `storeSetting`, `manualShippingMethod`, `emailTemplate`, `emailTemplateVersion`, `auditLog` em `uuid.modules.ecommerce`), `server/src/services/modules/ecommerce/permissions.ts` (`settingsRead`, `settingsManage`)
- Test: `tests/server/ecommerce/settingsContentTypes.test.ts`, `tests/server/ecommerce/permissions.test.ts` (acrescentar)

**Interfaces (atributos):**
- `integration`: `providerId` string (required, unique), `category` enumeration `payment|billing|carrier|email` (required), `active` boolean (default false), `config` json, `secrets` json (mapa `campo → EncryptedValue`), `updatedBy` string.
- `store-setting`: `key` string (required, unique), `value` json.
- `manual-shipping-method`: `name` json (mapa `locale → texto`, obrigatório no locale por defeito), `price` integer ≥ 0 (cêntimos, IVA incluído), `tax` decimal 0–100 (default 23), `countries` json (array ISO-3166 alfa-2, default `["PT"]`), `active` boolean (default true), `position` integer.
- `email-template`: `type` string (required), `locale` string (required), `subject` text, `html` text, `version` integer (default 1), `updatedBy` string. Índice único `["type","locale"]` com nome `ecommerce_email_tpl_type_locale_unique`.
- `email-template-version`: `type`, `locale`, `subject`, `html`, `version` integer, `createdBy` string.
- `audit-log`: `area` string (required), `action` string (required), `targetId` string, `userId` string, `details` json.
- Todas com `draftAndPublish: false` e os `pluginOptions` ocultos.

- [ ] **Step 1: Failing tests:** as 6 content-types existem com os atributos acima, ocultas, com o índice único do `email-template`. As permissões passam a registar 4 ações (`ecommerce.settings.read` e `.manage` juntam-se às de produtos).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): settings content-types and permissions`

---

### Task 3: Registo de fornecedores e testes de ligação

**Files:**
- Create: `server/src/services/modules/ecommerce/providers/registry.ts`
- Create: `server/src/services/modules/ecommerce/providers/definitions/{stripe,moloni,ctt-expresso,manual,resend}.ts`
- Test: `tests/server/ecommerce/providers/registry.test.ts`, `tests/server/ecommerce/providers/connectionTests.test.ts` (`fetch` simulado com `vi.stubGlobal`)

**Interfaces:**
- Produces:
  - `type ProviderCategory = 'payment' | 'billing' | 'carrier' | 'email'`
  - `type ProviderField = { key: string; type: 'string' | 'secret' | 'boolean' | 'number' | 'select'; required: boolean; default?: unknown; options?: string[]; label: string /* chave i18n do admin */ }`
  - `type ProviderRuntime = { config: Record<string, unknown>; secrets: Record<string, string> }`
  - `type ConnectionResult = { ok: boolean; code?: 'INVALID_CREDENTIALS' | 'UNREACHABLE' | 'NOT_IMPLEMENTED' | 'MISSING_FIELDS'; message?: string }`
  - `type ProviderDefinition = { id: string; category: ProviderCategory; name: string; fields: ProviderField[]; exclusive: boolean /* billing = true */; verified: boolean /* false = "não verificado" */; testConnection?(rt: ProviderRuntime): Promise<ConnectionResult> }`
  - `getProviderDefinitions(): ProviderDefinition[]`, `getProviderDefinition(id): ProviderDefinition | undefined`, `registerProvider(def)` (para planos futuros)
  - `validateProviderInput(def, input: { config?: Record<string, unknown>; secrets?: Record<string, string> }, hasStoredSecret: (key: string) => boolean): { path: string; code: 'required' | 'invalid_option' | 'invalid_number' }[]`
- Definições (valores exatos):

| id | categoria | campos (`*` obrigatório, `🔒` secreto) | testConnection |
|---|---|---|---|
| `stripe` | payment | `secretKey`*🔒, `webhookSecret`🔒, `publishableKey` | `GET https://api.stripe.com/v1/account` com `Authorization: Bearer <secretKey>`: 200 → ok; 401 → `INVALID_CREDENTIALS` |
| `moloni` | billing (exclusive) | `clientId`*, `clientSecret`*🔒, `username`*, `password`*🔒, `companyId`* (number), `documentType` (select `FR`/`FT`, default `FR`), `documentSetId` (number), `exemptionReason` (string) | `GET https://api.moloni.pt/v1/grant/?grant_type=password&client_id=…&client_secret=…&username=…&password=…`: `access_token` presente → ok, senão `INVALID_CREDENTIALS`. `verified: false` |
| `ctt-expresso` | carrier | `clientId`*, `contractNumber`*, `username`*, `password`*🔒 | devolve sempre `{ ok:false, code:'NOT_IMPLEMENTED' }`. `verified: false` |
| `manual` | carrier | nenhum (os métodos geridos na Task 4) | sem teste |
| `resend` | email | `apiKey`*🔒, `fromEmail`*, `fromName` | `GET https://api.resend.com/domains` com Bearer: 200 → ok; 401/403 → `INVALID_CREDENTIALS` |

  - Falhas de rede → `UNREACHABLE`. Nenhuma mensagem de erro inclui o valor de um segredo (teste: a mensagem não contém a chave usada).
- [ ] **Step 1: Failing tests:** as 5 definições, os campos e as categorias. `validateProviderInput` exige um segredo obrigatório só se não houver um guardado. Os resultados de cada `testConnection` com `fetch` simulado (200, 401, erro de rede), e nenhuma mensagem contém o segredo.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): provider registry and connection tests`

---

### Task 4: Serviço de configurações

**Files:**
- Create: `server/src/services/modules/ecommerce/settings.ts` (serviço `EcommerceSettingsService`), `server/src/services/modules/ecommerce/audit.ts` (serviço `EcommerceAuditService`)
- Modify: `server/src/services/index.ts`
- Test: `tests/server/ecommerce/settings.test.ts`

**Interfaces:**
- Consumes: Tasks 1 a 3.
- Produces:
  - `EcommerceAuditService.log(entry: { area: string; action: string; targetId?: string; userId?: string; details?: Record<string, unknown> }): Promise<void>`
  - `EcommerceSettingsService`:
    - `listIntegrations(): Promise<IntegrationView[]>` com `IntegrationView = { id; category; name; active; verified; fields: ProviderField[]; config: Record<string, unknown>; secrets: Record<string, string | null> /* mascarados */; secretsStatus: 'ok' | 'unreadable' | 'none'; encryptionKeyConfigured: boolean }`. Inclui todas as definições do registo, mesmo as nunca gravadas.
    - `updateIntegration(id, input: { config?; secrets? }, userId): Promise<IntegrationView>`. Valida com `validateProviderInput` (erro → `EcommerceValidationError`). Segredos vazios ou `isMaskedEcho` mantêm o valor guardado. Sem chave de cifragem e com segredo novo → `EcommerceSecretError('ENCRYPTION_KEY_MISSING')`. Faz audit com `details.changedFields` (só nomes, nunca valores) e invalida a cache.
    - `setActive(id, active: boolean, userId)`. Ativar um fornecedor `exclusive` desativa os outros da mesma categoria na mesma transação. Ativar sem campos obrigatórios preenchidos → `EcommerceValidationError` com `code:'required'`. Faz audit e invalida a cache.
    - `testConnection(id): Promise<ConnectionResult>`, usando o runtime decifrado e o resultado da definição.
    - `getRuntime(id): Promise<(ProviderRuntime & { active: boolean }) | null>`, **só para uso no servidor**. Cache em memória por `id`, com TTL de 60 s e invalidada em `updateIntegration`/`setActive`.
    - `getActiveProviders(category): Promise<string[]>`
    - `getStoreSettings(): Promise<StoreSettings>` e `updateStoreSettings(patch, userId)` com `StoreSettings = { storeName: string; logoUrl: string | null; brandColor: string /* default '#4945ff' */; storefrontUrl: string | null; paymentSuccessPath: string /* default '/checkout/success' */; paymentCancelPath: string /* default '/checkout/cancel' */; timezone: string /* default 'Europe/Lisbon' */; shippingCountries: string[] /* default ['PT'] */; supportEmail: string | null }`. Validação: URLs `http(s)` absolutas; `brandColor` hex `#rrggbb`; timezone válido (`Intl.DateTimeFormat` aceita); países ISO alfa-2 em maiúsculas.
    - Métodos manuais: `listManualMethods()`, `createManualMethod(input)`, `updateManualMethod(id, input)`, `deleteManualMethod(id)`, com validação de nome no locale por defeito, preço inteiro ≥ 0, `tax` 0–100 e países ISO.
- [ ] **Step 1: Failing tests** (Query Engine simulada, como no plano 1):
  - `listIntegrations` mostra os segredos mascarados, nunca em claro (verificar que o JSON da resposta não contém o segredo).
  - Gravar com o eco da máscara mantém o segredo (Review Focus 2).
  - Chave de cifragem trocada → `secretsStatus:'unreadable'`, sem lançar (Review Focus 1).
  - Ativar `moloni` com outro billing ativo desativa o outro (Review Focus 5). Para isso, o teste regista um fornecedor billing falso via `registerProvider`.
  - Ativar sem os obrigatórios → erro.
  - O audit não contém valores de segredo.
  - A cache é invalidada: `getRuntime` devolve o valor novo logo após `updateIntegration`.
  - Validações de `updateStoreSettings` e dos métodos manuais.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): settings service with encrypted integrations`

---

### Task 5: Motor de templates e catálogo de variáveis

**Files:**
- Create: `server/src/services/modules/ecommerce/email/templateEngine.ts`, `server/src/services/modules/ecommerce/email/catalog.ts`
- Test: `tests/server/ecommerce/email/templateEngine.test.ts`, `tests/server/ecommerce/email/catalog.test.ts`

**Interfaces:**
- Produces:
  - `renderTemplate(source: string, data: Record<string, unknown>): string`. Sintaxe: `{{path.to.value}}` (escapado em HTML), `{{#each path}}…{{/each}}` (dentro, `{{this.x}}` e `{{@index}}`), `{{#if path}}…{{else}}…{{/if}}`. Aninhamento permitido. Valores em falta → string vazia. Sem helpers, sem expressões, sem `eval`/`Function`.
  - `extractVariables(source: string): { path: string; kind: 'value' | 'each' | 'if' }[]`
  - `validateTemplate(type: EmailTemplateType, subject: string, html: string): TemplateIssue[]` com `TemplateIssue = { code: 'UNKNOWN_VARIABLE' | 'UNSAFE_HTML' | 'SYNTAX'; detail: string }`. Rejeita `<script`, atributos `on*=`, `javascript:` em `href`/`src`, `<iframe`, `<object`, `<embed`, chavetas desequilibradas e blocos não fechados. Variáveis desconhecidas segundo o catálogo do tipo (dentro de `#each`, `this.*` valida contra o esquema do item).
  - `type EmailTemplateType = 'ORDER_CONFIRMATION' | 'PAYMENT_CONFIRMATION' | 'PAYMENT_INSTRUCTIONS' | 'SUPPLEMENTARY_PAYMENT' | 'PARTIAL_SHIPMENT' | 'FULL_SHIPMENT' | 'DELIVERY_CONFIRMATION' | 'CANCELLATION' | 'REFUND_STARTED' | 'REFUND_COMPLETED' | 'INVOICE_AVAILABLE' | 'STORE_CREDIT_ISSUED'` (exportado como `EMAIL_TEMPLATE_TYPES`).
  - `getVariableCatalog(type): VariableDef[]` com `VariableDef = { path: string; description: string; kind: 'value' | 'list'; itemFields?: string[] }`, e `getSampleData(type): Record<string, unknown>` (dados fictícios, por exemplo `customer.firstName = 'João'`).
  - Variáveis comuns a todos os tipos: `store.name`, `store.logoUrl`, `store.brandColor`, `store.url`, `store.supportEmail`, `customer.firstName`, `customer.lastName`, `customer.email`, `order.reference`, `order.date`.
  - Variáveis específicas:
    - `ORDER_CONFIRMATION`: `order.items` (lista com `name`, `option`, `sku`, `quantity`, `unitPrice`, `total`), `order.subtotal`, `order.shipping`, `order.discount`, `order.total`, `order.paymentStatus`, `payment.link`, `payment.amountDue`, `payment.expiresAt`.
    - `PAYMENT_CONFIRMATION`: `payment.amount`, `payment.method`, `payment.amountDue`.
    - `PAYMENT_INSTRUCTIONS` e `SUPPLEMENTARY_PAYMENT`: `payment.amountDue`, `payment.method`, `payment.instructions`, `payment.link`, `payment.expiresAt`.
    - `PARTIAL_SHIPMENT` e `FULL_SHIPMENT`: `shipment.items` (lista com `name`, `option`, `sku`, `quantity`), `shipment.pendingItems` (a mesma lista; só no parcial), `shipment.carrier`, `shipment.trackingCode`, `shipment.trackingUrl`.
    - `DELIVERY_CONFIRMATION`: `delivery.date`.
    - `CANCELLATION`: `order.cancelledAt`, `order.amountPaid`.
    - `REFUND_STARTED` e `REFUND_COMPLETED`: `refund.amount`, `refund.method`, `refund.reference`, `refund.isPartial`, `refund.description`.
    - `INVOICE_AVAILABLE`: `invoice.number`.
    - `STORE_CREDIT_ISSUED`: `credit.amount`, `credit.code`, `credit.expiresAt`, `credit.conditions`.
  - Valores monetários chegam já formatados como string (por exemplo `29,90 €`): o motor não formata.
- [ ] **Step 1: Failing tests:**
  - `renderTemplate('Olá, {{customer.firstName}}', {customer:{firstName:'<b>João</b>'}}) === 'Olá, &lt;b&gt;João&lt;/b&gt;'`
  - `#each` com `{{this.name}}` e `{{@index}}`
  - `#if`/`else`
  - Aninhamento de `each` dentro de `if`
  - `validateTemplate` sinaliza `<script>`, `onclick=`, `javascript:` (Review Focus 3), `{{order.refrence}}` (Review Focus 4) e um `{{#each}}` não fechado
  - `this.quantity` dentro de `#each order.items` é válido
  - Todos os tipos têm catálogo e dados de exemplo, e `validateTemplate` sobre os padrões (Task 6) devolve `[]`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): safe email template engine and variable catalog`

---

### Task 6: Modelos padrão, serviço de modelos e envio pelo Resend

**Files:**
- Create: `server/src/services/modules/ecommerce/email/defaults/*.ts` (um por tipo, `{ subject: string; html: string }`, mais `layout.ts` com o invólucro comum)
- Create: `server/src/services/modules/ecommerce/email/templates.ts` (serviço `EcommerceEmailTemplateService`)
- Create: `server/src/services/modules/ecommerce/providers/email/resendSender.ts`
- Modify: `server/src/services/index.ts`
- Test: `tests/server/ecommerce/email/templates.test.ts`, `tests/server/ecommerce/email/resendSender.test.ts`

**Interfaces:**
- Produces:
  - Padrões: HTML de e-mail com tabelas (compatível com Outlook e Gmail), largura máxima de 600 px, responsivo, logótipo (`{{#if store.logoUrl}}`, senão o nome da loja), cor `store.brandColor` nos botões, botões só quando a variável correspondente existe (`{{#if payment.link}}`), rodapé com `store.name` e `store.supportEmail`. Textos em inglês. Cada padrão passa em `validateTemplate`.
  - `type EmailMessage = { to: string; subject: string; html: string; attachments?: { filename: string; content: Buffer; contentType: string }[]; idempotencyKey?: string }`
  - `sendWithResend(rt: ProviderRuntime, msg: EmailMessage): Promise<{ id: string }>`: `POST https://api.resend.com/emails` com `from: "<fromName> <fromEmail>"`, anexos em base64 e cabeçalho `Idempotency-Key` quando existir. Erros → `EcommerceEmailError(code: 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED', message sem segredos)`.
  - `EcommerceEmailTemplateService`:
    - `list(): Promise<{ type; customLocales: string[] }[]>`
    - `get(type, locale): Promise<{ type; locale; subject; html; isCustom: boolean; version: number; variables: VariableDef[] }>`: a personalização desse locale, senão o padrão.
    - `save(type, locale, { subject, html }, userId)`: valida com `validateTemplate` (problemas → `EcommerceValidationError` com `errors: [{ path: 'html' | 'subject', code: issue.code, detail }]`), guarda a versão anterior em `email-template-version`, incrementa `version` e faz audit.
    - `listVersions(type, locale)` e `restoreVersion(type, locale, versionId, userId)`.
    - `restoreDefault(type, locale, userId)`: guarda a versão atual e apaga a personalização.
    - `preview(type, { subject, html }): { subject: string; html: string; issues: TemplateIssue[] }`, renderizado com `getSampleData` e os dados reais da loja (`getStoreSettings`).
    - `render(type, locale, data): Promise<{ subject; html }>`: personalização do locale → personalização do locale por defeito → padrão. Usado pelas notificações (plano 4).
    - `sendTest(type, locale, to, userId)`: renderiza com dados de exemplo, envia pelo Resend ativo (`getRuntime('resend')` ativo, senão `EMAIL_NOT_CONFIGURED`) e faz audit.
- [ ] **Step 1: Failing tests:**
  - `get` sem personalização devolve o padrão com `isCustom:false`.
  - `save` com HTML inválido → erro e nada gravado.
  - `save` duas vezes → 2 versões e `version` 3.
  - `restoreDefault` → `isCustom:false` e a versão anterior guardada.
  - `render` faz fallback de locale.
  - `sendWithResend` envia o `from` e os anexos em base64 corretos (`fetch` simulado). Um 401 dá `EMAIL_SEND_FAILED` sem a chave na mensagem.
  - `sendTest` sem Resend ativo → `EMAIL_NOT_CONFIGURED`.
  - Todos os 12 padrões passam em `validateTemplate`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): default email templates, template service and Resend sender`

---

### Task 7: API admin das configurações

**Files:**
- Create: `server/src/controllers/modules/ecommerce/settings.ts` (`EcommerceSettingsController`), `server/src/routes/ecommerce/admin-settings.ts`
- Modify: `server/src/routes/admin-api.ts`, `server/src/controllers/index.ts`
- Test: `tests/server/ecommerce/settingsRoutes.test.ts`, `tests/server/ecommerce/settingsController.test.ts`

**Interfaces** (todas com o middleware `check-module-is-active`; `read` = `settingsRead`, `manage` = `settingsManage`; erros de domínio mapeados como no plano 1: `EcommerceValidationError` → 400 `details.errors`, `EcommerceNotFoundError` → 404, `EcommerceSecretError`/`EcommerceEmailError` → 400 `details.code`):

| Método | Path | Perm. | Notas |
|---|---|---|---|
| GET | `/admin/ecommerce/settings/store` | read | `StoreSettings` |
| PUT | `/admin/ecommerce/settings/store` | manage | patch |
| GET | `/admin/ecommerce/settings/integrations` | read | `IntegrationView[]` |
| PUT | `/admin/ecommerce/settings/integrations/:id` | manage | `{ config?, secrets? }` |
| POST | `/admin/ecommerce/settings/integrations/:id/activate` | manage | `{ active: boolean }` |
| POST | `/admin/ecommerce/settings/integrations/:id/test` | manage | `ConnectionResult` |
| GET/POST | `/admin/ecommerce/settings/shipping-methods` | read/manage | lista / cria |
| PUT/DELETE | `/admin/ecommerce/settings/shipping-methods/:id` | manage | |
| GET | `/admin/ecommerce/settings/email-templates` | read | `list()` |
| GET | `/admin/ecommerce/settings/email-templates/:type/:locale` | read | `get()` |
| PUT | `/admin/ecommerce/settings/email-templates/:type/:locale` | manage | `{ subject, html }` |
| POST | `/admin/ecommerce/settings/email-templates/:type/preview` | read | `{ subject, html }` → `preview()` |
| POST | `/admin/ecommerce/settings/email-templates/:type/:locale/test` | manage | `{ to }` (e-mail válido, senão 400) |
| POST | `/admin/ecommerce/settings/email-templates/:type/:locale/restore-default` | manage | |
| GET | `/admin/ecommerce/settings/email-templates/:type/:locale/versions` | read | |
| POST | `/admin/ecommerce/settings/email-templates/:type/:locale/versions/:versionId/restore` | manage | |

  - O `userId` vem de `ctx.state.user.id`. `:type` desconhecido → 404. `:locale` fora dos locales do Strapi → 400.
- [ ] **Step 1: Failing tests:** cada rota tem o método, path, middleware e policy certos. O controller mapeia os erros e nenhuma resposta de integração contém um segredo em claro (teste com o serviço real e a Query Engine simulada).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): admin API for settings, integrations and email templates`

---

### Task 8: Admin, estrutura da página Settings e dados da loja

**Files:**
- Create: `admin/src/ecommerce/gateways/ecommerceSettingsGateway.ts`, `admin/src/ecommerce/usecases/settings/*.ts` (um por operação da Task 7)
- Create: `admin/src/ecommerce/pages/settings/SettingsPage.tsx` (sub-navegação: General, Payments, Billing, Shipping, Email service, Email templates), `admin/src/ecommerce/pages/settings/GeneralSettings.tsx`
- Modify: `admin/src/ecommerce/EcommerceApp.tsx` (rotas `settings`, `settings/:section`, `settings/email-templates/:type/:locale`), `admin/src/index.ts` (Registry), `en.json` e `pt.json`
- Test: `tests/admin/ecommerce/settingsForm.test.ts` (validação pura de URL, cor e países)

**Interfaces:**
- `SettingsPage` mostra o separador ativo a partir de `:section` (por defeito `general`). Sem a permissão `settings.manage`, os campos ficam só de leitura (usar `useRBAC` de `@strapi/strapi/admin` com as ações das Global Constraints).
- `GeneralSettings`:
  - campos `storeName`, `logoUrl` (com miniatura), `brandColor` (input de cor + hex), `storefrontUrl`, `paymentSuccessPath`, `paymentCancelPath`, `supportEmail`, `timezone` (`SingleSelect` com `Intl.supportedValuesOf('timeZone')`), `shippingCountries` (`MultiSelect` ISO-3166 com nomes via `Intl.DisplayNames`);
  - aviso persistente quando `encryptionKeyConfigured` é falso, a explicar `LTB_ECOMMERCE_ENCRYPTION_KEY`.
- [ ] **Step 1:** Testes puros (`isValidHttpUrl`, `isValidHexColor`, `normalizeCountries`). **Step 2: Implementar.** **Step 3:** `npx vitest run` e `tsc` admin limpos. **Step 4: Commit** `feat(ecommerce): settings page shell and store settings`

---

### Task 9: Admin, integrações e métodos de entrega manuais

**Files:**
- Create: `admin/src/ecommerce/pages/settings/IntegrationsSection.tsx` (reutilizado por Payments, Billing, Shipping e Email service, filtrado por `category`), `admin/src/ecommerce/components/settings/IntegrationCard.tsx`, `IntegrationConfigModal.tsx`, `ManualMethodsTable.tsx`, `ManualMethodModal.tsx`
- Test: `tests/admin/ecommerce/integrationForm.test.ts`

**Interfaces:**
- `IntegrationCard`: nome, badge de estado (Active / Inactive), badge "Not verified" quando `verified` é falso, indicação de credenciais (ok / unreadable / missing), botões Configure, Test connection (com o resultado inline: ok, `INVALID_CREDENTIALS`, `UNREACHABLE`, `NOT_IMPLEMENTED`, `MISSING_FIELDS`, cada um com texto traduzido) e o toggle Activate.
- **Billing:** ativar um fornecedor quando outro está ativo pede confirmação ("X será desativado").
- `IntegrationConfigModal` gera o formulário a partir de `fields`:
  - um `secret` mostra a máscara atual como placeholder e o campo vazio; vazio = manter;
  - `select` usa `options`;
  - `number` só aceita inteiros;
  - mostra os erros `details.errors` por campo.
- O separador **Shipping** mostra as transportadoras e, por baixo, `ManualMethodsTable`:
  - colunas: nome (locale por defeito), preço, IVA, países e ativo, com Editar e Eliminar (com `ConfirmModal`);
  - estado vazio com ilustração (nova `EmptyShipping`, no estilo definido);
  - `ManualMethodModal` tem o nome por locale (`LocaleSwitcher` do plano 1), preço (`parseMoneyToCents`), IVA, países (`MultiSelect`) e ativo.
- Pure helper testado: `buildIntegrationPayload(fields, formValues)`, que omite os segredos vazios e converte números.
- [ ] **Step 1:** Testes do helper. **Step 2: Implementar.** **Step 3:** testes e `tsc` limpos. **Step 4: Commit** `feat(ecommerce): integrations and manual shipping methods UI`

---

### Task 10: Admin, editor de modelos de e-mail

**Files:**
- Create: `admin/src/ecommerce/pages/settings/EmailTemplatesSection.tsx` (lista), `admin/src/ecommerce/pages/settings/EmailTemplateEditorPage.tsx`, `admin/src/ecommerce/components/settings/{HtmlCodeEditor,EmailPreview,VariablesPanel,TestEmailModal,TemplateVersionsModal}.tsx`
- Modify: `package.json` (`@codemirror/lang-html ^6.4.9` em `dependencies`; o `@uiw/react-codemirror` vem do Strapi, mas tem de ser declarado em `dependencies` com a mesma versão instalada para não ser embutido no bundle)
- Test: `tests/admin/ecommerce/variableInsert.test.ts`

**Interfaces:**
- **Lista:** os 12 tipos com nome traduzido, a descrição de quando é enviado e os locales personalizados como badges. Clicar em Editar abre o editor no locale por defeito.
- **Editor:**
  - **Cabeçalho:** `LocaleSwitcher`, Save, Send test email, Versions, Restore default (com `ConfirmModal`), o campo Subject e um badge "Default" ou "Customized".
  - **Corpo em duas colunas** (empilhadas abaixo de 1100 px):
    - à esquerda, o `HtmlCodeEditor` (CodeMirror com `html()`, tema escuro ou claro conforme o tema do Strapi, altura mínima de 480 px);
    - à direita, o `EmailPreview`.
  - **Pré-visualização:** `<iframe sandbox="" srcdoc=…>` (sandbox sem permissões, sem scripts) atualizado com *debounce* de 400 ms através do endpoint `preview`. Os `issues` aparecem por cima, sem bloquear a escrita.
  - **`VariablesPanel`:** o catálogo do tipo. Clicar insere `{{path}}` na posição do cursor; um ícone copia a variável. As listas mostram um exemplo `{{#each path}}…{{/each}}` com os `itemFields`.
  - **Save** mostra os erros de validação do servidor (`UNKNOWN_VARIABLE`, `UNSAFE_HTML`, `SYNTAX`) com o detalhe.
  - **`TestEmailModal`:** e-mail de destino (por defeito o do utilizador atual) e o resultado (ok, ou `EMAIL_NOT_CONFIGURED` com link para o separador Email service).
  - **`TemplateVersionsModal`:** lista de versões (data, utilizador, versão), restaurar com confirmação.
- Pure helper testado: `insertAtCursor(text, cursor, snippet): { text, cursor }`.
- [ ] **Step 1:** Teste do helper. **Step 2: Implementar.** **Step 3:** testes, `tsc` e `npm run build` limpos. **Step 4: Commit** `feat(ecommerce): email template editor with live preview`

---

### Task 11: Verificação final do plano 2

- [ ] `npx vitest run`, os dois `tsc` e `npm run build` limpos.
- [ ] No Strapi de teste (`~/Projects/littlebox-plugins/strapi/backend-base`, `localhost:1337`):
  1. Sem `LTB_ECOMMERCE_ENCRYPTION_KEY`, o aviso aparece e gravar o Stripe falha com a mensagem certa.
  2. Com a chave (definir em `backend-base/.env` e reiniciar), gravar uma chave Stripe fictícia mostra-a mascarada.
  3. Na base de dados, `ltb_st_module_ecommerce_integrations.secrets` não contém o texto da chave.
  4. Test connection com uma chave fictícia → "Invalid credentials".
  5. Ativar Moloni com campos em falta → erro por campo.
  6. CTT Test connection → "Not implemented yet".
  7. Criar e editar um método manual.
  8. Editar o modelo "Order confirmation" em `pt`, ver a pré-visualização atualizar e gravar.
  9. Tentar gravar com `<script>` → erro.
  10. Repor o padrão.
- [ ] Commit de correções: `chore(ecommerce): plan 2 verification fixes`
