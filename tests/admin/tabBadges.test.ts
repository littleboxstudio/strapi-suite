// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildFieldTabNames,
  syncTabBadges,
  ctbContentTypeUid,
} from '../../admin/src/ctb/tabBadges';

const KEY = 'littlebox-strapi-suite';
const contentType = {
  pluginOptions: {
    [KEY]: {
      tabs: [
        { id: 't1', name: 'Teste 1' },
        { id: 't2', name: 'Teste 2' },
      ],
    },
  },
  attributes: [
    { name: 'title', type: 'string' },
    { name: 'capitulo', type: 'string', pluginOptions: { [KEY]: { tab: 't1' } } },
    { name: 'autor', type: 'string', pluginOptions: { [KEY]: { tab: 't2' } } },
    { name: 'orphan', type: 'string', pluginOptions: { [KEY]: { tab: 'gone' } } },
  ],
};

describe('buildFieldTabNames', () => {
  it('mapeia cada campo com tab válida para o nome da tab', () => {
    expect(buildFieldTabNames(contentType)).toEqual({ capitulo: 'Teste 1', autor: 'Teste 2' });
  });
  it('aceita attributes como objeto e content types sem tabs', () => {
    expect(
      buildFieldTabNames({
        pluginOptions: contentType.pluginOptions,
        attributes: { capitulo: { pluginOptions: { [KEY]: { tab: 't1' } } } },
      })
    ).toEqual({ capitulo: 'Teste 1' });
    expect(buildFieldTabNames({ attributes: [] })).toEqual({});
    expect(buildFieldTabNames(undefined)).toEqual({});
  });
});

describe('ctbContentTypeUid', () => {
  it('extrai o uid da URL do content type builder', () => {
    expect(
      ctbContentTypeUid('/admin/plugins/content-type-builder/content-types/api::page.page')
    ).toBe('api::page.page');
    expect(
      ctbContentTypeUid('/admin/plugins/content-type-builder/component-categories/a/b')
    ).toBeNull();
    expect(ctbContentTypeUid('/admin/content-manager/single-types/api::home.home')).toBeNull();
  });
});

function row(name: string, nested = '') {
  return `<li aria-label="${name}"><div><div><span>${name}<span>* </span></span></div><span>Text</span></div>${nested}</li>`;
}

describe('syncTabBadges', () => {
  beforeEach(() => {
    document.body.innerHTML = `<ul>${row('title')}${row('capitulo')}${row(
      'autor',
      `<ul>${row('capitulo')}</ul>`
    )}</ul>`;
  });

  const badges = () =>
    Array.from(document.querySelectorAll('[data-ltb-tab-badge]')).map((badge) => [
      badge.closest('li')!.getAttribute('aria-label'),
      badge.textContent,
    ]);

  it('adiciona o badge depois do nome só nos campos de primeiro nível com tab', () => {
    syncTabBadges(document.body, { capitulo: 'Teste 1', autor: 'Teste 2' });
    expect(badges()).toEqual([
      ['capitulo', 'Teste 1'],
      ['autor', 'Teste 2'],
    ]);
    const nameEl = document.querySelector('li[aria-label="capitulo"] span')!;
    expect(nameEl.nextElementSibling?.hasAttribute('data-ltb-tab-badge')).toBe(true);
  });

  it('não duplica, atualiza e remove badges', () => {
    syncTabBadges(document.body, { capitulo: 'Teste 1', autor: 'Teste 2' });
    syncTabBadges(document.body, { capitulo: 'Teste 1', autor: 'Teste 2' });
    expect(badges()).toHaveLength(2);
    syncTabBadges(document.body, { capitulo: 'Outra' });
    expect(badges()).toEqual([['capitulo', 'Outra']]);
  });
});

describe('startTabBadges', () => {
  it('lê o store do app quando ele fica disponível depois do start', async () => {
    const { startTabBadges } = await import('../../admin/src/ctb/tabBadges');
    window.history.replaceState(null, '', '/admin/plugins/content-type-builder/content-types/api::page.page');
    const app: any = {};
    startTabBadges(app);
    app.store = {
      subscribe: () => () => {},
      getState: () => ({
        'content-type-builder_dataManagerProvider': { current: { contentTypes: { 'api::page.page': contentType } } },
      }),
    };
    document.body.innerHTML = `<ul>${row('capitulo')}</ul>`;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('[data-ltb-tab-badge]')?.textContent).toBe('Teste 1');
  });
});
