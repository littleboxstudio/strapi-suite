import { UID } from "@strapi/strapi";
export const PLUGIN_ID = 'littlebox-strapi-suite';

export const SLUG_LANGUAGE_STRATEGY = "language";
export const SLUG_CONTENT_STRATEGY = "content";

export const AI_TRANSLATION_MODULE = "translation";
export const AI_TRANSLATION_DEFAULT_MODEL = "gpt-4o";
export const AI_TRANSLATION_BATCH_SIZE = 40;
export const ECOMMERCE_MODULE = "ecommerce";
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export interface LtbConfigs { 
  pluginId: string;
  uuid: {
    app: {
      setting: UID.ContentType;
    },
    modules: {
      menu: {
        main: UID.ContentType;
        children: UID.ContentType;
      },
      attribute: UID.ContentType;
      template: UID.ContentType;
      parameter: UID.ContentType;
      slug: UID.ContentType;
      translation: UID.ContentType;
      ecommerce: {
        product: UID.ContentType;
        productTranslation: UID.ContentType;
        variant: UID.ContentType;
        variantTranslation: UID.ContentType;
        image: UID.ContentType;
        integration: UID.ContentType;
        storeSetting: UID.ContentType;
        manualShippingMethod: UID.ContentType;
        emailTemplate: UID.ContentType;
        emailTemplateVersion: UID.ContentType;
        auditLog: UID.ContentType;
        customer: UID.ContentType;
        order: UID.ContentType;
        orderLine: UID.ContentType;
        payment: UID.ContentType;
        stockMovement: UID.ContentType;
        orderHistory: UID.ContentType;
      },
    },
    customFields: {
      slug: string;
    }
  }
} 
export default {
  default: {
    pluginId: PLUGIN_ID,
    uuid: {
      app: {
        setting: `plugin::${PLUGIN_ID}.ltb-st-app-setting`,
      },
      modules: {
        menu: {
          main: `plugin::${PLUGIN_ID}.ltb-st-module-menu-item`,
          children: `plugin::${PLUGIN_ID}.ltb-st-module-menu-children-item`,
        },
        attribute: `plugin::${PLUGIN_ID}.ltb-st-module-attribute-item`,
        template: `plugin::${PLUGIN_ID}.ltb-st-module-template-item`,
        parameter: `plugin::${PLUGIN_ID}.ltb-st-module-parameter-item`,
        slug: `plugin::${PLUGIN_ID}.ltb-st-module-slug-item`,
        translation: `plugin::${PLUGIN_ID}.ltb-st-module-translation-item`,
        ecommerce: {
          product: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product`,
          productTranslation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product-translation`,
          variant: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-variant`,
          variantTranslation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-variant-translation`,
          image: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-image`,
          integration: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-integration`,
          storeSetting: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-store-setting`,
          manualShippingMethod: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-manual-shipping-method`,
          emailTemplate: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-email-template`,
          emailTemplateVersion: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-email-template-version`,
          auditLog: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-audit-log`,
          customer: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-customer`,
          order: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-order`,
          orderLine: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-order-line`,
          payment: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-payment`,
          stockMovement: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-stock-movement`,
          orderHistory: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-order-history`,
        },
      },
      customFields: {
        slug: `plugin::${PLUGIN_ID}.ltbslug`
      }
    }
  },
  validator() {},
};
