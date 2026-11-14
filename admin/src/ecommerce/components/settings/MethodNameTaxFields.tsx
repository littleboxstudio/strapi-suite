import { useIntl } from 'react-intl';
import {
  Box,
  Field,
  Flex,
  Grid,
  SingleSelect,
  SingleSelectOption,
  TextInput,
} from '@strapi/design-system';
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../LocaleSwitcher';
import { TAX_OTHER, TAX_PRESETS } from '../../utils/variantDraft';
import type { ManualMethodDraft } from '../../utils/manualMethodForm';

type Props = {
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The locale whose name is shown. */
  locale: string;
  onLocaleChange: (locale: string) => void;
  draft: Pick<ManualMethodDraft, 'names' | 'taxChoice' | 'taxOther'>;
  /** Error codes by path: `name.<locale>`, `tax`. */
  errors: Record<string, string>;
  update: <K extends 'names' | 'taxChoice' | 'taxOther'>(
    field: K,
    value: ManualMethodDraft[K],
    errorPath: string
  ) => void;
};

/** The name per locale and the VAT rate of a shipping method (manual methods, DPD services). */
const MethodNameTaxFields = ({
  locales,
  defaultLocale,
  locale,
  onLocaleChange,
  draft,
  errors,
  update,
}: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string) => formatMessage({ id: getTranslation(id) });
  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.settings.errors.${errors[path]}`) : undefined;
  const namePath = (code: string) => `name.${code}`;
  const taxError = errorText('tax');

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <LocaleSwitcher
        locales={locales}
        defaultLocale={defaultLocale}
        value={locale}
        onChange={onLocaleChange}
        isFilled={(code) => !!draft.names[code]?.trim()}
        label={t('ecommerce.settings.manualMethods.locale')}
      />
      <Grid.Root gap={4}>
        <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
          <Field.Root
            name="name"
            error={errorText(namePath(locale))}
            required={locale === defaultLocale}
          >
            <Field.Label>{t('ecommerce.settings.manualMethods.name')}</Field.Label>
            <TextInput
              value={draft.names[locale] ?? ''}
              onChange={(e: any) =>
                update('names', { ...draft.names, [locale]: e.target.value }, namePath(locale))
              }
            />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
          <Field.Root
            name="tax"
            error={taxError}
            hint={t('ecommerce.settings.manual.pricesHint')}
            required
          >
            <Field.Label>{t('ecommerce.settings.manualMethods.tax')}</Field.Label>
            <Flex gap={2} alignItems="flex-start">
              <Box style={{ flex: 1 }}>
                <SingleSelect
                  value={draft.taxChoice}
                  hasError={!!taxError}
                  onChange={(value: string | number) => update('taxChoice', String(value), 'tax')}
                >
                  {TAX_PRESETS.map((rate) => (
                    <SingleSelectOption key={rate} value={String(rate)}>
                      {`${rate}%`}
                    </SingleSelectOption>
                  ))}
                  <SingleSelectOption value={TAX_OTHER}>
                    {t('ecommerce.settings.manualMethods.tax.other')}
                  </SingleSelectOption>
                </SingleSelect>
              </Box>
              {draft.taxChoice === TAX_OTHER && (
                <Box style={{ width: 96 }}>
                  <TextInput
                    aria-label={t('ecommerce.settings.manualMethods.tax.otherValue')}
                    placeholder="%"
                    value={draft.taxOther}
                    hasError={!!taxError}
                    onChange={(e: any) => update('taxOther', e.target.value, 'tax')}
                  />
                </Box>
              )}
            </Flex>
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      </Grid.Root>
    </Flex>
  );
};

export { MethodNameTaxFields };
