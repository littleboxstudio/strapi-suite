import type { Core } from '@strapi/strapi';
import { Context } from 'koa';
import { PLUGIN_ID, LtbConfigs } from '../../config';

const SECRET_SETTINGS = [
  { module: 'translation', property: 'aiApiKey' },
];

function isSecret(module: string, property: string): boolean {
  return SECRET_SETTINGS.some((secret) => secret.module === module && secret.property === property);
}

export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return '********';
  return `${value.slice(0, 3)}${'*'.repeat(8)}${value.slice(-4)}`;
}

function inferType(value: any): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function parseSettings(data: any): any {
  const typeParsers = {
    boolean: (value: string) => value === "true",
    number: (value: string) => Number(value),
    string: (value: string) => value,
    date: (value: string) => new Date(value)
  };
  const groupedByModule = data.reduce((acc, item) => {
    const parser = typeParsers[item.type as keyof typeof typeParsers] || ((v: string) => v);
    const convertedValue = isSecret(item.module, item.property)
      ? maskSecret(item.value)
      : parser(item.value);
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

  async getRawValue(module: string, property: string) {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: { module, property }
    });
    return setting ? setting.value : null;
  },

  async update(ctx: Context) {
    const config: LtbConfigs = strapi.config.get(`plugin::${PLUGIN_ID}`);
    const { module, property, value } = ctx.request.body;
    const setting = await strapi.db.query(config.uuid.app.setting).findOne({
      where: {
        module,
        property
      }
    });
    if (isSecret(module, property) && (value === null || value === undefined || value === '')) {
      return setting;
    }
    if (!setting) {
      return await strapi.db.query(config.uuid.app.setting).create({
        data: {
          module,
          property,
          type: inferType(value),
          value: String(value),
        }
      });
    }
    return await strapi.documents(config.uuid.app.setting).update({
      documentId: setting.documentId,
      data: {
        value: String(value),
        updated_by_id: ctx.state.user.id,
      }
    });
  }
});

export default SettingAppService;
