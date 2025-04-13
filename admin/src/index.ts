import * as yup from 'yup';
import config from './core/config';
import Registry from './core/di/registry';
import { StrapiAdapter } from './core/http/httpClient';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';
import { getTranslation } from './core/utils/getTranslation';
import { SettingGatewayHttp } from './core/gateways/settingGateway';
import { LocaleGatewayHttp } from './core/gateways/localeGateway';
import { SlugGatewayHttp } from './core/gateways/slugGateway';
import { AttributeGatewayHttp } from './core/gateways/attributeGateway';
import { TemplateGatewayHttp } from './core/gateways/templateGateway';
import { MenuGatewayHttp } from './core/gateways/menuGateway';
import { ParameterGatewayHttp } from './core/gateways/parameterGateway';
import { TranslationGatewayHttp } from './core/gateways/translationGateway';
import Mediator from './core/mediator/mediator';
import PageAttributesBox from './components/PageAttributesBox';

export default {
  async register(app: any) {
    app.addMenuLink({
      to: `plugins/${config.pluginId}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${config.pluginId}.app.name`,
        defaultMessage: config.pluginId,
      },
      position: 999,
      Component: () => import('./pages/App')
    });

    app.customFields.register({
      name: 'ltbslug',
      pluginId: config.pluginId,
      type: 'string',
      intlLabel: {
        id: getTranslation(`module.${config.uuid.modules.slug}.field.slug.label`),
        defaultMessage: 'Littlebox Strapi Slug',
      },
      intlDescription: {
        id: getTranslation(`module.${config.uuid.modules.slug}.field.slug.description`),
        defaultMessage: 'Generates custom slug',
      },
      icon: PluginIcon,
      components: {
        Input: async () =>
          import(/* webpackChunkName: "input-slug-component" */ './components/SlugInput'),
      },
      options: {
        base: [
          {
            intlLabel: {
              id: getTranslation(`module.${config.uuid.modules.slug}.field.slug.target`),
              defaultMessage: 'Attached field',
            },
            name: 'options.targetField',
            type: 'select',
            description: {
              id: getTranslation(`module.${config.uuid.modules.slug}.field.slug.target.description`),
              defaultMessage: "You must create the “title” field",
            },
            options: [
              {
                key: '__null_reset_value__',
                value: '',
                metadatas: { intlLabel: { id: 'global.none', defaultMessage: 'None' } },
              },
              {
                key: 'title',
                value: 'title',
                metadatas: {
                  intlLabel: { id: `title.no-override`, defaultMessage: 'Title' },
                },
              },
            ],
          } 
        ],
        advanced: [],
        validator: (args: any) => ({
          targetField: yup.string().required({
            id: getTranslation(`module.${config.uuid.modules.slug}.field.slug.target.error`),
            defaultMessage: "The target field is required",
          })
        }),
      }
    });

    app.registerPlugin({
      id: config.pluginId,
      initializer: Initializer,
      isReady: false,
      name: config.pluginId,
    });
  },

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./core/translations/${locale}.json`);
          return { data, locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },

  bootstrap(app: any) {
    Registry.getInstance().provide("mediator", new Mediator());
    Registry.getInstance().provide("httpClient", new StrapiAdapter());
    Registry.getInstance().provide("settingGateway", new SettingGatewayHttp());
    Registry.getInstance().provide("localeGateway", new LocaleGatewayHttp());
    Registry.getInstance().provide("slugGateway", new SlugGatewayHttp());
    Registry.getInstance().provide("attributeGateway", new AttributeGatewayHttp());
    Registry.getInstance().provide("templateGateway", new TemplateGatewayHttp());
    Registry.getInstance().provide("menuGateway", new MenuGatewayHttp());
    Registry.getInstance().provide("parameterGateway", new ParameterGatewayHttp());
    Registry.getInstance().provide("translationGateway", new TranslationGatewayHttp());
    app.getPlugin('content-manager').apis.addEditViewSidePanel([PageAttributesBox]);
  }
};