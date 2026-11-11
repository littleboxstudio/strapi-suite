import SettingsAppSchema from './app/settings';
import SlugModuleItemsSchema from './modules/slugs';
import TemplateModuleItemsSchema from './modules/templates';
import AttributeModuleItemsSchema from './modules/attributes';
import MenuModuleItemsSchema from './modules/menus';
import MenuModuleChildrenItemsSchema from './modules/menus/children';
import ParameterModuleItemsSchema from './modules/parameters';
import TranslationModuleItemsSchema from './modules/translations';
import EcommerceProductSchema from './modules/ecommerce/product';
import EcommerceProductTranslationSchema from './modules/ecommerce/product-translation';
import EcommerceVariantSchema from './modules/ecommerce/variant';
import EcommerceVariantTranslationSchema from './modules/ecommerce/variant-translation';
import EcommerceImageSchema from './modules/ecommerce/image';
import EcommerceIntegrationSchema from './modules/ecommerce/integration';
import EcommerceStoreSettingSchema from './modules/ecommerce/store-setting';
import EcommerceManualShippingMethodSchema from './modules/ecommerce/manual-shipping-method';
import EcommerceEmailTemplateSchema from './modules/ecommerce/email-template';
import EcommerceEmailTemplateVersionSchema from './modules/ecommerce/email-template-version';
import EcommerceAuditLogSchema from './modules/ecommerce/audit-log';
import EcommerceCustomerSchema from './modules/ecommerce/customer';
import EcommerceOrderSchema from './modules/ecommerce/order';
import EcommerceOrderLineSchema from './modules/ecommerce/order-line';
import EcommercePaymentSchema from './modules/ecommerce/payment';
import EcommerceStockMovementSchema from './modules/ecommerce/stock-movement';
import EcommerceOrderHistorySchema from './modules/ecommerce/order-history';
import EcommerceRefundSchema from './modules/ecommerce/refund';
import EcommerceShipmentSchema from './modules/ecommerce/shipment';
import EcommerceShipmentEventSchema from './modules/ecommerce/shipment-event';
import EcommerceOrderReturnSchema from './modules/ecommerce/order-return';
import EcommerceInvoiceSchema from './modules/ecommerce/invoice';
import EcommerceInvoiceAllocationSchema from './modules/ecommerce/invoice-allocation';
import EcommerceStoreCreditSchema from './modules/ecommerce/store-credit';
import EcommerceStoreCreditMovementSchema from './modules/ecommerce/store-credit-movement';
import EcommerceStripeSessionSchema from './modules/ecommerce/stripe-session';
import EcommerceNotificationSchema from './modules/ecommerce/notification';
import EcommerceWebhookEventSchema from './modules/ecommerce/webhook-event';
import EcommercePromotionSchema from './modules/ecommerce/promotion';
import EcommercePromotionRedemptionSchema from './modules/ecommerce/promotion-redemption';
import EcommercePromotionCustomerUsageSchema from './modules/ecommerce/promotion-customer-usage';
import EcommerceCheckoutSessionSchema from './modules/ecommerce/checkout-session';

export default {
  "ltb-st-app-setting": SettingsAppSchema,
  "ltb-st-module-slug-item": SlugModuleItemsSchema,
  "ltb-st-module-template-item": TemplateModuleItemsSchema,
  "ltb-st-module-attribute-item": AttributeModuleItemsSchema,
  "ltb-st-module-menu-item": MenuModuleItemsSchema,
  "ltb-st-module-menu-children-item": MenuModuleChildrenItemsSchema,
  "ltb-st-module-parameter-item": ParameterModuleItemsSchema,
  "ltb-st-module-translation-item": TranslationModuleItemsSchema,
  "ltb-st-module-ecommerce-product": EcommerceProductSchema,
  "ltb-st-module-ecommerce-product-translation": EcommerceProductTranslationSchema,
  "ltb-st-module-ecommerce-variant": EcommerceVariantSchema,
  "ltb-st-module-ecommerce-variant-translation": EcommerceVariantTranslationSchema,
  "ltb-st-module-ecommerce-image": EcommerceImageSchema,
  "ltb-st-module-ecommerce-integration": EcommerceIntegrationSchema,
  "ltb-st-module-ecommerce-store-setting": EcommerceStoreSettingSchema,
  "ltb-st-module-ecommerce-manual-shipping-method": EcommerceManualShippingMethodSchema,
  "ltb-st-module-ecommerce-email-template": EcommerceEmailTemplateSchema,
  "ltb-st-module-ecommerce-email-template-version": EcommerceEmailTemplateVersionSchema,
  "ltb-st-module-ecommerce-audit-log": EcommerceAuditLogSchema,
  "ltb-st-module-ecommerce-customer": EcommerceCustomerSchema,
  "ltb-st-module-ecommerce-order": EcommerceOrderSchema,
  "ltb-st-module-ecommerce-order-line": EcommerceOrderLineSchema,
  "ltb-st-module-ecommerce-payment": EcommercePaymentSchema,
  "ltb-st-module-ecommerce-stock-movement": EcommerceStockMovementSchema,
  "ltb-st-module-ecommerce-order-history": EcommerceOrderHistorySchema,
  "ltb-st-module-ecommerce-refund": EcommerceRefundSchema,
  "ltb-st-module-ecommerce-shipment": EcommerceShipmentSchema,
  "ltb-st-module-ecommerce-shipment-event": EcommerceShipmentEventSchema,
  "ltb-st-module-ecommerce-order-return": EcommerceOrderReturnSchema,
  "ltb-st-module-ecommerce-invoice": EcommerceInvoiceSchema,
  "ltb-st-module-ecommerce-invoice-allocation": EcommerceInvoiceAllocationSchema,
  "ltb-st-module-ecommerce-store-credit": EcommerceStoreCreditSchema,
  "ltb-st-module-ecommerce-store-credit-movement": EcommerceStoreCreditMovementSchema,
  "ltb-st-module-ecommerce-stripe-session": EcommerceStripeSessionSchema,
  "ltb-st-module-ecommerce-notification": EcommerceNotificationSchema,
  "ltb-st-module-ecommerce-webhook-event": EcommerceWebhookEventSchema,
  "ltb-st-module-ecommerce-promotion": EcommercePromotionSchema,
  "ltb-st-module-ecommerce-promotion-redemption": EcommercePromotionRedemptionSchema,
  "ltb-st-module-ecommerce-promotion-customer-usage": EcommercePromotionCustomerUsageSchema,
  "ltb-st-module-ecommerce-checkout-session": EcommerceCheckoutSessionSchema
};
