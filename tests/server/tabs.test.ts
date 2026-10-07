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
      'id',
      'documentId',
      'title',
      'orphan',
      'loja_vitrine',
      'contato',
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

describe('buildTabGroups — chave igual a qualquer atributo', () => {
  it('não agrupa a tab e não perde o valor do campo que ficou na raiz', () => {
    const attrs = {
      hero: { type: 'string' },
      cta_text: { type: 'string', pluginOptions: { [KEY]: { tab: 'h' } } },
      other: { type: 'string', pluginOptions: { [KEY]: { tab: 'c' } } },
    };
    const groups = buildTabGroups(
      [
        { id: 'h', name: 'Hero' },
        { id: 'c', name: 'CTA Text' },
      ],
      attrs
    );
    expect(groups).toEqual([]);
    expect(groupEntryByTabs({ id: 1, hero: 'H', cta_text: 'C', other: 'O' }, groups)).toEqual({
      id: 1,
      hero: 'H',
      cta_text: 'C',
      other: 'O',
    });
  });
});
