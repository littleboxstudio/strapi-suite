import type { SchemaLookup } from '../../../server/src/services/modules/duplicate/domain/scope';

const L = { i18n: { localized: true } };
const NL = { i18n: { localized: false } };

export const SLUG_FIELD = 'plugin::littlebox-strapi-suite.ltbslug';

export const contentTypes: Record<string, any> = {
  'api::page.page': {
    kind: 'collectionType',
    options: { draftAndPublish: true },
    pluginOptions: L,
    attributes: {
      title: { type: 'string', pluginOptions: L },
      slug: { type: 'string', customField: SLUG_FIELD, pluginOptions: L },
      code: { type: 'string', pluginOptions: NL },
      body: { type: 'blocks', pluginOptions: L },
      link: { type: 'string', pluginOptions: L },
      image: { type: 'json', customField: 'plugin::littlebox-strapi-suite.ltbimage', pluginOptions: L },
      cover: { type: 'media', multiple: false, pluginOptions: L },
      gallery: { type: 'media', multiple: true, pluginOptions: L },
      author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author', inversedBy: 'pages' },
      tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag.tag' },
      related: { type: 'relation', relation: 'oneToMany', target: 'api::page.page' },
      seo: { type: 'component', component: 'shared.seo', repeatable: false, pluginOptions: L },
      ctas: { type: 'component', component: 'shared.cta', repeatable: true, pluginOptions: L },
      blocks: { type: 'dynamiczone', components: ['shared.cta', 'shared.text'], pluginOptions: L },
      shared: { type: 'component', component: 'shared.seo', repeatable: false, pluginOptions: NL },
      createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
      updatedBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
    },
  },
  'api::author.author': {
    kind: 'collectionType',
    options: { draftAndPublish: false },
    pluginOptions: L,
    attributes: {
      name: { type: 'string', pluginOptions: L },
      handle: { type: 'uid', targetField: 'name' },
      pages: { type: 'relation', relation: 'oneToMany', target: 'api::page.page', mappedBy: 'author' },
    },
  },
  'api::tag.tag': {
    kind: 'collectionType',
    options: { draftAndPublish: true },
    attributes: { name: { type: 'string' } },
  },
  'api::home.home': {
    kind: 'singleType',
    options: { draftAndPublish: true },
    pluginOptions: L,
    attributes: { headline: { type: 'text', pluginOptions: L } },
  },
  'api::plain.plain': {
    kind: 'collectionType',
    options: {},
    pluginOptions: NL,
    attributes: { name: { type: 'string' } },
  },
  'plugin::littlebox-strapi-suite.ltb-st-module-slug-item': {
    kind: 'collectionType',
    options: {},
    pluginOptions: L,
    attributes: {},
  },
  'plugin::users-permissions.user': { kind: 'collectionType', options: {}, attributes: {} },
};

export const components: Record<string, any> = {
  'shared.seo': {
    attributes: {
      metaTitle: { type: 'string' },
      metaDescription: { type: 'text' },
      page: { type: 'relation', relation: 'oneToOne', target: 'api::page.page' },
      tag: { type: 'relation', relation: 'oneToOne', target: 'api::tag.tag' },
    },
  },
  'shared.cta': {
    attributes: {
      label: { type: 'string' },
      url: { type: 'string' },
      page: { type: 'relation', relation: 'oneToOne', target: 'api::page.page' },
      icon: { type: 'media', multiple: false },
      inner: { type: 'component', component: 'shared.leaf', repeatable: false },
    },
  },
  'shared.leaf': { attributes: { note: { type: 'richtext' } } },
  'shared.text': { attributes: { content: { type: 'richtext' }, handle: { type: 'uid' } } },
};

export const lookup: SchemaLookup = {
  contentType: (uid) => contentTypes[uid],
  component: (uid) => components[uid],
};
