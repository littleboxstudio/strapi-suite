import { useState } from 'react';
import { useNotification } from '@strapi/strapi/admin';
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
  TextInput,
  Typography,
} from '@strapi/design-system';
import { getTranslation } from '../../core/utils/getTranslation';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Gallery } from './Gallery';
import SetVariantActive from '../usecases/setVariantActive';
import { ActionConfirmModal } from './ActionConfirmModal';
import type { ErrorMap, FormVariant } from '../utils/productForm';
import type { ImageRecord } from '../types';
import {
  TAX_OTHER,
  TAX_PRESETS,
  draftToVariant,
  emptyVariantDraft,
  variantToDraft,
  withAdjustmentKey,
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
  /** Uploads and deletes are saved at once, so the page must learn of them even on Cancel. */
  onImagesChange: (variantId: number, images: ImageRecord[]) => void;
  /** Enabling/disabling a saved variant is stored at once too (same reason). */
  onActiveChange: (variantId: number, active: boolean) => void;
};

type TextField =
  | 'sku'
  | 'stock'
  | 'price'
  | 'weight'
  | 'width'
  | 'height'
  | 'depth';

const VariantModal = ({
  variant,
  newKey,
  locales,
  defaultLocale,
  initialLocale,
  serverErrors,
  onClose,
  onConfirm,
  onImagesChange,
  onActiveChange,
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
  const [toggling, setToggling] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const { toggleNotification } = useNotification();

  /**
   * Like the product button: a saved variant is enabled/disabled right away; a new one only in the
   * draft (stored when the product is saved).
   */
  const toggleActive = async () => {
    if (toggling) return;
    const next = !draft.active;
    if (draft.id === undefined) {
      setDraft((d) => ({ ...d, active: next }));
      return;
    }
    setToggling(true);
    try {
      const { active } = await new SetVariantActive().execute(draft.id, next);
      setDraft((d) => ({ ...d, active }));
      onActiveChange(draft.id, active);
      toggleNotification({
        type: 'success',
        message: t(active ? 'ecommerce.product.variant.enabledNotice' : 'ecommerce.product.variant.disabledNotice'),
      });
    } catch {
      toggleNotification({ type: 'danger', message: t('ecommerce.product.variant.toggleError') });
    } finally {
      setToggling(false);
    }
  };

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
    onConfirm(withAdjustmentKey(result.variant, variant));
  };

  const textField = (
    field: TextField,
    opts: { required?: boolean; hint?: string; label?: string } = {}
  ) => (
    <Field.Root name={field} error={errorText(field)} required={opts.required} hint={opts.hint}>
      <Field.Label>{opts.label ?? t(`ecommerce.product.variant.${field}`)}</Field.Label>
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
            <Flex direction="column" alignItems="stretch" gap={6}>
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

            <Grid.Root gap={4}>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {textField('sku', { required: true })}
              </Grid.Item>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {draft.id === undefined
                  ? textField('stock', { required: true })
                  : textField('stock', {
                      required: true,
                      label: t('ecommerce.product.variant.currentStock'),
                      hint: t('ecommerce.product.variant.currentStock.hint'),
                    })}
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
              {/* Same style as the field labels (Field.Label: pi, bold). */}
              <Typography variant="pi" fontWeight="bold" textColor="neutral800">
                {t('ecommerce.product.variant.gallery')}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('ecommerce.product.variant.gallery.hint')}
              </Typography>
              {draft.id !== undefined ? (
                <Gallery
                  owner={{ variantId: draft.id }}
                  images={draft.images}
                  onChange={(images) => {
                    setDraft((d) => ({ ...d, images }));
                    if (draft.id !== undefined) onImagesChange(draft.id, images);
                  }}
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
          <Flex gap={2}>
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.product.variant.cancel')}
            </Button>
            {/* Same as the product's button: confirmed, then applied immediately on a saved variant. */}
            <Button
              variant={draft.active ? 'danger-light' : 'success-light'}
              onClick={() => setConfirmToggle(true)}
              loading={toggling}
            >
              {t(draft.active ? 'ecommerce.product.variant.disable' : 'ecommerce.product.variant.enable')}
            </Button>
          </Flex>
          <Button onClick={confirm}>{t('ecommerce.product.variant.confirm')}</Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirmToggle}
        title={t(
          draft.active
            ? 'ecommerce.product.variant.disableConfirm.title'
            : 'ecommerce.product.variant.enableConfirm.title'
        )}
        text={t(
          draft.active
            ? 'ecommerce.product.variant.disableConfirm.text'
            : 'ecommerce.product.variant.enableConfirm.text'
        )}
        confirmLabel={t(
          draft.active ? 'ecommerce.product.variant.disable' : 'ecommerce.product.variant.enable'
        )}
        cancelLabel={t('ecommerce.product.variant.cancel')}
        confirmVariant={draft.active ? 'danger' : 'default'}
        onCancel={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          toggleActive();
        }}
      />
    </Modal.Root>
  );
};

export { VariantModal };
