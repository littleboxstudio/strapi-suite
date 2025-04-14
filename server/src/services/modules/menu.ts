import type { Core } from '@strapi/strapi';
import { PLUGIN_ID, LtbConfigs } from '../../config';
import { arrayToTree } from '../../utils/arrayToTree';
import { getSlugByDocumentId } from '../../utils/getSlugByDocumentId';

async function createMenus(params: {
  strapi: any,
  documentId: any,
  uid: string,
  items: any,
  parentId?: string
}) { 
  for (const item of params.items) {
    const document = await params.strapi.db.query(params.uid).create({
      data: {
        menuId: params.documentId,
        url: item.url,
        title: item.title,
        order: item.order,
        target: item.target,
        parentId: params.parentId || null,
        contentId: item.contentId || null,
        contentModel: item.contentModel || null,
        metadata: item.metadata || {}
      }
    });
    if (document && item.children) { 
      await createMenus({
        documentId: params.documentId,
        strapi: params.strapi,
        uid: params.uid,
        items: item.children,
        parentId: document.id
      });
    }
  }
}

const MenuModuleService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async adminGetAll() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) return [];
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const documents = await strapi.db.query(config.uuid.modules.menu.main).findMany({
      where: {
        locale: ctx.query.locale,
      },
      orderBy: {
        id: 'desc'
      }
    });
    return documents || [];
  },

  async adminGetByDocumentId() {
    const ctx = strapi.requestContext.get();
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const document = await strapi.db.query(config.uuid.modules.menu.main).findOne({
      where: {
        documentId: ctx.params.documentId
      }
    });
    if (document) {
      const children = await strapi.db.query(config.uuid.modules.menu.children).findMany({
        where: {
          menuId: ctx.params.documentId,
        },
        orderBy: {
          id: 'asc'
        }
      });
      document.children = children || [];
    }
    return document || {};
  },

  async adminCreate() {
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    await strapi.db.query(config.uuid.modules.menu.main).create({
      data: {
        uid: body.uid,
        title: body.title,
        locale: body.locale
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
    await strapi.db.query(config.uuid.modules.menu.main).deleteMany({
      where: {
        documentId: body.documentIds
      }
    });
    await strapi.db.query(config.uuid.modules.menu.children).deleteMany({
      where: {
        menuId: body.documentIds
      }
    });
    ctx.status = 204;
    return;
  },

  async adminEdit() { 
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const document = await strapi.db.query(config.uuid.modules.menu.main).findOne({
      where: {
        documentId: ctx.params.documentId
      }
    });
    if (document) {
      await strapi.db.query(config.uuid.modules.menu.main).update({
        where: {
          documentId: ctx.params.documentId,
        },
        data: {
          uid: body.uid || document.uid,
          title: body.title || document.title
        }
      });
      await strapi.db.query(config.uuid.modules.menu.children).deleteMany({
        where: {
          menuId: ctx.params.documentId
        }
      });
      if (body.children) {
        await createMenus({
          strapi,
          documentId: ctx.params.documentId,
          uid: config.uuid.modules.menu.children,
          items: body.children
        });
      }
    }
    ctx.status = 204;
    return;
  },

  async adminDuplicate() { 
    const ctx = strapi.requestContext.get();
    const body = ctx.request.body;
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const currentDocument = await strapi.db.query(config.uuid.modules.menu.main).findOne({
      where: {
        documentId: body.documentId
      }
    });
    if (currentDocument) { 
      const documentExist = await strapi.db.query(config.uuid.modules.menu.main).findOne({
        where: {
          uid: currentDocument.uid,
          locale: body.locale
        },
      });
      const uid = documentExist
        ? `${currentDocument.uid}-${Date.now()}`
        : currentDocument.uid;
      const duplicatedDocument = await strapi.db.query(config.uuid.modules.menu.main).create({
        data: {
          uid,
          title: currentDocument.title,
          locale: body.locale
        }
      });
      if (duplicatedDocument) { 
        const currentChildren = await strapi.db.query(config.uuid.modules.menu.children).findMany({
          where: {
            menuId: body.documentId,
          },
        });
        if (currentChildren && currentChildren.length > 0) { 
          const items = arrayToTree(currentChildren);
          await createMenus({
            strapi,
            documentId: duplicatedDocument.documentId,
            uid: config.uuid.modules.menu.children,
            items
          });
        }
      }
    }
    ctx.status = 204;
    return;
  },

  async getMenus() {
    const ctx = strapi.requestContext.get();
    if (!ctx.query.locale) { 
      ctx.status = 400;
      return;
    }
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module: 'slug',
        property: 'showDefaultLanguage'
      } 
    });
    const showDefaultLanguage = setting.value === "true";
    const documents = await strapi.db.query(config.uuid.modules.menu.main).findMany({
      where: {
        locale: ctx.query.locale,
      }
    });
    for (const document of documents) { 
      const children = await strapi.db.query(config.uuid.modules.menu.children).findMany({
        where: {
          menuId: document.documentId,
        },
        orderBy: {
          order: 'asc'
        }
      });
      for (const child of children) {
        if (child.contentId) { 
          const locale = ctx.query.locale as string;
          const content = await strapi.db.query(config.uuid.modules.slug).findOne({
            where: {
              locale,
              contentId: child.contentId,
              contentModel: child.contentModel
            }
          });
          if (content) { 
            child.url = await getSlugByDocumentId({
              contentId: child.contentId,
              defaultLocale,
              showDefaultLanguage,
              locale,
              strapi
            });
          }
        }
        delete child.locale;
        delete child.contentId;
        delete child.contentModel;
      }
      document.children = children && children.length > 0
        ? arrayToTree(children)
        : [];
    }
    return documents || [];
  },
});

export default MenuModuleService;