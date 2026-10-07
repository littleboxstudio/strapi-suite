import { describe, it, expect } from 'vitest';
import merge from 'lodash/merge';
import {
  toTabKey,
  generateTabId,
  validateTabs,
  cleanContentTypeSchema,
  padTabs,
  readTabs,
  resolveActiveTab,
  groupLayoutByTabs,
  findAnchorName,
  readTabFromHash,
  tabHash,
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
    expect(
      validateTabs([
        { id: 'a', name: 'Contato' },
        { id: 'b', name: 'contato' },
      ])
    ).toBe('key.duplicated');
  });
});

describe('cleanContentTypeSchema', () => {
  it('não altera schemas sem configuração de tabs', () => {
    const schema = {
      pluginOptions: { i18n: { localized: true } },
      attributes: [{ name: 'title', type: 'string' }],
    };
    expect(cleanContentTypeSchema(schema)).toBe(schema);
  });

  it('remove referências a tabs inexistentes e tab vazia (attributes em array)', () => {
    const schema = {
      pluginOptions: { [KEY]: { tabs: [tabs[0]] } },
      attributes: [
        { name: 'a', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
        {
          name: 'b',
          type: 'string',
          pluginOptions: { [KEY]: { tab: 'gone' }, i18n: { localized: true } },
        },
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

  it('descarta as tabs removidas (null) e libera os campos delas', () => {
    const schema = {
      pluginOptions: { [KEY]: { tabs: [tabs[1], null] } },
      attributes: [
        { name: 'a', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
        { name: 'b', type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
      ],
    };
    expect(cleanContentTypeSchema(schema)).toEqual({
      pluginOptions: { [KEY]: { tabs: [tabs[1]] } },
      attributes: [
        { name: 'a', type: 'string', pluginOptions: {} },
        { name: 'b', type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
      ],
    });
  });

  it('remove a configuração quando todas as tabs foram removidas', () => {
    const schema = {
      pluginOptions: { [KEY]: { tabs: [null, null] } },
      attributes: [{ name: 'a', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } }],
    };
    expect(cleanContentTypeSchema(schema)).toEqual({
      pluginOptions: {},
      attributes: [{ name: 'a', type: 'string', pluginOptions: {} }],
    });
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

describe('padTabs', () => {
  it('completa com null até o tamanho anterior para sobrescrever tabs removidas', () => {
    expect(padTabs([tabs[1]], tabs)).toEqual([tabs[1], null]);
    expect(padTabs([], [tabs[0], null])).toEqual([null, null]);
    expect(padTabs(tabs, undefined)).toEqual(tabs);
  });

  it('remove a tab mesmo quando o builder aplica o valor com lodash merge', () => {
    const state = { pluginOptions: { [KEY]: { tabs: structuredClone(tabs) } } };
    merge(state, { pluginOptions: { [KEY]: { tabs: padTabs([tabs[1]], tabs) } } });
    expect(readTabs(state.pluginOptions)).toEqual([tabs[1]]);
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

describe('groupLayoutByTabs', () => {
  const panels = [
    [[field('title'), field('banner', 't1')], [field('email', 't2')]],
    [[field('orphan', 'gone')]],
    [[field('produtos', 't1')]],
  ];

  it('separa campos sem tab e uma seção por tab, na ordem das tabs', () => {
    expect(groupLayoutByTabs(panels, tabs)).toEqual({
      rootPanels: [[[field('title')]], [[field('orphan', 'gone')]]],
      sections: [
        { tab: tabs[0], panels: [[[field('banner', 't1')]], [[field('produtos', 't1')]]] },
        { tab: tabs[1], panels: [[[field('email', 't2')]]] },
      ],
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

describe('findAnchorName', () => {
  const components = {
    'a.b': {
      layout: [
        [{ name: 'inner', type: 'component', attribute: { type: 'component', component: 'c.d' } }],
      ],
    },
    'c.d': { layout: [[{ name: 'leaf', type: 'string', attribute: { type: 'string' } }]] },
  };
  const comp = (name: string) => ({
    name,
    type: 'component',
    attribute: { type: 'component', component: 'a.b' },
  });

  it('prefere o primeiro campo que não é componente', () => {
    expect(findAnchorName([[[comp('hero'), field('title')]]], components)).toBe('title');
  });
  it('desce até uma folha de componente', () => {
    expect(findAnchorName([[[comp('hero')]]], components)).toBe('hero.inner.leaf');
  });
  it('devolve null quando não há campos', () => {
    expect(findAnchorName([], components)).toBeNull();
  });
});

describe('readTabFromHash / tabHash', () => {
  it('lê e escreve a tab ativa no hash', () => {
    expect(readTabFromHash('#ltbTab=contato')).toBe('contato');
    expect(readTabFromHash('')).toBeNull();
    expect(readTabFromHash('#outra=1')).toBeNull();
    expect(tabHash('loja_vitrine')).toBe('#ltbTab=loja_vitrine');
  });
});

describe('countErrorsByTab', () => {
  it('conta os erros de primeiro nível por tab', () => {
    const errors = {
      banner: 'required',
      email: 'invalid',
      title: 'required',
      produtos: { 0: 'x' },
    };
    expect(
      countErrorsByTab(errors, {
        banner: 'loja_vitrine',
        email: 'contato',
        produtos: 'loja_vitrine',
      })
    ).toEqual({
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

describe('getConflictingTabIds', () => {
  it('aponta tabs cuja chave é igual a um atributo ou chave de sistema', async () => {
    const { getConflictingTabIds } = await import('../../admin/src/core/utils/tabs');
    const list = [
      { id: 'a', name: 'Hero' },
      { id: 'b', name: 'Contato' },
      { id: 'c', name: 'ID' },
    ];
    expect(getConflictingTabIds(list, [{ name: 'hero' }, { name: 'email' }])).toEqual(
      new Set(['a', 'c'])
    );
    expect(getConflictingTabIds(list, { hero: {}, email: {} })).toEqual(new Set(['a', 'c']));
    expect(getConflictingTabIds(list, undefined)).toEqual(new Set(['c']));
  });
});

describe('pickInitialTab', () => {
  it('usa o hash, depois a tab atual, depois a primeira', async () => {
    const { pickInitialTab } = await import('../../admin/src/core/utils/tabs');
    const keys = ['loja_vitrine', 'contato'];
    expect(pickInitialTab(keys, 'contato', 'loja_vitrine')).toBe('contato');
    expect(pickInitialTab(keys, 'removida', 'contato')).toBe('contato');
    expect(pickInitialTab(keys, null, 'de_outro_documento')).toBe('loja_vitrine');
    expect(pickInitialTab([], null, null)).toBeNull();
  });
});
