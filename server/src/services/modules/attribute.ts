import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';

async function fetchAdditionalData(params: {
  strapi: any;
  record: any;
  locale: string;
  config: LtbConfigs;
}) {
  const content = await params.strapi.documents(params.record.contentModel).findOne({
    status: 'published',
    documentId: params.record.contentId,
    locale: params.locale,
  });
  if (content) {
    params.record.contentTitle =
      content.title || `${content.documentId} | ${params.record.contentModel}`;
  }
  if (params.record.parentContentModel) {
    const parent = await params.strapi.documents(params.record.parentContentModel).findOne({
      status: 'published',
      documentId: params.record.parentContentId,
      locale: params.locale,
    });
    if (parent) {
      params.record.parentContentTitle =
        parent.title || `${parent.documentId} | ${params.record.parentContentModel}`;
    }
  }
  if (params.record.templateId) {
    const template = await params.strapi.documents(params.config.uuid.modules.template).findOne({
      documentId: params.record.templateId,
    });
    if (template) {
      params.record.templateTitle = template.name;
    }
  }
}

const AttributeModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return [];
    const locale = ctx.query.locale as string;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const records = await strapi.db.query(config.uuid.modules.attribute).findMany({
      where: {
        locale: ctx.query.locale,
        state: 'published',
      },
      orderBy: {
        id: 'desc',
      },
    });
    const publishedResults = [];
    for (const record of records) {
      await fetchAdditionalData({ strapi, record, locale, config });
      publishedResults.push(record);
    }
    return publishedResults || [];
  },

  async adminGetByContentId() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return {};
    if (!ctx.query.state) return {};
    const locale = ctx.query.locale as string;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const record = await strapi.documents(config.uuid.modules.attribute).findFirst({
      filters: {
        contentId: ctx.params.contentId,
        locale: ctx.query.locale,
        state: ctx.query.state,
      },
    });
    if (record) {
      await fetchAdditionalData({ strapi, record, locale, config });
    }
    return record || {};
  },

  async adminBulkDelete() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return;
    const body = ctx.request.body;
    if (!body.contentIds) return;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.slug).updateMany({
      where: {
        contentId: body.contentIds,
        locale: ctx.query.locale,
      },
      data: {
        parentContentModel: null,
        parentContentId: null,
      },
    });
    await strapi.db.query(config.uuid.modules.attribute).deleteMany({
      where: {
        contentId: body.contentIds,
        locale: ctx.query.locale,
      },
    });
    ctx.status = 204;
    return;
  },
});

export default AttributeModuleService;
