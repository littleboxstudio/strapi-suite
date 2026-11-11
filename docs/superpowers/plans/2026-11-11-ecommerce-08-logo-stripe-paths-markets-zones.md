# E-commerce, plano 8: logótipo da loja, caminhos de retorno do Stripe, Mercados, Zonas e Tarifas de envio (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três alterações pedidas pelo utilizador ao módulo E-commerce já construído (planos 1–7):
- **A. Logótipo da loja:** o campo de texto `logoUrl` passa a um upload de imagem (pré-visualização, substituir, remover), processado com sharp para PNG e guardado pelo provider de upload; os e-mails mostram o logótipo com um URL sempre público (storefront ou CDN).
- **B. Caminhos de retorno do pagamento:** `paymentSuccessPath`/`paymentCancelPath` saem das definições da loja e passam a campos da integração Stripe.
- **C. Mercados → Zonas de envio → Tarifas de envio:** `markets` (países onde a loja vende) substitui `shippingCountries`; uma content-type nova de **zonas de envio** agrupa países; cada **método** define o preço por zona (manual: preço por zona no próprio método; CTT: as zonas que serve, preço vindo da API). O módulo "Envio manual" e a tabela de métodos manuais passam a um só contentor.

**Architecture:**
- **A:** `domain/imageProcessing.ts` ganha `processLogo` (auto-orientação, `fit: 'inside'` 480×96 sem ampliar, PNG). `EcommerceImageService.uploadStoreLogo` envia o ficheiro ao provider (sem Media Library, sem linha `image`); `EcommerceSettingsService.uploadStoreLogo/removeStoreLogo` gravam a chave `logo` em `store-setting` e apagam o ficheiro anterior depois de gravar. Um módulo puro `domain/storeLogo.ts` resolve o URL público e o tamanho de apresentação, usado por `notificationData.ts` e `email/templates.ts`.
- **B:** `ProviderField.format` ganha `'path'`, validado em `validateProviderInput` (servidor) e em `validateIntegrationForm` (admin). `stripePayments.ts` lê os caminhos do runtime Stripe.
- **C:** serviço novo `EcommerceShippingZoneService` (`shippingZones.ts`) com CRUD e regras de pertença; `EcommerceSettingsService` valida `markets`, as `rates` dos métodos manuais e o tipo de campo `'zones'` das integrações, e limpa as referências quando uma zona é apagada. `shipping.ts` resolve país → zona e aplica a regra genérica. No admin, uma página `ShippingSettings` carrega mercados e zonas e passa-os à secção de zonas, ao cartão manual (com a tabela de métodos lá dentro) e ao modal da integração CTT.

**Tech Stack:** Strapi 5 (Query Engine), `sharp`, provider de upload do Strapi (`strapi.plugin('upload').provider`), Vitest, React + `@strapi/design-system` v2.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (2.x definições, 4.13 sem URLs do backoffice, linha 333 `storefrontUrl` e caminhos de retorno, portes) e `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md` (definições, envios, e-mails, storefront). **As decisões do utilizador listadas no Goal prevalecem sobre o spec onde divergem** (caminhos de retorno na integração Stripe; países de envio substituídos por Mercados + Zonas + Tarifas). Pendentes: `docs/superpowers/plans/ecommerce-followups.md`.

## Global Constraints

- Existing non-ecommerce modules must not change. The module is unreleased: no data migration is needed; old keys may be ignored/removed.
- Any Strapi DB must work (client uses MariaDB): no @strapi/utils imports; check the existing convention for JSON columns (store-setting wraps values as {v: value}; follow existing practice for arrays/objects) ; every unique attribute needs a schema `indexes` entry (name ≤ 60 chars).
- Product/plugin images never use the Strapi Media Library; they use `strapi.plugin('upload').provider.upload` directly like server/src/services/modules/ecommerce/images.ts.
- E-mail links/images must never expose the backoffice (Strapi) URL; only the storefront URL (BFF) is public.
- Field names in English; admin UI translations en + pt (admin/src/core/translations/en.json, pt.json).
- Commits end with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Convenções herdadas dos planos 1–7: content-types ocultas (`content-manager`/`content-type-builder` `visible: false`), prefixo `ltb-st-module-ecommerce-*`; **colunas JSON novas recebem só objetos** (`shipping-zone.countries = { codes: [...] }`, `manual-shipping-method.rates = { "<zoneId>": cents }`); as chaves de `store-setting` passam por `wrapStoreValue` (`{ v: ... }`), por isso `markets` (array) e `logo` (objeto ou `null`) não precisam de outro embrulho; dinheiro em cêntimos inteiros com IVA incluído, `0 ≤ preço ≤ MAX_MONEY_CENTS`; erros de conflito com HTTP 409 via `CONFLICT_CODES` em `server/src/controllers/modules/ecommerce/errors.ts`; RBAC das rotas novas igual ao das definições (`settingsRead` para ler, `settingsManage` para escrever).
- Chaves antigas (`logoUrl`, `paymentSuccessPath`, `paymentCancelPath`, `shippingCountries` em `store-setting`; `price`, `countries` em `manual-shipping-method`) deixam de ser lidas; `getStoreSettings` já ignora chaves fora de `STORE_SETTINGS_DEFAULTS`.
- Comandos: testes `npx vitest run <ficheiros>`; tipos `npm run test:ts:back`, `npm run test:ts:front`, `npm run test:ts:tests`; build `npm run build`. Branch `feat/ecommerce`.

## Review Focus

1. **Logótipo com URL do backoffice:** provider local (`/uploads/logo_x.png`) sem `storefrontUrl` → `store.logoUrl` vazio e o cabeçalho mostra o nome; um provider configurado com URL absoluto no próprio Strapi (`http://localhost:1337/uploads/x.png` quando `server.url` é `http://localhost:1337`) → reescrito para `<storefrontUrl>/uploads/x.png` (ou vazio sem storefront). Testes na Task 1.
2. **Substituir o logótipo e falhas a meio:** um upload inválido (não-imagem) ou uma falha do provider mantém o logótipo anterior intacto (setting e ficheiro); o ficheiro anterior só é apagado depois de gravada a nova setting, e uma falha ao apagá-lo não faz falhar o pedido (só `strapi.log.warn`); `PUT /store` com `logo: { url: 'https://evil.example/x.png' }` é ignorado. Testes na Task 1.
3. **País no mercado mas sem zona, ou método sem preço para a zona:** a cotação devolve `options: []` sem falhas (não é erro), a encomenda com esse destino falha como hoje com uma opção de envio inexistente, e um país fora dos mercados dá `invalid_country` no admin e na cotação do storefront. Testes nas Tasks 4 e 5.
4. **Apagar uma zona em uso:** as `rates` dessa zona saem de todos os métodos manuais, o id sai do `zones` da configuração CTT, e o `getRuntime('ctt-expresso')` seguinte (cache de 60 s) já não tem a zona. Teste na Task 6.
5. **Remover de `markets` um país ainda numa zona:** 409 `MARKET_IN_USE` com o nome das zonas em `detail`, e **nada** do mesmo `PUT /store` é gravado (nem os outros campos). Teste na Task 4.

---

### Task 1: Logótipo da loja — processamento, armazenamento, endpoints e e-mails (servidor)

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/storeLogo.ts`
- Modify: `server/src/services/modules/ecommerce/domain/imageProcessing.ts` (`processLogo`, `MAX_UPLOAD_BYTES`), `server/src/services/modules/ecommerce/images.ts` (`uploadStoreLogo`, `removeFiles` aceita `StoredFile`), `server/src/services/modules/ecommerce/settings.ts` (`logo` substitui `logoUrl`; `uploadStoreLogo`/`removeStoreLogo`), `server/src/controllers/modules/ecommerce/settings.ts`, `server/src/controllers/modules/ecommerce/products.ts` (importa `MAX_UPLOAD_BYTES`), `server/src/routes/ecommerce/admin-settings.ts`, `server/src/services/modules/ecommerce/notificationData.ts`, `server/src/services/modules/ecommerce/notifications.ts` (passa `backofficeUrl`), `server/src/services/modules/ecommerce/email/templates.ts`, `server/src/services/modules/ecommerce/email/catalog.ts`, `server/src/services/modules/ecommerce/email/defaults/layout.ts`
- Test: `tests/server/ecommerce/domain/storeLogo.test.ts` (novo), `tests/server/ecommerce/images.test.ts`, `tests/server/ecommerce/settings.test.ts`, `tests/server/ecommerce/settingsRoutes.test.ts`, `tests/server/ecommerce/settingsController.test.ts`, `tests/server/ecommerce/notificationData.test.ts`, `tests/server/ecommerce/notifications.test.ts` (~linhas 755–802), `tests/server/ecommerce/email/catalog.test.ts`

**Interfaces:**
- Produces (`domain/storeLogo.ts`):
  - `LOGO_BOX = { width: 480, height: 96 }`, `LOGO_DISPLAY = { width: 240, height: 48 }`
  - `publicAssetUrl(url: string | null | undefined, storefrontUrl: string | null, backofficeUrl?: string | null): string` — `http(s)://` absoluto → devolvido tal como está, **exceto** se a origem for igual à de `backofficeUrl`: então `storefront + pathname + search`, ou `''` sem storefront; `//host/...` → `https:` + url (mesma regra de origem); começa por `/` → `storefrontUrl` (barras finais removidas) + url, ou `''` sem storefront; qualquer outra coisa → `''`.
  - `logoDisplaySize(width: number, height: number): { width: number; height: number }` — cabe em 240×48 sem ampliar, `Math.round`, mínimo 1.
  - `storeLogoVariables(store: Pick<StoreSettings, 'logo' | 'storefrontUrl'>, backofficeUrl?: string | null): { logoUrl: string; logoWidth: string; logoHeight: string }` — sem URL utilizável os três são `''`.
- Produces (`imageProcessing.ts`): `MAX_UPLOAD_BYTES = 15 * 1024 * 1024`; `processLogo(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number; sizeBytes: number }>` — `sharp(input).rotate().resize(480, 96, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 })`; metadata ilegível → `Error('INVALID_IMAGE')` (igual a `processImage`).
- Produces (`images.ts`): `type StoredFile = Omit<StoredImage, 'id'>`; `removeFiles(records: StoredFile[])`; `uploadStoreLogo(params: { buffer: Buffer; originalName: string }): Promise<StoreLogo>` — hash `store-logo_<10 hex>`, `name: 'store-logo.png'`, `ext: '.png'`, `mime: 'image/png'`, sem criar linha na tabela `image`.
- Produces (`settings.ts`):
  - `type StoreLogo = { url: string; width: number; height: number; sizeBytes: number; hash: string; ext: '.png'; mime: 'image/png'; provider: string; providerMetadata: unknown | null }`
  - `StoreSettings.logo: StoreLogo | null` (default `null`), `logoUrl` removido; `normalizeStorePatch` não aceita `logo` (ignorado como chave desconhecida).
  - `uploadStoreLogo(file: { buffer: Buffer; originalName: string }, userId?: string | number): Promise<StoreSettings>` — processa+envia, grava `logo` (via o mesmo ciclo de escrita de `updateStoreSettings`, extraído para `writeStoreValues(values)`), audita `store.update` com `details.changedFields: ['logo']`, depois `images().removeFiles([anterior])`. Se a gravação falhar, apaga o ficheiro novo e relança.
  - `removeStoreLogo(userId?): Promise<StoreSettings>` — grava `logo: null`, audita, apaga o ficheiro; sem logótipo → devolve as definições sem auditar.
- Rotas (em `admin-settings.ts`, `settingsManage`): `POST /store/logo` → `uploadStoreLogo`, `DELETE /store/logo` → `removeStoreLogo`; ambas respondem 200 com `StoreSettings`.
- Controller `uploadStoreLogo`: `ctx.request.files?.file` em falta ou array → 400 `A file is required`; `size > MAX_UPLOAD_BYTES` → 400 `The image exceeds 15 MB`; `INVALID_IMAGE` → 400 com `details.code = 'INVALID_IMAGE'`.
- E-mails: variáveis `store.logoUrl`, `store.logoWidth`, `store.logoHeight` (catálogo + `SAMPLE_VALUES`: `'store.logoWidth': '160'`, `'store.logoHeight': '48'`); `NotificationDataContext.backofficeUrl?: string | null` (posto por `notifications.ts` a partir de `strapi.config.get('server.url')`); `templates.ts` usa o mesmo `storeLogoVariables`. No `layout.ts` o `<img>` passa a `width="{{store.logoWidth}}" height="{{store.logoHeight}}"` e `style="display:block;width:{{store.logoWidth}}px;height:{{store.logoHeight}}px;max-width:100%;border:0;outline:none;text-decoration:none"` (o Outlook desktop usa os atributos; sem largura explícita um logótipo largo ficava deformado pelo `max-width`); o `{{else}}` com o nome mantém-se.

- [ ] **Step 1: Failing tests**
  - `storeLogo.test.ts`:
    - `publicAssetUrl('https://cdn.example.com/l.png', 'https://shop.example', 'http://localhost:1337')` → `'https://cdn.example.com/l.png'`
    - `publicAssetUrl('/uploads/l.png', 'https://shop.example/', null)` → `'https://shop.example/uploads/l.png'`
    - `publicAssetUrl('/uploads/l.png', null)` → `''`; `publicAssetUrl('uploads/l.png', 'https://shop.example')` → `''`; `publicAssetUrl(null, 'https://shop.example')` → `''`
    - `publicAssetUrl('http://localhost:1337/uploads/l.png', 'https://shop.example', 'http://localhost:1337')` → `'https://shop.example/uploads/l.png'`; o mesmo sem storefront → `''`
    - `publicAssetUrl('//cdn.example.com/l.png', null)` → `'https://cdn.example.com/l.png'`
    - `logoDisplaySize(480, 96)` → `{ width: 240, height: 48 }`; `(200, 40)` → `{ 200, 40 }`; `(480, 40)` → `{ 240, 20 }`; `(96, 96)` → `{ 48, 48 }`
    - `storeLogoVariables({ logo: null, storefrontUrl: 'https://shop.example' })` → os três `''`
  - `images.test.ts`: `uploadStoreLogo` com um PNG 1000×500 → provider `upload` chamado com `ext '.png'`, `mime 'image/png'`; resultado `width 192, height 96`; nenhuma linha na tabela de imagens; um JPEG 100×50 → `100×50` (sem ampliar); um buffer de texto → rejeita `INVALID_IMAGE` e o provider não é chamado.
  - `settings.test.ts`:
    - defaults: `logo: null` e sem `logoUrl` (atualizar o `toEqual` completo, ~linha 387);
    - `uploadStoreLogo` grava `logo` com `url`, `width`, `height`; um segundo upload grava o novo e chama `provider.delete` com o `hash` do anterior **depois** do `update` da setting; audit `store.update` com `changedFields: ['logo']`;
    - provider `delete` a lançar no segundo upload → o pedido resolve e `strapi.log.warn` é chamado;
    - provider `upload` a lançar → a setting `logo` continua a anterior e nada é apagado;
    - `removeStoreLogo` → `logo: null` e o ficheiro apagado;
    - `updateStoreSettings({ logo: { url: 'https://evil.example/x.png' } } as any)` → `logo` inalterado.
  - `settingsRoutes.test.ts`: `POST /admin/ecommerce/settings/store/logo` e `DELETE …/store/logo` com `settingsManage`.
  - `settingsController.test.ts`: sem ficheiro → 400; 16 MB → 400; `INVALID_IMAGE` → 400 com `details.code`.
  - `notificationData.test.ts`: store com `logo.url '/uploads/l.png'`, `width 480`, `height 96`, `storefrontUrl 'https://shop.example'` → `data.store` com `logoUrl 'https://shop.example/uploads/l.png'`, `logoWidth '240'`, `logoHeight '48'`; sem storefront → `logoUrl ''`.
  - `notifications.test.ts`: o teste que verifica os URLs do e-mail usa `logo: { url: 'https://cdn.example.com/logo.png', width: 480, height: 96, … }`; o HTML contém `width="240" height="48"` e nenhum URL com `localhost:1337` ou `/admin`.
  - `catalog.test.ts`: `STORE` inclui `store.logoWidth` e `store.logoHeight`; os modelos por defeito continuam a passar a validação (sem `UNKNOWN_VARIABLE`).
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/domain/storeLogo.test.ts tests/server/ecommerce/images.test.ts tests/server/ecommerce/settings.test.ts tests/server/ecommerce/settingsRoutes.test.ts tests/server/ecommerce/settingsController.test.ts tests/server/ecommerce/notificationData.test.ts tests/server/ecommerce/notifications.test.ts tests/server/ecommerce/email` → FAIL.
- [ ] **Step 3:** Implementar as interfaces acima; o `makeStrapi` de `settings.test.ts` passa a resolver `EcommerceImageService` (o serviço real) e `strapi.plugin('upload').provider` com `upload`/`delete` em `vi.fn` (o `upload` põe `file.url = '/uploads/' + hash + ext`), e `strapi.log.warn`; atualizar as fixtures de `StoreSettings` que tinham `logoUrl` (`notificationData.test.ts`, `notifications.test.ts`, `invoices.test.ts`).
- [ ] **Step 4:** Os mesmos testes → PASS; `npx vitest run tests/server/ecommerce` verde; `npm run test:ts:back` e `npm run test:ts:tests` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): store logo upload stored by the upload provider and used in e-mails`

---

### Task 2: Logótipo da loja — admin (Settings → General → Store)

**Files:**
- Create: `admin/src/ecommerce/components/settings/StoreLogoField.tsx`, `admin/src/ecommerce/utils/storeLogo.ts`, `admin/src/ecommerce/usecases/settings/uploadStoreLogo.ts`, `admin/src/ecommerce/usecases/settings/removeStoreLogo.ts`
- Modify: `admin/src/ecommerce/settingsTypes.ts`, `admin/src/ecommerce/gateways/ecommerceSettingsGateway.ts`, `admin/src/ecommerce/utils/settingsForm.ts`, `admin/src/ecommerce/pages/settings/GeneralSettings.tsx`, `admin/src/core/translations/en.json`, `pt.json`
- Test: `tests/admin/ecommerce/storeLogo.test.ts` (novo), `tests/admin/ecommerce/settingsForm.test.ts`

**Interfaces:**
- Consumes: `POST/DELETE /admin/ecommerce/settings/store/logo` (Task 1), resposta `StoreSettings`.
- Produces:
  - admin `StoreSettings.logo: { url: string; width: number; height: number } | null` (sem `logoUrl`); `type StoreSettingsInput = Omit<StoreSettings, 'logo'>`; `buildStoreSettingsInput(form): StoreSettingsInput`; `StoreForm` sem `logoUrl`.
  - gateway `uploadStoreLogo(form: FormData): Promise<StoreSettings>`, `removeStoreLogo(): Promise<StoreSettings>`.
  - `utils/storeLogo.ts`: `LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'`; `logoFileError(file: { size: number; type: string }): 'too_large' | 'invalid_type' | null` (limite `MAX_IMAGE_BYTES` de `imageUpload.ts`; tipo fora de `LOGO_ACCEPT` → `invalid_type`); `buildLogoForm(file: File): FormData` (campo `file`).
  - `StoreLogoField` props `{ logo: StoreSettings['logo']; readOnly: boolean; onChange: (settings: StoreSettings) => void }`: miniatura (`<img src={logo.url}>`, o admin corre na origem do Strapi), botão "Upload logo"/"Replace" (input file oculto com `accept={LOGO_ACCEPT}`), "Remove" com `ConfirmModal`; erros `too_large`, `invalid_type`, `INVALID_IMAGE` em notificação. O upload grava logo (não espera pelo "Save"); `GeneralSettings` atualiza só `logo` no estado carregado, sem perder edições por gravar do formulário.
- Layout: na secção Store, o `StoreLogoField` ocupa a coluna onde estava `logoUrl`, ao lado de `brandColor`.
- Traduções (en / pt): remover `store.logoUrl`, `store.logoUrl.hint`; acrescentar `store.logo` "Logo" / "Logótipo", `store.logo.hint` "PNG, JPG, WebP, GIF or SVG up to 15 MB. Shown in emails, resized to fit 480×96." / "PNG, JPG, WebP, GIF ou SVG até 15 MB. Aparece nos e-mails, redimensionado para caber em 480×96.", `store.logo.upload` "Upload logo" / "Carregar logótipo", `store.logo.replace` "Replace" / "Substituir", `store.logo.remove` "Remove" / "Remover", `store.logo.removeConfirm.title` "Remove the logo?" / "Remover o logótipo?", `store.logo.removeConfirm.text` "Emails will show the store name instead." / "Os e-mails passam a mostrar o nome da loja.", `store.logo.errors.too_large` "The image exceeds 15 MB." / "A imagem excede 15 MB.", `store.logo.errors.invalid_type` "Choose a PNG, JPG, WebP, GIF or SVG image." / "Escolha uma imagem PNG, JPG, WebP, GIF ou SVG.", `store.logo.errors.INVALID_IMAGE` "This file is not a valid image." / "Este ficheiro não é uma imagem válida.", `store.logo.uploaded` "Logo saved." / "Logótipo guardado.", `store.logo.removed` "Logo removed." / "Logótipo removido." (todas com o prefixo `littlebox-strapi-suite.ecommerce.settings.`).

- [ ] **Step 1: Failing tests:** `logoFileError({ size: 15 * 1024 * 1024 + 1, type: 'image/png' })` → `'too_large'`; `({ size: 10, type: 'application/pdf' })` → `'invalid_type'`; `({ size: 10, type: 'image/svg+xml' })` → `null`; `buildLogoForm(file).get('file')` é o ficheiro; em `settingsForm.test.ts` as fixtures perdem `logoUrl` e ganham `logo: null`, `storeFormFromSettings` não tem `logoUrl`, `buildStoreSettingsInput` não devolve `logo` nem `logoUrl`, e `validateStoreForm` deixa de produzir erros de `logoUrl`.
- [ ] **Step 2:** `npx vitest run tests/admin/ecommerce/storeLogo.test.ts tests/admin/ecommerce/settingsForm.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; remover `LogoThumb`/`logoBroken` do `GeneralSettings`.
- [ ] **Step 4:** → PASS; `npm run test:ts:front` limpo.
- [ ] **Step 5: Commit** `feat(ecommerce): store logo upload in general settings`

---

### Task 3: Caminhos de retorno do pagamento na integração Stripe

**Files:**
- Modify: `server/src/services/modules/ecommerce/providers/registry.ts`, `server/src/services/modules/ecommerce/providers/definitions/stripe.ts`, `server/src/services/modules/ecommerce/settings.ts` (remover os dois campos de `StoreSettings`, defaults e validação), `server/src/services/modules/ecommerce/stripePayments.ts`, `admin/src/ecommerce/settingsTypes.ts`, `admin/src/ecommerce/utils/integrationForm.ts`, `admin/src/ecommerce/components/settings/IntegrationConfigModal.tsx`, `admin/src/ecommerce/utils/settingsForm.ts`, `admin/src/ecommerce/pages/settings/GeneralSettings.tsx`, `admin/src/core/translations/en.json`, `pt.json`, `docs/ecommerce/storefront-api.md` (passo 6 do fluxo)
- Test: `tests/server/ecommerce/providers/registry.test.ts`, `tests/server/ecommerce/settings.test.ts`, `tests/server/ecommerce/stripePayments.test.ts`, `tests/admin/ecommerce/integrationForm.test.ts`, `tests/admin/ecommerce/settingsForm.test.ts`; fixtures com os campos antigos: `tests/server/ecommerce/helpers/commerceSetup.ts`, `notificationData.test.ts`

**Interfaces:**
- Produces:
  - `ProviderField.format?: 'email' | 'path'` (servidor e admin); `ProviderInputIssue.code` ganha `'invalid_path'`.
  - Regra `path`: string que começa por `/` e não por `//`, sem espaços nem `\` (`/^\/(?!\/)[^\s\\]*$/`), senão `invalid_path`. Vazio segue a regra `required` normal (e, como o campo tem `default`, `configWithDefaults` repõe o default; o modal envia `null`).
  - Campos Stripe novos: `{ key: 'paymentSuccessPath', type: 'string', format: 'path', required: true, default: '/checkout/success', label: `${L}.paymentSuccessPath` }` e `{ key: 'paymentCancelPath', …, default: '/checkout/cancel' }`.
  - `stripePayments.ts`: `export function stripeReturnUrls(storefrontUrl: string, runtime: ProviderRuntime, publicId: string): { successUrl: string; cancelUrl: string }` — base sem barras finais + caminho do runtime (fallback para os defaults se não for uma string válida) + `?order=<encodeURIComponent(publicId)>`. `stripeClient()` passa a assentar em `loadStripe(): Promise<{ client: StripeClient; runtime: ProviderRuntime }>`; `getOrCreatePaymentLink` usa o runtime daí.
  - admin `validateIntegrationForm(fields: ProviderField[], values: IntegrationFormValues): Record<string, string>` — para já só `format: 'path'` não vazio → `invalid_path`; o modal chama-o antes de gravar e não envia com erros.
- Remover de `StoreSettings`, `STORE_SETTINGS_DEFAULTS`, `normalizeStorePatch`, `StoreForm`, `storeFormFromSettings`, `buildStoreSettingsInput`, `validateStoreForm` e da secção "Storefront" do `GeneralSettings` (fica só `storefrontUrl`).
- Traduções: remover `store.paymentSuccessPath`, `store.paymentCancelPath`, `store.path.hint`; acrescentar `providers.stripe.fields.paymentSuccessPath` "Payment success path" / "Caminho de pagamento concluído", `providers.stripe.fields.paymentCancelPath` "Payment cancel path" / "Caminho de pagamento cancelado", `errors.invalid_path` "Enter a path that starts with /, e.g. /checkout/success." / "Indique um caminho começado por /, por exemplo /checkout/success.".
- Doc: o passo 6 passa a "Stripe returns to `<storefrontUrl><success path>?order=<publicId>` (the success and cancel paths are set in Settings → Payments → Stripe; defaults `/checkout/success` and `/checkout/cancel`)".

- [ ] **Step 1: Failing tests**
  - `registry.test.ts`: um campo `format: 'path'` com `'checkout/ok'`, `'//evil.com'`, `'/a b'` → `invalid_path`; `'/obrigado'` → sem issues; a definição `stripe` tem os dois campos com os defaults acima.
  - `settings.test.ts`: `updateIntegration('stripe', { config: { paymentSuccessPath: '//evil.com' } })` → `EcommerceValidationError` com `config.paymentSuccessPath` `invalid_path`; `listIntegrations()` mostra `paymentSuccessPath: '/checkout/success'` sem nada gravado; `{ paymentSuccessPath: '' }` grava e o runtime devolve o default; `setActive('stripe', true)` com uma `paymentCancelPath` inválida guardada → `invalid_path`; defaults da loja sem os dois campos.
  - `stripePayments.test.ts`: runtime Stripe com `config: { paymentSuccessPath: '/obrigado', paymentCancelPath: '/carrinho' }` e `storefrontUrl 'https://shop.example/'` → `successUrl 'https://shop.example/obrigado?order=<publicId>'`, `cancelUrl 'https://shop.example/carrinho?order=<publicId>'`; runtime sem os campos → `/checkout/success` e `/checkout/cancel`.
  - `integrationForm.test.ts`: `validateIntegrationForm` com `paymentSuccessPath: '//x'` → `{ paymentSuccessPath: 'invalid_path' }`; `'/ok'` → `{}`.
  - `settingsForm.test.ts`: sem os campos de caminho nas fixtures e nos erros esperados.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/providers/registry.test.ts tests/server/ecommerce/settings.test.ts tests/server/ecommerce/stripePayments.test.ts tests/admin/ecommerce/integrationForm.test.ts tests/admin/ecommerce/settingsForm.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; atualizar as fixtures (`commerceSetup.ts` move os caminhos para o `getRuntime('stripe')`).
- [ ] **Step 4:** → PASS; `npx vitest run` verde; `npm run test:ts:back`, `npm run test:ts:front`, `npm run test:ts:tests` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): payment return paths move to the Stripe integration`

---

### Task 4: Mercados e Zonas de envio (servidor) + campo Mercados no admin

**Files:**
- Create: `server/src/content-types/modules/ecommerce/shipping-zone/{schema.json,index.ts}`, `server/src/services/modules/ecommerce/shippingZones.ts`, `tests/server/ecommerce/helpers/settingsStrapi.ts` (o `makeStrapi` de `settings.test.ts`, movido e a registar também `EcommerceShippingZoneService` sobre a mesma fake db), `tests/server/ecommerce/shippingZones.test.ts`
- Modify: `server/src/content-types/index.ts`, `server/src/config/index.ts` (UID `shippingZone`), `server/src/services/index.ts`, `server/src/services/modules/ecommerce/settings.ts` (`markets`; exportar `validateCountries`/`isCountry`), `server/src/services/modules/ecommerce/orders.ts` (~linhas 633 e 1727), `server/src/services/modules/ecommerce/orderPricing.ts` (~linhas 130 e 380), `server/src/services/modules/ecommerce/shipping.ts` (linha 118: `store.markets`), `server/src/controllers/modules/ecommerce/settings.ts`, `server/src/controllers/modules/ecommerce/errors.ts` (`CONFLICT_CODES`), `server/src/routes/ecommerce/admin-settings.ts`, `admin/src/ecommerce/settingsTypes.ts`, `admin/src/ecommerce/utils/settingsForm.ts`, `admin/src/ecommerce/pages/settings/GeneralSettings.tsx`, `en.json`, `pt.json`
- Test: `tests/server/ecommerce/settingsContentTypes.test.ts`, `tests/server/ecommerce/settings.test.ts`, `tests/server/ecommerce/orders.create.test.ts`, `orders.modify.test.ts`, `orders.lifecycle.test.ts`, `stripeWebhooks.test.ts`, `shipping.test.ts`, `invoices.test.ts`, `notifications.test.ts`, `stripePayments.test.ts`, `helpers/commerceSetup.ts` (todas as fixtures `shippingCountries` → `markets`), `settingsRoutes.test.ts`, `settingsController.test.ts`, `tests/admin/ecommerce/settingsForm.test.ts`

**Interfaces:**
- `shipping-zone` (`collectionName` `ltb_st_module_ecommerce_shipping_zones`, oculta): `name` string required, `countries` json (`{ codes: string[] }`), `position` integer. Sem atributos únicos.
- `StoreSettings.markets: string[]` (default `['PT']`, validação igual à antiga `shippingCountries`: obrigatório, ISO-2 de país, sem duplicados) substitui `shippingCountries`.
- `EcommerceShippingZoneService`:
  - `type ShippingZone = { id: number; name: string; countries: string[]; position: number }`, `type ShippingZoneInput = { name?: string; countries?: string[]; position?: number }`
  - `list(): Promise<ShippingZone[]>` (por `position`, `id`; lê `countries` como `{ codes }` ou array)
  - `create(input, userId?)`, `update(id: number, input, userId?)` → `ShippingZone`; `remove(id: number, userId?): Promise<void>` (a limpeza de referências entra na Task 6)
  - Validação: `name` aparado, obrigatório (`name` `required`), ≤ 100 caracteres (`name` `too_long`); `countries` com `validateCountries` (`required`, `countries.<i>` `invalid_country`), cada país em `markets` (`countries.<i>` `not_in_market`); país já noutra zona → `countries.<i>` `ZONE_COUNTRY_CONFLICT` com `detail` = nome dessa zona (HTTP 409). Duplicados removidos. `position` omitido → máximo + 1. Auditoria `area 'settings'`, ações `shipping_zone.create|update|delete`, `targetId` = id.
- `updateStoreSettings`: quando `markets` muda, os países removidos que ainda estão numa zona → `EcommerceValidationError` com um issue por zona `{ path: 'markets', code: 'MARKET_IN_USE', detail: <nome da zona> }` (HTTP 409), lançado **antes** da transação (nada gravado).
- `CONFLICT_CODES` += `'ZONE_COUNTRY_CONFLICT'`, `'MARKET_IN_USE'`.
- `orders.ts`/`orderPricing.ts`: o país da morada de envio (create, modify) e o `shipping.country` da cotação (admin e storefront) têm de estar em `markets` → `invalid_country` como hoje. `OrderPricingDeps.getStoreSettings(): Promise<{ markets?: string[] } | null | undefined>`.
- Rotas (`admin-settings.ts`): `GET /shipping-zones` (`settingsRead`), `POST /shipping-zones`, `PUT /shipping-zones/:id`, `DELETE /shipping-zones/:id` (`settingsManage`); controller `listShippingZones`, `createShippingZone` (201), `updateShippingZone`, `deleteShippingZone` (204).
- Admin: `StoreSettings.markets`, `StoreForm.markets` (substituem `shippingCountries`); `SettingsFieldError` ganha `detail?: string`; `marketInUseZones(errors: SettingsFieldError[]): string[]` em `settingsForm.ts`. Na secção Region o `MultiSelect` passa a "Markets"; um 409 `MARKET_IN_USE` mostra no campo `errors.MARKET_IN_USE` com `{ zones }`.
- Traduções: remover `store.shippingCountries`(+`.hint`); acrescentar `store.markets` "Markets" / "Mercados", `store.markets.hint` "Countries where the store sells. Group them into shipping zones in Shipping." / "Países onde a loja vende. Agrupe-os em zonas de envio em Envios.", `errors.MARKET_IN_USE` "Remove these countries from the shipping zones first: {zones}." / "Retire primeiro estes países das zonas de envio: {zones}.".

- [ ] **Step 1: Failing tests**
  - `settingsContentTypes.test.ts`: `shipping-zone` registada, oculta, `countries` json, UID `shippingZone`; `schemaIndexes` continua verde.
  - `settings.test.ts`: defaults com `markets: ['PT']` e sem `shippingCountries`; `{ markets: ['PT', 'pt', 'ZZ'] }` → `markets.1`/`markets.2` `invalid_country`; `{ markets: [] }` → `required`; com a zona "Ibéria" `['PT','ES']` e `markets ['PT','ES','FR']`, `updateStoreSettings({ storeName: 'Nova', markets: ['PT','FR'] })` → 409-code `MARKET_IN_USE` com `detail 'Ibéria'` e `storeName` **não** gravado; `{ markets: ['PT','ES'] }` (remove só FR) → gravado.
  - `shippingZones.test.ts`: create `{ name: ' Continente ', countries: ['PT','PT'] }` → `{ name: 'Continente', countries: ['PT'], position: 1 }` e a linha guardada com `countries: { codes: ['PT'] }`; `countries: ['ES']` com `markets ['PT']` → `countries.0` `not_in_market`; segunda zona com `['PT']` → `ZONE_COUNTRY_CONFLICT` com `detail 'Continente'`; update da própria zona com os mesmos países → OK; `name: ''` → `required`; `remove(99)` → `EcommerceNotFoundError`; auditoria das três ações.
  - `orders.create.test.ts` / `orders.modify.test.ts`: fixtures com `markets`; morada `ES` com `markets ['PT']` → `shippingAddress.country` `invalid_country`.
  - `shipping.test.ts`: fixture `markets` (a regra completa vem na Task 5).
  - `settingsRoutes.test.ts`/`settingsController.test.ts`: as quatro rotas com as permissões acima; `ZONE_COUNTRY_CONFLICT` → 409 `ConflictError` com `details.code`.
  - `settingsForm.test.ts`: `markets` em vez de `shippingCountries`; `marketInUseZones([{ path: 'markets', code: 'MARKET_IN_USE', detail: 'Ibéria' }, { path: 'x', code: 'required' }])` → `['Ibéria']`.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce tests/admin/ecommerce/settingsForm.test.ts` → FAIL nos testes novos/alterados.
- [ ] **Step 3:** Implementar; `grep -rn shippingCountries server admin tests docs/ecommerce` → sem resultados.
- [ ] **Step 4:** `npx vitest run` verde; os três `tsc` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): markets replace shipping countries; shipping zones`

---

### Task 5: Tarifas dos métodos manuais por zona e regra genérica da cotação

**Files:**
- Modify: `server/src/content-types/modules/ecommerce/manual-shipping-method/schema.json` (remove `price`, `countries`; acrescenta `rates` json, default `{}`), `server/src/services/modules/ecommerce/settings.ts` (`ManualMethod`, `normalizeManualMethod`, `toManualMethod`), `server/src/services/modules/ecommerce/shipping.ts`
- Test: `tests/server/ecommerce/settings.test.ts` (describe dos métodos manuais), `tests/server/ecommerce/settingsContentTypes.test.ts` (defaults do método manual), `tests/server/ecommerce/shipping.test.ts`

**Interfaces:**
- Consumes: `EcommerceShippingZoneService.list()` (Task 4).
- Produces:
  - `ManualMethod = { id: number; name: Record<string, string>; rates: Record<string, number>; tax: number; active: boolean; position: number }` — `rates` com chaves = id da zona em texto, valor em cêntimos; zona sem chave = método indisponível nessa zona.
  - `normalizeManualMethod(input, defaultLocale, zoneIds: Set<number>)`: `rates` tem de ser objeto (senão `rates` `invalid_number`); chave que não é o id de uma zona existente → `rates.<chave>` `invalid_zone`; valor `null`/`''` → chave removida; não inteiro → `rates.<chave>` `invalid_number`; `< 0` ou `> MAX_MONEY_CENTS` → `out_of_range`. `rates` vazio é aceite (método sem zonas). `tax` como hoje.
  - `ShippingQuoteRequest.zoneId?: number` (posto pelo serviço, nunca pelo chamador).
  - `quote(req)` (algoritmo):
    1. país fora de `markets` → `{ options: [], failures: [] }`;
    2. `zone = zones.find(z => z.countries.includes(req.country))`; sem zona → vazio;
    3. manual: só métodos `active` com `typeof rates[String(zone.id)] === 'number'`, `price` = esse valor;
    4. carrier API: depois do runtime (e do `CARRIER_NOT_CONFIGURED` atual), se `runtime.config.zones` não for array ou não incluir `zone.id` → ignorado sem falha; senão `adapter.quote({ ...req, zoneId: zone.id }, …)`.
  - `findOption` herda a regra (a criação/alteração de encomendas usa-o).

- [ ] **Step 1: Failing tests**
  - `settingsContentTypes.test.ts`: o método manual não tem `price` nem `countries`; `rates` json com default `{}`.
  - `settings.test.ts`: com zonas 1 e 2, `createManualMethod({ name: { pt: 'Correio' }, rates: { '1': 495, '2': 995 }, tax: 23 })` → guardado com essas `rates`; `rates: { '9': 100 }` → `rates.9` `invalid_zone`; `{ '1': -1 }` → `out_of_range`; `{ '1': 4.5 }` → `invalid_number`; `{ '1': null, '2': 300 }` → `rates: { '2': 300 }`; `rates: []` → `rates` `invalid_number`; update parcial mantém as `rates` guardadas.
  - `shipping.test.ts` (setup com `EcommerceShippingZoneService.list` a devolver `[{ id: 1, countries: ['PT'] }, { id: 2, countries: ['ES'] }]`, `markets ['PT','ES','FR']`; o helper `method(id, rates)`):
    - método `{ '1': 500 }` + método `{ '2': 300 }` → `PT` dá só o primeiro com `price 500`, `ES` só o segundo com `300`;
    - `FR` (mercado sem zona) → `options: []`, `failures: []`;
    - `DE` (fora dos mercados) → vazio mesmo com um carrier que serve todas as zonas (o quoter não é chamado);
    - carrier com `runtime.config.zones = [2]` → não é chamado para `PT`, é chamado para `ES` com `req.zoneId === 2`;
    - carrier sem `zones` na configuração → nunca chamado, sem falha;
    - os testes de carriers existentes passam a dar `config: { zones: [1] }` ao runtime e continuam verdes (timeout, `INVALID_QUOTE`, CTT `NOT_IMPLEMENTED`, etc.).
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/settings.test.ts tests/server/ecommerce/settingsContentTypes.test.ts tests/server/ecommerce/shipping.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS; `npx vitest run tests/server/ecommerce` verde; `npm run test:ts:back`, `npm run test:ts:tests` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): manual shipping rates per zone; quote resolves the destination zone`

---

### Task 6: Campo de integração `zones`, zonas do CTT e limpeza ao apagar uma zona

**Files:**
- Modify: `server/src/services/modules/ecommerce/providers/registry.ts`, `server/src/services/modules/ecommerce/providers/definitions/ctt-expresso.ts`, `server/src/services/modules/ecommerce/settings.ts` (`normalizeConfigValue`, `updateIntegration`, `removeZoneReferences`), `server/src/services/modules/ecommerce/shippingZones.ts` (`remove`), `docs/superpowers/plans/ecommerce-followups.md`
- Test: `tests/server/ecommerce/providers/registry.test.ts`, `tests/server/ecommerce/providers/cttExpresso.test.ts`, `tests/server/ecommerce/settings.test.ts`, `tests/server/ecommerce/shippingZones.test.ts`

**Interfaces:**
- Produces:
  - `ProviderField.type` ganha `'zones'` (valor: `number[]` de ids de zona). Em `validateProviderInput`: um array vazio conta como vazio (`required` se obrigatório); não-array ou item que não é inteiro ≥ 1 → `invalid_zone`. `ProviderInputIssue.code` ganha `'invalid_zone'`.
  - `normalizeConfigValue` para `zones`: inteiros únicos pela ordem recebida; `[]` → `undefined`.
  - `updateIntegration`: depois de `validateProviderInput`, ids que não existem em `EcommerceShippingZoneService.list()` → `config.<key>` `invalid_zone` (bloqueia sempre, ativa ou não).
  - CTT: `{ key: 'zones', type: 'zones', required: true, default: [], label: `${L}.zones` }` (ativar o CTT exige pelo menos uma zona).
  - `EcommerceSettingsService.removeZoneReferences(zoneId: number): Promise<{ methods: number[]; carriers: string[] }>` — remove a chave das `rates` de cada método manual que a tem e o id de cada campo `zones` das integrações guardadas; chama `invalidate()` (cache do runtime).
  - `EcommerceShippingZoneService.remove` apaga a zona e chama `removeZoneReferences` na mesma `strapi.db.transaction`; a auditoria `shipping_zone.delete` leva `details: { methods, carriers }`.
- `ecommerce-followups.md`, secção nova "Plan 8": "CTT Expresso: o preço vem da cotação da API (ainda um stub `NOT_IMPLEMENTED`); reavaliar a tarifação por zona do CTT (serviços, peso, zonas próprias do CTT) quando chegar a documentação da API."

- [ ] **Step 1: Failing tests**
  - `registry.test.ts`: campo `zones` obrigatório com `[]` → `required`; `['1']`, `[0]`, `'1'` → `invalid_zone`; `[1, 2]` → sem issues; a definição `ctt-expresso` tem o campo `zones`.
  - `settings.test.ts`: `updateIntegration('ctt-expresso', { config: { zones: [1, 1, 2] } })` com as zonas 1 e 2 → `config.zones` `[1, 2]`; `{ zones: [9] }` → `config.zones` `invalid_zone`; `setActive('ctt-expresso', true)` com credenciais e sem zonas → `config.zones` `required`.
  - `shippingZones.test.ts`: zona 1 usada pelos métodos A `{ '1': 500, '2': 900 }` e B `{ '1': 300 }` e pelo CTT `zones: [1, 2]`; `getRuntime('ctt-expresso')` chamado antes (cache cheia); `remove(1)` → A `{ '2': 900 }`, B `{}`, CTT `zones: [2]`, o `getRuntime` seguinte devolve `zones: [2]`, auditoria com `methods: [A, B]`, `carriers: ['ctt-expresso']`.
  - `cttExpresso.test.ts`: continua `NOT_IMPLEMENTED` (ajustar só se enumerar campos).
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/providers tests/server/ecommerce/settings.test.ts tests/server/ecommerce/shippingZones.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; acrescentar a nota aos pendentes.
- [ ] **Step 4:** → PASS; `npx vitest run tests/server/ecommerce` verde; `npm run test:ts:back`, `npm run test:ts:tests` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): carriers choose their shipping zones; deleting a zone removes its rates`

---

### Task 7: Admin — separador Envios: zonas de envio e contentor único do envio manual

**Files:**
- Create: `admin/src/ecommerce/pages/settings/ShippingSettings.tsx`, `admin/src/ecommerce/components/settings/ShippingZonesSection.tsx`, `admin/src/ecommerce/components/settings/ShippingZoneModal.tsx`, `admin/src/ecommerce/utils/shippingZoneForm.ts`, usecases `fetchShippingZones.ts`, `createShippingZone.ts`, `updateShippingZone.ts`, `deleteShippingZone.ts` em `admin/src/ecommerce/usecases/settings/`
- Modify: `admin/src/ecommerce/settingsTypes.ts`, `admin/src/ecommerce/gateways/ecommerceSettingsGateway.ts`, `admin/src/ecommerce/pages/settings/SettingsPage.tsx`, `admin/src/ecommerce/pages/settings/IntegrationsSection.tsx`, `admin/src/ecommerce/components/settings/IntegrationCard.tsx`, `admin/src/ecommerce/components/settings/ManualMethodsTable.tsx`, `en.json`, `pt.json`
- Test: `tests/admin/ecommerce/shippingZoneForm.test.ts` (novo)

**Interfaces:**
- Consumes: rotas de zonas (Task 4), `markets` de `GET /store`.
- Produces:
  - admin `ShippingZone = { id: number; name: string; countries: string[]; position: number }`, `ShippingZoneInput`; gateway `fetchShippingZones`, `createShippingZone(input)`, `updateShippingZone(id, input)`, `deleteShippingZone(id)`.
  - `shippingZoneForm.ts`: `type ZoneDraft = { name: string; countries: string[] }`; `emptyZoneDraft(): ZoneDraft`; `zoneToDraft(zone): ZoneDraft`; `draftToZoneInput(draft): { input?: ShippingZoneInput; errors: Record<string, string> }` (`name` vazio → `required`, sem países → `countries` `required`, países normalizados com `normalizeCountries`); `zoneErrorMap(errors: SettingsFieldError[]): { fields: Record<string, string>; conflictZones: string[] }` (`countries.N` colapsa em `countries`; `ZONE_COUNTRY_CONFLICT` junta os `detail` em `conflictZones` sem repetidos); `zoneCountriesSummary(zone, locale): string` (nomes dos países por `countryOptions`, separados por ", ").
  - `ShippingSettings` (substitui, para `section === 'shipping'`, o `IntegrationsSection` genérico): carrega `markets` e zonas; renderiza `ShippingZonesSection` (tabela nome / países / ações, botão "Add zone", estado vazio com `EmptySection` e "Create a zone to start offering shipping.", modal com nome e `MultiSelect` só com os `markets`, confirmação ao apagar com o texto abaixo) e depois `IntegrationsSection category="carrier" zones={zones}`. Depois de criar/editar/apagar uma zona, `zones` atualiza e o `IntegrationsSection` e o `ManualMethodsTable` voltam a pedir os seus dados (dependência de efeito em `zones`).
  - `IntegrationCard` ganha `children?: ReactNode`, renderizado no fim do mesmo `Box`. O `IntegrationsSection` passa `<ManualMethodsTable embedded readOnly zones={zones} />` como `children` do cartão `manual` e deixa de o renderizar à parte. Com `embedded`, o `ManualMethodsTable` não tem `Box`/sombra nem título/descrição próprios (o cartão já tem título "Manual shipping", interruptor e descrição).
- Traduções: `settings.zones.title` "Shipping zones" / "Zonas de envio", `settings.zones.description` "Group the countries you sell to by shipping rules. Each shipping method sets its price per zone." / "Agrupe os países onde vende segundo as regras de envio. Cada método de envio define o preço por zona.", `settings.zones.add` "Add zone" / "Adicionar zona", `settings.zones.empty` "Create a zone to start offering shipping." / "Crie uma zona para começar a oferecer envios.", `settings.zones.table.name|countries|actions`, `settings.zones.modal.createTitle|editTitle`, `settings.zones.fields.name|countries`, `settings.zones.fields.countries.hint` "Only countries in your markets (Settings → General)." / "Só países dos seus mercados (Definições → Geral).", `settings.zones.deleteConfirm.title` "Delete this zone?" / "Apagar esta zona?", `settings.zones.deleteConfirm.text` "Its prices are removed from the manual shipping methods and from the carriers that serve it." / "Os preços desta zona saem dos métodos de envio manual e das transportadoras que a servem.", `settings.errors.not_in_market` "This country is not in your markets." / "Este país não está nos seus mercados.", `settings.errors.ZONE_COUNTRY_CONFLICT` "Some countries already belong to another zone: {zones}." / "Alguns países já pertencem a outra zona: {zones}.", `settings.errors.too_long` "This value is too long." / "Este valor é demasiado longo."; `providers.manual.description` passa a "Fixed-price delivery options you handle yourself, such as store pickup or regular mail, priced per shipping zone." / equivalente pt; `settings.manualMethods.title`/`.description` deixam de ser usados e saem.

- [ ] **Step 1: Failing tests:** `draftToZoneInput({ name: ' Ilhas ', countries: ['pt', 'PT'] })` → `input { name: 'Ilhas', countries: ['PT'] }`; `({ name: '', countries: [] })` → `errors { name: 'required', countries: 'required' }`; `zoneErrorMap([{ path: 'countries.0', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Continente' }, { path: 'countries.1', code: 'ZONE_COUNTRY_CONFLICT', detail: 'Continente' }])` → `{ fields: { countries: 'ZONE_COUNTRY_CONFLICT' }, conflictZones: ['Continente'] }`; `zoneCountriesSummary({ countries: ['PT','ES'] }, 'en')` → `'Portugal, Spain'`.
- [ ] **Step 2:** `npx vitest run tests/admin/ecommerce/shippingZoneForm.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS; `npm run test:ts:front` limpo.
- [ ] **Step 5: Commit** `feat(ecommerce): shipping zones admin; manual shipping in a single container`

---

### Task 8: Admin — preços por zona nos métodos manuais e zonas na configuração do CTT

**Files:**
- Modify: `admin/src/ecommerce/settingsTypes.ts` (`ManualMethod.rates`, `ProviderField.type` com `'zones'`), `admin/src/ecommerce/utils/manualMethodForm.ts`, `admin/src/ecommerce/components/settings/ManualMethodModal.tsx`, `admin/src/ecommerce/components/settings/ManualMethodsTable.tsx`, `admin/src/ecommerce/utils/integrationForm.ts`, `admin/src/ecommerce/components/settings/IntegrationConfigModal.tsx` (prop `zones`), `admin/src/ecommerce/pages/settings/IntegrationsSection.tsx` (passa `zones` ao modal), `en.json`, `pt.json`
- Test: `tests/admin/ecommerce/integrationForm.test.ts` (inclui os testes de `manualMethodForm`)

**Interfaces:**
- Consumes: `ManualMethod.rates` (Task 5), campo `zones` (Task 6), `zones` passados pela `ShippingSettings` (Task 7).
- Produces:
  - `ManualMethodDraft = { names: Record<string, string>; rates: Record<string, string>; taxChoice: string; taxOther: string; active: boolean }` (sem `price`/`countries`; `rates` por id de zona, texto como escrito).
  - `emptyManualMethodDraft(localeCodes, zones: ShippingZone[])` (todas as zonas com `''`); `manualMethodToDraft(method, localeCodes, uiLocale, zones)` (`centsToText` por zona; zonas sem preço → `''`); `draftToManualMethodInput(draft, defaultLocale)`: cada valor não vazio → `parseMoneyToCents`, inválido → `errors['rates.<id>'] = 'invalid_number'`; vazio → omitido; nenhum preço → `errors.rates = 'required'` (o modal exige pelo menos uma zona com preço).
  - `manualMethodErrorMap`: mantém `rates.<id>` como chave; deixa de colapsar `countries.N`.
  - `ratesSummary(method: ManualMethod, zones: ShippingZone[], uiLocale: string): string` — `"<zona> <preço>"` pela ordem das zonas, separados por " · ", zonas sem preço omitidas; sem nenhum → `''` (a tabela mostra então "Not available in any zone").
  - `ManualMethodModal`: uma linha por zona (nome + `TextInput` de preço, em branco = indisponível); sem zonas → aviso "Create a shipping zone first." e botão de gravar desativado. `ManualMethodsTable`: colunas `name`, `rates`, `tax`, `active`.
  - `IntegrationFormValues = Record<string, string | boolean | string[]>`; `integrationFormFromView`: `zones` → ids guardados como texto; `buildIntegrationPayload`: `zones` → `number[]`; `validateIntegrationForm` (Task 3) acrescenta: campo `zones` obrigatório vazio → `required`. `IntegrationConfigModal` renderiza `type 'zones'` como `MultiSelect withTags` com as zonas (nome), e sem zonas mostra o aviso "Create a shipping zone first.".
- Traduções: `settings.manualMethods.table.rates` "Price per zone" / "Preço por zona", `settings.manualMethods.noZones` "Not available in any zone" / "Indisponível em todas as zonas", `settings.manualMethods.fields.rates` "Price per zone" / "Preço por zona", `settings.manualMethods.fields.rates.hint` "Leave a zone blank to not offer this method there." / "Deixe uma zona em branco para não oferecer este método nela.", `settings.zones.createFirst` "Create a shipping zone first." / "Crie primeiro uma zona de envio.", `providers.ctt-expresso.fields.zones` "Shipping zones served" / "Zonas de envio servidas", `settings.errors.invalid_zone` "Choose existing shipping zones." / "Escolha zonas de envio existentes."; remover `settings.manualMethods.table.price`, `.table.countries` e os textos de `price`/`countries` do modal.

- [ ] **Step 1: Failing tests** (substituem os de `price`/`countries` em `integrationForm.test.ts`):
  - `draftToManualMethodInput({ names: { pt: 'Entrega em loja' }, rates: { '1': '3,50', '2': '' }, taxChoice: '23', taxOther: '', active: true }, 'pt')` → `input { name: { pt: 'Entrega em loja' }, rates: { '1': 350 }, tax: 23, active: true }`;
  - `rates: { '1': 'abc' }` → `errors['rates.1'] === 'invalid_number'`; todas em branco → `errors.rates === 'required'`;
  - `manualMethodToDraft({ …, rates: { '1': 495 } }, ['pt'], 'pt', [zona1, zona2])` → `rates { '1': '4,95', '2': '' }`;
  - `manualMethodErrorMap([{ path: 'rates.9', code: 'invalid_zone' }])` → `{ 'rates.9': 'invalid_zone' }`;
  - `ratesSummary({ rates: { '2': 995, '1': 495 } }, [{ id: 1, name: 'Continente' }, { id: 2, name: 'Ilhas' }], 'pt')` → `'Continente 4,95 € · Ilhas 9,95 €'` (formato de `formatCents`);
  - `buildIntegrationPayload([{ key: 'zones', type: 'zones', … }], { zones: ['1', '3'] })` → `config.zones` `[1, 3]`; `integrationFormFromView` com `config.zones [2]` → `['2']`; `validateIntegrationForm` com `zones: []` obrigatório → `{ zones: 'required' }`.
- [ ] **Step 2:** `npx vitest run tests/admin/ecommerce/integrationForm.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS; `npx vitest run tests/admin` verde; `npm run test:ts:front`, `npm run test:ts:tests` e `npm run build` limpos.
- [ ] **Step 5: Commit** `feat(ecommerce): per-zone prices for manual methods and zones for CTT in the admin`

---

### Task 9: Documentação do contrato e verificação final do plano 8

**Files:**
- Modify: `docs/ecommerce/storefront-api.md`, `docs/superpowers/plans/ecommerce-followups.md`

- [ ] **Doc `storefront-api.md`:** na cotação (`/cart/quote`) e na criação de encomendas: um país fora dos **mercados** da loja → `400` com `invalid_country`; um país dos mercados sem **zona de envio**, ou sem métodos com preço para essa zona, → `shippingOptions: []` (a loja não envia para lá); em "Images", um parágrafo "Store logo in e-mails": o logótipo é um PNG do provider de upload e, com o provider local, os e-mails usam `<storefrontUrl>/uploads/...`, por isso o BFF tem de servir `/uploads` publicamente (já documentado para as imagens dos produtos).
- [ ] `npx vitest run`, `npm run test:ts:back`, `npm run test:ts:front`, `npm run test:ts:tests` e `npm run build` limpos.
- [ ] `grep -rnE "shippingCountries|paymentSuccessPath|paymentCancelPath|logoUrl" server/src admin/src tests docs/ecommerce` → só `store.logoUrl` (variável de e-mail, catálogo, layout, testes de e-mail), `paymentSuccessPath`/`paymentCancelPath` na definição Stripe, no `stripePayments.ts`, nas traduções `providers.stripe.fields.*` e nos testes; nenhum `shippingCountries`.
- [ ] No Strapi de teste (`~/Projects/littlebox-plugins/strapi/backend-base`, MariaDB; reiniciar como descrito na memória do projeto). As tabelas antigas mantêm colunas `price`/`countries` que deixam de ser usadas (projeto não lançado, sem migração). Sem chamadas externas (Stripe e Resend inativos):
  1. Tabela `ltb_st_module_ecommerce_shipping_zones` criada; `manual_shipping_methods` com a coluna `rates`.
  2. *General*: carregar um PNG 1200×300 transparente → miniatura; o ficheiro em `public/uploads/store-logo_*.png` tem 384×96 e transparência; substituir por um JPEG → o PNG anterior desaparece de `public/uploads`; remover → ficheiro apagado e miniatura vazia; um PDF → erro traduzido (`en` e `pt`). Nenhum registo novo na Media Library.
  3. Pré-visualização de um modelo de e-mail com logótipo e `storefrontUrl` `https://shop.example` → `<img src="https://shop.example/uploads/store-logo_….png" width="…" height="48">`; sem `storefrontUrl` → o nome da loja; nenhum `localhost:1337`.
  4. *Payments → Stripe*: os dois caminhos com os defaults; `//evil.com` recusado no modal e no servidor (pedido manual com `curl`); a secção *General → Storefront* só tem o URL.
  5. *General → Region*: Mercados `PT, ES, FR`. *Shipping*: zona "Continente" `PT`, zona "Espanha" `ES`; uma terceira zona com `PT` → erro com o nome "Continente"; retirar `ES` dos mercados → erro com "Espanha" e nada gravado.
  6. O cartão "Manual shipping" mostra título, interruptor, descrição e a tabela de métodos dentro do mesmo contentor. Método "Correio" com Continente 4,95 € e Espanha em branco.
  7. Storefront (script `node` com o token do BFF, como no plano 7): `/cart/quote` com `destination PT` → "Correio" 4,95 €; `ES` → `shippingOptions: []`; `FR` (mercado sem zona) → `[]`; `DE` com `shippingMethod` → `invalid_country`. No admin, criar encomenda para `DE` → `invalid_country` traduzido.
  8. CTT: configurar com zona "Espanha" e ativar → a cotação `ES` regista a falha `NOT_IMPLEMENTED` e `PT` não chama o CTT; apagar a zona "Espanha" → desaparece da configuração do CTT e das `rates` do "Correio".
  9. Os módulos antigos (Menus, Slugs, Traduções) continuam a responder como antes.
- [ ] Acrescentar a `ecommerce-followups.md` (secção "Plan 8") os pendentes encontrados e estes:
  - a exclusividade país → zona é verificada no serviço (sem índice na base de dados): duas gravações simultâneas no admin podem pôr o mesmo país em duas zonas;
  - o storefront não expõe os mercados (nenhum endpoint de países existe hoje); o BFF precisa de os conhecer para o formulário de morada: acrescentar um endpoint público se for preciso;
  - o formulário de morada das encomendas no admin lista todos os países; restringir a morada de envio aos mercados (hoje o servidor recusa com `invalid_country`).
- [ ] Commit de correções: `chore(ecommerce): plan 8 verification fixes`
