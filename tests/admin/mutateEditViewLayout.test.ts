import { describe, it, expect } from 'vitest';
import { mutateEditViewLayout } from '../../admin/src/editView/mutateEditViewLayout';

const KEY = 'littlebox-strapi-suite';
const EDIT = '/admin/content-manager/single-types/api::home.home';
const field = (
  name: string,
  tab?: string,
  type = 'string',
  extra: Record<string, unknown> = {}
) => ({
  name,
  type,
  size: 6,
  visible: true,
  attribute: tab ? { type, ...extra, pluginOptions: { [KEY]: { tab } } } : { type, ...extra },
});
const tabs = [
  { id: 't1', name: 'Loja - Vitrine' },
  { id: 't2', name: 'Contato' },
];
const layout = {
  options: { [KEY]: { tabs } },
  layout: [
    [[field('title'), field('banner', 't1')], [field('email', 't2')]],
    [[field('blocks', 't1', 'dynamiczone')]],
  ],
  components: {},
};

const summarize = (panels: any[]) =>
  panels.map((panel) =>
    panel
      .flat()
      .map((f: any) => (f.ltbTabKey ? `section:${f.ltbTabKey}` : `${f.type}:${f.name}`))
      .join(',')
  );

describe('mutateEditViewLayout', () => {
  it('não altera content types sem tabs', () => {
    const args = { layout: { ...layout, options: {} } };
    expect(mutateEditViewLayout(args, EDIT)).toBe(args);
  });

  it('não altera fora da edit view', () => {
    const args = { layout };
    expect(mutateEditViewLayout(args, `${EDIT}/configurations/edit`)).toBe(args);
  });

  it('mantém todos os campos: raiz, barra e uma seção por tab antes dos seus painéis', () => {
    // Called without `query`, as it is when i18n's hook runs first.
    const panels = mutateEditViewLayout({ layout }, EDIT).layout.layout;
    expect(summarize(panels)).toEqual([
      'string:title',
      'ltb-tabs-bar:title',
      'section:loja_vitrine',
      'string:banner',
      'dynamiczone:blocks',
      'section:contato',
      'string:email',
    ]);
  });

  it('passa à barra as tabs e o mapa de campos por tab', () => {
    const bar = mutateEditViewLayout({ layout }, EDIT).layout.layout[1][0][0];
    expect(bar).toMatchObject({
      size: 12,
      visible: true,
      ltbTabs: [
        { id: 't1', name: 'Loja - Vitrine', key: 'loja_vitrine' },
        { id: 't2', name: 'Contato', key: 'contato' },
      ],
      ltbFieldTabKeys: { banner: 'loja_vitrine', email: 'contato', blocks: 'loja_vitrine' },
    });
  });

  it('usa um campo folha de componente como âncora quando só há componentes', () => {
    const onlyComponents = {
      options: { [KEY]: { tabs } },
      layout: [[[field('hero', 't1', 'component', { component: 'sections.hero' })]]],
      components: {
        'sections.hero': {
          layout: [
            [
              {
                name: 'cta',
                type: 'component',
                attribute: { type: 'component', component: 'shared.cta' },
              },
            ],
          ],
        },
        'shared.cta': {
          layout: [[{ name: 'label', type: 'string', attribute: { type: 'string' } }]],
        },
      },
    };
    const panels = mutateEditViewLayout({ layout: onlyComponents }, EDIT).layout.layout;
    expect(panels[0][0][0]).toMatchObject({ type: 'ltb-tabs-bar', name: 'hero.cta.label' });
    expect(panels[1][0][0]).toMatchObject({ name: 'hero.cta.label', ltbTabKey: 'loja_vitrine' });
  });

  it('prefere um campo que não seja componente como âncora', () => {
    const mixed = {
      ...layout,
      layout: [[[field('hero', 't1', 'component', { component: 'x.y' }), field('email', 't2')]]],
      components: {
        'x.y': { layout: [[{ name: 'a', type: 'string', attribute: { type: 'string' } }]] },
      },
    };
    expect(mutateEditViewLayout({ layout: mixed }, EDIT).layout.layout[0][0][0].name).toBe('email');
  });
});
