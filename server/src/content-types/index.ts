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
  "ltb-st-module-ecommerce-image": EcommerceImageSchema
};
