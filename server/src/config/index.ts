import { UID } from "@strapi/strapi";
export const PLUGIN_ID = 'littlebox-strapi-suite';

export const SLUG_LANGUAGE_STRATEGY = "language";
export const SLUG_CONTENT_STRATEGY = "content";
export interface LtbConfigs { 
  pluginId: string;
  uuid: {
    app: {
      setting: UID.ContentType;
    },
    modules: {
      menu: {
        main: UID.ContentType;
        children: UID.ContentType;
      },
      attribute: UID.ContentType;
      template: UID.ContentType;
      parameter: UID.ContentType;
      slug: UID.ContentType;
      translation: UID.ContentType;
    },
    customFields: {
      slug: string;
    }
  }
} 
export default {
  default: {
    pluginId: PLUGIN_ID,
    uuid: {
      app: {
        setting: `plugin::${PLUGIN_ID}.ltb-st-app-setting`,
      },
      modules: {
        menu: {
          main: `plugin::${PLUGIN_ID}.ltb-st-module-menu-item`,
          children: `plugin::${PLUGIN_ID}.ltb-st-module-menu-children-item`,
        },
        attribute: `plugin::${PLUGIN_ID}.ltb-st-module-attribute-item`,
        template: `plugin::${PLUGIN_ID}.ltb-st-module-template-item`,
        parameter: `plugin::${PLUGIN_ID}.ltb-st-module-parameter-item`,
        slug: `plugin::${PLUGIN_ID}.ltb-st-module-slug-item`,
        translation: `plugin::${PLUGIN_ID}.ltb-st-module-translation-item`,
      },
      customFields: {
        slug: `plugin::${PLUGIN_ID}.ltbslug`
      }
    }
  },
  validator() {},
};
