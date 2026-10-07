// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applySectionVisibility } from '../../admin/src/editView/sectionVisibility';

function panel(inner = '') {
  return `<div class="panel"><div class="row">${inner}</div></div>`;
}

describe('applySectionVisibility', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<main><div id="form">${[
      panel('root'),
      panel('<div data-ltb-tabs-bar></div>'),
      panel('<span data-ltb-tab-section="a"></span>'),
      panel('a1'),
      panel('a2'),
      panel('<span data-ltb-tab-section="b"></span>'),
      panel('b1'),
    ].join('')}</div></main>`;
    container = document.getElementById('form')!;
  });

  const panels = () => Array.from(container.children) as HTMLElement[];
  const marker = (key: string) =>
    container.querySelector(`[data-ltb-tab-section="${key}"]`) as HTMLElement;

  it('esconde o painel da seção e os painéis da tab inativa até a próxima seção, devolvendo o container', () => {
    expect(applySectionVisibility(marker('a'), false)).toBe(container);
    expect(panels().map((p) => p.style.display)).toEqual(['', '', 'none', 'none', 'none', '', '']);
  });

  it('mostra os painéis da tab ativa, mantendo o painel da seção escondido', () => {
    applySectionVisibility(marker('a'), false);
    applySectionVisibility(marker('a'), true);
    applySectionVisibility(marker('b'), false);
    expect(panels().map((p) => p.style.display)).toEqual(['', '', 'none', '', '', 'none', 'none']);
  });

  it('devolve null e não esconde nada quando a barra não existe', () => {
    container.querySelector('[data-ltb-tabs-bar]')!.remove();
    expect(applySectionVisibility(marker('a'), false)).toBeNull();
    expect(panels().every((p) => p.style.display === '')).toBe(true);
  });
});
