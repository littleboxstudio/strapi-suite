import * as yup from 'yup';
import config from './core/config';
import Registry from './core/di/registry';
import { StrapiAdapter } from './core/http/httpClient';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';
import { EcommerceIcon } from './components/EcommerceIcon';
import { mergeTranslations } from './core/utils/mergeTranslations';
import { getTranslation } from './core/utils/getTranslation';
import { SettingGatewayHttp } from './core/gateways/settingGateway';
import { LocaleGatewayHttp } from './core/gateways/localeGateway';
import { SlugGatewayHttp } from './core/gateways/slugGateway';
import { AttributeGatewayHttp } from './core/gateways/attributeGateway';
import { TemplateGatewayHttp } from './core/gateways/templateGateway';
import { MenuGatewayHttp } from './core/gateways/menuGateway';
import { ParameterGatewayHttp } from './core/gateways/parameterGateway';
import { TranslationGatewayHttp } from './core/gateways/translationGateway';
import { DocumentGatewayHttp } from './core/gateways/documentGateway';
import { AiGatewayHttp } from './core/gateways/aiGateway';
import { EcommerceProductGatewayHttp } from "./ecommerce/gateways/ecommerceProductGateway";
import { EcommerceSettingsGatewayHttp } from "./ecommerce/gateways/ecommerceSettingsGateway";
import { EcommerceOrdersGatewayHttp } from "./ecommerce/gateways/ecommerceOrdersGateway";
import { EcommercePromotionsGatewayHttp } from "./ecommerce/gateways/ecommercePromotionsGateway";
import { EcommerceOrganizationGatewayHttp } from './ecommerce/gateways/ecommerceOrganizationGateway';
import { DuplicateGatewayHttp } from './duplicate/gateway';
import Mediator from './core/mediator/mediator';
import PageAttributesBox from './components/PageAttributesBox';
import DocumentTranslateBox from './components/DocumentTranslateBox';
import { registerTabsInContentTypeBuilder } from './ctb/registerTabsInContentTypeBuilder';
import { startTabBadges } from './ctb/tabBadges';
import { mutateEditViewLayout } from './editView/mutateEditViewLayout';
import TabsBar from './editView/TabsBar';
import TabSection from './editView/TabSection';
import { TABS_BAR_FIELD_TYPE, TABS_SECTION_FIELD_TYPE } from './core/utils/tabs';

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

    // A shortcut to the e-commerce module (its pages are routed by the link above). The module's
    // root opens the products list; the link stays active on every e-commerce page.
    app.addMenuLink({
      to: `plugins/${config.pluginId}/ecommerce`,
      icon: EcommerceIcon,
      intlLabel: {
        id: `${config.pluginId}.app.ecommerce.name`,
        defaultMessage: 'Littlebox Strapi Ecommerce',
      },
      position: 1000,
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

    // Image (single or gallery), cropped with zoom and stored as a WebP file in the Media Library.
    // Option names match what the server reads (server/src/services/modules/image-field/domain/values.ts).
    const imageTrad = (key: string) => getTranslation(`image.field.ctb.${key}`);
    const imageSize = yup
      .number()
      .transform((v: number, original: unknown) => (original === '' ? undefined : v))
      .nullable()
      .integer({
        id: imageTrad('size.error'),
        defaultMessage: 'Enter a whole number from 1 to 6000',
      })
      .min(1, {
        id: imageTrad('size.error'),
        defaultMessage: 'Enter a whole number from 1 to 6000',
      })
      .max(6000, {
        id: imageTrad('size.error'),
        defaultMessage: 'Enter a whole number from 1 to 6000',
      });
    // A locked size needs both dimensions.
    const lockedSize = (schema: typeof imageSize) =>
      schema.when('lockSize', {
        is: true,
        then: (s) =>
          s.required({
            id: imageTrad('lockSize.required'),
            defaultMessage: 'Required when the size is locked',
          }),
      });
    app.customFields.register({
      name: 'ltbimage',
      pluginId: config.pluginId,
      type: 'json',
      intlLabel: { id: imageTrad('label'), defaultMessage: 'Littlebox Image' },
      intlDescription: {
        id: imageTrad('description'),
        defaultMessage: 'Single image or gallery, cropped with zoom and saved as WebP',
      },
      icon: PluginIcon,
      components: {
        Input: async () =>
          import(
            /* webpackChunkName: "input-image-field" */ './components/imageField/ImageFieldInput'
          ),
      },
      options: {
        base: [
          {
            intlLabel: { id: imageTrad('mode'), defaultMessage: 'Mode' },
            name: 'options.mode',
            type: 'select',
            defaultValue: 'single',
            options: [
              {
                key: 'single',
                value: 'single',
                metadatas: {
                  intlLabel: { id: imageTrad('mode.single'), defaultMessage: 'Single image' },
                },
              },
              {
                key: 'gallery',
                value: 'gallery',
                metadatas: {
                  intlLabel: { id: imageTrad('mode.gallery'), defaultMessage: 'Gallery' },
                },
              },
            ],
          },
          {
            intlLabel: { id: imageTrad('width'), defaultMessage: 'Width (px)' },
            name: 'options.width',
            type: 'number',
            description: {
              id: imageTrad('width.description'),
              defaultMessage: 'Optional, 1 to 6000. Suggested output width.',
            },
          },
          {
            intlLabel: { id: imageTrad('height'), defaultMessage: 'Height (px)' },
            name: 'options.height',
            type: 'number',
            description: {
              id: imageTrad('height.description'),
              defaultMessage: 'Optional, 1 to 6000. Suggested output height.',
            },
          },
          {
            intlLabel: { id: imageTrad('lockSize'), defaultMessage: 'Lock this size' },
            name: 'options.lockSize',
            type: 'checkbox',
            description: {
              id: imageTrad('lockSize.description'),
              defaultMessage:
                'Only when both width and height are set: every image is saved at exactly this size.',
            },
          },
        ],
        advanced: [
          {
            sectionTitle: { id: 'global.settings', defaultMessage: 'Settings' },
            items: [
              {
                name: 'required',
                type: 'checkbox',
                intlLabel: {
                  id: 'content-type-builder.form.attribute.item.requiredField',
                  defaultMessage: 'Required field',
                },
                description: {
                  id: 'content-type-builder.form.attribute.item.requiredField.description',
                  defaultMessage: "You won't be able to create an entry if this field is empty",
                },
              },
              {
                intlLabel: { id: imageTrad('maxImages'), defaultMessage: 'Maximum images' },
                name: 'options.maxImages',
                type: 'number',
                description: {
                  id: imageTrad('maxImages.description'),
                  defaultMessage:
                    'Gallery only (ignored for a single image). Leave empty for no limit.',
                },
              },
            ],
          },
        ],
        validator: () => ({
          mode: yup.string().oneOf(['single', 'gallery']).nullable(),
          width: lockedSize(imageSize),
          height: lockedSize(imageSize),
          maxImages: yup
            .number()
            .transform((v: number, original: unknown) => (original === '' ? undefined : v))
            .nullable()
            .integer({
              id: imageTrad('maxImages.error'),
              defaultMessage: 'Enter a whole number of at least 1',
            })
            .min(1, {
              id: imageTrad('maxImages.error'),
              defaultMessage: 'Enter a whole number of at least 1',
            }),
        }),
      },
    });

    app.addFields([
      { type: TABS_BAR_FIELD_TYPE, Component: TabsBar },
      { type: TABS_SECTION_FIELD_TYPE, Component: TabSection },
    ]);

    // Started in `register`: only the full app instance exposes the redux store (bootstrap
    // receives a reduced API), and the store is read lazily once the admin renders.
    startTabBadges(app);

    app.registerPlugin({
      id: config.pluginId,
      initializer: Initializer,
      isReady: false,
      name: config.pluginId,
    });
  },

  async registerTrads({ locales }: { locales: string[] }) {
    const { default: en } = await import('./core/translations/en.json');
    return Promise.all(
      locales.map(async (locale) => {
        if (locale === 'en') return { data: en, locale };
        try {
          const { default: data } = await import(`./core/translations/${locale}.json`);
          return { data: mergeTranslations(en, data), locale };
        } catch {
          return { data: en, locale };
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
    Registry.getInstance().provide("documentGateway", new DocumentGatewayHttp());
    Registry.getInstance().provide("aiGateway", new AiGatewayHttp());
    Registry.getInstance().provide("ecommerceProductGateway", new EcommerceProductGatewayHttp());
    Registry.getInstance().provide("ecommerceSettingsGateway", new EcommerceSettingsGatewayHttp());
    Registry.getInstance().provide("ecommerceOrdersGateway", new EcommerceOrdersGatewayHttp());
    Registry.getInstance().provide("ecommercePromotionsGateway", new EcommercePromotionsGatewayHttp());
    Registry.getInstance().provide("ecommerceOrganizationGateway", new EcommerceOrganizationGatewayHttp());
    Registry.getInstance().provide("duplicateGateway", new DuplicateGatewayHttp());
    app.getPlugin('content-manager').apis.addEditViewSidePanel([
      PageAttributesBox,
      DocumentTranslateBox,
    ]);
    registerTabsInContentTypeBuilder(app);
    app.registerHook('Admin/CM/pages/EditView/mutate-edit-view-layout', (args: any) =>
      mutateEditViewLayout(args)
    );
  }
};