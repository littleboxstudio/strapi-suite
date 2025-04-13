import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';

const ParameterModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.parameter).findMany({
      orderBy: {
        id: 'desc'
      }
    });
    return documents || [];
  },

  async adminCreate() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.parameter).create({
      data: {
        uid: body.uid,
        value: body.value,
        private: body.private,
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
    await strapi.db.query(config.uuid.modules.parameter).deleteMany({
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
    const document = await strapi.db.query(config.uuid.modules.parameter).findOne({
      where: {
        documentId: ctx.params.documentId
      }
    });
    if (document) {
      await strapi.db.query(config.uuid.modules.parameter).update({
        where: {
          documentId: ctx.params.documentId,
        },
        data: {
          uid: body.uid,
          value: body.value,
          private: body.private
        }
      });
    }
    ctx.status = 204;
    return;
  },

  async getParameters() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.parameter).findMany({
      select: ['uid', 'value'],
      where: {
        private: false,
      },
      orderBy: {
        id: 'desc'
      }
    });
    return documents || [];
  },
});

export default ParameterModuleService;