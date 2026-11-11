# E-commerce, plano 6: Promoções (motor, capacidade, admin e integração com encomendas) (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o capítulo Promoções (1 a 3) dos requisitos:
- **Motor puro** de condições (AND/OR com grupos), benefícios (produto, encomenda, portes, Compre X Receba Y, ofertas), acumulação recíproca, escolha da combinação com o menor total e desempate determinístico.
- **Capacidade estrita** (design 9.2): o limite global e o limite por cliente nunca são ultrapassados; a criação da encomenda falha com 409 `PROMOTION_UNAVAILABLE`; o cancelamento devolve a capacidade.
- **Integração com encomendas:** cotação (`quote`) e criação com códigos, linhas com desconto, ofertas com stock, persistência histórica (fotografia da promoção) e libertação no cancelamento.
- **Modificações** (design 4.8): sem reavaliação; aviso quando uma condição deixa de se cumprir e ajuste manual do desconto de encomenda.
- **Admin:** menu Promoções (listagem, formulário por secções, utilizações, separador "Store credit"), secção "Promotions and discounts" da encomenda, códigos na criação manual.

**Architecture:**
- **Domínio puro** novo em `server/src/services/modules/ecommerce/domain/promotions/` (sem Strapi), separado como pede o requisito 1.35: `types.ts`, `definition.ts` (validação), `time.ts` (fuso da loja), `availability.ts` (estado e capacidade), `conditions.ts` (registo de avaliadores), `benefits.ts` (cálculo de uma combinação fixa) e `engine.ts` (`evaluatePromotions`: elegibilidade, compatibilidade, procura de combinações, desempate, resultado detalhado).
- **`EcommercePromotionService`** (`promotions.ts`): CRUD admin, carregamento de candidatas, **`reserve`** (incrementos condicionais na transação da encomenda) e **`releaseForOrder`** (idempotente, no cancelamento).
- **`EcommerceOrderService.quote`** e **`create`** partilham um único `priceCart` interno: `evaluatePromotions` sem portes → cotação de portes (com as ofertas) → `evaluatePromotions` com portes. O **plano 7** (carrinho e checkout do storefront) chama `quote` em cada alteração e `create` no checkout; não precisa de mais nada deste plano.
- Uma linha do carrinho pode dar **várias linhas de encomenda da mesma variante**, agrupadas pelo desconto por unidade (por exemplo, "Compre 3 pague 2" dá 2 unidades sem desconto e 1 com 100%). Assim o desconto de cada linha é sempre um inteiro exato por unidade (o modelo do plano 3 guarda `unitDiscount` por unidade).

**Tech Stack:** Strapi 5 (Query Engine + knex portável), `Intl` para fusos horários, Vitest, React + `@strapi/design-system` v2.

**Spec:** `docs/superpowers/specs/2026-11-11-ecommerce-design.md` (2.3, 2.6, 2.8, 4.7, 4.8, 4.16, 6, 9.1, 9.2, 10) e, em `docs/superpowers/specs/2026-11-11-ecommerce-requirements.md`, o capítulo **Promoções** completo: "1. Sistema de Promoções e Motor de Regras" (1.1–1.36), "2. Regras de Acumulação, Prioridade e Resolução de Conflitos" (2.1–2.25) e "3. Visualização de Promoções e Descontos na Encomenda" (3.1–3.9). O 1.33 (códigos de compensação) foi substituído pelo vale de crédito do plano 4 (design 4.7) e não entra aqui.

## Global Constraints

- Tudo das Global Constraints dos planos 1 a 5 continua a valer:
  - alterações aditivas; os módulos não-ecommerce não mudam;
  - content-types ocultas (`content-manager` e `content-type-builder` `visible: false`), prefixo `ltb-st-module-ecommerce-*`, relações novas `manyToOne` unidirecionais;
  - nomes de campos em inglês; `en` + `pt` na interface; ilustrações no estilo definido (reutilizar `EmptySection`);
  - dinheiro em cêntimos inteiros (EUR), **preços com IVA incluído**, valores em `[0, MAX_MONEY_CENTS]` (`MAX_MONEY_CENTS = 1_000_000_000`, `domain/orders.ts`);
  - proibido importar `@strapi/utils`;
  - **colunas JSON só recebem objetos**: `order.promotions = { applied, codes, exhaustive, evaluatedAt }`, `order-line.promotionRefs = { refs: [...] }`, `promotion.benefits = { items: [...] }`. As linhas antigas com `[]` são lidas como vazias (os defaults dos schemas existentes não mudam);
  - todo o atributo `unique: true` tem um índice único em `indexes`, com nome ≤ 60 caracteres (o teste `schemaIndexes` impõe-no);
  - qualquer base de dados suportada pelo Strapi (o cliente usa MariaDB): só Query Engine ou knex portável. **Nunca se continua uma transação depois de uma violação de índice único** (PostgreSQL aborta-a): verifica-se antes com `findOne` e, se a corrida acontecer, a violação sobe e o ciclo de tentativas de `create` (já existente, `MAX_CREATE_ATTEMPTS`) repete a criação inteira;
  - as colunas alteradas por knex (`increment`/`decrement` condicionais) têm nomes de **uma só palavra em minúsculas** (`redemptions`, `uses`), para que o nome do atributo seja o da coluna;
  - eventos emitidos dentro da transação com `collector.emit` e entregues com `flush()` depois do commit.
- **Capacidade (design 9.2, decisão do dono do produto):**
  - global: `UPDATE … SET redemptions = redemptions + 1 WHERE id = ? AND active = true AND redemptions <= <L>`, onde `<L> = usageLimit − 1` é **calculado em JS** a partir da linha da promoção lida na própria transação (a `reserve` não confia nos limites da fotografia de `loadCandidates`; o `fakeDb` e as colunas de uma só palavra só suportam constantes, nunca comparação coluna-com-coluna); sem limite, o incremento é incondicional (só `active = true`);
  - por cliente: contador `promotion-customer-usage` por promoção e e-mail normalizado, com `uses <= <L>` (`<L> = perCustomerLimit − 1`, constante calculada em JS a partir da linha da promoção); o contador é mantido **mesmo sem limite**, para que um limite acrescentado depois conte as encomendas anteriores;
  - 0 linhas afetadas → `EcommerceValidationError` com `{ path: 'promotions.<promotionId>', code: 'PROMOTION_UNAVAILABLE', detail: <código ou ''> }` → HTTP 409; a encomenda não é criada e o stock não é descontado (tudo na mesma transação);
  - o cancelamento liberta (redemption `RESERVED → RELEASED` condicional, depois os decrementos guardados por `>= 1`); repetido, não faz nada;
  - **uma modificação de encomenda não consome nem liberta**; as promoções guardadas nunca são reavaliadas (design 4.8); uma devolução também não liberta.
  - `STORE_CREDIT_INSUFFICIENT` passa também a 409 (design 9.2: "HTTP 409 com um código estável"; hoje sai como 400).
- **Ordem de cálculo** (requisitos 1.25 e 2.6), centralizada em `applyCombination`: Compre X Receba Y → descontos por unidade → subtotal → descontos de encomenda (base comum, soma ≤ subtotal) → portes → um só desconto de portes (o maior) → total. Nenhum valor negativo.
- **Arredondamento:** percentagens com meio para cima ao cêntimo (`percentOf`), sempre **por unidade** nos descontos de produto; descontos "SET" repartidos com `allocateProportionally` (já existe em `domain/orders.ts`).
- **Base das condições de subtotal:** o valor das linhas do cliente a preço original, sem portes e sem ofertas (evita a dependência circular do requisito 1.10).
- **Fuso horário:** as datas chegam e saem da API como hora local `YYYY-MM-DDTHH:mm` no `store.timezone` (por defeito `Europe/Lisbon`) e são guardadas em UTC.
- **Limite técnico da procura** (design 6): configuração do plugin `ecommerce.promotionSearchLimit` (lida com `strapi.config.get(plugin)?.ecommerce?.promotionSearchLimit`, sem assumir que existe), inteiro 1–16, por defeito 12; só o tipo `LtbConfigs` ganha `ecommerce?: { promotionSearchLimit?: number }`, sem mais nenhuma alteração de configuração; acima do limite, estratégia gulosa assinalada com `exhaustive: false`.
- **Histórico:** os valores de histórico das promoções usam a chave `promotionCode` (nunca `code`: `redactHistoryValue` mascara qualquer `code`). Os códigos de promoção não podem ter o formato dos vales (`XXXX-XXXX-XXXX`), que `redactVoucherCodes` mascara.
- **Permissões:** novas ações `ecommerce.promotions.read` ("Read promotions") e `ecommerce.promotions.manage` ("Manage promotions"). A cotação e a criação de encomendas continuam em `orders.manage`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (os subagentes podem assinar com o seu próprio modelo). Branch `feat/ecommerce`.

## Review Focus

1. **Dois checkouts disputam a última utilização de um código** (`usageLimit = 1`): o segundo `create` recebe 409 `PROMOTION_UNAVAILABLE` com o id e o código, não cria encomenda, não mexe no stock e `redemptions` fica em 1. Teste na Task 7.
2. **Cancelar duas vezes (ou cancelar depois de um cancelamento concorrente):** a capacidade é devolvida uma só vez (`redemptions` e `uses` voltam a 0, nunca −1) e há uma só entrada `PROMOTIONS_RELEASED`. Testes nas Tasks 6 e 7.
3. **Oferta da mesma variante que o cliente comprou** (Compre 2 A, receba 1 A em oferta): o stock baixa 3 de uma vez (a `operationKey` `order:<id>:create:<variantId>` é única por variante, por isso as quantidades são somadas antes do movimento). Teste na Task 7.
4. **O administrador altera a promoção depois de haver encomendas** (de 10% para 50%): a encomenda antiga mostra os valores e a fotografia de 10%, a versão sobe e as cotações novas usam 50%. Testes nas Tasks 6 e 7.
5. **Código com formato de vale ou mascarado no histórico:** `ABCD-EFGH-JKLM` é recusado (`code_reserved_format`) e o código `VERAO20` aparece por inteiro no histórico da encomenda. Testes nas Tasks 2 e 7.

---

### Task 1: Content-types, UIDs, permissões, histórico e códigos de conflito

**Files:**
- Create: `server/src/content-types/modules/ecommerce/{promotion,promotion-redemption,promotion-customer-usage}/{schema.json,index.ts}`
- Modify: `content-types/index.ts`, `config/index.ts` (UIDs `promotion`, `promotionRedemption`, `promotionCustomerUsage`), `services/modules/ecommerce/permissions.ts`, `orderHistory.ts` (`OrderHistoryType` + `PROMOTIONS_APPLIED`, `PROMOTIONS_RELEASED`), `controllers/modules/ecommerce/errors.ts` (`CONFLICT_CODES`), `tests/server/ecommerce/helpers/commerceSetup.ts` (UIDs, relações, `enforceUnique` e `getStoreSettings` com `timezone: 'Europe/Lisbon'`)
- Test: `tests/server/ecommerce/promotionsContentTypes.test.ts`, `tests/server/ecommerce/permissions.test.ts` (11 → 13 ações), `tests/server/ecommerce/promotionErrors.test.ts`

**Interfaces:**
- `collectionName`: `ltb_st_module_ecommerce_promotions`, `ltb_st_module_ecommerce_promotion_redemptions`, `ltb_st_module_ecommerce_promotion_customer_usages`.
- `promotion`:
  - `name` (string, required), `description` (text), `code` (string, unique + índice `ecommerce_promotion_code_unique`; nulo permitido), `method` enum `AUTOMATIC,CODE` (required)
  - `active` (boolean, default false), `startsAt` (datetime, required), `endsAt` (datetime), `priority` (integer, default 0)
  - `displayName` (json `{ <locale>: string }`), `eligibility` (json `Eligibility`), `conditions` (json `ConditionGroup`), `benefits` (json `{ items: Benefit[] }`), `stacking` (json `Stacking`)
  - `usageLimit`, `perCustomerLimit`, `perOrderLimit` (integer, nulos = sem limite), `redemptions` (integer, default 0), `version` (integer, default 1), `actor` (string)
  - índice simples `ecommerce_promotion_method_active_idx` (`method`, `active`).
- `promotion-redemption`: `promotion`, `order`, `customer` (manyToOne), `emailNormalized` (string), `promotionCode` (string), `amount` (integer), `status` enum `RESERVED,RELEASED` (default `RESERVED`), `releasedAt` (datetime), `uniqueKey` (string, required, unique + índice `ecommerce_promo_redemption_key_unique`; `<promotionId>:<orderId>`), `actor` (string).
- `promotion-customer-usage`: `promotion` (manyToOne), `emailNormalized` (string), `uses` (integer, default 0), `uniqueKey` (string, required, unique + índice `ecommerce_promo_usage_key_unique`; `p<promotionId>:<sha256 hex do e-mail normalizado>`, para caber em 255). Todos os nomes de índice ≤ 60 caracteres (`schemaIndexes`).
- `ECOMMERCE_PERMISSIONS.promotionsRead` / `promotionsManage` (`plugin::littlebox-strapi-suite.ecommerce.promotions.read|manage`).
- `CONFLICT_CODES` ganha `PROMOTION_UNAVAILABLE`, `STORE_CREDIT_INSUFFICIENT`, `TOTAL_CHANGED`, `PROMOTION_IN_USE`, `PROMOTION_VERSION_CONFLICT`.

- [ ] **Step 1: Failing tests:**
  - os três schemas existem, estão ocultos, têm os enums, as relações e os índices únicos (`schemaIndexes` e o teste de nomes reservados continuam a passar);
  - `ECOMMERCE_ACTIONS` tem 13 ações e inclui as duas novas;
  - `handleDomainError`: um erro de validação com `PROMOTION_UNAVAILABLE` → 409 `{ details: { code: 'PROMOTION_UNAVAILABLE', errors } }`; `STORE_CREDIT_INSUFFICIENT` → 409; `TOTAL_CHANGED` → 409; `code_taken` → 400.
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/promotionsContentTypes.test.ts tests/server/ecommerce/permissions.test.ts tests/server/ecommerce/promotionErrors.test.ts` → FAIL.
- [ ] **Step 3:** Schemas, registos, UIDs, permissões, tipos de histórico e `CONFLICT_CODES`; `commerceSetup` com as tabelas novas.
- [ ] **Step 4:** Os mesmos testes → PASS; `npx vitest run tests/server/ecommerce` continua verde.
- [ ] **Step 5: Commit** `feat(ecommerce): promotion content-types, permissions and conflict codes`

---

### Task 2: Domínio: tipos, validação da definição, fuso horário e disponibilidade

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/promotions/{types,definition,time,availability,index}.ts`
- Modify: `server/src/services/modules/ecommerce/domain/email.ts` (novo `isValidEmailFormat`; `settings.ts` pode reutilizá-lo, sem mudar comportamento)
- Test: `tests/server/ecommerce/domain/promotions/{definition,time,availability}.test.ts`, `tests/server/ecommerce/domain/email.test.ts` (novo)

**Interfaces (`types.ts`):**
- `type DiscountClass = 'PRODUCT_DISCOUNT' | 'ORDER_DISCOUNT' | 'SHIPPING_DISCOUNT'`
- `type ProductTarget = { productIds: number[]; variantIds: number[] }`; `targetMatches(t, line: { productId; variantId }): boolean` (variante listada **ou** produto listado).
- `type NumberOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'`
- `type Condition =`
  - `{ type: 'SUBTOTAL'; operator: NumberOperator; value: number }` | `{ type: 'SUBTOTAL_BETWEEN'; min: number; max: number }`
  - `{ type: 'CART_CONTAINS'; match: 'ANY' | 'ALL' | 'NONE'; target: ProductTarget }` (requisito 1.11, tipos 1–4)
  - `{ type: 'PRODUCT_QUANTITY'; target: ProductTarget; operator: NumberOperator; value: number }` (soma das quantidades da lista; tipos 5–7 e 1.12)
  - `{ type: 'TOTAL_QUANTITY' | 'DISTINCT_PRODUCTS'; operator: NumberOperator; value: number }`
  - `{ type: 'EMAIL'; operator: 'eq' | 'neq' | 'contains' | 'not_contains'; value: string }`
- `type ConditionGroup = { type: 'GROUP'; operator: 'AND' | 'OR'; children: (ConditionGroup | Condition)[] }`
- `type Reward = { kind: 'FREE' } | { kind: 'PERCENT'; percent: number } | { kind: 'FIXED'; amount: number }`
- `type Benefit =`
  - `{ type: 'PRODUCT_PERCENT'; target: ProductTarget; percent: number; maxQuantity: number | null }`
  - `{ type: 'PRODUCT_FIXED'; target: ProductTarget; amount: number; per: 'UNIT' | 'SET'; maxQuantity: number | null }`
  - `{ type: 'BUY_X_GET_Y'; buy: { target: ProductTarget; quantity: number; minAmount: number | null }; get: { mode: 'IN_CART'; target: ProductTarget; quantity: number } | { mode: 'GIFT'; variantIds: number[]; quantity: number }; reward: Reward }`
  - `{ type: 'ORDER_PERCENT'; percent: number }` | `{ type: 'ORDER_FIXED'; amount: number }`
  - `{ type: 'SHIPPING_FREE'; maxAmount: number | null }` | `{ type: 'SHIPPING_PERCENT'; percent: number }` | `{ type: 'SHIPPING_FIXED'; amount: number }`
- `BENEFIT_CLASS: Record<Benefit['type'], DiscountClass>` (os 4 primeiros → produto, `ORDER_*` → encomenda, `SHIPPING_*` → portes).
- `type Stacking = { exclusive: boolean; withProduct: boolean; withOrder: boolean; withShipping: boolean }`; `type Eligibility = { mode: 'ALL' } | { mode: 'EMAILS'; emails: string[] }`.
- `type PromotionDefinition = { id: number; name: string; code: string | null; method: 'AUTOMATIC' | 'CODE'; displayName: Record<string, string>; priority: number; eligibility: Eligibility; conditions: ConditionGroup; benefits: Benefit[]; stacking: Stacking; perOrderLimit: number | null; version: number }`
- `type PromotionCandidate = PromotionDefinition & { active: boolean; startsAt: string; endsAt: string | null; usageLimit: number | null; perCustomerLimit: number | null; redemptions: number; customerUses: number }`
- `type EvaluationLine = { variantId: number; productId: number; unitPrice: number; quantity: number }`
- `percentOf(amount: number, percent: number): number` = meio para cima de `amount × percent / 100`, em inteiros (`percent` com até 2 casas → pontos base).

**Interfaces (`definition.ts`, `time.ts`, `availability.ts`):**
- `isValidEmailFormat(raw: string): boolean` em `domain/email.ts` (função pura; o domínio não importa de ficheiros de serviço como `settings.ts`/`customers.ts`); `validatePromotionInput` usa-a para `eligibility.emails` e para `EMAIL` com operador `eq`/`neq`.
- `normalizePromotionCode(raw: unknown): string` (`trim` + maiúsculas).
- `type PromotionInput = Omit<PromotionDefinition, 'id' | 'version'> & { description: string | null; active: boolean; startsAt: string /* UTC ISO */; endsAt: string | null; usageLimit: number | null; perCustomerLimit: number | null }`
- `validatePromotionInput(raw: unknown, ctx: { locales: string[]; timeZone: string }): { value: PromotionInput | null; errors: ValidationIssue[] }`, com os códigos:
  - `name` 1–120 (`required`, `too_long`); `description` ≤ 5000; `method` (`invalid`);
  - `code`: obrigatório em `CODE` (`required`), opcional em `AUTOMATIC` (identificador administrativo, nunca aceite como código do cliente); `^[A-Z0-9_-]{3,40}$` (`invalid_code`); formato dos vales → `code_reserved_format`;
  - datas: hora local válida (`invalid_date`), `endsAt > startsAt` (`ends_before_start`);
  - `priority` inteiro em [−1000, 1000];
  - `displayName`: só locales configurados (`unknown_locale`), ≤ 120, vazios removidos;
  - `eligibility.emails`: 1–1000 e-mails válidos, normalizados e sem repetidos (`invalid_email` em `eligibility.emails.<i>`);
  - condições: profundidade ≤ 3 (`too_deep`), ≤ 50 folhas (`too_many`), operador permitido pelo tipo (`invalid_operator`), dinheiro em `[0, MAX_MONEY_CENTS]` e quantidades inteiras em `[0, 100000]` (`invalid_value`), `min ≤ max`, alvo não vazio com ≤ 500 ids por lista (`required`);
  - benefícios: 1–10 (`required`), `percent` em `]0, 100]` com ≤ 2 casas (`invalid_percent`), montantes em `[1, MAX_MONEY_CENTS]` (`invalid_amount`), quantidades ≥ 1, `GIFT.variantIds` 1–20;
  - `exclusive: true` força os três `with*` a `false`; limites nulos ou inteiros em `[1, 1_000_000]`.
- `displayNameFor(p: { name: string; displayName: Record<string, string> }, locale: string, defaultLocale: string): string` = locale → locale por defeito → `name`.
- `zonedWallTimeToUtc(wall: string, timeZone: string): string | null` e `utcToZonedWallTime(iso: string, timeZone: string): string`, com `Intl.DateTimeFormat`. Hora inexistente (salto de verão) → avança a hora; hora ambígua (recuo de outono) → a primeira ocorrência.
- `type PromotionStatus = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE' | 'EXPIRED'`; `promotionStatus(p: { active; startsAt; endsAt }, now: Date): PromotionStatus` (por esta ordem: `!active` → `INACTIVE`; antes do início → `SCHEDULED`; `now ≥ endsAt` → `EXPIRED`).
- `type BlockReason = 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'USAGE_LIMIT_REACHED' | 'CUSTOMER_LIMIT_REACHED' | 'EMAIL_NOT_ELIGIBLE'`; `candidateBlock(c: PromotionCandidate, ctx: { now: Date; email: string | null }): BlockReason | null` (estado, `redemptions ≥ usageLimit`, `customerUses ≥ perCustomerLimit` só com e-mail, `EMAILS` sem e-mail ou com e-mail fora da lista).

- [ ] **Step 1: Failing tests:**
  - **Review Focus 5 (parte):** `code: 'ABCD-EFGH-JKLM'` → `code_reserved_format`; `' verao20 '` → `VERAO20`;
  - `CODE` sem código → `required`; `percent: 0`, `100.5` e `10.123` → `invalid_percent`; `ORDER_FIXED` 0 → `invalid_amount`; grupo com profundidade 4 → `too_deep`; `TOTAL_QUANTITY` com `contains` → `invalid_operator`; e-mail inválido → `invalid_email` com o índice; `displayName` com `fr` → `unknown_locale`;
  - `exclusive: true` com `withOrder: true` → `withOrder: false`;
  - `endsAt` igual a `startsAt` → `ends_before_start`;
  - `zonedWallTimeToUtc('2026-07-01T10:00', 'Europe/Lisbon')` → `2026-07-01T09:00:00.000Z`; `'2026-01-15T10:00'` → `10:00Z`; `'2026-03-29T01:30'` → `2026-03-29T01:30:00.000Z`; `'2026-10-25T01:30'` → `2026-10-25T00:30:00.000Z`; `utcToZonedWallTime` inverte os dois primeiros; `'2026-13-01T00:00'` → `null`;
  - `promotionStatus`: desativada e expirada → `INACTIVE`; antes do início → `SCHEDULED`; exatamente em `endsAt` → `EXPIRED`;
  - `candidateBlock`: `redemptions 100 / usageLimit 100` → `USAGE_LIMIT_REACHED`; `customerUses 1 / perCustomerLimit 1` com e-mail → `CUSTOMER_LIMIT_REACHED`, sem e-mail → `null`; `EMAILS` com `null` → `EMAIL_NOT_ELIGIBLE`;
  - `percentOf(1999, 10)` → 200; `percentOf(1005, 12.5)` → 126; `displayNameFor` cai para o locale por defeito e depois para `name`;
  - `isValidEmailFormat`: `'cliente@exemplo.pt'` → verdadeiro; `'sem-arroba'`, `'a@b'` e `''` → falso (`domain/email.test.ts`).
- [ ] **Step 2:** `npx vitest run tests/server/ecommerce/domain/promotions` → FAIL.
- [ ] **Step 3:** Implementar os quatro ficheiros e o barrel `index.ts`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(ecommerce): promotion definition, validation, timezone and availability rules`

---

### Task 3: Domínio: motor de condições

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/promotions/conditions.ts`
- Modify: `domain/promotions/index.ts` (exporta o ficheiro novo)
- Test: `tests/server/ecommerce/domain/promotions/conditions.test.ts`

**Interfaces:**
- `type ConditionContext = { lines: EvaluationLine[]; email: string | null }` (linhas do cliente, sem ofertas).
- `CONDITION_EVALUATORS: { [K in Condition['type']]: (c: Extract<Condition, { type: K }>, ctx: ConditionContext) => boolean }`: um novo tipo de condição é uma entrada aqui e outra na validação (requisito 1.35); o motor não muda.
  - `SUBTOTAL`/`SUBTOTAL_BETWEEN`: `Σ unitPrice × quantity` (intervalo inclusivo);
  - `CART_CONTAINS`: cada id listado (variante ou produto) conta como um item; `ANY` = pelo menos um presente, `ALL` = todos presentes, `NONE` = nenhum;
  - `PRODUCT_QUANTITY`: soma das quantidades das linhas que `targetMatches`;
  - `DISTINCT_PRODUCTS`: número de `productId` distintos;
  - `EMAIL`: compara com o e-mail normalizado; com `email = null` é sempre falsa (também `neq`/`not_contains`).
- `conditionsMet(group: ConditionGroup, ctx: ConditionContext): boolean`: um grupo sem filhos é verdadeiro (sem condições).
- `eligibilityMet(e: Eligibility, email: string | null): boolean`.
- `unmetPromotions(applied: { promotionId: number; name: string; snapshot: { eligibility: Eligibility; conditions: ConditionGroup } }[], ctx: ConditionContext): { promotionId: number; name: string }[]` (usada pela modificação, Task 8).

- [ ] **Step 1: Failing tests:**
  - exemplo do requisito 1.13: `(A OR B) AND subtotal ≥ 10000` → verdadeiro com B e 12000, falso com B e 9000, falso só com C e 20000;
  - exemplo AND com e-mail `cliente@exemplo.pt`, subtotal ≥ 10000 e A no carrinho;
  - `CART_CONTAINS ALL [A, B]` só com A → falso; `NONE [C]` com C → falso;
  - "pelo menos 5 unidades entre A, B e C" (`PRODUCT_QUANTITY gte 5`) com 2 A + 3 C → verdadeiro;
  - `PRODUCT_QUANTITY eq 3` com 4 → falso; `TOTAL_QUANTITY`, `DISTINCT_PRODUCTS gte 2`;
  - alvo por produto apanha qualquer variante desse produto;
  - `SUBTOTAL_BETWEEN 10000–20000` aceita os dois extremos;
  - `EMAIL contains '@empresa.pt'` com `null` → falso; grupo vazio → verdadeiro;
  - `unmetPromotions` devolve a promoção cujo mínimo deixou de se cumprir.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): promotion condition engine with nested AND/OR groups`

---

### Task 4: Domínio: benefícios de uma combinação fixa

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/promotions/benefits.ts`
- Modify: `domain/promotions/index.ts` (exporta o ficheiro novo)
- Test: `tests/server/ecommerce/domain/promotions/benefits.test.ts`

**Interfaces:**
- `type GiftOption = { variantId: number; productId: number; unitPrice: number; available: number /* stock − unidades do carrinho dessa variante */; active: boolean }`
- `type PricedLine = { sourceIndex: number | null /* linha do carrinho; null nas ofertas */; variantId: number; productId: number; unitPrice: number; quantity: number; unitDiscount: number; isGift: boolean; refs: { promotionId: number; benefitIndex: number; amount: number }[] }`
- `type CombinationResult = { lines: PricedLine[]; benefitAmounts: Map<number, number[]> /* por promoção, por índice de benefício */; itemsOriginal: number; productDiscount: number; subtotal: number; orderDiscount: number; shippingOriginal: number | null; shippingDiscount: number; total: number }`
- `applyCombination(promotions: PromotionCandidate[], ctx: { lines: EvaluationLine[]; shipping: number | null; gifts: Map<number, GiftOption>; giftChoices: Record<number, number> }): CombinationResult`. As promoções são processadas pela ordem **prioridade desc, id asc, índice do benefício asc**. O algoritmo (não é determinado pelos testes):
  1. **Unidades:** cada linha do carrinho tem `quantity` unidades livres; um desconto de produto atribuído a uma unidade é um `(promotionId, benefitIndex, amount)`; **uma unidade recebe no máximo um benefício de produto** (requisito 2.7). Uma unidade pode estar ainda **reservada como compra** de um `BUY_X_GET_Y` (sem ter recebido benefício): continua livre para os descontos de produto do passo 3.
  2. **`BUY_X_GET_Y`**, repetição a repetição, até `perOrderLimit` (nulo = até faltarem unidades):
     - se `buy.minAmount` e o valor original das linhas do alvo de compra for menor → 0;
     - reserva `buy.quantity` unidades livres do alvo de compra, **das mais caras para as mais baratas** (empate: ordem das linhas);
     - `IN_CART`: reserva `get.quantity` unidades livres do alvo oferecido (sem as acabadas de reservar), **das mais baratas para as mais caras**, com o prémio por unidade;
     - `GIFT`: variante = `giftChoices[promotionId]` se estiver em `variantIds`, ativa e com stock; senão a primeira de `variantIds` ativa com `available ≥ get.quantity`; o total oferecido nunca passa de `available`;
     - se faltar alguma unidade, a repetição é desfeita e o benefício para;
     - **unidades de compra** (requisito 2.12): ficam reservadas só contra outros benefícios `BUY_X_GET_Y` (não servem de compra a outro Compre X Receba Y nem recebem o prémio de outro), mas **podem receber descontos de produto** dos passos 3 (requisito 2.7); a unidade **recebida** (prémio) é que não recebe nenhum outro desconto de produto (requisito 2.11).
     - prémio por unidade: `FREE` = preço; `PERCENT` = `percentOf(preço, p)`; `FIXED` = `min(amount, preço)`.
  3. **Descontos por unidade** (`PRODUCT_PERCENT`, `PRODUCT_FIXED`) sobre as unidades ainda livres: valor por unidade `PERCENT` = `percentOf(preço, p)`, `UNIT` = `min(amount, preço)`, `SET` = `amount / E` (fração exata, só para comparar; `E` = unidades livres do alvo, limitadas por `maxQuantity`). As linhas são percorridas por preço desc; cada unidade fica com o benefício de **maior valor por unidade** que ainda tenha quota (`maxQuantity`); empate pela ordem das promoções acima.
     - `SET` realizado = `min(floor(amount × ganhas / E), Σ preços ganhos)`, repartido pelas unidades ganhas com `allocateProportionally(realizado, preços)`.
  4. **Linhas de saída:** as unidades de cada linha do carrinho agrupam-se por `(desconto por unidade, ref)`: o grupo sem desconto primeiro, depois por desconto asc. Cada grupo é uma `PricedLine` com `unitDiscount` inteiro exato. As ofertas `GIFT` vêm no fim (`isGift: true`, uma linha por promoção e variante).
  5. **Encomenda:** `base` = `Σ (unitPrice − unitDiscount) × quantity` de todas as linhas (ofertas incluídas). Cada `ORDER_PERCENT` = `percentOf(base, p)`, cada `ORDER_FIXED` = `min(amount, base)`, todos sobre a mesma base (requisito 2.9); depois, pela ordem das promoções, cada um fica com `min(valor, base − já descontado)`.
  6. **Portes:** com `shipping` nulo, os benefícios de portes valem 0. Senão `FREE` = `min(S, maxAmount ?? S)`, `PERCENT` = `percentOf(S, p)`, `FIXED` = `min(amount, S)`; **só o maior é aplicado** (requisito 2.10), empate pela ordem; os outros valem 0.
  7. `total = base − orderDiscount + (S ?? 0) − shippingDiscount`.

- [ ] **Step 1: Failing tests** (valores dos exemplos dos requisitos, em cêntimos):
  - 1.17: A 3000 × 2 com `PRODUCT_FIXED` 500 `UNIT` → uma linha com `unitDiscount 500`;
  - 1.18 e 3.3: A 5000 × 2 com 20% → `unitDiscount 1000`, total da linha 8000;
  - "Compre 3, pague 2": A 1000 × 3, `buy A 2`, `get IN_CART A 1 FREE` → linhas `{ quantity 2, unitDiscount 0 }` e `{ quantity 1, unitDiscount 1000 }`, `productDiscount 1000` (sem cêntimos perdidos);
  - 2.11/2.12: 2 A a 1000 e 1 B a 1500, "compre 2 A, receba B" → B com 1500 de desconto; um 10% em A na mesma combinação **desconta** as duas unidades de A usadas como compra (`unitDiscount 100` cada, `productDiscount` 1500 + 200 = 1700); um 10% em B não desconta o B recebido; um segundo "compre 2 A, receba 1 A" não reutiliza as mesmas duas unidades de A como compra;
  - 2.7 "mesmo produto": A 10000 com 20% e 30% na mesma combinação → só 3000; o 20% fica com 0;
  - 1.22: Compre 2 A, receba 1 B em `GIFT`, 4 A: `perOrderLimit 1` → 1 oferta; `2` → 2; `null` com `available 1` → 1;
  - `GIFT` com `giftChoices` válido usa a escolha; com escolha sem stock usa a primeira com stock; nenhuma com stock → sem oferta e benefício 0;
  - `SET` 500 sobre 3 unidades de 1000 → `Σ` dos descontos = 500 exatos, em grupos inteiros;
  - 2.9: base 10000, 10% e 20% → `orderDiscount 3000`; `ORDER_FIXED 8000` + 50% → 10000 e total 0 (nunca negativo);
  - 2.8 / 3.6: A 10000 e B 5000, 20% em A + 10% na encomenda + portes 800 grátis → `productDiscount 2000`, `orderDiscount 1300`, `shippingDiscount 800`, `total 11700`;
  - 2.10: portes 1200, `SHIPPING_FIXED 500` e `SHIPPING_FREE` → 1200, o fixo fica 0; 1.19: portes 1500 com `maxAmount 1000` → 1000;
  - `shipping: null` → `shippingDiscount 0` e `shippingOriginal null`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): promotion benefit calculation with unit-level claims and exact line splits`

---

### Task 5: Domínio: compatibilidade, melhor combinação e resultado (`evaluatePromotions`)

**Files:**
- Create: `server/src/services/modules/ecommerce/domain/promotions/engine.ts`
- Modify: `domain/promotions/index.ts` (exporta o ficheiro novo)
- Test: `tests/server/ecommerce/domain/promotions/engine.test.ts`

**Interfaces:**
- `PROMOTION_SEARCH_LIMIT_DEFAULT = 12`, `PROMOTION_SEARCH_LIMIT_MAX = 16`.
- `classesOf(p: PromotionDefinition): Set<DiscountClass>`; `compatible(a: PromotionDefinition, b: PromotionDefinition): boolean` = nenhuma exclusiva **e** `a` permite todas as classes de `b` **e** `b` permite todas as classes de `a` (requisitos 2.3 e 2.5).
- `type CodeStatus = 'APPLIED' | 'NOT_FOUND' | BlockReason | 'CONDITIONS_NOT_MET' | 'CONFLICT' | 'NO_BENEFIT' | 'AWAITING_SHIPPING'`
- `type AppliedBenefit = { index: number; type: Benefit['type']; class: DiscountClass; amount: number; params: Benefit }`
- `type AppliedPromotion = { promotionId: number; version: number; name: string; displayName: Record<string, string>; code: string | null; method: 'AUTOMATIC' | 'CODE'; classes: DiscountClass[]; amount: number; benefits: AppliedBenefit[]; snapshot: { eligibility: Eligibility; conditions: ConditionGroup; stacking: Stacking; priority: number; perOrderLimit: number | null } }`
- `type EvaluationInput = { lines: EvaluationLine[]; email: string | null; shipping: number | null; codes: string[]; candidates: PromotionCandidate[]; gifts: Map<number, GiftOption>; giftChoices?: Record<number, number>; now: Date; searchLimit: number }`
- `type PromotionEvaluation = { evaluated: number[]; eligible: number[]; applied: AppliedPromotion[]; rejected: { promotionId: number; reason: Exclude<CodeStatus, 'APPLIED' | 'NOT_FOUND'> }[]; codes: { code: string; status: CodeStatus; promotionId: number | null }[]; lines: PricedLine[]; itemsOriginal: number; productDiscount: number; subtotal: number; orderDiscount: number; shippingOriginal: number | null; shippingDiscount: number; totalDiscount: number; total: number; exhaustive: boolean }`
- `evaluatePromotions(input: EvaluationInput): PromotionEvaluation`. O algoritmo:
  1. Códigos normalizados e sem repetidos. Candidatas = automáticas + promoções `CODE` cujo código foi introduzido (uma promoção `CODE` não introduzida nunca entra; um código de promoção `AUTOMATIC` dá `NOT_FOUND`). Tudo ordenado por id (o resultado não depende da ordem de entrada).
  2. Filtro: `candidateBlock` → rejeitada com o motivo; `eligibilityMet` falsa → `EMAIL_NOT_ELIGIBLE`; `conditionsMet` falsa → `CONDITIONS_NOT_MET`. As restantes são `eligible`; o valor isolado de cada uma (`applyCombination([p])`) é calculado; com `shipping` nulo, uma promoção só com benefícios de portes fica `AWAITING_SHIPPING`; valor isolado 0 → `NO_BENEFIT`.
  3. **Procura:** com `n ≤ searchLimit`, avalia todos os subconjuntos com pares compatíveis (máscaras de bits) e fica com o melhor; senão, **gulosa**: ordena por valor isolado desc (depois prioridade desc, id asc) e acrescenta cada uma se for compatível com as escolhidas e baixar o total estritamente; `exhaustive = false`.
  4. **Comparação** de duas combinações (requisitos 2.13 e 2.14): menor `total`; depois mais promoções com código introduzido; depois maior soma de prioridades; depois menos promoções; depois a lista de ids ordenada lexicograficamente menor.
  5. Na combinação escolhida, uma promoção que realizou 0 sai de `applied` e fica `CONFLICT` (valor isolado > 0) ou `NO_BENEFIT`. Elegível fora da escolhida → `CONFLICT`.
  6. `codes`: um estado por código introduzido (o motivo da rejeição, `APPLIED` ou `NOT_FOUND`). `totalDiscount = productDiscount + orderDiscount + shippingDiscount`.

- [ ] **Step 1: Failing tests:**
  - 2.13: produtos 15000, portes 1000; A = 10% nos produtos, B = `ORDER_FIXED 2000`, C = portes grátis, todas exclusivas → B, `total 14000`; com A e C acumuláveis entre si → A + C, `total 13500`;
  - 2.4: 30% exclusivo contra portes grátis (10000 + 800) → o 30%, `total 7800`;
  - 2.3: A (10% na encomenda, acumula com produtos) e B (500 no produto X, não acumula com encomendas) → `compatible = false` e só uma é aplicada;
  - 2.5: `NATAL2026` (encomenda + portes) contra uma promoção que só acumula com encomendas → `compatible = false`;
  - 2.7: 10% em A e 20% em B, acumuláveis → as duas, subtotal 13000;
  - 2.12: X 4 × 1000, Y 800 e Z 600 no carrinho; "compre 2 X, receba Y" e "compre 2 X, receba Z", acumuláveis → as duas (1400); só 2 X → só a de Y;
  - 2.15: automática de 10% + código de portes grátis compatíveis → as duas, `codes[0].status = 'APPLIED'`; incompatíveis e o código perde → `CONFLICT` (nunca `NOT_FOUND`);
  - desempate: duas promoções com o mesmo total, uma por código introduzido → a do código; sem código, prioridades 5 e 1 → a de 5; tudo igual → o id menor;
  - a mesma entrada com as candidatas baralhadas dá o mesmo resultado;
  - 13 candidatas com `searchLimit 12` → `exhaustive: false` e combinação compatível; 12 → `exhaustive: true`;
  - estados dos códigos: inexistente → `NOT_FOUND`; expirado → `EXPIRED`; esgotado → `USAGE_LIMIT_REACHED`; e-mail fora da lista → `EMAIL_NOT_ELIGIBLE`; mínimo não atingido → `CONDITIONS_NOT_MET`; código de uma promoção `AUTOMATIC` → `NOT_FOUND`;
  - só portes grátis e `shipping: null` → `AWAITING_SHIPPING`;
  - 2.18 (alterações no carrinho): "compre 2 A, receba 1 B" em `GIFT` com 2 A → uma oferta de B; a mesma avaliação com 1 A → nenhuma oferta, a promoção (sem condições) em `rejected` com `NO_BENEFIT`, e uma linha de B comprada pelo cliente mantém-se intacta (sem desconto);
  - `applied[*].snapshot` e `version` vêm da candidata; `amount` = soma dos benefícios.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): promotion stacking, best-combination search and deterministic tie-breaks`

---

### Task 6: `EcommercePromotionService`: administração, candidatas, reserva e libertação

**Files:**
- Create: `server/src/services/modules/ecommerce/promotions.ts`
- Modify: `server/src/services/index.ts`, `server/src/config/index.ts` (só o tipo `LtbConfigs`: `ecommerce?: { promotionSearchLimit?: number }`), `tests/server/ecommerce/helpers/commerceSetup.ts` (regista o serviço)
- Test: `tests/server/ecommerce/promotions.test.ts`

**Interfaces:**
- `type PromotionListItem = { id; name; code: string | null; method; status: PromotionStatus; startsAt: string /* hora local */; endsAt: string | null; redemptions: number; usageLimit: number | null }`
- `type PromotionView = PromotionInput (datas em hora local) & { id; status; redemptions; version; timezone: string; createdAt; updatedAt; labels: { products: Record<number, string>; variants: Record<number, { name: string; option: string | null; sku: string }> } }`
- `list({ page?, search? }): Promise<{ results: PromotionListItem[]; pagination }>`: 50 por página, `id desc`, pesquisa `$containsi` por `name` ou `code`.
- `get(id): Promise<PromotionView>` (`labels` para todos os ids dos alvos e ofertas, a partir de `product`/`variant` e das traduções no locale por defeito).
- `create(raw, actor): Promise<PromotionView>` e `update(id, raw & { version: number }, actor): Promise<PromotionView>`:
  - `validatePromotionInput` com os locales do i18n e o `store.timezone`;
  - código já usado por outra promoção → `code_taken` (verificado com `findOne`; uma violação do índice, fora de transação, também dá `code_taken`);
  - `update` é condicional em `{ id, version }` e grava `version + 1`; 0 linhas → `PROMOTION_VERSION_CONFLICT`;
  - auditoria `EcommerceAuditService.log({ area: 'promotions', action: 'create' | 'update' | 'delete', targetId, userId, details: { fields } })` só com nomes de campos.
- `remove(id, actor)`: com alguma `promotion-redemption` → `PROMOTION_IN_USE` (desativar é a alternativa).
- `listRedemptions(id, { page? }): Promise<{ results: { id; orderId; orderReference; email; amount; status; createdAt; releasedAt }[]; pagination }>`.
- `catalogSearch(q, locale?)` = `EcommerceOrderService.searchVariants`.
- `searchLimit(): number` = `strapi.config.get(plugin)?.ecommerce?.promotionSearchLimit` (leitura segura: os fakes de teste devolvem só `{ uuid }`) inteiro em [1, 16], senão 12.
- `loadCandidates({ codes: string[]; email: string | null }): Promise<PromotionCandidate[]>`: automáticas ativas (`active`, `startsAt ≤ agora`, `endsAt` nulo ou futuro) e as `CODE` com `code $in codes` (em qualquer estado, para o motor dar o motivo); `benefits` é desembrulhado de `{ items }` para `Benefit[]`; `customerUses` a partir de `promotion-customer-usage` pelo `uniqueKey` (0 sem e-mail).
- `giftOptions(candidates, cartQuantities: Map<number, number>): Promise<Map<number, GiftOption>>` para todos os `GIFT.variantIds` (via `EcommerceStockService.available` e o catálogo).
- `reserve(applied: AppliedPromotion[], ctx: { orderId: number; customerId: number; email: string; actor: string; operationId?: string }): Promise<void>`: junta-se à transação do chamador com `strapi.db.transaction(async ({ trx }) => …)`, como `storeCredits.consume`; `AppliedPromotion` não traz `usageLimit`/`perCustomerLimit`, por isso, para cada promoção, por ordem de id, **`findOne` da linha da promoção** (limites e `active` atuais; ausente → `PROMOTION_UNAVAILABLE`) e:
  1. incremento condicional global via `strapi.db.getConnection(tableName)` com constantes: `active = true` e, com `usageLimit`, `redemptions <= usageLimit − 1` (calculado em JS); 0 linhas → `PROMOTION_UNAVAILABLE`;
  2. contador por cliente: `findOne` pelo `uniqueKey`, cria-o com `uses: 0` se não existir, incremento condicional com `uses <= perCustomerLimit − 1` (constante; sem limite, incondicional); 0 linhas → `PROMOTION_UNAVAILABLE`;
  3. cria a `promotion-redemption` `RESERVED` (`uniqueKey <promotionId>:<orderId>`, `promotionCode`, `amount`).
- `releaseForOrder(orderId, actor, opts: { operationId?: string }): Promise<{ promotionId: number; promotionCode: string | null }[]>`: para cada redemption da encomenda, `updateMany` condicional `RESERVED → RELEASED` (`releasedAt`); só com `count > 0` decrementa `redemptions` e `uses` (guardados por `>= 1`). Repetido → `[]`.

- [ ] **Step 1: Failing tests:**
  - criar, ler e listar com pesquisa por nome e por código; as datas voltam na hora local de Lisboa e ficam em UTC na tabela;
  - código repetido → `code_taken`; `update` com `version` antiga → `PROMOTION_VERSION_CONFLICT`; **Review Focus 4 (parte):** `update` sobe a `version` e grava a auditoria só com nomes de campos;
  - `remove` com uma redemption → `PROMOTION_IN_USE`; sem → apagada;
  - `loadCandidates`: automática agendada fora; `CODE` expirada dentro (para o motivo); `customerUses` lido pelo e-mail;
  - `reserve` com `usageLimit 1` e `redemptions 1` → `PROMOTION_UNAVAILABLE` com `path 'promotions.<id>'` e `detail` = código; `perCustomerLimit 1` com uma utilização do mesmo e-mail (outro cliente, mesmo e-mail) → `PROMOTION_UNAVAILABLE`; sem limites → `redemptions` e `uses` sobem 1;
  - **Review Focus 2 (parte):** `releaseForOrder` duas vezes → a segunda devolve `[]` e os contadores voltam a 0, nunca −1;
  - `reserve` ignora os limites da fotografia: com a linha da tabela já em `redemptions 1 / usageLimit 1`, falha mesmo que o `applied` venha de candidatas com `redemptions 0`; com o limite subido para 2 na tabela, passa;
  - `searchLimit` com 40 ou `'abc'` → 12; com 8 → 8; sem a chave `ecommerce` na configuração (`{ uuid }` apenas) → 12, sem lançar.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): promotion admin service with strict capacity reserve and release`

---

### Task 7: Encomendas: cotação, criação com promoções, ofertas, cancelamento e vista

**Files:**
- Modify: `server/src/services/modules/ecommerce/orders.ts`; os `strapi` fakes locais dos testes que chamam `create`/`cancel` (`orders.create`, `orders.lifecycle`, `orders.modify`, `ordersController`, `refundsController`, `stripePayments`, `stripeWebhooks`: registam `EcommercePromotionService`, os UIDs e as tabelas de promoção, e `config.get` devolve `{ uuid }` sem `ecommerce`)
- Test: `tests/server/ecommerce/orders.promotions.test.ts`; `tests/server/ecommerce/orders.create.test.ts` (a asserção da encomenda gravada, linha ~243, passa de `promotions: []` para `promotions: { applied: [], codes: [], exhaustive: true }` em `toMatchObject`; a da vista, linha ~583, mantém-se) e os restantes ficheiros acima (só os setups)

**Interfaces:**
- `create`, `cancel` e `get` chamam o `EcommercePromotionService` só através de um acessor interno `promotions()` (resolvido a partir dos UIDs partilhados do `commerceSetup`); os setups locais acima registam-no.
- `CreateOrderInput` ganha `promotionCodes?: string[]` (≤ 5), `expectedTotal?: number`, `giftChoices?: Record<number, number>`.
- `type OrderQuoteInput = { lines: { variantId: number; quantity: number }[]; locale: string; email?: string | null; promotionCodes?: string[]; giftChoices?: Record<number, number>; shipping?: { country: string; postalCode?: string; providerId: string; serviceId: string } | null }`
- `type OrderQuote = { lines: (PricedLine & { sku; name; option; imageUrl })[]; promotions: AppliedPromotion[]; codes: PromotionEvaluation['codes']; rejected: PromotionEvaluation['rejected']; totals: { itemsOriginal; productDiscount; subtotal; orderDiscount; shippingOriginal: number | null; shippingDiscount; shippingTotal: number | null; total; totalDiscount }; shippingOption: ShippingOption | null; exhaustive: boolean }`
- `quote(input: OrderQuoteInput): Promise<OrderQuote>` (sem escrita; os mesmos erros de linha que `create`: `VARIANT_UNAVAILABLE`, `INSUFFICIENT_STOCK`, `SHIPPING_UNAVAILABLE`). É o ponto de entrada do plano 7.
- `priceCart` (interno, partilhado por `quote` e `create`):
  1. `loadCandidates` + `giftOptions` (catálogo das ofertas carregado com `loadCatalog` no locale da encomenda);
  2. `evaluatePromotions` com `shipping: null` → ofertas G1;
  3. cotação de portes com as linhas **e as ofertas G1** (quantidades somadas por variante) e `subtotal` = `subtotal − orderDiscount` da passagem 1;
  4. `evaluatePromotions` com os portes; se as ofertas mudarem, nova cotação com as ofertas novas e uma terceira avaliação, que é a final (no máximo duas cotações).
- `create`:
  - **códigos introduzidos que não ficaram aplicados:** `USAGE_LIMIT_REACHED`/`CUSTOMER_LIMIT_REACHED` → `PROMOTION_UNAVAILABLE` (409); `CONFLICT`, `NO_BENEFIT` → a encomenda é criada sem ele; os restantes → `{ path: 'promotionCodes.<i>', code: 'PROMOTION_CODE_INVALID', detail: <CodeStatus> }` (400);
  - `expectedTotal` diferente do total calculado → `{ path: 'expectedTotal', code: 'TOTAL_CHANGED', detail: '<total>' }` (409);
  - disponibilidade de stock verificada com a soma de linhas e ofertas por variante;
  - na transação: uma `order-line` por `PricedLine` (`unitDiscount`, `isGift`, `promotionRefs = { refs }`, `position` pela ordem do resultado); `productDiscount`/`orderDiscount`/`shippingDiscount`/totais da avaliação; `promotions = { applied, codes, exhaustive, evaluatedAt }`;
  - **stock:** um `ORDER_DEDUCT` por variante com a quantidade somada (linhas + ofertas) e a mesma `operationKey` `order:<id>:create:<variantId>`;
  - `reserve(applied, { orderId, customerId, email: normalizeEmail(customer.email), actor })` e histórico `PROMOTIONS_APPLIED` (`newValue: { promotions: [{ promotionId, promotionCode, amount }] }`, descrição `Promotions applied: <nome> (<código>), …`), só quando há promoções.
- `cancel`: depois de `releaseStoreCreditOnCancel`, `promotions().releaseForOrder(orderId, actor, { operationId })`; se libertou alguma, histórico `PROMOTIONS_RELEASED` com a mesma forma.
- `OrderView.promotions: (AppliedPromotion & { redemptionStatus: 'RESERVED' | 'RELEASED' | null })[]` (lido de `order.promotions.applied`; `[]` antigo → vazio; **`get()` só consulta as redemptions quando `applied` não está vazio**); `OrderLineView.promotionIds: number[]` (de `promotionRefs.refs`).

- [ ] **Step 1: Failing tests** (`commerceSetup` com variantes e promoções na tabela):
  - **Review Focus 1:** código com `usageLimit 1`; `loadCandidates` simulado devolve a fotografia antiga (`redemptions 0`) e a tabela já tem `redemptions 1` → 409 `PROMOTION_UNAVAILABLE` com o id e o código; nenhuma `order`, nenhum movimento de stock, `redemptions` continua 1;
  - **Review Focus 3:** "compre 2 A, receba 1 A" em `GIFT` → uma linha de 2 e uma oferta de 1 (`isGift`), um só `ORDER_DEDUCT` de −3 e o stock baixa 3; cancelar repõe 3;
  - **Review Focus 4:** encomenda criada com 10%; a promoção passa a 50%; `get` mostra o desconto de 10%, a `version` 1 na fotografia, e uma `quote` nova usa 50%;
  - **Review Focus 5 (parte):** o histórico `PROMOTIONS_APPLIED` mostra `VERAO20` por inteiro (`newValue.promotions[0].promotionCode`);
  - **Review Focus 2:** cancelar → redemption `RELEASED`, `redemptions 0` e `PROMOTIONS_RELEASED`; um segundo cancelamento → `ACTION_NOT_AVAILABLE` e os contadores não mudam;
  - 3.6 de ponta a ponta: 150 € de produtos, 20 € de desconto de produto, 13 € de encomenda e portes de 8 € grátis → `total 11700` gravado e as linhas com `unitDiscount` certo;
  - portes grátis acima de 50 € (design 4.16): 4000 → portes cobrados; 6000 → `shippingDiscount` = preço do método;
  - `expectedTotal` errado → 409 `TOTAL_CHANGED`; certo → criada;
  - código inexistente → 400 `PROMOTION_CODE_INVALID` com `detail 'NOT_FOUND'`; código em conflito → criada sem ele;
  - "Compre 3, pague 2" cria duas linhas da mesma variante (2 sem desconto e 1 com 100%) e a modificação com `orderLineId` continua a funcionar sobre elas;
  - a oferta entra na cotação dos portes (o quoter simulado recebe a quantidade somada);
  - `quote` sem `shipping` → `shippingOriginal: null` e as promoções só de portes em `rejected` com `AWAITING_SHIPPING`; `quote` não escreve nada;
  - encomenda sem promoções continua igual à do plano 3 (`promotions.applied` vazio, sem histórico de promoções, sem consulta a redemptions em `get`);
  - os totais gravados (`productDiscount`, `orderDiscount`, `shippingDiscount`, `total`) são iguais a `computeTotals` sobre as linhas criadas (`computeTotals` limita `orderDiscount` ao subtotal; a avaliação nunca o ultrapassa).
- [ ] Steps 2–5. **Commit** `feat(ecommerce): price orders with promotions, gifts and strict capacity on create and cancel`

---

### Task 8: Modificações: aviso de condições e ajuste manual do desconto (design 4.8)

**Files:**
- Modify: `server/src/services/modules/ecommerce/domain/orderModification.ts`, `orders.ts` (`normalizeModification`, `loadModificationContext`, `toModificationCurrent`, `toModificationCatalog`, `writeModification`)
- Test: `tests/server/ecommerce/domain/orderModification.test.ts`, `tests/server/ecommerce/orders.modify.test.ts` (acrescentar)

**Interfaces:**
- `OrderModificationInput` e `ModificationInput` ganham `orderDiscount?: number` (inteiro em `[0, MAX_MONEY_CENTS]`, senão `INVALID_AMOUNT` em `orderDiscount`).
- `ModificationCurrent` ganha `promotions?: AppliedPromotion[]` e `email?: string` (**opcionais**: os fixtures de `orderModification.test.ts` e o `tsc` não partem; ausentes = vazio / `null`).
- `ExistingLine` e o `CatalogVariant` da modificação ganham `productId` (para `targetMatches`/`EvaluationLine`); `toModificationCurrent` e `toModificationCatalog` preenchem-no (e `promotions`/`email`).
- `ModificationResult.discountWarnings: ({ code: 'ORDER_DISCOUNT_CAPPED' } | { code: 'PROMOTION_CONDITION_UNMET'; promotionId: number; name: string } | { code: 'SHIPPING_PROMOTION_DROPPED'; promotionId: number; name: string })[]`:
  - `unmetPromotions(current.promotions, { lines: linhas não-oferta depois da modificação, a preço original; email })`;
  - nenhum desconto é retirado: as linhas mantêm o desconto por unidade, o desconto de encomenda mantém o valor (limitado ao subtotal).
- Com `orderDiscount` presente, esse valor substitui o guardado antes do limite; o `writeModification` grava o histórico existente `ORDER_DISCOUNT_CHANGED` ("Order discount adjusted manually", valor anterior e novo, actor). Sem `orderDiscount`, nada muda.
- O aviso `ORDER_DISCOUNT_CAPPED` compara com o valor **pedido** (`input.orderDiscount ?? current.orderDiscount`), não com o guardado: `orderDiscount: 0` manual não gera aviso falso.
- O histórico `ORDER_DISCOUNT_CHANGED` escreve-se **uma só vez** por modificação: com `orderDiscount` fornecido, a descrição manual ("Order discount adjusted manually"); sem ele, a descrição existente de limite ("Order discount capped at the new subtotal") quando o guardado difere do calculado. Linhas `ADDED` gravam `promotionRefs = { refs: [] }` (nunca `[]`).
- **`orderLineId` obrigatório com várias linhas da mesma variante** (a Task 7 divide linhas): em `simulateModification`, uma entrada sem `orderLineId` para uma variante que tem mais de uma linha existente não-oferta → `INVALID_QUANTITY` em `lines.<i>.orderLineId` (em vez de resolver para a primeira e zerar as outras); o controller documenta-o. O seletor do admin (`modification.ts`) continua a juntar unidades acrescentadas à primeira linha não-oferta.
- **Portes (design 4.8):** quando a modificação põe os portes em `RECALCULATE` ou `MANUAL` e uma promoção de portes aplicada deixa por isso de se aplicar (o `shippingDiscount` passa a 0), `discountWarnings` inclui `{ code: 'SHIPPING_PROMOTION_DROPPED'; promotionId: number; name: string }` por promoção de portes afetada; `order.promotions` **não é reescrito** (a fotografia histórica mantém-se, spec 3.8).
- Nenhuma chamada a `reserve`/`releaseForOrder`.

- [ ] **Step 1: Failing tests:**
  - promoção "10% acima de 100 €" e a encomenda desce para 80 € → aviso `PROMOTION_CONDITION_UNMET` com o id e o nome; o `orderDiscount` mantém-se (limitado ao novo subtotal);
  - `orderDiscount: 0` no `applyModification` → total sobe, histórico `ORDER_DISCOUNT_CHANGED` com o actor;
  - `orderDiscount: -1` → `INVALID_AMOUNT`;
  - `orderDiscount: 0` com o guardado a 1300 → sem aviso `ORDER_DISCOUNT_CAPPED` e **uma só** entrada `ORDER_DISCOUNT_CHANGED` (descrição manual); sem `orderDiscount` e subtotal que obriga a limitar → aviso `ORDER_DISCOUNT_CAPPED` e uma entrada com a descrição de limite;
  - linha acrescentada grava `promotionRefs = { refs: [] }`;
  - `ModificationCurrent` sem `promotions`/`email` (fixtures antigos) continua a funcionar;
  - `SHIPPING_PROMOTION_DROPPED`: encomenda com promoção de portes grátis aplicada, modificação com portes `RECALCULATE` (e outra com `MANUAL`) → aviso com o id e o nome, `shippingDiscount 0`, e `order.promotions` inalterado;
  - variante com duas linhas (2 + 1): entrada sem `orderLineId` → `INVALID_QUANTITY`; com `orderLineId` → funciona;
  - a modificação não altera `redemptions` nem a redemption da encomenda.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): promotion condition warnings and manual order discount on modification`

---

### Task 9: E-mail de confirmação com as promoções aplicadas

**Files:**
- Modify: `server/src/services/modules/ecommerce/email/catalog.ts` (lista `order.promotions` com `name` e `amount`, só em `ORDER_CONFIRMATION`, com dados de exemplo), `email/defaults/orderConfirmation.ts` (bloco das promoções quando a lista não está vazia), `notificationData.ts`, `notifications.ts` (`NotificationExtra.defaultLocale?: string`, novo; o `locale` existente tem outro significado, "locale sem encomenda"; o `prepare` preenche-o com o locale por defeito da loja)
- Test: `tests/server/ecommerce/notificationData.test.ts`, `tests/server/ecommerce/email/catalog.test.ts` (acrescentar)

**Interfaces:**
- `buildTemplateData` (`ORDER_CONFIRMATION`): `order.promotions = applied.map(p => ({ name: displayNameFor(p, order.locale, defaultLocale), amount: money(p.amount) }))`; o `defaultLocale` chega por `NotificationExtra.defaultLocale` (preenchido pelo `prepare` em `notifications.ts`; ausente → `order.locale`).
- As linhas de oferta aparecem nos `items` com o preço final (0 € quando oferecidas).

- [ ] **Step 1: Failing tests:**
  - encomenda em `pt` com `displayName { pt: 'Verão' }` → `order.promotions[0].name = 'Verão'`; em `en` sem tradução → o locale por defeito e depois `name`;
  - `prepare` passa o locale por defeito da loja em `extra.defaultLocale`;
  - sem promoções → lista vazia e o template não mostra o bloco;
  - o catálogo de variáveis cobre `order.promotions` e o HTML renderizado não contém `/admin`, `/api/` nem `littlebox-strapi-suite`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): applied promotions in the order confirmation e-mail`

---

### Task 10: API admin (promoções e cotação de encomendas)

**Files:**
- Create: `server/src/controllers/modules/ecommerce/promotions.ts` (`EcommercePromotionController`), `server/src/routes/ecommerce/admin-promotions.ts`
- Modify: `server/src/routes/admin-api.ts` (spread), `server/src/controllers/index.ts`, `server/src/routes/ecommerce/admin-orders.ts` (rota `quote`), `server/src/controllers/modules/ecommerce/orders.ts` (`quote`; `create` passa `promotionCodes`, `expectedTotal`, `giftChoices`)
- Test: `tests/server/ecommerce/promotionsRoutes.test.ts`, `tests/server/ecommerce/promotionsController.test.ts`, `tests/server/ecommerce/ordersRoutes.test.ts` e `ordersController.test.ts` (acrescentar)

**Rotas** (middleware de módulo ativo; `p-read` = `promotionsRead`, `p-manage` = `promotionsManage`, `o-manage` = `ordersManage`; os caminhos estáticos vêm antes dos `/:id`):

| Método | Path | Perm. | Corpo / resposta |
|---|---|---|---|
| GET | `/admin/ecommerce/promotions?page=&search=` | p-read | `{ results, pagination }` |
| POST | `/admin/ecommerce/promotions` | p-manage | definição → 201 `PromotionView` |
| GET | `/admin/ecommerce/promotions/catalog-search?q=&locale=` | p-manage | variantes |
| GET | `/admin/ecommerce/promotions/:id` | p-read | `PromotionView` |
| PUT | `/admin/ecommerce/promotions/:id` | p-manage | definição + `version` |
| DELETE | `/admin/ecommerce/promotions/:id` | p-manage | `{ ok: true }` |
| GET | `/admin/ecommerce/promotions/:id/redemptions?page=` | p-read | `{ results, pagination }` |
| POST | `/admin/ecommerce/orders/quote` | o-manage | `OrderQuoteInput` → `OrderQuote` |

- Validação no controller com `validation.ts`: ids inteiros ≥ 1 (400 `Invalid id`); `search` ≤ 100; `promotionCodes` lista de ≤ 5 strings com ≤ 40 caracteres; `expectedTotal` em `[0, MAX_MONEY_CENTS]`; `giftChoices` objeto com ≤ 10 pares de inteiros ≥ 1. A definição da promoção é validada no serviço.
- Erros pelo `handleDomainError` (`withCode: true`).
- O controller de modificação documenta que, numa encomenda com várias linhas da mesma variante (Task 7), cada entrada de uma variante com mais de uma linha tem de trazer `orderLineId` (senão `INVALID_QUANTITY`, Task 8).
- [ ] **Step 1: Failing tests:**
  - cada rota tem a policy, a ação e o middleware certos; `quote` vem antes de `/:id` em `admin-orders.ts`;
  - corpo de promoção inválido → 400 com `errors`; `PROMOTION_IN_USE` e `PROMOTION_VERSION_CONFLICT` → 409;
  - `create` de encomenda com `PROMOTION_UNAVAILABLE` → 409 com `details.errors[0].detail` = código; `promotionCodes` com 6 entradas → 400;
  - `quote` devolve `codes` e `totals`.
- [ ] Steps 2–5. **Commit** `feat(ecommerce): admin API for promotions and order quotes`

---

### Task 11: Admin: listagem de promoções e separador "Store credit"

**Files:**
- Create: `admin/src/ecommerce/promotionTypes.ts`, `admin/src/ecommerce/gateways/ecommercePromotionsGateway.ts`, `admin/src/ecommerce/usecases/promotions/{fetchPromotions,fetchPromotion,savePromotion,deletePromotion,fetchPromotionRedemptions,searchPromotionCatalog,fetchStoreCredits}.ts`, `admin/src/ecommerce/hooks/usePromotionPermissions.ts`, `admin/src/ecommerce/pages/promotions/{PromotionListPage,StoreCreditListPage}.tsx`, `admin/src/ecommerce/components/promotions/PromotionTabs.tsx`, `admin/src/ecommerce/utils/promotionList.ts`
- Modify: `admin/src/ecommerce/EcommerceApp.tsx` (rotas `promotions`, `promotions/new`, `promotions/:id`, `promotions/store-credits`; sai o `EcommerceComingSoon`), `utils/rbac.ts` (`PROMOTIONS_READ_ACTION`, `PROMOTIONS_MANAGE_ACTION`), `admin/src/ecommerce/EcommerceLayout.tsx` (o item `promotions` do `MENU` passa a ser filtrado por `promotions.read`; os outros itens não mudam), `admin/src/core/translations/{en,pt}.json`
- Test: `tests/admin/ecommerce/promotionList.test.ts`, `tests/admin/ecommerce/rbac.test.ts` (acrescentar)

**Comportamento:**
- **`PromotionListPage`** (requisito 1.3):
  - estado vazio com a ilustração `EmptySection`, "No promotions yet." / "Ainda não existem promoções." e **Create promotion** (só com `canManage`);
  - colunas Nome, Código, Método, Estado (badge: Active, Scheduled, Inactive, Expired), Validade (hora local da loja), Utilizações (`redemptions / usageLimit` ou `redemptions`), Editar;
  - pesquisa por nome ou código, 50 por página com `ListPagination`.
- **`PromotionTabs`:** "Promotions" e "Store credit" no topo das duas páginas.
- **`StoreCreditListPage`** (design 4.7: só consulta e ajustes registados): lista de `/store-credits` (código, e-mail, saldo, validade, estado) com pesquisa; "Void" com confirmação, só com `refunds.manage`; abrir mostra os movimentos (`/store-credits/:id`). Com `customers.read` em falta, o separador não aparece.
- **Menu (`EcommerceLayout.tsx`):** o item Promoções só aparece com `promotions.read` (design 9.2: o admin esconde o que o utilizador não pode fazer); a função de filtro é pura e testada.
- **`promotionList.ts`:** `statusTone(status)`, `usageLabel(item)`, `validityLabel(item, locale)`.
- [ ] **Step 1: Failing tests:** `usageLabel` com e sem limite; `statusTone` dos 4 estados; `validityLabel` sem `endsAt` mostra só o início; `rbacKey(PROMOTIONS_MANAGE_ACTION)` → `canManage`; o filtro do menu esconde `promotions` sem `promotions.read` e mantém os restantes itens.
- [ ] Implementação, testes, `npm run test:ts:front` e `npm run build`. **Commit** `feat(ecommerce): promotions list and store credit tab`

---

### Task 12: Admin: formulário da promoção

**Files:**
- Create: `admin/src/ecommerce/pages/promotions/PromotionEditPage.tsx`, `admin/src/ecommerce/components/promotions/{ConditionGroupEditor,BenefitEditor,TargetPicker,EligibilityFields,StackingFields,LimitsFields,PromotionSummary,RedemptionsTable}.tsx`, `admin/src/ecommerce/utils/promotionForm.ts`
- Modify: `admin/src/core/translations/{en,pt}.json`
- Test: `tests/admin/ecommerce/promotionForm.test.ts`

**Comportamento** (requisito 1.4, secções por esta ordem):
1. **Informações gerais:** nome, descrição, prioridade, toggle `active`, nome visível ao cliente por locale (seletor de idioma, como nos produtos).
2. **Método:** Automatic / Code; código em maiúsculas; em automática, o campo chama-se "Campaign identifier" e explica que não é aceite no checkout.
3. **Validade:** data e hora de início e fim opcional, na hora local da loja (o fuso é mostrado).
4. **Elegibilidade:** All customers / Specific e-mails (área de texto, um por linha).
5. **Condições:** `ConditionGroupEditor` visual com AND/OR, "Add condition", "Add group" (até 3 níveis), tipos com os operadores permitidos; o `TargetPicker` pesquisa variantes (`catalog-search`) e deixa escolher "this variant" ou "whole product".
6. **Benefícios:** `BenefitEditor` por tipo (produto %, produto fixo por unidade/conjunto com quantidade máxima, Compre X Receba Y com modo "in cart"/"gift", encomenda %, encomenda fixa, portes grátis com máximo opcional, portes % e fixo); até 10.
7. **Limites:** global, por cliente, repetições por encomenda (vazio = sem limite).
8. **Acumulação:** "Exclusive" (desativa as outras três) e as três caixas por classe.
9. **Resumo:** `PromotionSummary` com o texto gerado por `describePromotion`; "Save".
- Em modo de edição: tabela `RedemptionsTable` (encomenda com link, e-mail, valor, estado, data) e "Delete" (com confirmação; `PROMOTION_IN_USE` explica que se deve desativar). Gravar envia a `version`; `PROMOTION_VERSION_CONFLICT` pede para recarregar.
- **`promotionForm.ts`:**
  - `emptyPromotionForm(defaultLocale)`, `promotionFormFromView(view)`, `toPromotionInput(form)` (euros → cêntimos, percentagens como número);
  - `validatePromotionForm(form): Record<path, code>` (os mesmos códigos do servidor para o que se pode verificar localmente);
  - árvore de condições: `addCondition(tree, path)`, `addGroup(tree, path)` (recusa o 4.º nível), `removeNode(tree, path)`, `updateNode(tree, path, patch)`;
  - `describeBenefit(b, money, t)` e `describePromotion(form, money, t)`.
- [ ] **Step 1: Failing tests:**
  - `toPromotionInput` converte `12,50` € em 1250 e mantém `12.5` %;
  - `addGroup` no 3.º nível é recusado; `removeNode` da raiz não é permitido;
  - `validatePromotionForm`: `CODE` sem código, percentagem 0, fim antes do início;
  - `describeBenefit` de `SHIPPING_FREE` com máximo 1000 → "Free shipping (up to €10.00)" / "Portes grátis (até 10,00 €)"; `describePromotion` de um Compre 2 Receba 1;
  - `exclusive` desliga as outras opções de acumulação.
- [ ] Implementação, testes, os dois `tsc` e `npm run build`. **Commit** `feat(ecommerce): promotion form with visual conditions, benefits, limits and stacking`

---

### Task 13: Admin: promoções na encomenda, na criação manual e na modificação

**Files:**
- Create: `admin/src/ecommerce/components/orders/{PromotionsSection,OrderQuotePanel}.tsx`, `admin/src/ecommerce/usecases/orders/quoteOrder.ts`
- Modify: `orderTypes.ts` (`Order.promotions` deixa de ser `unknown[]`; `OrderLine.promotionIds`, `OrderQuote`, e `discountWarnings` com `PROMOTION_CONDITION_UNMET` e `SHIPPING_PROMOTION_DROPPED`, ambos com `promotionId` e `name`; no admin os tipos chamam-se `Order`/`OrderLine`, não `OrderView`/`OrderLineView`), `ecommerceOrdersGateway.ts` (`quote`), `OrderDetailPage.tsx` (substitui o `SectionPlaceholder` de promoções), `OrderLinesTable.tsx`, `utils/orderDetail.ts` (`financialSummaryRows` + `totalDiscount`; `API_ERROR_CODES` + `PROMOTION_UNAVAILABLE`, `PROMOTION_CODE_INVALID`, `TOTAL_CHANGED`), `utils/orderForm.ts` (`promotionCodes` vem do `OrderForm`; `expectedTotal` e `giftChoices` vêm da cotação e entram como **terceiro argumento**: `buildCreateOrderInput(form, idempotencyKey, quote?: { expectedTotal: number; giftChoices: Record<number, number> })`), `pages/orders/OrderCreatePage.tsx`, `utils/modification.ts` e `ModifyOrderModal.tsx`/`ModificationSummary.tsx` (campo "Order discount" e avisos; o resumo passa o `name` como parâmetro de tradução em `PROMOTION_CONDITION_UNMET` e `SHIPPING_PROMOTION_DROPPED`, que hoje não têm parâmetros), `admin/src/core/translations/{en,pt}.json` (inclui os tipos de histórico `PROMOTIONS_APPLIED`/`PROMOTIONS_RELEASED`, os `CodeStatus` e os avisos `PROMOTION_CONDITION_UNMET` e `SHIPPING_PROMOTION_DROPPED` em `en` + `pt`, ex.: "<name>: the shipping promotion no longer applies; the original discount is kept in the history" / "<name>: a promoção de portes deixou de se aplicar; o desconto original mantém-se no histórico")
- Test: `tests/admin/ecommerce/orderDetail.test.ts` (**editar** a asserção existente de `financialSummaryRows`, linha ~341, para incluir a linha `totalDiscount` −4100 com os mesmos valores 2000/1300/800), `tests/admin/ecommerce/orderForm.test.ts`, `tests/admin/ecommerce/modification.test.ts` (acrescentar)

**Comportamento:**
- **`PromotionsSection`** (requisitos 3.2, 3.7 e 3.8): uma linha por benefício de cada promoção aplicada (nome, código, método, tipo Produto/Encomenda/Portes, benefício descrito com `describeBenefit` a partir da fotografia, valor), o estado "Released" quando a redemption foi libertada e o desconto total. Lê só `order.promotions` (nunca recalcula). Vazio → `EmptySection`.
- **`OrderLinesTable`** (3.3 e 3.4): preço original riscado, "−X € / un.", preço final, e o nome das promoções da linha (`promotionIds`); as ofertas mantêm o badge "Promotional gift".
- **Resumo financeiro** (3.6): nova linha `totalDiscount` (produto + encomenda + portes), escondida a 0.
- **`OrderCreatePage` + `OrderQuotePanel`:** campo de códigos (até 5, como etiquetas) e "Apply"; com linhas, morada e método escolhidos, chama `quote` e mostra as promoções, o estado de cada código traduzido, as ofertas (com seletor quando a promoção oferece várias variantes), os descontos e o total. O `create` envia os códigos, as escolhas e `expectedTotal`; um 409 `PROMOTION_UNAVAILABLE`/`TOTAL_CHANGED` mostra a mensagem e repete a cotação. O `TotalsPreview` local fica só enquanto não há cotação.
- **Modificação:** campo opcional "Order discount" (euros) e, no resumo, os avisos `PROMOTION_CONDITION_UNMET` ("<nome>: the conditions are no longer met; the discount was kept") e `SHIPPING_PROMOTION_DROPPED` (com o `name` como parâmetro).
- [ ] **Step 1: Failing tests:**
  - `financialSummaryRows` com desconto de produto 2000, encomenda 1300 e portes 800 → linha `totalDiscount` −4100 (o teste existente é atualizado em conformidade); sem descontos → sem linha;
  - `buildCreateOrderInput` inclui `promotionCodes` normalizados (sem repetidos) e `expectedTotal`;
  - `promotionRows(order.promotions)` dá uma linha por benefício com o valor;
  - `buildCreateOrderInput(form, key, { expectedTotal, giftChoices })` inclui os dois; sem o terceiro argumento, não os inclui;
  - o input de modificação inclui `orderDiscount` só quando o campo foi preenchido (euros → cêntimos);
  - o resumo da modificação traduz `SHIPPING_PROMOTION_DROPPED` com o nome da promoção (`en` + `pt`).
- [ ] Implementação, testes, os dois `tsc` e `npm run build`. **Commit** `feat(ecommerce): promotions on the order page, manual order creation and modification`

---

### Task 14: Verificação final do plano 6

- [ ] `npx vitest run`, `npm run test:ts:back`, `npm run test:ts:front` e `npm run build` limpos.
- [ ] No Strapi de teste (`~/Projects/littlebox-plugins/strapi/backend-base`, MariaDB, reiniciado; sem chamadas a redes externas: Stripe, Resend e Moloni desativados ou sem credenciais):
  1. As tabelas novas e os índices únicos existem (`ltb_st_module_ecommerce_promotions`, `ltb_st_module_ecommerce_promotion_redemptions`, `ltb_st_module_ecommerce_promotion_customer_usages`) e as colunas JSON aceitam as promoções gravadas (`json_valid`).
  2. Promotions mostra o estado vazio com a ilustração; criar "Portes grátis acima de 50 €" (automática, `SUBTOTAL gte 5000`, `SHIPPING_FREE`) e "VERAO20" (código, 20% na encomenda, `usageLimit 1`, acumulável com portes). A listagem mostra os estados e a pesquisa por "verao" encontra-a.
  3. Criação manual de encomenda de 60 € com o código `VERAO20`: a cotação mostra as duas promoções, o total e o estado `APPLIED`; a encomenda criada mostra a secção "Promotions and discounts", as linhas e o resumo com o desconto total, e o histórico `PROMOTIONS_APPLIED` com `VERAO20` legível.
  4. Segunda encomenda com `VERAO20` → o formulário mostra o erro de limite (`USAGE_LIMIT_REACHED` na cotação; 409 `PROMOTION_UNAVAILABLE` se for forçada) e nenhuma encomenda é criada.
  5. Cancelar a primeira encomenda → redemption "Released", `VERAO20` volta a ter 0 utilizações e pode ser usado de novo.
  6. Promoção "Compre 2, receba 1 em oferta" com uma variante de stock 1 → a cotação inclui a oferta, a encomenda tem a linha "Promotional gift" e o stock da oferta baixa 1; com stock 0 a oferta não aparece.
  7. Editar a promoção de 20% para 50% não altera a encomenda já criada (valores e fotografia mantêm-se).
  8. Modificar uma encomenda abaixo do mínimo de uma promoção mostra o aviso e mantém o desconto; o campo "Order discount" altera-o e regista `ORDER_DISCOUNT_CHANGED`.
  9. Separador "Store credit" lista os vales; um utilizador sem `promotions.read` não vê o menu Promoções (filtro em `EcommerceLayout.tsx`, Task 11) e as rotas respondem 403 (policies, Task 10).
  10. As datas de início e fim gravadas em hora de Lisboa aparecem iguais depois de recarregar.
- [ ] Acrescentar a `docs/superpowers/plans/ecommerce-followups.md` (secção "Plan 6") os pendentes encontrados e estes, já conhecidos:
  - tratamento fiscal das ofertas: as linhas a 0 € continuam omitidas da fatura (`buildInvoiceLines`); confirmar com o contabilista se devem aparecer com 100% de desconto;
  - requisito 1.8 "validação adicional" para promoções de valor elevado ou restritas a e-mails: sem autenticação não há como provar a identidade; a decidir com o storefront (plano 7);
  - seleção da oferta pelo cliente (`giftChoices`) e mensagens dos `CodeStatus` no storefront: plano 7.
- [ ] Commit de correções: `chore(ecommerce): plan 6 verification fixes`
