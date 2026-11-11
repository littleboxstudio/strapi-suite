import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import { LocaleSwitcher } from './LocaleSwitcher';
import { GallerySlot } from './GallerySlot';
import type { ErrorMap, FormVariant } from '../utils/productForm';
import {
  TAX_OTHER,
  TAX_PRESETS,
  draftToVariant,
  emptyVariantDraft,
  variantToDraft,
  type VariantDraft,
} from '../utils/variantDraft';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  /** The variant being edited, or null to create one with `newKey`. */
  variant: FormVariant | null;
  newKey: string;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  initialLocale: string;
  /** Server errors for this variant, paths relative to it (`sku`, `translations.en.option`). */
  serverErrors: ErrorMap;
  onClose: () => void;
  onConfirm: (variant: FormVariant) => void;
};

type TextField = 'sku' | 'stock' | 'price' | 'weight' | 'width' | 'height' | 'depth';

const VariantModal = ({
  variant,
  newKey,
  locales,
  defaultLocale,
  initialLocale,
  serverErrors,
  onClose,
  onConfirm,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const codes = locales.map((l) => l.code);

  const [draft, setDraft] = useState<VariantDraft>(() =>
    variant ? variantToDraft(variant, codes, uiLocale) : emptyVariantDraft(codes, newKey)
  );
  const [errors, setErrors] = useState<ErrorMap>(serverErrors);
  const [locale, setLocale] = useState(initialLocale);

  const optionPath = (code: string) => `translations.${code}.option`;

  const clearError = (path: string) =>
    setErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      return rest;
    });

  const setField = (field: TextField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    clearError(field);
  };

  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.product.errors.${errors[path]}`) : undefined;

  const confirm = () => {
    const result = draftToVariant(draft, defaultLocale);
    if (!result.variant) {
      setErrors(result.errors);
      if (result.errors[optionPath(defaultLocale)]) setLocale(defaultLocale);
      return;
    }
    onConfirm(result.variant);
  };

  const textField = (field: TextField, opts: { required?: boolean; hint?: string } = {}) => (
    <Field.Root name={field} error={errorText(field)} required={opts.required} hint={opts.hint}>
      <Field.Label>{t(`ecommerce.product.variant.${field}`)}</Field.Label>
      <TextInput value={draft[field]} onChange={(e: any) => setField(field, e.target.value)} />
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );

  const taxError = errorText('tax');

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t(
              variant ? 'ecommerce.product.variant.editTitle' : 'ecommerce.product.variant.addTitle'
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <LocaleSwitcher
                locales={locales}
                defaultLocale={defaultLocale}
                value={locale}
                onChange={setLocale}
                isFilled={(code) => !!draft.options[code]?.trim()}
                label={t('ecommerce.product.locale')}
              />
              <Field.Root
                name="option"
                error={errorText(optionPath(locale))}
                required={locale === defaultLocale}
                hint={t('ecommerce.product.variant.option.hint')}
              >
                <Field.Label>{t('ecommerce.product.variant.option')}</Field.Label>
                <TextInput
                  value={draft.options[locale] ?? ''}
                  onChange={(e: any) => {
                    const value = e.target.value;
                    setDraft((d) => ({ ...d, options: { ...d.options, [locale]: value } }));
                    clearError(optionPath(locale));
                  }}
                />
                <Field.Error />
                <Field.Hint />
              </Field.Root>
            </Flex>

            <Field.Root name="active">
              <Flex gap={3}>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(checked: boolean) =>
                    setDraft((d) => ({ ...d, active: checked }))
                  }
                  aria-label={t('ecommerce.product.variant.active')}
                />
                <Typography variant="omega">{t('ecommerce.product.variant.active')}</Typography>
              </Flex>
            </Field.Root>

            <Grid.Root gap={4}>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {textField('sku', { required: true })}
              </Grid.Item>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {textField('stock', { required: true })}
              </Grid.Item>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {textField('price', {
                  required: true,
                  hint: t('ecommerce.product.variant.price.hint'),
                })}
              </Grid.Item>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                <Field.Root name="tax" error={taxError} required>
                  <Field.Label>{t('ecommerce.product.variant.tax')}</Field.Label>
                  <Flex gap={2} alignItems="flex-start">
                    <Box style={{ flex: 1 }}>
                      <SingleSelect
                        value={draft.taxChoice}
                        onChange={(value: string | number) => {
                          setDraft((d) => ({ ...d, taxChoice: String(value) }));
                          clearError('tax');
                        }}
                        hasError={!!taxError}
                      >
                        {TAX_PRESETS.map((rate) => (
                          <SingleSelectOption key={rate} value={String(rate)}>
                            {`${rate}%`}
                          </SingleSelectOption>
                        ))}
                        <SingleSelectOption value={TAX_OTHER}>
                          {t('ecommerce.product.variant.tax.other')}
                        </SingleSelectOption>
                      </SingleSelect>
                    </Box>
                    {draft.taxChoice === TAX_OTHER && (
                      <Box style={{ width: 96 }}>
                        <TextInput
                          aria-label={t('ecommerce.product.variant.tax.otherValue')}
                          placeholder="%"
                          value={draft.taxOther}
                          hasError={!!taxError}
                          onChange={(e: any) => {
                            const value = e.target.value;
                            setDraft((d) => ({ ...d, taxOther: value }));
                            clearError('tax');
                          }}
                        />
                      </Box>
                    )}
                  </Flex>
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
              <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
                {textField('weight')}
              </Grid.Item>
              <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
                {textField('width')}
              </Grid.Item>
              <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
                {textField('height')}
              </Grid.Item>
              <Grid.Item col={3} s={6} direction="column" alignItems="stretch">
                {textField('depth')}
              </Grid.Item>
            </Grid.Root>

            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="sigma" textColor="neutral800">
                {t('ecommerce.product.variant.gallery')}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.product.variant.gallery.hint')}
              </Typography>
              {draft.id !== undefined ? (
                <GallerySlot
                  owner={{ variantId: draft.id }}
                  images={draft.images}
                  onChange={(images) => setDraft((d) => ({ ...d, images }))}
                />
              ) : (
                <Typography variant="pi" textColor="neutral500">
                  {t('ecommerce.product.gallery.saveFirst')}
                </Typography>
              )}
            </Flex>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.product.variant.cancel')}
          </Button>
          <Button onClick={confirm}>{t('ecommerce.product.variant.confirm')}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { VariantModal };
