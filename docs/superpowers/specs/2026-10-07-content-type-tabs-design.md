# Tabs em Collection Types e Single Types — Design

**Data:** 2026-10-07
**Plugin:** `littlebox-strapi-suite` (Strapi 5.10.3)

## Objetivo

Permitir organizar os campos de um collection type ou single type em tabs. As tabs são definidas no Content-Type Builder (CTB). Na tela de edição do Content Manager, os campos aparecem separados por tab. Na API REST de leitura, os campos de cada tab são devolvidos agrupados numa propriedade com o nome da tab convertido em chave (ex.: `"Loja - Vitrine"` → `loja_vitrine`).

Caso de uso principal: sites one page com muitas seções, em que todos os campos ficam num único single type.

## Decisões

| Tema | Decisão |
|---|---|
| Consumo da API | Só leitura via REST (`GET`). Escrita via REST e GraphQL ficam fora do escopo. |
| Definição das tabs | A lista de tabs é cadastrada no content type, e cada campo escolhe a sua tab num select. |
| Campos sem tab | Ficam sempre visíveis, acima da barra de tabs. Na API, ficam na raiz do objeto. |
| Módulo | Não é um módulo com ativar/desativar. A funcionalidade fica sempre disponível e é opt-in por content type. |
| Escopo de tipos | Só collection types e single types. Componentes não têm tabs, mas um campo do tipo componente ou dynamic zone pode ser colocado numa tab. |
| Testes | Vitest como devDependency, para as funções puras. O restante é validado manualmente num projeto Strapi via yalc. |

## Formato no schema

```json
// content type (schema.json)
"pluginOptions": {
  "littlebox-strapi-suite": {
    "tabs": [
      { "id": "k3f9a2", "name": "Loja - Vitrine" },
      { "id": "p81xq0", "name": "Contato" }
    ]
  }
}

// atributo
"banner": {
  "type": "media",
  "pluginOptions": { "littlebox-strapi-suite": { "tab": "k3f9a2" } }
}
```

- O `id` da tab é estável (string aleatória curta, gerada no admin). Renomear uma tab não desfaz a associação dos campos.
- A ordem do array `tabs` define a ordem das tabs na tela de edição e na resposta da API.
- Renomear uma tab muda a chave na API, o que quebra quem já consome a API. Isso fica documentado no README.

## Conversão do nome em chave (`toTabKey`)

Função pura compartilhada entre admin e servidor. O código é duplicado em `admin/src/core/utils/tabs.ts` e `server/src/utils/tabs.ts`, porque os dois bundles são separados. Os testes cobrem as duas cópias com os mesmos casos.

Passos, na ordem:
1. `normalize('NFD')` e remoção dos diacríticos (`\p{Diacritic}`);
2. `toLowerCase()`;
3. espaços (`\s+`) viram `_`;
4. remoção de qualquer caractere fora de `[a-z0-9_]`;
5. `_` repetidos viram um só;
6. remoção de `_` no início e no fim.

Exemplos: `Loja - Vitrine` → `loja_vitrine`; `Seção Ação 2` → `secao_acao_2`; `!!!` → `""` (inválido).

## 1. Content-Type Builder (admin)

Arquivos: `admin/src/ctb/`. O registro é feito em `admin/src/index.ts` (`register`), usando `app.getPlugin('content-type-builder').apis.forms`.

### 1.1 Lista de tabs do content type

- `ctbFormsAPI.components.add({ id: 'ltbTabsEditor', component: TabsEditor })`.
- `ctbFormsAPI.extendContentType` adiciona em `advanced` o campo `pluginOptions.littlebox-strapi-suite.tabs`, com `type: 'ltbTabsEditor'`.
- O `TabsEditor` recebe `name`, `value` e `onChange`, com a mesma assinatura usada pelo `CheckboxConfirmation` do i18n. Ele permite:
  - adicionar uma tab (gera o `id`);
  - renomear;
  - remover;
  - reordenar com drag-and-drop, usando o `@dnd-kit` que já é dependência do plugin.
- Ao lado de cada nome aparece a chave gerada por `toTabKey`.
- O validador (yup) aplicado em `tabs` exige:
  - nome obrigatório;
  - chave gerada não vazia;
  - chaves únicas entre as tabs.
- O validador também deve barrar uma chave igual ao nome de um atributo do content type. Se o validador de content type não receber os atributos, essa checagem vai para o validador do campo (1.2). O servidor também se protege (3.3).

### 1.2 Select "Tab" em cada campo

- `ctbFormsAPI.extendFields(<todos os tipos de atributo>, { form: { advanced } })`.
- Aparece só quando `forTarget === 'contentType'` e o content type tem pelo menos uma tab.
- O campo é `pluginOptions.littlebox-strapi-suite.tab`, com `type: 'select'`. As opções são "Nenhuma (sempre visível)" (valor vazio) mais as tabs de `contentTypeSchema.schema.pluginOptions['littlebox-strapi-suite'].tabs`, incluindo as que ainda não foram salvas.

### 1.3 Limpeza ao salvar

`ctbFormsAPI.addContentTypeSchemaMutation`:
- remove `tab` dos atributos cujo `id` não existe mais na lista de tabs;
- remove `tab` vazio;
- se a lista de tabs ficar vazia, remove `pluginOptions['littlebox-strapi-suite']` do content type e dos atributos.

## 2. Tela de edição do Content Manager (admin)

Arquivos: `admin/src/editView/`.

### 2.1 Layout com seções

- `app.registerHook('Admin/CM/pages/EditView/mutate-edit-view-layout', mutateLayout)`.
- O layout mantém **todos** os campos, organizados assim: painéis com os campos sem tab, o painel da barra de tabs e, para cada tab (na ordem cadastrada), um painel marcador seguido dos painéis com os campos da tab. Dynamic zones continuam em painéis próprios.
- Se o content type não tem tabs, ou se a URL não é da edit view, o layout passa intacto. Configure the view, History e Preview usam o mesmo hook e precisam do layout original.
- **Por que não filtrar no hook (revisão no Strapi 5.56):**
  - o Content Manager só recalcula o hook quando a query da URL muda, e o hook do i18n, que roda antes, descarta a `query`;
  - mudar a query dispara o aviso de alterações não salvas do formulário e recarrega o documento.

### 2.2 Barra de tabs e troca de tab

- A barra (`ltb-tabs-bar`) e os marcadores de seção (`ltb-tab-section`) são tipos de campo registrados com `app.addFields`, renderizados pelo `InputRenderer` dentro do contexto do formulário.
- Esses campos usam o nome de um campo real, porque o `InputRenderer` checa as permissões (RBAC) pelo nome. Preferência: o primeiro campo que não é componente, entre os campos sem tab; se só houver componentes, um caminho folha (ex.: `seo.metaTitle`), já que as permissões listam só as folhas dos componentes.
- A tab ativa fica num store em memória, compartilhado entre a barra e os marcadores, e é espelhada no hash da URL (`#ltbTab=<chave>`) via `history.replaceState`. O hash não aciona o aviso de alterações não salvas nem recarrega o documento, e mantém a tab ao recarregar a página.
- Cada marcador esconde o próprio painel e mostra ou esconde os painéis seguintes até o próximo marcador. Isso depende de os painéis serem filhos diretos de uma mesma coluna (estrutura do `FormLayout` do Content Manager). Um `MutationObserver` reaplica quando a lista de painéis muda.
- Se essa estrutura não for encontrada (ex.: mudança numa versão futura do Strapi), nada é escondido e todos os campos aparecem agrupados por seção.

### 2.3 Erros de validação

- Cada tab mostra um badge com a quantidade de erros dos seus campos (erros cujo caminho começa pelo nome de um campo da tab).
- Quando o envio falha e a tab ativa não tem erros, a barra muda para a primeira tab que tenha.

### 2.4 Fora do escopo

- A tela de History (versões) mostra todos os campos, sem tabs.
- O "Configure the view" do Content Manager continua funcionando. O filtro é aplicado sobre o layout configurado.

## 3. API REST (servidor)

Arquivos: `server/src/middlewares/tabs.ts` e `server/src/utils/tabs.ts`. O registro é feito em `server/src/register.ts`, com `strapi.server.use(...)`.

### 3.1 Condições

O middleware chama `await next()` e só transforma a resposta quando todas estas condições valem:
- o método é `GET`;
- `ctx.path` começa com `strapi.config.get('api.rest.prefix', '/api')`;
- o status é `200` e `ctx.body?.data` existe;
- `ctx.state.route?.handler` é `<uid>.find` ou `<uid>.findOne`, e `strapi.contentType(uid)` tem tabs.

Em qualquer outro caso, a resposta passa intacta.

### 3.2 Transformação

A função pura `groupByTabs(entry, tabs, attributes)` é aplicada a `data`, seja objeto ou cada item de um array.

- **Raiz:** `id`, `documentId`, `locale`, datas de sistema e campos sem tab, mantendo a ordem original.
- **Depois da raiz:** uma chave `toTabKey(name)` por tab, na ordem cadastrada, com os campos da tab que vieram na resposta.
- Se nenhum campo de uma tab vier na resposta (por causa de `fields`/`populate`), a chave da tab é omitida.
- `meta` não muda.

```json
// GET /api/home
{
  "data": {
    "id": 1,
    "documentId": "abc",
    "title": "Home",
    "loja_vitrine": { "banner": {}, "produtos_destaque": [] },
    "contato": { "email": "...", "telefone": "..." }
  },
  "meta": {}
}
```

### 3.3 Conflitos

- Se a chave de uma tab for igual a um atributo que fica na raiz, ou a uma chave de sistema, a tab não é agrupada: os campos dela ficam na raiz e o servidor registra um `strapi.log.warn` uma única vez por content type e tab.
- Tabs com chave vazia são ignoradas da mesma forma.

### 3.4 Limitações da v1

- Só o nível raiz é reagrupado. Relações populadas que apontam para outros content types com tabs vêm no formato original.
- `filters`, `sort`, `fields` e `populate` usam os nomes originais dos campos.
- Sem suporte a escrita via REST nem a GraphQL.

## Testes

- Adicionar `vitest` em `devDependencies` e o script `"test": "vitest run"`.
- Testes unitários para:
  - `toTabKey`, nas duas cópias: acentos, espaços, caracteres especiais, vazio;
  - `groupByTabs`: objeto, array, campos ausentes, tab vazia omitida, conflito de chave;
  - `filterLayoutByTab`: tab ativa válida ou inválida, campos sem tab, remoção de painéis e linhas vazios;
  - a limpeza do schema (1.3).
- Validação manual num projeto Strapi via yalc:
  - criar tabs e associar campos no CTB;
  - editar e salvar uma entrada trocando de tab;
  - erro de campo obrigatório numa tab oculta;
  - `GET` de um single type e de um collection type (find e findOne) com `populate` e `fields`.

## Documentação

Seção no README explicando a configuração no CTB, o formato da API, a regra de conversão do nome e o aviso de que renomear uma tab muda a chave da API.
