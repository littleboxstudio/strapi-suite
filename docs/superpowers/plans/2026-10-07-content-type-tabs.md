# Tabs em Content Types — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizar os campos de collection/single types em tabs definidas no Content-Type Builder, exibidas como tabs na tela de edição e devolvidas agrupadas na API REST de leitura.

**Architecture:** As tabs ficam em `pluginOptions['littlebox-strapi-suite']` do schema: a lista `tabs` no content type e o `tab` (id) em cada atributo. O admin estende o CTB pela `apis.forms` do plugin content-type-builder e filtra o layout da tela de edição com o hook `Admin/CM/pages/EditView/mutate-edit-view-layout`. A barra de tabs entra no layout como um campo de um tipo registrado com `app.addFields`, e esse campo usa o nome de um campo real para passar pela checagem de permissões (RBAC) do `InputRenderer`. O servidor registra um middleware Koa em `register` (antes do router) que reagrupa `data` nas respostas `GET` de `find`/`findOne`.

**Tech Stack:** Strapi 5 (peer `^5.48.1`, validado no 5.56.0), React 18, `@strapi/design-system` v2, `@dnd-kit`, yup, Koa, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-content-type-tabs-design.md`

## Global Constraints

- Chave do plugin em `pluginOptions`: `littlebox-strapi-suite` (igual a `PLUGIN_ID`).
- Formato: content type `{ tabs: [{ id: string, name: string }] }`; atributo `{ tab: string /* id */ }`.
- `toTabKey`: NFD → remove diacríticos → minúsculas → `\s+` → `_` → remove `[^a-z0-9_]` → colapsa `_` → remove `_` nas bordas. `"Loja - Vitrine"` → `loja_vitrine`.
- Parâmetro de URL da tab ativa: `ltbTab` (valor = chave da tab).
- API: só `GET`, status 200, handler `<uid>.find` ou `<uid>.findOne`, URL com o prefixo REST (`api.rest.prefix`, padrão `/api`). Só o nível raiz é agrupado. Tab sem campos na resposta é omitida.
- Conflito de chave (vazia, igual a uma chave da raiz ou duplicada): a tab não é agrupada e o servidor registra `strapi.log.warn` uma vez por content type e tab.
- Tela de edição: o filtro atua só nas URLs da edit view. Configure the view, History e Preview recebem o layout intacto.
- Schema do CTB no Strapi ≥ 5.48: `attributes` é um array de `{ name, ...}` e `pluginOptions` fica no topo. Também aceitar `attributes` como objeto e `contentTypeSchema.schema.pluginOptions`, por compatibilidade.

## Review Focus

- Content type sem tabs: a tela de edição, o CTB e a API ficam idênticos ao comportamento atual. Testes em `filterLayout` (sem tabs), `cleanContentTypeSchema` (objeto inalterado) e `groupDataByTabs` (sem grupos).
- `?ltbTab=` inválido ou de outra tab removida: cai na primeira tab. Teste em `resolveActiveTab`.
- Campo apontando para uma tab removida: na tela de edição aparece como campo sem tab (sempre visível), e no CTB a referência é limpa ao salvar. Testes em `splitLayoutByTab` e `cleanContentTypeSchema`.
- Resposta com `fields=` limitando os campos: a tab cujos campos não vieram é omitida e a raiz não perde nada. Teste em `groupEntryByTabs`.
- Tab cujo nome gera uma chave igual a um campo da raiz (ex.: tab `Title` com campo `title` sem tab): a tab não é agrupada. Teste em `buildTabGroups`.

---

### Task 1: Vitest e utilitário de tabs do servidor

**Files:**
- Modify: `package.json` (devDependency `vitest`, script `test`)
- Create: `vitest.config.mts`
- Create: `server/src/utils/tabs.ts`
- Test: `tests/server/tabs.test.ts`

**Interfaces:**
- Produces (`server/src/utils/tabs.ts`):
  - `TABS_PLUGIN_KEY = 'littlebox-strapi-suite'`
  - `interface LtbTab { id: string; name: string }`
  - `interface TabGroup { tab: LtbTab; key: string; fields: string[] }`
  - `toTabKey(name: string): string`
  - `readTabs(pluginOptions: unknown): LtbTab[]`
  - `readAttributeTabId(attribute: unknown): string | null`
  - `buildTabGroups(tabs: LtbTab[], attributes: Record<string, unknown>, onConflict?: (tab: LtbTab, key: string) => void): TabGroup[]`
  - `groupEntryByTabs(entry: unknown, groups: TabGroup[]): unknown`
  - `groupDataByTabs(data: unknown, groups: TabGroup[]): unknown`
  - `parseHandlerUid(handler: unknown): string | null`

- [ ] **Step 1: Instalar o Vitest e configurar**

Run: `npm i -D vitest@^3 --legacy-peer-deps`

`package.json` → `"test": "vitest run"` em `scripts`.

`vitest.config.mts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/server/tabs.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import {
  toTabKey,
  readTabs,
  readAttributeTabId,
  buildTabGroups,
  groupEntryByTabs,
  groupDataByTabs,
  parseHandlerUid,
} from '../../server/src/utils/tabs';

const KEY = 'littlebox-strapi-suite';
const tabs = [
  { id: 't1', name: 'Loja - Vitrine' },
  { id: 't2', name: 'Contato' },
];
const attributes = {
  title: { type: 'string' },
  banner: { type: 'media', pluginOptions: { [KEY]: { tab: 't1' } } },
  produtos: { type: 'json', pluginOptions: { [KEY]: { tab: 't1' } } },
  email: { type: 'email', pluginOptions: { [KEY]: { tab: 't2' } } },
  orphan: { type: 'string', pluginOptions: { [KEY]: { tab: 'gone' } } },
};

describe('toTabKey', () => {
  it.each([
    ['Loja - Vitrine', 'loja_vitrine'],
    ['Seção Ação 2', 'secao_acao_2'],
    ['  Olá   Mundo  ', 'ola_mundo'],
    ['Café & Pão!', 'cafe_pao'],
    ['!!!', ''],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(toTabKey(input)).toBe(expected);
  });
});

describe('readTabs / readAttributeTabId', () => {
  it('lê as tabs válidas e ignora lixo', () => {
    expect(readTabs({ [KEY]: { tabs: [...tabs, { id: 1 }, null] } })).toEqual(tabs);
    expect(readTabs(undefined)).toEqual([]);
    expect(readTabs({ [KEY]: { tabs: 'x' } })).toEqual([]);
  });
  it('lê o id da tab do atributo', () => {
    expect(readAttributeTabId(attributes.banner)).toBe('t1');
    expect(readAttributeTabId(attributes.title)).toBeNull();
    expect(readAttributeTabId({ pluginOptions: { [KEY]: { tab: '' } } })).toBeNull();
  });
});

describe('buildTabGroups', () => {
  it('agrupa os campos por tab, na ordem das tabs', () => {
    expect(buildTabGroups(tabs, attributes)).toEqual([
      { tab: tabs[0], key: 'loja_vitrine', fields: ['banner', 'produtos'] },
      { tab: tabs[1], key: 'contato', fields: ['email'] },
    ]);
  });
  it('ignora tabs sem campos', () => {
    expect(buildTabGroups([...tabs, { id: 't3', name: 'Vazia' }], attributes)).toHaveLength(2);
  });
  it('não agrupa tab cuja chave conflita com a raiz, com chave vazia ou duplicada', () => {
    const onConflict = vi.fn();
    const conflicting = [
      { id: 'a', name: 'Title' },
      { id: 'b', name: '!!!' },
      { id: 'c', name: 'Contato' },
      { id: 'd', name: 'contato' },
      { id: 'e', name: 'ID' },
    ];
    const attrs = {
      title: { type: 'string' },
      x: { pluginOptions: { [KEY]: { tab: 'a' } } },
      y: { pluginOptions: { [KEY]: { tab: 'b' } } },
      z: { pluginOptions: { [KEY]: { tab: 'c' } } },
      w: { pluginOptions: { [KEY]: { tab: 'd' } } },
      v: { pluginOptions: { [KEY]: { tab: 'e' } } },
    };
    const groups = buildTabGroups(conflicting, attrs, onConflict);
    expect(groups.map((g) => g.key)).toEqual(['contato']);
    expect(onConflict).toHaveBeenCalledTimes(4);
  });
});

describe('groupEntryByTabs / groupDataByTabs', () => {
  const groups = buildTabGroups(tabs, attributes);
  const entry = {
    id: 1,
    documentId: 'abc',
    title: 'Home',
    banner: { url: '/x.png' },
    produtos: [1, 2],
    email: 'a@b.c',
    orphan: 'fica na raiz',
  };

  it('move os campos para a chave da tab, depois da raiz', () => {
    const result = groupEntryByTabs(entry, groups);
    expect(result).toEqual({
      id: 1,
      documentId: 'abc',
      title: 'Home',
      orphan: 'fica na raiz',
      loja_vitrine: { banner: { url: '/x.png' }, produtos: [1, 2] },
      contato: { email: 'a@b.c' },
    });
    expect(Object.keys(result as object)).toEqual([
      'id', 'documentId', 'title', 'orphan', 'loja_vitrine', 'contato',
    ]);
  });

  it('omite tabs sem campos na resposta (fields=)', () => {
    expect(groupEntryByTabs({ id: 1, title: 'Home', email: 'a@b.c' }, groups)).toEqual({
      id: 1,
      title: 'Home',
      contato: { email: 'a@b.c' },
    });
  });

  it('trata arrays, null e entradas sem grupos', () => {
    expect(groupDataByTabs([entry], groups)).toEqual([groupEntryByTabs(entry, groups)]);
    expect(groupDataByTabs(null, groups)).toBeNull();
    expect(groupDataByTabs(entry, [])).toBe(entry);
  });
});

describe('parseHandlerUid', () => {
  it('extrai o uid só de find/findOne', () => {
    expect(parseHandlerUid('api::home.home.find')).toBe('api::home.home');
    expect(parseHandlerUid('api::article.article.findOne')).toBe('api::article.article');
    expect(parseHandlerUid('api::article.article.create')).toBeNull();
    expect(parseHandlerUid(undefined)).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/server/tabs.test.ts`
Expected: FAIL (módulo `server/src/utils/tabs` não existe)

- [ ] **Step 4: Implementar `server/src/utils/tabs.ts`**

```ts
export const TABS_PLUGIN_KEY = 'littlebox-strapi-suite';

const SYSTEM_KEYS = [
  'id',
  'documentId',
  'locale',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'localizations',
];

export interface LtbTab {
  id: string;
  name: string;
}

export interface TabGroup {
  tab: LtbTab;
  key: string;
  fields: string[];
}

export function toTabKey(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function readTabs(pluginOptions: unknown): LtbTab[] {
  const tabs = (pluginOptions as any)?.[TABS_PLUGIN_KEY]?.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string');
}

export function readAttributeTabId(attribute: unknown): string | null {
  const id = (attribute as any)?.pluginOptions?.[TABS_PLUGIN_KEY]?.tab;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function buildTabGroups(
  tabs: LtbTab[],
  attributes: Record<string, unknown>,
  onConflict?: (tab: LtbTab, key: string) => void
): TabGroup[] {
  const candidates = tabs
    .map((tab) => ({
      tab,
      key: toTabKey(tab.name),
      fields: Object.entries(attributes)
        .filter(([, attribute]) => readAttributeTabId(attribute) === tab.id)
        .map(([name]) => name),
    }))
    .filter((group) => group.fields.length > 0);

  const groupedFields = new Set(candidates.flatMap((group) => group.fields));
  const rootKeys = new Set([
    ...SYSTEM_KEYS,
    ...Object.keys(attributes).filter((name) => !groupedFields.has(name)),
  ]);
  const usedKeys = new Set<string>();

  return candidates.filter((group) => {
    if (group.key === '' || rootKeys.has(group.key) || usedKeys.has(group.key)) {
      onConflict?.(group.tab, group.key);
      return false;
    }
    usedKeys.add(group.key);
    return true;
  });
}

export function groupEntryByTabs(entry: unknown, groups: TabGroup[]): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || groups.length === 0) {
    return entry;
  }
  const fieldToKey = new Map<string, string>();
  groups.forEach((group) => group.fields.forEach((field) => fieldToKey.set(field, group.key)));

  const result: Record<string, unknown> = {};
  const grouped: Record<string, Record<string, unknown>> = {};
  Object.entries(entry).forEach(([name, value]) => {
    const key = fieldToKey.get(name);
    if (key === undefined) {
      result[name] = value;
    } else {
      (grouped[key] ??= {})[name] = value;
    }
  });
  groups.forEach((group) => {
    if (grouped[group.key]) result[group.key] = grouped[group.key];
  });
  return result;
}

export function groupDataByTabs(data: unknown, groups: TabGroup[]): unknown {
  if (groups.length === 0) return data;
  return Array.isArray(data)
    ? data.map((entry) => groupEntryByTabs(entry, groups))
    : groupEntryByTabs(data, groups);
}

export function parseHandlerUid(handler: unknown): string | null {
  if (typeof handler !== 'string') return null;
  const match = handler.match(/^(.+)\.(find|findOne)$/);
  return match ? match[1] : null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/server/tabs.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.mts server/src/utils/tabs.ts tests/server/tabs.test.ts
git commit -m "feat(server): add tab grouping utilities"
```

### Task 2: Middleware da API

**Files:**
- Create: `server/src/middlewares/tabs.ts`
- Modify: `server/src/register.ts`
- Test: `tests/server/tabsMiddleware.test.ts`

**Interfaces:**
- Consumes: `readTabs`, `buildTabGroups`, `groupDataByTabs`, `parseHandlerUid` (Task 1).
- Produces: `createTabsMiddleware({ strapi }): (ctx, next) => Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/server/tabsMiddleware.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createTabsMiddleware } from '../../server/src/middlewares/tabs';

const KEY = 'littlebox-strapi-suite';
const contentType = {
  pluginOptions: { [KEY]: { tabs: [{ id: 't1', name: 'Loja - Vitrine' }, { id: 't2', name: 'Title' }] } },
  attributes: {
    title: { type: 'string' },
    banner: { type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
    other: { type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
  },
};

function makeStrapi() {
  return {
    config: { get: vi.fn((_key: string, fallback: string) => fallback) },
    contentType: vi.fn((uid: string) => (uid === 'api::home.home' ? contentType : undefined)),
    log: { warn: vi.fn() },
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/api/home',
    status: 200,
    body: { data: { id: 1, title: 'Home', banner: 'b', other: 'o' }, meta: {} },
    state: { route: { handler: 'api::home.home.find' } },
    ...overrides,
  } as any;
}

describe('createTabsMiddleware', () => {
  it('agrupa a resposta e avisa sobre conflitos uma única vez', async () => {
    const strapi = makeStrapi();
    const middleware = createTabsMiddleware({ strapi: strapi as any });
    const ctx = makeCtx();
    await middleware(ctx, async () => {});
    expect(ctx.body).toEqual({
      data: { id: 1, title: 'Home', other: 'o', loja_vitrine: { banner: 'b' } },
      meta: {},
    });
    await middleware(makeCtx(), async () => {});
    expect(strapi.log.warn).toHaveBeenCalledTimes(1);
  });

  it('não altera respostas fora das condições', async () => {
    const strapi = makeStrapi();
    const middleware = createTabsMiddleware({ strapi: strapi as any });
    const cases = [
      makeCtx({ method: 'POST' }),
      makeCtx({ status: 404 }),
      makeCtx({ path: '/admin/home' }),
      makeCtx({ state: { route: { handler: 'api::home.home.update' } } }),
      makeCtx({ state: { route: { handler: 'api::other.other.find' } } }),
      makeCtx({ body: { data: null } }),
    ];
    for (const ctx of cases) {
      const before = ctx.body;
      await middleware(ctx, async () => {});
      expect(ctx.body).toBe(before);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/server/tabsMiddleware.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `server/src/middlewares/tabs.ts`**

```ts
import type { Core } from '@strapi/strapi';
import { readTabs, buildTabGroups, groupDataByTabs, parseHandlerUid } from '../utils/tabs';

export function createTabsMiddleware({ strapi }: { strapi: Core.Strapi }) {
  const warned = new Set<string>();

  return async (ctx: any, next: () => Promise<void>) => {
    await next();

    if (ctx.method !== 'GET' || ctx.status !== 200) return;
    const prefix: string = strapi.config.get('api.rest.prefix', '/api');
    if (!ctx.path?.startsWith(prefix)) return;
    const body = ctx.body;
    if (!body || typeof body !== 'object' || body.data == null) return;

    const uid = parseHandlerUid(ctx.state?.route?.handler);
    if (!uid) return;
    let contentType: any;
    try {
      contentType = strapi.contentType(uid as any);
    } catch {
      return;
    }
    if (!contentType) return;
    const tabs = readTabs(contentType.pluginOptions);
    if (tabs.length === 0) return;

    const groups = buildTabGroups(tabs, contentType.attributes ?? {}, (tab, key) => {
      const id = `${uid}:${tab.id}`;
      if (warned.has(id)) return;
      warned.add(id);
      strapi.log.warn(
        `[littlebox-strapi-suite] Tab "${tab.name}" of ${uid} was not grouped: the key "${key}" is empty or conflicts with another field or tab.`
      );
    });
    if (groups.length === 0) return;

    ctx.body = { ...body, data: groupDataByTabs(body.data, groups) };
  };
}
```

- [ ] **Step 4: Registrar em `server/src/register.ts`**

```ts
import type { Core } from '@strapi/strapi';
import { PLUGIN_ID } from './config/index';
import { createTabsMiddleware } from './middlewares/tabs';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.customFields.register({
    name: 'ltbslug',
    plugin: PLUGIN_ID,
    type: 'uid',
  });

  // Registered during `register` so it runs before the router, which is mounted in `bootstrap`.
  strapi.server.use(createTabsMiddleware({ strapi }));
};

export default register;
```

- [ ] **Step 5: Rodar testes e checagem de tipos**

Run: `npx vitest run && npm run test:ts:back`
Expected: PASS, sem erros de tipos

- [ ] **Step 6: Commit**

```bash
git add server/src/middlewares/tabs.ts server/src/register.ts tests/server/tabsMiddleware.test.ts
git commit -m "feat(server): group REST read responses by content type tabs"
```

### Task 3: Utilitário de tabs do admin

**Files:**
- Create: `admin/src/core/utils/tabs.ts`
- Test: `tests/admin/tabs.test.ts`

**Interfaces:**
- Produces (`admin/src/core/utils/tabs.ts`):
  - `TABS_PLUGIN_KEY`, `TABS_QUERY_PARAM = 'ltbTab'`, `TABS_BAR_FIELD_TYPE = 'ltb-tabs-bar'`
  - `LtbTab`, `toTabKey`, `readTabs`, `readAttributeTabId` (mesma semântica da Task 1)
  - `generateTabId(): string`
  - `type TabsValidationError = 'name.required' | 'key.empty' | 'key.duplicated'`
  - `validateTabs(tabs: LtbTab[]): TabsValidationError | null`
  - `cleanContentTypeSchema<T>(schema: T): T`
  - `resolveActiveTab(tabs: LtbTab[], requested: unknown): LtbTab | null`
  - `type LayoutField = { name: string; attribute?: unknown; [key: string]: unknown }`, `type LayoutPanel = LayoutField[][]`
  - `splitLayoutByTab(panels: LayoutPanel[], tabs: LtbTab[], activeTabId: string): { rootPanels: LayoutPanel[]; tabPanels: LayoutPanel[] }`
  - `mapFieldsToTabKeys(panels: LayoutPanel[], tabs: LtbTab[]): Record<string, string>`
  - `countErrorsByTab(errors: unknown, fieldTabKeys: Record<string, string>): Record<string, number>`
  - `isEditViewPath(pathname: string): boolean`

- [ ] **Step 1: Escrever o teste que falha**

`tests/admin/tabs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  toTabKey,
  generateTabId,
  validateTabs,
  cleanContentTypeSchema,
  resolveActiveTab,
  splitLayoutByTab,
  mapFieldsToTabKeys,
  countErrorsByTab,
  isEditViewPath,
} from '../../admin/src/core/utils/tabs';

const KEY = 'littlebox-strapi-suite';
const tabs = [
  { id: 't1', name: 'Loja - Vitrine' },
  { id: 't2', name: 'Contato' },
];
const field = (name: string, tab?: string) => ({
  name,
  attribute: tab ? { type: 'string', pluginOptions: { [KEY]: { tab } } } : { type: 'string' },
});

describe('toTabKey (admin)', () => {
  it.each([
    ['Loja - Vitrine', 'loja_vitrine'],
    ['Seção Ação 2', 'secao_acao_2'],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(toTabKey(input)).toBe(expected);
  });
});

describe('generateTabId', () => {
  it('gera ids distintos', () => {
    const ids = new Set(Array.from({ length: 50 }, generateTabId));
    expect(ids.size).toBe(50);
  });
});

describe('validateTabs', () => {
  it('aceita uma lista válida ou vazia', () => {
    expect(validateTabs(tabs)).toBeNull();
    expect(validateTabs([])).toBeNull();
  });
  it('detecta nome vazio, chave vazia e chave duplicada', () => {
    expect(validateTabs([{ id: 'a', name: '  ' }])).toBe('name.required');
    expect(validateTabs([{ id: 'a', name: '!!!' }])).toBe('key.empty');
    expect(validateTabs([{ id: 'a', name: 'Contato' }, { id: 'b', name: 'contato' }])).toBe('key.duplicated');
  });
});

describe('cleanContentTypeSchema', () => {
  it('não altera schemas sem configuração de tabs', () => {
    const schema = { pluginOptions: { i18n: { localized: true } }, attributes: [{ name: 'title', type: 'string' }] };
    expect(cleanContentTypeSchema(schema)).toBe(schema);
  });

  it('remove referências a tabs inexistentes e tab vazia (attributes em array)', () => {
    const schema = {
      pluginOptions: { [KEY]: { tabs: [tabs[0]] } },
      attributes: [
        { name: 'a', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
        { name: 'b', type: 'string', pluginOptions: { [KEY]: { tab: 'gone' }, i18n: { localized: true } } },
        { name: 'c', type: 'string', pluginOptions: { [KEY]: { tab: '' } } },
      ],
    };
    const result = cleanContentTypeSchema(schema);
    expect(result.attributes).toEqual([
      { name: 'a', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
      { name: 'b', type: 'string', pluginOptions: { i18n: { localized: true } } },
      { name: 'c', type: 'string', pluginOptions: {} },
    ]);
  });

  it('remove a configuração do content type quando não há tabs (attributes em objeto)', () => {
    const schema = {
      pluginOptions: { [KEY]: { tabs: [] }, i18n: { localized: true } },
      attributes: { a: { type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } } },
    };
    expect(cleanContentTypeSchema(schema)).toEqual({
      pluginOptions: { i18n: { localized: true } },
      attributes: { a: { type: 'string', pluginOptions: {} } },
    });
  });
});

describe('resolveActiveTab', () => {
  it('usa a tab da query quando ela existe, senão a primeira', () => {
    expect(resolveActiveTab(tabs, 'contato')).toBe(tabs[1]);
    expect(resolveActiveTab(tabs, 'nao_existe')).toBe(tabs[0]);
    expect(resolveActiveTab(tabs, undefined)).toBe(tabs[0]);
    expect(resolveActiveTab([], 'contato')).toBeNull();
  });
});

describe('splitLayoutByTab', () => {
  const panels = [
    [[field('title'), field('banner', 't1')], [field('email', 't2')]],
    [[field('orphan', 'gone')]],
    [[field('produtos', 't1')]],
  ];

  it('separa campos sem tab e campos da tab ativa, removendo linhas e painéis vazios', () => {
    expect(splitLayoutByTab(panels, tabs, 't1')).toEqual({
      rootPanels: [[[field('title')]], [[field('orphan', 'gone')]]],
      tabPanels: [[[field('banner', 't1')]], [[field('produtos', 't1')]]],
    });
  });

  it('mapeia campos para a chave da tab', () => {
    expect(mapFieldsToTabKeys(panels, tabs)).toEqual({
      banner: 'loja_vitrine',
      email: 'contato',
      produtos: 'loja_vitrine',
    });
  });
});

describe('countErrorsByTab', () => {
  it('conta os erros de primeiro nível por tab', () => {
    const errors = { banner: 'required', email: 'invalid', title: 'required', produtos: { 0: 'x' } };
    expect(countErrorsByTab(errors, { banner: 'loja_vitrine', email: 'contato', produtos: 'loja_vitrine' })).toEqual({
      loja_vitrine: 2,
      contato: 1,
    });
    expect(countErrorsByTab(undefined, {})).toEqual({});
  });
});

describe('isEditViewPath', () => {
  it.each([
    ['/admin/content-manager/collection-types/api::article.article/abc123', true],
    ['/admin/content-manager/collection-types/api::article.article/create', true],
    ['/admin/content-manager/single-types/api::home.home', true],
    ['/admin/content-manager/single-types/api::home.home/history', false],
    ['/admin/content-manager/collection-types/api::article.article/abc123/history', false],
    ['/admin/content-manager/collection-types/api::article.article/configurations/edit', false],
    ['/admin/content-manager/single-types/api::home.home/configurations/edit', false],
    ['/admin/content-manager/single-types/api::home.home/preview', false],
    ['/admin/content-manager/collection-types/api::article.article', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isEditViewPath(pathname)).toBe(expected);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/admin/tabs.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `admin/src/core/utils/tabs.ts`**

```ts
export const TABS_PLUGIN_KEY = 'littlebox-strapi-suite';
export const TABS_QUERY_PARAM = 'ltbTab';
export const TABS_BAR_FIELD_TYPE = 'ltb-tabs-bar';

export interface LtbTab {
  id: string;
  name: string;
}

export type LayoutField = { name: string; attribute?: unknown; [key: string]: unknown };
export type LayoutPanel = LayoutField[][];
export type TabsValidationError = 'name.required' | 'key.empty' | 'key.duplicated';

export function toTabKey(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function generateTabId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function readTabs(pluginOptions: unknown): LtbTab[] {
  const tabs = (pluginOptions as any)?.[TABS_PLUGIN_KEY]?.tabs;
  if (!Array.isArray(tabs)) return [];
  return tabs.filter((tab) => tab && typeof tab.id === 'string' && typeof tab.name === 'string');
}

export function readAttributeTabId(attribute: unknown): string | null {
  const id = (attribute as any)?.pluginOptions?.[TABS_PLUGIN_KEY]?.tab;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function validateTabs(tabs: LtbTab[]): TabsValidationError | null {
  const keys = new Set<string>();
  for (const tab of tabs) {
    if (!tab.name || tab.name.trim() === '') return 'name.required';
    const key = toTabKey(tab.name);
    if (key === '') return 'key.empty';
    if (keys.has(key)) return 'key.duplicated';
    keys.add(key);
  }
  return null;
}

function omitPluginKey(pluginOptions: Record<string, unknown>) {
  const { [TABS_PLUGIN_KEY]: _removed, ...rest } = pluginOptions;
  return rest;
}

function cleanAttribute(attribute: any, validIds: Set<string>) {
  if (!attribute?.pluginOptions || !(TABS_PLUGIN_KEY in attribute.pluginOptions)) return attribute;
  const id = readAttributeTabId(attribute);
  if (id && validIds.has(id)) return attribute;
  return { ...attribute, pluginOptions: omitPluginKey(attribute.pluginOptions) };
}

export function cleanContentTypeSchema<T>(schema: T): T {
  const current = schema as any;
  if (!current || typeof current !== 'object') return schema;

  const tabs = readTabs(current.pluginOptions);
  const validIds = new Set(tabs.map((tab) => tab.id));
  let changed = false;
  const next: any = { ...current };

  if (current.pluginOptions && TABS_PLUGIN_KEY in current.pluginOptions && tabs.length === 0) {
    next.pluginOptions = omitPluginKey(current.pluginOptions);
    changed = true;
  }

  const clean = (attribute: any) => {
    const cleaned = cleanAttribute(attribute, validIds);
    if (cleaned !== attribute) changed = true;
    return cleaned;
  };
  if (Array.isArray(current.attributes)) {
    next.attributes = current.attributes.map(clean);
  } else if (current.attributes && typeof current.attributes === 'object') {
    next.attributes = Object.fromEntries(
      Object.entries(current.attributes).map(([name, attribute]) => [name, clean(attribute)])
    );
  }

  return changed ? next : schema;
}

export function resolveActiveTab(tabs: LtbTab[], requested: unknown): LtbTab | null {
  if (tabs.length === 0) return null;
  if (typeof requested === 'string') {
    const found = tabs.find((tab) => toTabKey(tab.name) === requested);
    if (found) return found;
  }
  return tabs[0];
}

function fieldTabId(field: LayoutField, validIds: Set<string>): string | null {
  const id = readAttributeTabId(field.attribute);
  return id && validIds.has(id) ? id : null;
}

function pickFields(panels: LayoutPanel[], predicate: (field: LayoutField) => boolean): LayoutPanel[] {
  return panels
    .map((panel) => panel.map((row) => row.filter(predicate)).filter((row) => row.length > 0))
    .filter((panel) => panel.length > 0);
}

export function splitLayoutByTab(panels: LayoutPanel[], tabs: LtbTab[], activeTabId: string) {
  const validIds = new Set(tabs.map((tab) => tab.id));
  return {
    rootPanels: pickFields(panels, (field) => fieldTabId(field, validIds) === null),
    tabPanels: pickFields(panels, (field) => fieldTabId(field, validIds) === activeTabId),
  };
}

export function mapFieldsToTabKeys(panels: LayoutPanel[], tabs: LtbTab[]): Record<string, string> {
  const keysById = new Map(tabs.map((tab) => [tab.id, toTabKey(tab.name)]));
  const result: Record<string, string> = {};
  panels.flat(2).forEach((field) => {
    const id = readAttributeTabId(field.attribute);
    const key = id ? keysById.get(id) : undefined;
    if (key !== undefined) result[field.name] = key;
  });
  return result;
}

export function countErrorsByTab(
  errors: unknown,
  fieldTabKeys: Record<string, string>
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!errors || typeof errors !== 'object') return counts;
  Object.entries(errors).forEach(([name, error]) => {
    const key = fieldTabKeys[name];
    if (key !== undefined && error) counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

const EDIT_VIEW_PATH = /\/content-manager\/(collection-types\/[^/]+\/[^/]+|single-types\/[^/]+)\/?$/;
const NON_EDIT_SEGMENTS = new Set(['history', 'preview', 'configurations']);

export function isEditViewPath(pathname: string): boolean {
  if (!EDIT_VIEW_PATH.test(pathname)) return false;
  const lastSegment = pathname.replace(/\/$/, '').split('/').pop() ?? '';
  return !NON_EDIT_SEGMENTS.has(lastSegment);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/admin/tabs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin/src/core/utils/tabs.ts tests/admin/tabs.test.ts
git commit -m "feat(admin): add tab utilities for the content type builder and edit view"
```

### Task 4: Content-Type Builder (lista de tabs, select por campo, limpeza)

**Files:**
- Create: `admin/src/ctb/TabsEditor.tsx`
- Create: `admin/src/ctb/registerTabsInContentTypeBuilder.ts`
- Modify: `admin/src/index.ts` (chamar o registro no `bootstrap`)
- Modify: `admin/src/core/translations/en.json`

**Interfaces:**
- Consumes: `TABS_PLUGIN_KEY`, `LtbTab`, `toTabKey`, `generateTabId`, `readTabs`, `validateTabs`, `cleanContentTypeSchema` (Task 3).
- Produces: `registerTabsInContentTypeBuilder(app: any): void`.

- [ ] **Step 1: `admin/src/ctb/TabsEditor.tsx`**

Componente controlado. Props do CTB: `{ name, value, onChange, intlLabel, description, error }`. Chama `onChange({ target: { name, value: LtbTab[] } })`. Usa `DndContext`/`SortableContext`/`useSortable` do `@dnd-kit` (o mesmo padrão de `admin/src/components/menu/MenuList.tsx`), `TextInput`, `IconButton`, `Button`, `Typography` e `Field` do design system, e ícones `Drag`, `Trash`, `Plus` de `@strapi/icons`. Ao lado de cada nome mostra `toTabKey(name)` (ou o aviso de chave vazia). O código completo está no commit desta task.

- [ ] **Step 2: `admin/src/ctb/registerTabsInContentTypeBuilder.ts`**

```ts
import * as yup from 'yup';
import { getTranslation } from '../core/utils/getTranslation';
import { TABS_PLUGIN_KEY, readTabs, validateTabs, cleanContentTypeSchema } from '../core/utils/tabs';
import TabsEditor from './TabsEditor';

const TABS_EDITOR_INPUT = 'ltbTabsEditor';

const TAB_FIELD_TYPES = [
  'biginteger', 'blocks', 'boolean', 'component', 'date', 'datetime', 'decimal',
  'dynamiczone', 'email', 'enumeration', 'float', 'integer', 'json', 'media',
  'password', 'relation', 'richtext', 'string', 'text', 'time', 'uid',
];

export function registerTabsInContentTypeBuilder(app: any) {
  const forms = app.getPlugin('content-type-builder')?.apis?.forms;
  if (!forms) return;

  forms.components.add({ id: TABS_EDITOR_INPUT, component: TabsEditor });

  forms.addContentTypeSchemaMutation((nextSchema: unknown) => cleanContentTypeSchema(nextSchema));

  forms.extendContentType({
    validator: () => ({
      [TABS_PLUGIN_KEY]: yup.object().shape({
        tabs: yup.array().test('ltb-tabs', function (tabs) {
          const error = validateTabs(readTabs({ [TABS_PLUGIN_KEY]: { tabs } }));
          return error === null
            ? true
            : this.createError({ message: getTranslation(`tabs.ctb.error.${error}`) });
        }),
      }),
    }),
    form: {
      advanced: () => [
        {
          name: `pluginOptions.${TABS_PLUGIN_KEY}.tabs`,
          type: TABS_EDITOR_INPUT,
          size: 12,
          intlLabel: { id: getTranslation('tabs.ctb.content-type.label'), defaultMessage: 'Tabs' },
          description: {
            id: getTranslation('tabs.ctb.content-type.description'),
            defaultMessage: 'Organize the fields of this content type in tabs. Fields in a tab are returned by the REST API inside a property named after the tab.',
          },
        },
      ],
    },
  });

  forms.extendFields(TAB_FIELD_TYPES, {
    form: {
      advanced: ({ contentTypeSchema, forTarget }: any) => {
        if (forTarget !== 'contentType') return [];
        const tabs = readTabs(contentTypeSchema?.pluginOptions ?? contentTypeSchema?.schema?.pluginOptions);
        if (tabs.length === 0) return [];
        return [
          {
            name: `pluginOptions.${TABS_PLUGIN_KEY}.tab`,
            type: 'select',
            intlLabel: { id: getTranslation('tabs.ctb.field.label'), defaultMessage: 'Tab' },
            description: {
              id: getTranslation('tabs.ctb.field.description'),
              defaultMessage: 'Tab where this field is shown. Fields without a tab are always visible.',
            },
            options: [
              {
                key: '__null_reset_value__',
                value: '',
                metadatas: {
                  intlLabel: { id: getTranslation('tabs.ctb.field.none'), defaultMessage: 'None (always visible)' },
                },
              },
              ...tabs.map((tab) => ({
                key: tab.id,
                value: tab.id,
                metadatas: { intlLabel: { id: `${TABS_PLUGIN_KEY}.tab.${tab.id}`, defaultMessage: tab.name } },
              })),
            ],
          },
        ];
      },
    },
  });
}
```

- [ ] **Step 3: Registrar no `bootstrap` de `admin/src/index.ts` e adicionar as traduções**

`registerTabsInContentTypeBuilder(app);` depois do `addEditViewSidePanel`. Chaves em `en.json`:
- `tabs.ctb.content-type.label`, `tabs.ctb.content-type.description`
- `tabs.ctb.field.label`, `tabs.ctb.field.description`, `tabs.ctb.field.none`
- `tabs.ctb.add`, `tabs.ctb.remove`, `tabs.ctb.name.placeholder`, `tabs.ctb.key`, `tabs.ctb.key.empty`, `tabs.ctb.empty`
- `tabs.ctb.error.name.required`, `tabs.ctb.error.key.empty`, `tabs.ctb.error.key.duplicated`

- [ ] **Step 4: Checagem de tipos e build**

Run: `npm run test:ts:front && npm run build`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add admin/src/ctb admin/src/index.ts admin/src/core/translations/en.json
git commit -m "feat(admin): configure content type tabs in the content type builder"
```

### Task 5: Tela de edição (filtro do layout e barra de tabs)

**Files:**
- Create: `admin/src/editView/mutateEditViewLayout.ts`
- Create: `admin/src/editView/TabsBar.tsx`
- Modify: `admin/src/index.ts` (`addFields` no `register`, `registerHook` no `bootstrap`)
- Modify: `admin/src/core/translations/en.json`
- Test: `tests/admin/mutateEditViewLayout.test.ts`

**Interfaces:**
- Consumes: `readTabs`, `resolveActiveTab`, `splitLayoutByTab`, `mapFieldsToTabKeys`, `countErrorsByTab`, `isEditViewPath`, `toTabKey`, `TABS_QUERY_PARAM`, `TABS_BAR_FIELD_TYPE` (Task 3).
- Produces:
  - `mutateEditViewLayout(args: { layout: any; query?: Record<string, unknown> }, pathname?: string): typeof args`
  - Props extras do campo da barra: `ltbTabs: { id: string; name: string; key: string }[]`, `ltbActiveKey: string`, `ltbFieldTabKeys: Record<string, string>`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/admin/mutateEditViewLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mutateEditViewLayout } from '../../admin/src/editView/mutateEditViewLayout';

const KEY = 'littlebox-strapi-suite';
const EDIT = '/admin/content-manager/single-types/api::home.home';
const field = (name: string, tab?: string) => ({
  name,
  type: 'string',
  size: 6,
  visible: true,
  attribute: tab ? { type: 'string', pluginOptions: { [KEY]: { tab } } } : { type: 'string' },
});
const layout = {
  options: { [KEY]: { tabs: [{ id: 't1', name: 'Loja - Vitrine' }, { id: 't2', name: 'Contato' }] } },
  layout: [[[field('title'), field('banner', 't1')], [field('email', 't2')]]],
  components: {},
};

describe('mutateEditViewLayout', () => {
  it('não altera content types sem tabs', () => {
    const args = { layout: { ...layout, options: {} }, query: {} };
    expect(mutateEditViewLayout(args, EDIT)).toBe(args);
  });

  it('não altera fora da edit view', () => {
    const args = { layout, query: {} };
    expect(mutateEditViewLayout(args, `${EDIT}/configurations/edit`)).toBe(args);
  });

  it('monta raiz, barra e campos da tab ativa', () => {
    const result = mutateEditViewLayout({ layout, query: { ltbTab: 'contato' } }, EDIT);
    const [root, bar, tab] = result.layout.layout;
    expect(root).toEqual([[field('title')]]);
    expect(tab).toEqual([[field('email', 't2')]]);
    expect(bar[0][0]).toMatchObject({
      name: 'title',
      type: 'ltb-tabs-bar',
      size: 12,
      visible: true,
      ltbActiveKey: 'contato',
      ltbTabs: [
        { id: 't1', name: 'Loja - Vitrine', key: 'loja_vitrine' },
        { id: 't2', name: 'Contato', key: 'contato' },
      ],
      ltbFieldTabKeys: { banner: 'loja_vitrine', email: 'contato' },
    });
  });

  it('usa a primeira tab quando não há campos na raiz', () => {
    const onlyTabs = { ...layout, layout: [[[field('banner', 't1')], [field('email', 't2')]]] };
    const result = mutateEditViewLayout({ layout: onlyTabs, query: {} }, EDIT);
    const [bar, tab] = result.layout.layout;
    expect(bar[0][0]).toMatchObject({ name: 'banner', ltbActiveKey: 'loja_vitrine' });
    expect(tab).toEqual([[field('banner', 't1')]]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/admin/mutateEditViewLayout.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `admin/src/editView/mutateEditViewLayout.ts`**

```ts
import {
  TABS_BAR_FIELD_TYPE,
  TABS_QUERY_PARAM,
  LayoutPanel,
  readTabs,
  resolveActiveTab,
  splitLayoutByTab,
  mapFieldsToTabKeys,
  isEditViewPath,
  toTabKey,
} from '../core/utils/tabs';

type HookArgs = { layout: any; query?: Record<string, unknown>; [key: string]: unknown };

export function mutateEditViewLayout<T extends HookArgs>(
  args: T,
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : ''
): T {
  const tabs = readTabs(args.layout?.options);
  const panels: LayoutPanel[] = args.layout?.layout ?? [];
  if (tabs.length === 0 || !isEditViewPath(pathname)) return args;

  const active = resolveActiveTab(tabs, args.query?.[TABS_QUERY_PARAM])!;
  const { rootPanels, tabPanels } = splitLayoutByTab(panels, tabs, active.id);
  // The bar borrows the name of a real field so the content manager RBAC check lets it render.
  const anchor = rootPanels.flat(2)[0] ?? panels.flat(2)[0];
  if (!anchor) return args;

  const barField = {
    name: anchor.name,
    label: '',
    type: TABS_BAR_FIELD_TYPE,
    size: 12,
    visible: true,
    disabled: false,
    required: false,
    unique: false,
    hint: '',
    placeholder: '',
    attribute: { type: TABS_BAR_FIELD_TYPE },
    ltbTabs: tabs.map((tab) => ({ ...tab, key: toTabKey(tab.name) })),
    ltbActiveKey: toTabKey(active.name),
    ltbFieldTabKeys: mapFieldsToTabKeys(panels, tabs),
  };

  return {
    ...args,
    layout: { ...args.layout, layout: [...rootPanels, [[barField]], ...tabPanels] },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/admin/mutateEditViewLayout.test.ts`
Expected: PASS

- [ ] **Step 5: `admin/src/editView/TabsBar.tsx`**

Recebe as props do campo (`ltbTabs`, `ltbActiveKey`, `ltbFieldTabKeys`). Renderiza `Tabs.Root`/`Tabs.List`/`Tabs.Trigger` do `@strapi/design-system` com `Badge` de erros. Os erros vêm de `unstable_useContentManagerContext().form.errors`, contados com `countErrorsByTab`. Ao trocar de tab, chama `navigate({ pathname, search })` com `ltbTab` atualizado e `replace: true`, preservando os outros parâmetros. Um `useEffect` em `errors` muda para a primeira tab com erros quando a tab ativa não tem nenhum.

- [ ] **Step 6: Registrar em `admin/src/index.ts`**

- `register`: `app.addFields({ type: TABS_BAR_FIELD_TYPE, Component: TabsBar })`.
- `bootstrap`: `app.registerHook('Admin/CM/pages/EditView/mutate-edit-view-layout', (args: any) => mutateEditViewLayout(args))`.
- Traduções em `en.json`: `tabs.edit-view.label`, `tabs.edit-view.errors`.

- [ ] **Step 7: Testes, tipos e build**

Run: `npx vitest run && npm run test:ts:front && npm run build`
Expected: PASS, sem erros

- [ ] **Step 8: Commit**

```bash
git add admin/src/editView admin/src/index.ts admin/src/core/translations/en.json tests/admin/mutateEditViewLayout.test.ts
git commit -m "feat(admin): show content type tabs in the content manager edit view"
```

### Task 6: Validação manual e README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Validação manual no `backend-base` (Strapi 5.56) via yalc**

Run: `npm run build && npx yalc push` no plugin. No `backend-base`, rodar `npx yalc add @littlebox/strapi-suite && npm run develop`. Depois, verificar:
1. Criar tabs no content type (Advanced settings), reordenar e salvar. O `schema.json` deve ganhar o `pluginOptions`.
2. Associar campos às tabs pelo select e salvar.
3. Na tela de edição, trocar de tab, editar e salvar. Recarregar a página mantém a tab.
4. Deixar um campo obrigatório vazio numa tab oculta, salvar e conferir o badge e a troca automática de tab.
5. Abrir Configure the view e History e confirmar que todos os campos aparecem.
6. Chamar `GET /api/<single>` e `GET /api/<collection>`, `/:id`, com `populate=*` e com `fields[0]=title`.

- [ ] **Step 2: Documentar no README**

Seção "Content type tabs" com a configuração no CTB, o formato da API, a regra de conversão do nome e o aviso de que renomear uma tab muda a chave da API.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document content type tabs"
```
