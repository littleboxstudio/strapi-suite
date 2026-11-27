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
  /** Optional e-commerce tuning; read null-safely (it may be absent). */
  ecommerce?: { promotionSearchLimit?: number };
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
        refund: UID.ContentType;
        storeCredit: UID.ContentType;
        storeCreditMovement: UID.ContentType;
        stripeSession: UID.ContentType;
        notification: UID.ContentType;
        webhookEvent: UID.ContentType;
        shipment: UID.ContentType;
        shipmentEvent: UID.ContentType;
        orderReturn: UID.ContentType;
        invoice: UID.ContentType;
        invoiceAllocation: UID.ContentType;
        promotion: UID.ContentType;
        promotionRedemption: UID.ContentType;
        promotionCustomerUsage: UID.ContentType;
        checkoutSession: UID.ContentType;
        customerSession: UID.ContentType;
        customerToken: UID.ContentType;
        cronRun: UID.ContentType;
        customerEvent: UID.ContentType;
        paymentMethodSuggestion: UID.ContentType;
        category: UID.ContentType;
        categoryTranslation: UID.ContentType;
        tag: UID.ContentType;
        tagTranslation: UID.ContentType;
        collection: UID.ContentType;
        collectionTranslation: UID.ContentType;
        collectionProduct: UID.ContentType;
      },
      imageField: {
        file: UID.ContentType;
      },
    },
    customFields: {
      slug: string;
      image: string;
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
          refund: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-refund`,
          storeCredit: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-store-credit`,
          storeCreditMovement: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-store-credit-movement`,
          stripeSession: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-stripe-session`,
          notification: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-notification`,
          webhookEvent: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-webhook-event`,
          shipment: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-shipment`,
          shipmentEvent: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-shipment-event`,
          orderReturn: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-order-return`,
          invoice: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-invoice`,
          invoiceAllocation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-invoice-allocation`,
          promotion: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-promotion`,
          promotionRedemption: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-promotion-redemption`,
          promotionCustomerUsage: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-promotion-customer-usage`,
          checkoutSession: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-checkout-session`,
          customerSession: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-customer-session`,
          customerToken: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-customer-token`,
          cronRun: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-cron-run`,
          customerEvent: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-customer-event`,
          paymentMethodSuggestion: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-payment-method-suggestion`,
          category: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product-category`,
          categoryTranslation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product-category-translation`,
          tag: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product-tag`,
          tagTranslation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-product-tag-translation`,
          collection: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-collection`,
          collectionTranslation: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-collection-translation`,
          collectionProduct: `plugin::${PLUGIN_ID}.ltb-st-module-ecommerce-collection-product`,
        },
        imageField: {
          file: `plugin::${PLUGIN_ID}.ltb-st-module-image-field-file`,
        },
      },
      customFields: {
        slug: `plugin::${PLUGIN_ID}.ltbslug`,
        image: `plugin::${PLUGIN_ID}.ltbimage`,
      }
    }
  },
  validator() {},
};
