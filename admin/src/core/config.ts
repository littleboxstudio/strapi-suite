import { PLUGIN_ID } from '../pluginId';

export const SLUG_LANGUAGE_STRATEGY = "language";
export const SLUG_CONTENT_STRATEGY = "content";

export default {
  pluginId: PLUGIN_ID,
  uuid: {
    modules: {
      menu: 'menu',
      attribute: 'attribute',
      parameter: 'parameter',
      slug: 'slug',
      translation: 'translation',
      template: 'template'
    }
  }
}