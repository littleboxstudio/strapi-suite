import type { Core } from '@strapi/strapi';
import { Context } from 'koa';
import { PLUGIN_ID, LtbConfigs } from '../../config';

function parseSettings(data: any): any { 
  const typeParsers = {
    boolean: (value: string) => value === "true",
    number: (value: string) => Number(value),
    string: (value: string) => value,
    date: (value: string) => new Date(value)
  };
  const groupedByModule = data.reduce((acc, item) => {
    const parser = typeParsers[item.type as keyof typeof typeParsers] || ((v: string) => v);
    const convertedValue = parser(item.value);
    let moduleObject = acc.find(obj => obj.module === item.module);
    if (!moduleObject) {
      moduleObject = { module: item.module, settings: {} };
      acc.push(moduleObject);
    }
    moduleObject.settings[item.property] = convertedValue;
    return acc;
  }, [] as { module: string, properties: Record<string, any> }[]);
  return groupedByModule;
}

const SettingAppService = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getAll() {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const settings = await strapi.db.query(config.uuid.app.setting).findMany({});
    const parsedSettings = parseSettings(settings);
    return parsedSettings || {};
  },

  async update(ctx: Context) { 
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module: ctx.request.body.module,
        property: ctx.request.body.property
      } 
    });
    return await strapi.documents(config.uuid.app.setting).update({ 
      documentId: setting.documentId,
      data: {
        value: String(ctx.request.body.value),
        updated_by_id: ctx.state.user.id,
      }
    });
  }
});

export default SettingAppService;