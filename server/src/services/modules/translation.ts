import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';

export interface TranslationItem {
  id: number;
  uid: string;
  translations: Record<string, string>;
}

function groupByUid(items: any[]): TranslationItem[] {
  const groupedMap = items.reduce<Record<string, TranslationItem>>((acc, item) => {
    if (acc[item.uid]) {
      acc[item.uid].translations[item.locale] = item.translation;
    } else {
      acc[item.uid] = {
        id: item.id,
        uid: item.uid,
        translations: {
          [item.locale]: item.translation,
        },
      };
    }
    return acc;
  }, {});
  return Object.values(groupedMap);
}

const TranslationModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.translation).findMany({
      orderBy: {
        translation: 'asc'
      }
    });
    return documents || [];
  },

  async adminCreate() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.translation).createMany({
      data: body
    });
    ctx.status = 201;
    return;
  }, 

  async adminBulkDelete() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    if (!body.uids) return;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.translation).deleteMany({
      where: {
        uid: body.uids
      }
    });
    ctx.status = 204;
    return;
  },

  async adminEdit() { 
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.translation).deleteMany({
      where: {
        uid: ctx.params.uid
      }
    });
    await strapi.db.query(config.uuid.modules.translation).createMany({
      data: body
    });
    ctx.status = 204;
    return;
  },

  async getTranslations() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.translation).findMany({
      select: ['id', 'uid', 'translation', 'locale'],
      orderBy: {
        translation: 'asc'
      }
    });
    return documents ? groupByUid(documents) : [];
  },
});

export default TranslationModuleService;