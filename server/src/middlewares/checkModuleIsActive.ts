import { LtbConfigs, PLUGIN_ID } from '../config';

function getModuleName(url: string) { 
  if (url.includes("/pages")) return 'slug';
  if (url.includes("/locales")) return 'locale';
  if (url.includes("/parameters")) return 'parameter';
  if (url.includes("/translations")) return 'translation';
  if (url.includes("/menus")) return 'menu';
  throw new Error("Module not found");
}

export default (config, { strapi }) => { 
  return async (ctx, next) => { 
    const module = getModuleName(ctx.request.url);
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module,
        property: 'active'
      } 
    });
    const isActive = setting.value === "true";
    if (!isActive) { 
      return ctx.forbidden('Module is not active');
    }
    return next();
  }
}