import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';

const TemplateModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getAll() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const data = await strapi.db.query(config.uuid.modules.template).findMany({});
    return data || [];
  },

  async adminCreate() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.template).create({
      data: {
        uid: body.uid,
        name: body.name
      }
    });
    ctx.status = 201;
    return;
  }, 

  async adminBulkDelete() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    if (!body.documentIds) return;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.attribute).updateMany({
      where: {
        templateId: body.documentIds
      },
      data: {
        templateId: null
      }
    });
    await strapi.db.query(config.uuid.modules.template).deleteMany({
      where: {
        documentId: body.documentIds
      }
    });
    ctx.status = 204;
    return;
  },

  async adminEdit() { 
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const document = await strapi.db.query(config.uuid.modules.template).findOne({
      where: {
        documentId: ctx.params.documentId
      }
    });
    if (document) {
      await strapi.db.query(config.uuid.modules.template).update({
        where: {
          documentId: ctx.params.documentId,
        },
        data: {
          uid: body.uid,
          name: body.name
        }
      });
    }
    ctx.status = 204;
    return;
  }
});

export default TemplateModuleService;