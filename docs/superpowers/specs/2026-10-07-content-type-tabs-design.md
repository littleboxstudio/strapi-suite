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

### 2.1 Filtro do layout

- `app.registerHook('Admin/CM/pages/EditView/mutate-edit-view-layout', mutateLayout)`.
- A função pura `filterLayoutByTab(layout, tabs, attributes, activeKey)` faz o seguinte:
  - se o content type não tem tabs, devolve o layout inalterado;
  - tab ativa = `query.ltbTab` quando ela corresponde a uma tab existente; caso contrário, a primeira tab;
  - mantém os campos sem tab e os da tab ativa;
  - remove painéis e linhas vazios.
- O Content Manager recalcula o hook quando `query` muda (dependência confirmada no `useMemo` do CM 5.10.3), então trocar de tab é só atualizar `?ltbTab=` na URL.
- Os valores dos campos ocultos continuam no estado do formulário e são salvos normalmente.

### 2.2 Barra de tabs

- A barra entra no próprio layout como um painel entre os campos sem tab e os campos da tab ativa. O campo desse painel é de um tipo registrado com `app.addFields({ type: 'ltb-tabs-bar', Component: TabsBar })`, que o `InputRenderer` do Content Manager renderiza dentro do contexto do formulário.
- Esse campo usa o `name` de um campo real (o primeiro campo sem tab ou, se não houver, o primeiro campo do layout), porque o `InputRenderer` checa as permissões (RBAC) pelo nome. Um campo com nome inexistente apareceria como "sem permissão".
- O hook só atua nas URLs da edit view. Configure the view, History e Preview usam o mesmo hook e precisam receber o layout intacto, senão a configuração salva perderia os campos.
- A barra usa os componentes de Tabs do `@strapi/design-system` e, ao trocar de tab, atualiza `?ltbTab=` mantendo os outros parâmetros (ex.: `plugins[i18n][locale]`).
- Essa abordagem substitui o React portal previsto antes: usa só APIs públicas do Strapi (`registerHook` e `addFields`) e não depende do HTML da página. A validação manual no Strapi 5.56 (backend-base) confirma o funcionamento.

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
