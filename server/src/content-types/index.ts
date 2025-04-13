import SettingsAppSchema from './app/settings';
import SlugModuleItemsSchema from './modules/slugs';
import TemplateModuleItemsSchema from './modules/templates';
import AttributeModuleItemsSchema from './modules/attributes';
import MenuModuleItemsSchema from './modules/menus';
import MenuModuleChildrenItemsSchema from './modules/menus/children';
import ParameterModuleItemsSchema from './modules/parameters';
import TranslationModuleItemsSchema from './modules/translations';

export default {
  "ltb-st-app-setting": SettingsAppSchema,
  "ltb-st-module-slug-item": SlugModuleItemsSchema,
  "ltb-st-module-template-item": TemplateModuleItemsSchema,
  "ltb-st-module-attribute-item": AttributeModuleItemsSchema,
  "ltb-st-module-menu-item": MenuModuleItemsSchema,
  "ltb-st-module-menu-children-item": MenuModuleChildrenItemsSchema,
  "ltb-st-module-parameter-item": ParameterModuleItemsSchema,
  "ltb-st-module-translation-item": TranslationModuleItemsSchema
};
