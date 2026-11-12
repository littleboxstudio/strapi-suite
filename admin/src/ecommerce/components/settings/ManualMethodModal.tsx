import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
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
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../LocaleSwitcher';
import CreateShippingMethod from '../../usecases/settings/createShippingMethod';
import UpdateShippingMethod from '../../usecases/settings/updateShippingMethod';
import { extractFieldErrors } from '../../utils/productForm';
import { TAX_OTHER, TAX_PRESETS } from '../../utils/variantDraft';
import {
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
  type ManualMethodDraft,
  type ManualMethodErrors,
} from '../../utils/manualMethodForm';
import type { ManualMethod } from '../../settingsTypes';

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  /** The method being edited, or null to create one. */
  method: ManualMethod | null;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The store markets; without any the method cannot be saved. TEMP (Task 5 rewrites this modal). */
  markets: string[];
  onClose: () => void;
  onSaved: (method: ManualMethod) => void;
};

const ManualMethodModal = ({ method, locales, defaultLocale, markets, onClose, onSaved }: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);
  const codes = locales.map((l) => l.code);

  const [draft, setDraft] = useState<ManualMethodDraft>(() =>
    method
      ? manualMethodToDraft(method, codes, uiLocale, markets)
      : emptyManualMethodDraft(codes)
  );
  const [errors, setErrors] = useState<ManualMethodErrors>({});
  const [locale, setLocale] = useState(defaultLocale);
  const [saving, setSaving] = useState(false);

  const namePath = (code: string) => `name.${code}`;

  const clearError = (path: string) =>
    setErrors((current) => {
      if (!(path in current)) return current;
      const { [path]: _removed, ...rest } = current;
      return rest;
    });

  const update = <K extends keyof ManualMethodDraft>(
    field: K,
    value: ManualMethodDraft[K],
    errorPath: string = field
  ) => {
    setDraft((d) => ({ ...d, [field]: value }));
    clearError(errorPath);
  };

  // TEMP: one flat price per market (a single no-limit bracket) until Task 5 adds the bracket editor.
  const updateRate = (code: string, text: string) => {
    setDraft((d) => ({
      ...d,
      markets: d.markets.includes(code) ? d.markets : [...d.markets, code],
      brackets: { ...d.brackets, [code]: [{ upTo: '', price: text }] },
    }));
    clearError(`rates.${code}.0.price`);
    clearError('markets');
  };

  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.settings.errors.${errors[path]}`) : undefined;

  const showErrors = (map: ManualMethodErrors) => {
    setErrors(map);
    // The default-locale name is the only required name: show it if that is what failed.
    if (map[namePath(defaultLocale)]) setLocale(defaultLocale);
  };

  const save = async () => {
    if (saving || markets.length === 0) return;
    const result = draftToManualMethodInput(draft, defaultLocale);
    if (!result.input) {
      showErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      const saved = method
        ? await new UpdateShippingMethod().execute(method.id, result.input)
        : await new CreateShippingMethod().execute(result.input);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
      onSaved(saved);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      if (fieldErrors) {
        showErrors(manualMethodErrorMap(fieldErrors));
        toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
      }
    } finally {
      setSaving(false);
    }
  };

  const taxError = errorText('tax');
  const ratesError = errorText('rates');

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {t(
              method
                ? 'ecommerce.settings.manualMethods.editTitle'
                : 'ecommerce.settings.manualMethods.addTitle'
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
                isFilled={(code) => !!draft.names[code]?.trim()}
                label={t('ecommerce.settings.manualMethods.locale')}
              />
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
            </Flex>

            <Field.Root name="active">
              <Flex gap={3}>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(checked: boolean) => update('active', checked)}
                  aria-label={t('ecommerce.settings.manualMethods.active')}
                />
                <Typography variant="omega">
                  {t('ecommerce.settings.manualMethods.active')}
                </Typography>
              </Flex>
            </Field.Root>

            <Flex direction="column" alignItems="stretch" gap={3}>
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography variant="pi" fontWeight="bold" textColor="neutral800">
                  {t('ecommerce.settings.manualMethods.fields.rates')}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t('ecommerce.settings.manualMethods.fields.rates.hint')}
                </Typography>
              </Flex>
              {markets.length === 0 ? (
                <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
                  <Typography textColor="neutral800">
                    {t('ecommerce.settings.zones.createFirst')}
                  </Typography>
                </Box>
              ) : (
                <Grid.Root gap={4}>
                  {markets.map((id) => {
                    const path = `rates.${id}.0.price`;
                    return (
                      <Grid.Item key={id} col={6} s={12} direction="column" alignItems="stretch">
                        <Field.Root name={path} error={errorText(path)}>
                          <Field.Label>{id}</Field.Label>
                          <TextInput
                            inputMode="decimal"
                            value={draft.brackets[id]?.[0]?.price ?? ''}
                            hasError={!!errors[path] || !!ratesError}
                            onChange={(e: any) => updateRate(id, e.target.value)}
                          />
                          <Field.Error />
                        </Field.Root>
                      </Grid.Item>
                    );
                  })}
                </Grid.Root>
              )}
              {ratesError && (
                <Typography variant="pi" textColor="danger600" role="alert">
                  {errors.rates === 'required'
                    ? t('ecommerce.settings.manualMethods.ratesRequired')
                    : ratesError}
                </Typography>
              )}
            </Flex>

            <Grid.Root gap={4}>
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                <Field.Root name="tax" error={taxError} required>
                  <Field.Label>{t('ecommerce.settings.manualMethods.tax')}</Field.Label>
                  <Flex gap={2} alignItems="flex-start">
                    <Box style={{ flex: 1 }}>
                      <SingleSelect
                        value={draft.taxChoice}
                        hasError={!!taxError}
                        onChange={(value: string | number) =>
                          update('taxChoice', String(value), 'tax')
                        }
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
                  <Field.Error />
                </Field.Root>
              </Grid.Item>
            </Grid.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          <Button onClick={save} loading={saving} disabled={markets.length === 0}>
            {t('ecommerce.settings.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export { ManualMethodModal };
