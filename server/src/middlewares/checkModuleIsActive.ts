import { ECOMMERCE_MODULE, LtbConfigs, PLUGIN_ID } from '../config';
import { isEcommerceActive, NOT_FOUND_BODY } from './ecommerceModuleGate';

// Matches on the request path only (never the query string).
function getModuleName(path: string) {
  if (/\/ecommerce(\/|$)/.test(path)) return ECOMMERCE_MODULE;
  if (path.includes("/pages")) return 'slug';
  if (path.includes("/locales")) return 'locale';
  if (path.includes("/parameters")) return 'parameter';
  if (path.includes("/translations")) return 'translation';
  if (path.includes("/menus")) return 'menu';
  throw new Error("Module not found");
}

export default (config, { strapi }) => {
  return async (ctx, next) => {
    const path: string = ctx.request.path ?? String(ctx.request.url).split('?')[0];
    const module = getModuleName(path);
    if (module === ECOMMERCE_MODULE) {
      // A disabled store hides its endpoints: 404, as if the route did not exist.
      if (await isEcommerceActive(strapi)) return next();
      ctx.status = 404;
      ctx.body = NOT_FOUND_BODY;
      return;
    }
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
