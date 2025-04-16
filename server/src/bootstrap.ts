import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from './config';
import {
  BeforeCreateSlug,
  BeforeUpdateSlug,
  AfterCreateSlug,
  AfterUpdateSlug,
  AfterFindOneSlug,
  AfterFindManySlug,
  AfterDeleteSlug,
  AfterUnpublishSlug
} from './lifecycles';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
  
  try {
    await strapi.db.query(config.uuid.app.setting).createMany({
      data: [
        {
          module: "menu",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "attribute",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "parameter",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "translation",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "slug",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "slug",
          property: 'showDefaultLanguage',
          type: 'boolean',
          value: 'false',
        },
        {
          module: "slug",
          property: 'homepageContentId',
          type: 'string',
          value: null,
        },
        {
          module: "slug",
          property: 'homepageContentModel',
          type: 'string',
          value: null,
        },
        {
          module: "slug",
          property: 'homepageSlugStrategy',
          type: 'string',
          value: 'language',
        },
        {
          module: "template",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
        {
          module: "locale",
          property: 'active',
          type: 'boolean',
          value: 'true',
        },
      ],
    });
  } catch (e) { }

  try {
    await strapi.db.query(config.uuid.modules.template).createMany({
      data: [
        {
          uid: "default",
          name: 'Default'
        }
      ],
    });
  } catch (e) { }

  strapi.documents.use(async (ctx, next) => {
    if (ctx.action === "unpublish") { 
      await AfterUnpublishSlug(ctx);
    }
    if (ctx.action === "delete") { 
      await AfterDeleteSlug(ctx);
    }
    return next();
  });
  
  strapi.db.lifecycles.subscribe({
    async beforeCreate(event: any) {
      await BeforeCreateSlug(event);
    },
    async afterCreate(event: any) {
      await AfterCreateSlug(event);
    },
    async beforeUpdate(event: any) {
      await BeforeUpdateSlug(event);
    },
    async afterUpdate(event: any) { 
      await AfterUpdateSlug(event);
    },
    async afterFindOne(event: any) { 
      await AfterFindOneSlug(event);
    },
    async afterFindMany(event: any) { 
      await AfterFindManySlug(event);
    }
  });
};

export default bootstrap;