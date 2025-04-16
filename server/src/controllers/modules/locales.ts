import type { Core } from '@strapi/strapi';

const LocalesModuleController = ({ strapi }: { strapi: Core.Strapi }) => ({
  async getLocales() {
    const locales = await strapi.plugin('i18n').service('locales').find();
    const mappedLocales = locales.map(locale => locale.code.toLowerCase());
    const defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale();
    return {
      locales: mappedLocales,
      default: defaultLocale
    };
  }
});

export default LocalesModuleController;
