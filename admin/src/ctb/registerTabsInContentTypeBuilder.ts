import * as yup from 'yup';
import { getTranslation } from '../core/utils/getTranslation';
import {
  TABS_PLUGIN_KEY,
  readTabs,
  validateTabs,
  cleanContentTypeSchema,
  getConflictingTabIds,
} from '../core/utils/tabs';
import TabsEditor from './TabsEditor';
import TabSelect from './TabSelect';

const TABS_EDITOR_INPUT = 'ltbTabsEditor';
const TAB_SELECT_INPUT = 'ltbTabSelect';

const TAB_FIELD_TYPES = [
  'biginteger',
  'blocks',
  'boolean',
  'component',
  'date',
  'datetime',
  'decimal',
  'dynamiczone',
  'email',
  'enumeration',
  'float',
  'integer',
  'json',
  'media',
  'password',
  'relation',
  'richtext',
  'string',
  'text',
  'time',
  'uid',
];

export function registerTabsInContentTypeBuilder(app: any) {
  const forms = app.getPlugin('content-type-builder')?.apis?.forms;
  if (!forms) return;

  forms.components.add({ id: TABS_EDITOR_INPUT, component: TabsEditor });
  forms.components.add({ id: TAB_SELECT_INPUT, component: TabSelect });

  forms.addContentTypeSchemaMutation((nextSchema: unknown) => cleanContentTypeSchema(nextSchema));

  forms.extendContentType({
    validator: () => ({
      [TABS_PLUGIN_KEY]: yup.object().shape({
        tabs: yup.array().test('ltb-tabs', function (tabs) {
          const error = validateTabs(readTabs({ [TABS_PLUGIN_KEY]: { tabs } }));
          return error === null
            ? true
            : this.createError({ message: getTranslation(`tabs.ctb.error.${error}`) });
        }),
      }),
    }),
    form: {
      advanced: () => [
        {
          name: `pluginOptions.${TABS_PLUGIN_KEY}.tabs`,
          type: TABS_EDITOR_INPUT,
          size: 12,
          intlLabel: { id: getTranslation('tabs.ctb.content-type.label'), defaultMessage: 'Tabs' },
          description: {
            id: getTranslation('tabs.ctb.content-type.description'),
            defaultMessage:
              'Organize the fields of this content type in tabs. Fields in a tab are returned by the REST API inside a property named after the tab.',
          },
        },
      ],
    },
  });

  forms.extendFields(TAB_FIELD_TYPES, {
    form: {
      advanced: ({ contentTypeSchema, forTarget }: any) => {
        if (forTarget !== 'contentType') return [];
        const tabs = readTabs(
          contentTypeSchema?.pluginOptions ?? contentTypeSchema?.schema?.pluginOptions
        );
        if (tabs.length === 0) return [];
        const conflicting = getConflictingTabIds(
          tabs,
          contentTypeSchema?.attributes ?? contentTypeSchema?.schema?.attributes
        );
        return [
          {
            name: `pluginOptions.${TABS_PLUGIN_KEY}.tab`,
            type: TAB_SELECT_INPUT,
            size: 12,
            intlLabel: { id: getTranslation('tabs.ctb.field.label'), defaultMessage: 'Tab' },
            description: {
              id: getTranslation('tabs.ctb.field.description'),
              defaultMessage:
                'Tab where this field is shown. Fields without a tab are always visible.',
            },
            options: [
              {
                key: '__null_reset_value__',
                value: '',
                metadatas: {
                  intlLabel: {
                    id: getTranslation('tabs.ctb.field.none'),
                    defaultMessage: 'None (always visible)',
                  },
                },
              },
              ...tabs.map((tab) => ({
                key: tab.id,
                value: tab.id,
                metadatas: conflicting.has(tab.id)
                  ? {
                      disabled: true,
                      // The CTB select formats option labels without values, so the text is prebuilt.
                      intlLabel: {
                        id: `${TABS_PLUGIN_KEY}.tab.${tab.id}.conflict`,
                        defaultMessage: `${tab.name} (conflicts with a field name)`,
                      },
                    }
                  : {
                      intlLabel: {
                        id: `${TABS_PLUGIN_KEY}.tab.${tab.id}`,
                        defaultMessage: tab.name,
                      },
                    },
              })),
            ],
          },
        ];
      },
    },
  });
}
