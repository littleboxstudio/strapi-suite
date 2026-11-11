# E-commerce, plano 1: Base e Produtos (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr o módulo E-commerce no plugin, desligado por defeito, com card no dashboard,
layout com menu lateral e o ecrã de **Produtos** completo: catálogo com variantes, traduções,
"Traduzir com IA", galeria própria com recorte/redimensionamento para WebP e permissões RBAC.

**Architecture:** O código novo vive em pastas `ecommerce/` no servidor e no admin. Os ficheiros
partilhados só recebem entradas aditivas. As regras puras (validação, slug, sanitização, cálculo de
recorte, dinheiro) ficam em `server/src/services/modules/ecommerce/domain/` e
`admin/src/ecommerce/utils/`, testadas com Vitest. Os serviços Strapi usam a Query Engine
(`strapi.db.query`), como os módulos existentes. As imagens são processadas com `sharp` e enviadas
diretamente ao provider de upload do Strapi, sem registos na Biblioteca de Media.

**Tech Stack:** Strapi 5 plugin (TypeScript), React 18 + `@strapi/design-system` v2, Vitest, `sharp`,
`sanitize-html`, `react-easy-crop`, TipTap v2 (só os nós e marcas mínimos).

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (prevalece) e
`docs/superpowers/specs/2026-11-11-ecommerce-requirements.md` (secção **Produtos**).

**Planos seguintes (fora deste):** 2 Configurações · 3 Clientes e núcleo de Encomendas ·
4 Pagamentos, Expedições, Devoluções, Reembolsos, Vale, Faturação e Notificações · 5 Promoções ·
6 API do Storefront.

## Global Constraints

- Strapi 5 (`@strapi/strapi ^5.10.3` em dev). Não mexer em comportamento nem em dados dos módulos existentes. Alterações a ficheiros partilhados só aditivas (design 2.3).
- Módulo `ecommerce`, definição `active` com **valor por defeito `'false'`** (design 2.2).
- Todas as content-types novas têm `pluginOptions.content-manager.visible=false`, `content-type-builder.visible=false` e `i18n.localized=false` (design 2.4).
- Prefixo de UID e de tabela: `ltb-st-module-ecommerce-*` / `ltb_st_module_ecommerce_*`.
- Nomes de campos em inglês (design 2.6).
- Dinheiro em **cêntimos inteiros**, EUR (design 2.7). `price` é inteiro em cêntimos e inclui IVA.
- Idiomas de conteúdo = locales de `strapi.plugin('i18n').service('locales')`. O locale por defeito é obrigatório (design 3.2).
- Não usar a Biblioteca de Media: sem registos em `plugin::upload.file` (design 3.4).
- Imagens: **WebP, qualidade 80**; o original nunca é persistido (design 3.4).
- `description` permite só `p`, `br`, `strong`, `em`, `u`, sem atributos (design 3.2).
- Ilustrações: SVG minimalista a preto e branco, traço desenhado à mão, áreas preenchidas a preto, pequenos detalhes decorativos e `currentColor` (design 2.8).
- Paginação da lista de produtos: **50** por página, no servidor.
- Interface admin em `en` e `pt`. As chaves em falta em `pt` caem para `en` (design 2.5).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Trabalhar no branch `feat/ecommerce` (criado na Task 1).

## Review Focus

1. **SKU duplicado entre produtos diferentes ou dentro do mesmo produto:** o utilizador espera um erro claro no campo e nada gravado. Teste na Task 4 (`validateProductInput`) e na Task 6 (serviço rejeita SKU existente noutro produto).
2. **Dois produtos com o mesmo nome no mesmo locale:** o slug é desambiguado (`camisa`, `camisa-2`) e não falha. Teste na Task 4 (`resolveUniqueSlug`).
3. **Imagem enviada não é imagem, ou excede o tamanho:** erro 400 e nada fica no provider. Teste na Task 5 (`processImage` rejeita buffer inválido) e limite de **15 MB** na rota (Task 7).
4. **HTML colado na descrição (links, scripts, estilos):** é removido no servidor e só fica negrito, itálico e sublinhado. Teste na Task 4 (`sanitizeDescription`).
5. **Eliminar uma imagem falha no provider:** o registo não pode ficar órfão e a UI mostra erro. O serviço apaga primeiro do provider e só depois o registo; se o provider falhar, mantém o registo e devolve erro. Teste na Task 5 (`ImageService.remove`).

---

### Task 1: Registo do módulo (servidor) e card no dashboard

**Files:**
- Modify: `server/src/config/index.ts` (UIDs novas em `LtbConfigs.uuid.modules.ecommerce`)
- Modify: `server/src/bootstrap.ts` (nova entrada em `defaultSettings`)
- Modify: `server/src/middlewares/checkModuleIsActive.ts` (mapeamento `/ecommerce`)
- Modify: `admin/src/core/config.ts` (`uuid.modules.ecommerce = 'ecommerce'`)
- Modify: `admin/src/pages/HomePage.tsx` (novo `Card`)
- Modify: `admin/src/index.ts` (`registerTrads` com fallback para `en`)
- Modify: `admin/src/core/translations/en.json`; Create: `admin/src/core/translations/pt.json`
- Test: `tests/server/ecommerce/checkModuleIsActive.test.ts`, `tests/admin/ecommerce/registerTrads.test.ts`

**Interfaces:**
- Produces: `LtbConfigs.uuid.modules.ecommerce = { product, productTranslation, variant, variantTranslation, image }` (UIDs `plugin::littlebox-strapi-suite.ltb-st-module-ecommerce-product`, `...-product-translation`, `...-variant`, `...-variant-translation`, `...-image`). Constante `ECOMMERCE_MODULE = 'ecommerce'` exportada de `server/src/config/index.ts`.
- Produces: `mergeTranslations(base: Record<string,string>, locale: Record<string,string>): Record<string,string>` em `admin/src/core/utils/mergeTranslations.ts`.

- [ ] **Step 1: Criar o branch** — `git checkout -b feat/ecommerce`
- [ ] **Step 2: Write failing tests**
  - `checkModuleIsActive`: um pedido a `/littlebox-strapi-suite/admin/ecommerce/products` procura a definição `module: 'ecommerce'`. Com `value 'false'` chama `ctx.forbidden('Module is not active')`; com `'true'` chama `next`. Um pedido a `/modules/parameters` continua a procurar `'parameter'` (regressão).
  - `mergeTranslations({a:'A',b:'B'},{a:'Á'})` devolve `{a:'Á',b:'B'}`.
- [ ] **Step 3: Run** `npx vitest run tests/server/ecommerce tests/admin/ecommerce` → FAIL.
- [ ] **Step 4: Implementar**
  - Em `getModuleName`, testar `url.includes('/ecommerce')` **antes** dos restantes e devolver `'ecommerce'`.
  - Juntar `{ module: 'ecommerce', property: 'active', type: 'boolean', value: 'false' }` a `defaultSettings`. O loop existente só cria quando não existe, por isso as instalações atualizadas recebem `false` e as definições existentes não mudam.
  - `registerTrads`: carregar `en.json` e o locale pedido e devolver `mergeTranslations(en, locale)` (para `en`, devolve o próprio).
  - `HomePage`: novo `Card` com chaves `module.ecommerce.name` / `module.ecommerce.description`, `active={settings.provide('ecommerce').active}`, e botão com texto `app.manage` ("Manage" / "Gerir") que navega para `/plugins/${pluginId}/ecommerce/products`.
  - `pt.json`: só as chaves `ecommerce.*`, `module.ecommerce.*` e `app.manage`. As restantes caem para `en`.
- [ ] **Step 5: Run** os testes → PASS. Correr também `npx vitest run` (toda a suite, sem regressões).
- [ ] **Step 6: Commit** `feat(ecommerce): register module (off by default) and dashboard card`

---

### Task 2: Content-types do catálogo

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{product,product-translation,variant,variant-translation,image}/{schema.json,index.ts}`
- Modify: `server/src/content-types/index.ts` (5 entradas novas)
- Test: `tests/server/ecommerce/contentTypes.test.ts`

**Interfaces:**
- Produces (atributos):
  - `product`: `active` boolean (default true), `translations` oneToMany → product-translation (mappedBy `product`), `variants` oneToMany → variant (mappedBy `product`), `images` oneToMany → image (mappedBy `product`).
  - `product-translation`: `product` manyToOne, `locale` string (required), `name` string (required), `slug` string (required), `shortDescription` text, `description` text. Índice único `["locale","slug"]` com nome `ecommerce_product_tr_locale_slug_unique`.
  - `variant`: `product` manyToOne, `sku` string (required, unique), `price` integer (required, min 0), `tax` decimal (required, min 0, max 100), `stock` integer (required, default 0), `weight` decimal (default 0), `width`/`height`/`depth` decimal (default 0), `active` boolean (default true), `position` integer (default 0), `translations` oneToMany → variant-translation, `images` oneToMany → image (mappedBy `variant`).
  - `variant-translation`: `variant` manyToOne, `locale` string (required), `option` string (required).
  - `image`: `product` manyToOne, `variant` manyToOne, `position` integer, `name` string, `width` integer, `height` integer, `sizeBytes` integer, `mime` string, `ext` string, `hash` string (unique), `url` string, `provider` string, `providerMetadata` json.
  - Todas: `draftAndPublish: false` e os `pluginOptions` das Global Constraints.

- [ ] **Step 1: Write failing test** — importa `server/src/content-types` e, para cada uma das 5 chaves `ltb-st-module-ecommerce-*`, verifica `pluginOptions['content-manager'].visible === false`, `['content-type-builder'].visible === false`, `draftAndPublish === false` e a presença dos atributos acima (incluindo `variant.attributes.sku.unique === true`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Criar os schemas e registar** no `content-types/index.ts`.
- [ ] **Step 4: Run** → PASS. `npx tsc -p server/tsconfig.json --noEmit` sem erros.
- [ ] **Step 5: Commit** `feat(ecommerce): catalog content-types`

---

### Task 3: Permissões RBAC do e-commerce (produtos)

**Files:**
- Create: `server/src/services/modules/ecommerce/permissions.ts`
- Modify: `server/src/bootstrap.ts` (chamar `registerEcommercePermissions(strapi)`)
- Test: `tests/server/ecommerce/permissions.test.ts`

**Interfaces:**
- Produces: `ECOMMERCE_PERMISSIONS = { productsRead: 'plugin::littlebox-strapi-suite.ecommerce.products.read', productsManage: 'plugin::littlebox-strapi-suite.ecommerce.products.manage' }` e `registerEcommercePermissions(strapi): Promise<void>`. Os planos seguintes acrescentam ações a este ficheiro.
- Rotas consomem: `policies: ['admin::isAuthenticatedAdmin', { name: 'admin::hasPermissions', config: { actions: [ECOMMERCE_PERMISSIONS.productsRead] } }]`.

- [ ] **Step 1: Failing test** — com `strapi.admin.services.permission.actionProvider.registerMany` simulado, verifica que é chamado com duas ações: `section: 'plugins'`, `pluginName: 'littlebox-strapi-suite'`, `subCategory: 'ecommerce'`, `uid: 'ecommerce.products.read'` / `'ecommerce.products.manage'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): RBAC actions for products`

---

### Task 4: Domínio puro do catálogo

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/catalog.ts`
- Test: `tests/server/ecommerce/domain/catalog.test.ts`
- Modify: `package.json` (dependência `sanitize-html ^2.13.0` e devDependency `@types/sanitize-html`)

**Interfaces:**
- Produces:
  - `slugify(text: string): string`: minúsculas, sem acentos (NFD), não alfanuméricos passam a `-`, sem `-` duplicados nem nas pontas.
  - `resolveUniqueSlug(base: string, taken: string[]): string`: devolve `base` ou `base-2`, `base-3`…
  - `sanitizeDescription(html: string): string`: allow-list `p, br, strong, em, u`, sem atributos. `b` passa a `strong` e `i` a `em`.
  - `type ProductInput = { active: boolean; translations: Record<string /*locale*/, { name: string; slug?: string; shortDescription?: string; description: string }>; variants: VariantInput[] }`
  - `type VariantInput = { id?: number; sku: string; price: number; tax: number; stock: number; weight: number; width: number; height: number; depth: number; active: boolean; translations: Record<string, { option: string }> }`
  - `type FieldError = { path: string; code: 'required' | 'min_variants' | 'duplicate_sku' | 'invalid_number' | 'out_of_range' }`
  - `validateProductInput(input: ProductInput, defaultLocale: string): FieldError[]`

- [ ] **Step 1: Failing tests** (valores exatos):
  - `slugify('Camisa de Linho Ação!') === 'camisa-de-linho-acao'`
  - `resolveUniqueSlug('camisa', ['camisa','camisa-2']) === 'camisa-3'`, e `resolveUniqueSlug('caneca', []) === 'caneca'`
  - `sanitizeDescription('<p><b>A</b> <a href="x">B</a><script>x</script><u style="c">C</u></p>') === '<p><strong>A</strong> B<u>C</u></p>'`
  - `validateProductInput` com `variants: []` → contém `{path:'variants', code:'min_variants'}`
  - Sem `translations.en.name` (defaultLocale `en`) → `{path:'translations.en.name', code:'required'}`. `translations.pt.name` vazio **não** dá erro.
  - Duas variantes com `sku 'A'` → `{path:'variants.1.sku', code:'duplicate_sku'}`
  - `price: -1` → `out_of_range`; `tax: 101` → `out_of_range`; `stock: 1.5` → `invalid_number`
  - Variante sem `translations.en.option` → `required`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): catalog domain rules`

---

### Task 5: Processamento e armazenamento de imagens

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/imageProcessing.ts`
- Create: `server/src/services/modules/ecommerce/images.ts` (serviço `EcommerceImageService`)
- Modify: `server/src/services/index.ts`; `package.json` (`sharp 0.35.5` em `dependencies`, a mesma versão exata que o `@strapi/upload` instalado usa)
- Test: `tests/server/ecommerce/domain/imageProcessing.test.ts`, `tests/server/ecommerce/images.test.ts`

**Interfaces:**
- Produces:
  - `type ImageTransform = { mode: 'crop'; width: number; height: number; crop: { x: number; y: number; width: number; height: number } } | { mode: 'resize'; width: number; height: number }`. As coordenadas do recorte vêm em píxeis da imagem original.
  - `processImage(input: Buffer, t: ImageTransform): Promise<{ buffer: Buffer; width: number; height: number; sizeBytes: number }>`: `crop` faz `extract(crop)` e depois `resize(width,height,{fit:'fill'})`; `resize` faz `resize(width,height,{fit:'fill'})`. Ambos terminam em `.webp({ quality: 80 })`. Rejeita (`Error('INVALID_IMAGE')`) entradas que o `sharp` não lê, dimensões ≤ 0 ou > 6000, e recortes fora dos limites.
  - `EcommerceImageService.upload(params: { buffer: Buffer; originalName: string; transform: ImageTransform; owner: { productId?: number; variantId?: number } }): Promise<ImageRecord>`: processa, monta o objeto de ficheiro do provider (`{ name: '<base>.webp', hash: '<base>_<random>', ext: '.webp', mime: 'image/webp', size: kb, width, height, buffer, getStream }`), chama `strapi.plugin('upload').provider.upload(file)`, cria o registo `image` com a `position` seguinte e **nunca** chama o `upload` service nem cria `plugin::upload.file`.
  - `EcommerceImageService.remove(imageId: number): Promise<void>`: chama `provider.delete(file)` **primeiro** e só depois apaga o registo. Se o provider falhar, lança o erro e mantém o registo.
  - `type ImageRecord = { id; name; width; height; sizeBytes; url; position }`

- [ ] **Step 1: Failing tests**
  - Gerar um PNG 400×300 com `sharp({create:{width:400,height:300,channels:3,background:'#f00'}}).png().toBuffer()`.
  - `crop` `{x:50,y:0,width:300,height:300}` para 120×120 → resultado `width 120`, `height 120`, e `sharp(buffer).metadata().format === 'webp'`.
  - `resize` 200×150 → 200×150, webp.
  - `Buffer.from('nope')` → rejeita com `INVALID_IMAGE`. Recorte `{x:350,...width:300}` → `INVALID_IMAGE`.
  - `upload` com provider simulado: `provider.upload` recebe `mime 'image/webp'`; `strapi.db.query('plugin::upload.file')` **não** é chamado; o registo é criado com o `url` definido pelo provider.
  - `remove`: com o provider a lançar erro, `delete` do registo não é chamado e o erro propaga-se.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): webp image processing and plugin-owned storage`

---

### Task 6: Serviço de produtos

**Files:**
- Create: `server/src/services/modules/ecommerce/products.ts` (serviço `EcommerceProductService`)
- Modify: `server/src/services/index.ts`
- Test: `tests/server/ecommerce/products.test.ts` (Query Engine simulada em memória, no estilo de `tests/server/slugServiceTabs.test.ts`)

**Interfaces:**
- Consumes: Task 4 (`validateProductInput`, `slugify`, `resolveUniqueSlug`, `sanitizeDescription`) e Task 5 (`EcommerceImageService.remove`).
- Produces:
  - `list(params: { page: number; search?: string; locale?: string }): Promise<{ results: ProductListItem[]; pagination: { page: number; pageSize: 50; total: number; pageCount: number } }>`. `search` compara (`$containsi`) com `translations.name` em qualquer locale **ou** `variants.sku`. Ordena por `id desc`.
  - `type ProductListItem = { id: number; name: string /*locale pedido, senão o por defeito*/; thumbnailUrl: string | null /*1.ª imagem do produto, senão a 1.ª da 1.ª variante*/; skus: string[]; priceMin: number; priceMax: number; stockTotal: number; variantCount: number; hasNegativeStock: boolean; active: boolean }`
  - `get(id: number): Promise<ProductDetail>`: `ProductDetail = ProductInput & { id; images: ImageRecord[]; variants: (VariantInput & { id: number; images: ImageRecord[] })[] }`
  - `create(input: ProductInput): Promise<{ id: number }>` / `update(id: number, input: ProductInput): Promise<void>`. Numa `strapi.db.transaction`: valida (erros → `ValidationError` com `details.errors: FieldError[]`), sanitiza `description`, gera o slug de cada locale com nome (`slugify(name)` + `resolveUniqueSlug` contra os slugs desse locale, excluindo o próprio produto), verifica que nenhum SKU existe noutro produto (`duplicate_sku`), e faz upsert das traduções e das variantes por `id`. As variantes que não vierem no `update` são apagadas, juntamente com as suas imagens (via `EcommerceImageService.remove`).
  - `getDefaultLocale(): Promise<string>` e `getLocales(): Promise<{code:string;name:string}[]>` através do serviço `locales` do i18n.

- [ ] **Step 1: Failing tests**
  - `list({page:2})` com 120 produtos → 50 resultados, `pagination {page:2,pageSize:50,total:120,pageCount:3}`.
  - `list({page:1, search:'cam-p'})` encontra o produto pela SKU `CAM-P-M`.
  - `create` com dois produtos com `name 'Camisa'` em `en` → slugs `camisa` e `camisa-2`.
  - `create` com SKU já usado noutro produto → lança `ValidationError` com `{path:'variants.0.sku', code:'duplicate_sku'}` e não cria nada.
  - `update` sem uma das variantes → essa variante é apagada e `EcommerceImageService.remove` é chamado para cada imagem dela.
  - `description` com `<a>` é guardada sem o link.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): product service`

---

### Task 7: Rotas e controllers admin (produtos, imagens, IA)

**Files:**
- Create: `server/src/controllers/modules/ecommerce/products.ts` (`EcommerceProductController`)
- Create: `server/src/routes/ecommerce/admin-products.ts`
- Modify: `server/src/routes/admin-api.ts` (spread das rotas novas no fim), `server/src/controllers/index.ts`
- Test: `tests/server/ecommerce/productRoutes.test.ts`, `tests/server/ecommerce/productController.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5 e 6, e `AiTranslationModuleService.getCredentials()` / `.translateStrings()` (existentes).
- Produces (todas com `middlewares: ['plugin::littlebox-strapi-suite.check-module-is-active']`; `read` = `productsRead`, `manage` = `productsManage`):

| Método | Path | Permissão | Corpo / Resposta |
|---|---|---|---|
| GET | `/admin/ecommerce/locales` | read | `{ defaultLocale, locales: {code,name}[], aiAvailable: boolean }` |
| GET | `/admin/ecommerce/products?page=&search=&locale=` | read | resposta de `list` |
| GET | `/admin/ecommerce/products/:id` | read | `ProductDetail` |
| POST | `/admin/ecommerce/products` | manage | `ProductInput` → `201 {id}` |
| PUT | `/admin/ecommerce/products/:id` | manage | `ProductInput` → `204` |
| POST | `/admin/ecommerce/images` | manage | multipart: `file` + `transform` (JSON) + `productId` ou `variantId` → `201 ImageRecord`; limite de **15 MB**, senão `400` |
| DELETE | `/admin/ecommerce/images/:id` | manage | `204` |
| POST | `/admin/ecommerce/products/translate` | manage | `{ sourceLocale, targetLocales: string[], strings: Record<string,string> }` → `{ translations: Record<locale, Record<key,string>>, failed: number }`; `409 {code:'AI_NOT_CONFIGURED'}` se `getCredentials()` devolver `null` |

  - Erros de `ValidationError` → `400 { error: { name:'ValidationError', details:{ errors: FieldError[] } } }`, que é o formato padrão do Strapi.
  - Imagem de um produto ainda não gravado: a UI só permite upload depois do primeiro Guardar (ver Task 11), por isso `productId` ou `variantId` é obrigatório (`400` sem eles).

- [ ] **Step 1: Failing tests** — `productRoutes.test.ts` verifica que cada rota da tabela existe com o método, o path, o middleware e a policy `admin::hasPermissions` com a ação certa. `productController.test.ts` verifica: `translate` sem credenciais → `ctx.status 409`; upload > 15 MB → `400` sem chamar o serviço.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (controllers finos: ler `ctx`, chamar o serviço, mapear erros). **Step 4: Run** → PASS.
- [ ] **Step 5: Verificação manual da API** — `npm run build`, depois `npm run watch:link` e, num projeto Strapi de teste com MariaDB ou SQLite, ligar o módulo e fazer `POST /littlebox-strapi-suite/admin/ecommerce/products` pelo admin (Task 11). Neste ponto basta confirmar que o servidor arranca e que `GET /admin/ecommerce/locales` devolve 200 com o módulo ligado e 403 com ele desligado.
- [ ] **Step 6: Commit** `feat(ecommerce): admin API for products, images and AI translation`

---

### Task 8: Camada admin: gateways, use cases e utilitários puros

**Files:**
- Create: `admin/src/ecommerce/gateways/ecommerceProductGateway.ts` (interface + `EcommerceProductGatewayHttp`, no padrão de `parameterGateway.ts`)
- Create: `admin/src/ecommerce/usecases/{fetchEcommerceLocales,fetchProducts,fetchProduct,saveProduct,uploadProductImage,deleteProductImage,translateProductStrings}.ts`
- Create: `admin/src/ecommerce/utils/money.ts`, `admin/src/ecommerce/utils/cropMath.ts`
- Modify: `admin/src/index.ts` (`Registry.provide('ecommerceProductGateway', new EcommerceProductGatewayHttp())`)
- Test: `tests/admin/ecommerce/money.test.ts`, `tests/admin/ecommerce/cropMath.test.ts`

**Interfaces:**
- Produces:
  - `formatCents(cents: number, locale: string): string` → `formatCents(2990,'pt-PT') === '29,90 €'`
  - `parseMoneyToCents(input: string): number | null` → `'29,90'→2990`, `'29.9'→2990`, `'1 299,00'→129900`, `'abc'→null`, `'-1'→null`
  - `lockedHeight(width: number, ratio: number): number` (arredondado) e `toPixelCrop(areaPercent: {x,y,width,height}, natural: {width,height}): {x,y,width,height}` (inteiros, limitados à imagem). `react-easy-crop` devolve `croppedAreaPixels`, mas esta função normaliza e limita para o servidor nunca receber coordenadas fora da imagem.
  - O gateway `uploadImage(form: FormData)` usa `getFetchClient().post` com `FormData` (o `StrapiAdapter` existente aceita o corpo como está).
- [ ] **Step 1: Failing tests** com os valores acima, mais `toPixelCrop({x:90,y:0,width:20,height:100},{width:1000,height:500})` → `{x:900,y:0,width:100,height:500}` (o recorte é limitado à largura da imagem).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): admin gateways, use cases and money/crop utils`

---

### Task 9: Layout do e-commerce, rotas admin e ilustrações

**Files:**
- Create: `admin/src/ecommerce/EcommerceLayout.tsx` (menu lateral: Products, Orders, Customers, Promotions, Settings; os 4 últimos mostram `EcommerceComingSoon` neste plano)
- Create: `admin/src/ecommerce/EcommerceApp.tsx` (`<Routes>`: `products`, `products/new`, `products/:id`, `orders`, `customers`, `promotions`, `settings`)
- Create: `admin/src/ecommerce/illustrations/{EmptyProducts,EmptyVariants,ComingSoon}.tsx`
- Modify: `admin/src/pages/App.tsx` (`<Route path="ecommerce/*" element={<EcommerceApp />} />`)
- Modify: `en.json` / `pt.json` (chaves `ecommerce.menu.*`, `ecommerce.comingSoon`)

**Interfaces:**
- Produces: `<EcommerceLayout>` com `children` e item ativo derivado de `useLocation()`. Quando `settings.provide('ecommerce').active` é `false`, o layout mostra a mensagem "módulo desligado" e o botão para o ativar, com o mesmo `UpdateSetting` que `ParameterSettingsPage` usa. Quando está ligado, mostra o botão "Enabled" no cabeçalho, como nos outros módulos.
- Ilustrações: componentes `({ size?: number }) => JSX` com um `<svg>` usando `stroke="currentColor"` / `fill="currentColor"` e `role="img"` + `aria-label`. Estilo descrito nas Global Constraints. `EmptyProducts` mostra um saco de compras e uma t-shirt desenhados à mão com estrelinhas. `EmptyVariants` mostra três etiquetas de roupa penduradas.

- [ ] **Step 1: Implementar layout, rotas e ilustrações.**
- [ ] **Step 2: Verificar** `npx tsc -p admin/tsconfig.json --noEmit`, depois `npm run build`. No projeto de teste com `watch:link`: o card "E-commerce" aparece no dashboard com "Manage" e estado desligado, o botão abre o layout com o menu lateral e o item ativo realçado, e o tema escuro inverte as ilustrações.
- [ ] **Step 3: Commit** `feat(ecommerce): admin layout, navigation and illustrations`

---

### Task 10: Lista de produtos

**Files:**
- Create: `admin/src/ecommerce/pages/ProductListPage.tsx`

**Interfaces:**
- Consumes: `FetchProducts` (Task 8), `EmptyProducts` (Task 9) e `formatCents`.
- Comportamento: `Searchbar` com *debounce* de 300 ms (o mesmo do `ParameterSettingsPage`), que faz um novo pedido ao servidor com `page=1`. Tabela com thumbnail (36 px, ou um quadrado neutro), nome, SKU (a única, ou a primeira + "+N"), preço (`priceMin`, ou `priceMin – priceMax`), stock (`stockTotal`; com `hasNegativeStock` mostra um `Badge` vermelho "Negative stock") e `Edit`. O botão "Create product" fica no cabeçalho. Paginação do design-system controlada por `pagination`. O estado vazio (sem resultados **e** sem pesquisa) mostra `EmptyProducts`, "No products yet." e o botão "Create your first product". Uma pesquisa sem resultados mostra só "No results".

- [ ] **Step 1: Implementar.**
- [ ] **Step 2: Verificar no projeto de teste:** o estado vazio aparece; com 60 produtos criados via API (script de seed no README do teste ou pela UI), a página 2 mostra 10; a pesquisa por SKU encontra o produto.
- [ ] **Step 3: Commit** `feat(ecommerce): product list page`

---

### Task 11: Formulário de produto e modal de variante

**Files:**
- Create: `admin/src/ecommerce/pages/ProductEditPage.tsx`
- Create: `admin/src/ecommerce/components/LocaleSwitcher.tsx`, `DescriptionEditor.tsx`, `VariantsTable.tsx`, `VariantModal.tsx`
- Modify: `package.json` (devDependencies admin: `@tiptap/react ^2.11.0`, `@tiptap/pm ^2.11.0`, `@tiptap/extension-document`, `-paragraph`, `-text`, `-bold`, `-italic`, `-underline`, `-hard-break` (todos `^2.11.0`))

**Interfaces:**
- Consumes: `FetchEcommerceLocales`, `FetchProduct`, `SaveProduct`, `TranslateProductStrings` e `FieldError` (formato da Task 4, vindo em `error.details.errors`).
- Comportamento (mockup v3 aprovado; design 3.5):
  - Cabeçalho: voltar, título (nome no locale por defeito, ou "New product"), toggle `active` e `Save`.
  - Secção Informação: `LocaleSwitcher` (locale por defeito marcado com `*`; um ponto nos locales com nome preenchido). Campos `name`*, `slug` só de leitura (gerado no servidor; antes de gravar mostra `slugify` local como pré-visualização), `shortDescription` e `description`*.
  - "Translate with AI": envia os campos do locale por defeito (e os `option` de todas as variantes) para os locales **vazios**. Preenche o formulário sem gravar. Fica desativado com tooltip quando `aiAvailable` é `false`.
  - `DescriptionEditor`: TipTap só com Document/Paragraph/Text/HardBreak/Bold/Italic/Underline e uma barra de 3 botões. `Ctrl+B/I/U` funcionam. Colar texto rico remove o resto (o servidor volta a sanitizar).
  - Galeria (Task 12) só fica ativa depois do primeiro Save. Antes disso mostra "Save the product to add images".
  - `VariantsTable`: thumbnail, `option` (locale ativo), `sku`, `price`, `tax`, `stock`, `active` e `Edit`/`Remove`. Vazia → `EmptyVariants`, "This product has no variants yet." e "Add variant".
  - `VariantModal`: `option`* (com `LocaleSwitcher`), `active`, `sku`*, `stock`*, `price`* (texto convertido com `parseMoneyToCents`), `tax`* (`SingleSelect` com 23, 13, 6 e 0, e opção "Other" para um valor livre), `weight`, `width`/`height`/`depth` (por defeito 0) e galeria da variante (Task 12, só para variantes já gravadas). O texto de ajuda diz "Empty gallery uses the product gallery".
  - As variantes editam-se em memória e só são gravadas com o Save do produto. Os erros do servidor (`FieldError.path`) mapeiam-se para o campo (por exemplo, `variants.1.sku` destaca a linha 2 e o campo SKU na modal).
  - Save sem variantes: mostra o erro `min_variants` junto da tabela e não faz o pedido.

- [ ] **Step 1: Implementar componentes e página.**
- [ ] **Step 2: Verificar no projeto de teste:**
  1. Criar "Camisa" com variantes Preto/Branco → grava, slug `camisa`.
  2. Criar outro "Camisa" → slug `camisa-2`.
  3. SKU repetido → erro no campo da linha certa.
  4. Colar HTML com link na descrição → depois de recarregar, só fica o texto e a formatação permitida.
  5. Com a chave de IA configurada no módulo de Traduções, "Translate with AI" preenche `pt`. Sem chave, o botão fica desativado.
- [ ] **Step 3: Commit** `feat(ecommerce): product form with variants, translations and AI`

---

### Task 12: Galeria, modal de upload (recortar/redimensionar) e modal de imagem

**Files:**
- Create: `admin/src/ecommerce/components/Gallery.tsx`, `ImageUploadModal.tsx`, `ImageDetailModal.tsx`
- Modify: `package.json` (dependência admin `react-easy-crop ^5.0.8`)

**Interfaces:**
- Consumes: `UploadProductImage`, `DeleteProductImage`, `cropMath` (Task 8) e `ConfirmModal` (componente existente em `admin/src/components/ConfirmModal.tsx`).
- `Gallery` props: `{ owner: { productId?: number; variantId?: number }; images: ImageRecord[]; onChange(images: ImageRecord[]): void }`. Mostra uma grelha de miniaturas e um tile "+".
- `ImageUploadModal`: ficheiro (`accept="image/*"`, máx. 15 MB validado no cliente), separadores **Crop** e **Resize**, e campos `width` × `height` (mín. 1, máx. 6000).
  - Crop: `react-easy-crop` com `aspect = width/height`. Envia `transform {mode:'crop', width, height, crop: toPixelCrop(...)}`.
  - Resize: cadeado ligado por defeito (`lockedHeight` mantém a proporção do original) e envia `{mode:'resize', width, height}`.
  - Envia `FormData` (`file`, `transform`, `productId|variantId`) e mostra o progresso e os erros (`INVALID_IMAGE` → "This file is not a valid image").
- `ImageDetailModal`: miniatura grande, `name`, `width × height px`, tamanho (`sizeBytes` em KB/MB) e botão `Delete`. Delete abre `ConfirmModal` e só depois de confirmar chama `DeleteProductImage`. Em caso de erro, mostra a mensagem e mantém a imagem na galeria.

- [ ] **Step 1: Implementar.**
- [ ] **Step 2: Verificar no projeto de teste:**
  1. Fazer upload de uma JPEG 4000×3000 com Crop 1200×1200 → a imagem fica 1200×1200 webp e não aparece na Media Library.
  2. Redimensionar para 800 de largura com o cadeado → 800×600.
  3. Na pasta `public/uploads` (provider local) só existe o `.webp`, sem o original.
  4. Eliminar → pede confirmação, remove o ficheiro da pasta e o registo.
  5. Galeria vazia da variante → o storefront usará a do produto (verificado no plano 6; aqui confirmar que `thumbnailUrl` na lista cai para a imagem da 1.ª variante quando o produto não tem imagens).
- [ ] **Step 3: Commit** `feat(ecommerce): product galleries with crop/resize webp upload`

---

### Task 13: Verificação final do plano 1

- [ ] **Step 1:** `npx vitest run` → tudo verde (incluindo os testes antigos).
- [ ] **Step 2:** `npx tsc -p server/tsconfig.json --noEmit` e `npx tsc -p admin/tsconfig.json --noEmit` sem erros. `npm run build` e `npm run verify` sem erros.
- [ ] **Step 3: Regressão de upgrade:** num projeto de teste com a versão publicada atual (1.0.55) e dados nos módulos Menus/Parâmetros/Slugs, instalar este branch via `watch:link` e arrancar. Confirmar que os módulos antigos funcionam e mantêm os dados, que o e-commerce aparece **desligado** e que as rotas `/admin/ecommerce/*` dão 403 enquanto estiver desligado.
- [ ] **Step 4:** Verificar no Content Manager e no Content-Type Builder que nenhuma content-type `ltb-st-module-ecommerce-*` aparece.
- [ ] **Step 5: Commit** de eventuais correções: `chore(ecommerce): plan 1 verification fixes`
