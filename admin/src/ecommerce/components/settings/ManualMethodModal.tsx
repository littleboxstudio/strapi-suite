import { Fragment, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  IconButton,
  Modal,
  MultiSelect,
  MultiSelectOption,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../LocaleSwitcher';
import CreateShippingMethod from '../../usecases/settings/createShippingMethod';
import UpdateShippingMethod from '../../usecases/settings/updateShippingMethod';
import { extractFieldErrors } from '../../utils/productForm';
import { TAX_OTHER, TAX_PRESETS } from '../../utils/variantDraft';
import { countryOptions } from '../../utils/settingsForm';
import {
  applyToAllMarkets,
  draftToManualMethodInput,
  emptyManualMethodDraft,
  manualMethodErrorMap,
  manualMethodToDraft,
  newBracketRows,
  type BracketDraft,
  type ManualMethodDraft,
  type ManualMethodErrors,
} from '../../utils/manualMethodForm';
import type { ManualMethod } from '../../settingsTypes';

/**
 * Weight ranges of one market: Up to | Price | remove. A plain grid (not the design-system Table,
 * whose scroll wrapper clips the last row) so every cell starts on the same line.
 */
const RangeGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: start;
`;

/** Mount it only while open: the draft is initialised once, from the props. */
type Props = {
  /** The method being edited, or null to create one. */
  method: ManualMethod | null;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  /** The store markets (country codes); without any the method cannot be saved. */
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

  const countries = useMemo(() => countryOptions(uiLocale), [uiLocale]);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  /** The store markets, by country name. */
  const marketOptions = useMemo(
    () => countries.filter((c) => markets.includes(c.code)),
    [countries, markets]
  );

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

  /** Drops every error whose path is `prefix` or below it (row indexes shift on add/remove). */
  const clearErrorsUnder = (prefix: string) =>
    setErrors((current) => {
      const keys = Object.keys(current).filter((k) => k === prefix || k.startsWith(`${prefix}.`));
      if (keys.length === 0) return current;
      const rest = { ...current };
      keys.forEach((k) => delete rest[k]);
      return rest;
    });

  /** A newly selected market starts with one empty row; a reselected one keeps its rows. */
  const setMarkets = (next: string[]) => {
    setDraft((d) => {
      const brackets = { ...d.brackets };
      next.forEach((code) => {
        if (!brackets[code]) brackets[code] = newBracketRows();
      });
      return { ...d, markets: next, brackets };
    });
    clearError('markets');
    clearError('rates');
    draft.markets
      .filter((code) => !next.includes(code))
      .forEach((code) => clearErrorsUnder(`rates.${code}`));
  };

  const changeRows = (code: string, change: (rows: BracketDraft[]) => BracketDraft[]) =>
    setDraft((d) => ({ ...d, brackets: { ...d.brackets, [code]: change(d.brackets[code] ?? []) } }));

  const updateRow = (code: string, index: number, field: keyof BracketDraft, text: string) => {
    changeRows(code, (rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: text } : row))
    );
    clearError(`rates.${code}.${index}.${field}`);
    clearError(`rates.${code}`);
  };

  const addRow = (code: string) => {
    changeRows(code, (rows) => [...rows, ...newBracketRows()]);
    clearErrorsUnder(`rates.${code}`);
  };

  const removeRow = (code: string, index: number) => {
    changeRows(code, (rows) => rows.filter((_, i) => i !== index));
    clearErrorsUnder(`rates.${code}`);
  };

  const applyToAll = (code: string) => {
    setDraft((d) => applyToAllMarkets(d, code));
    clearErrorsUnder('rates');
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
  const marketsError =
    errors.markets === 'required'
      ? t('ecommerce.settings.manual.marketsRequired')
      : errorText('markets');

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

            {markets.length === 0 ? (
              <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
                <Typography textColor="neutral800">
                  {t('ecommerce.settings.manual.noStoreMarkets')}
                </Typography>
              </Box>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Field.Root
                  name="markets"
                  error={marketsError}
                  hint={t('ecommerce.settings.manual.pricesHint')}
                  required
                >
                  <Field.Label>{t('ecommerce.settings.manual.markets')}</Field.Label>
                  <Flex gap={2} alignItems="flex-start">
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <MultiSelect
                        withTags
                        value={draft.markets}
                        hasError={!!marketsError}
                        onChange={(next: string[]) => setMarkets(next)}
                      >
                        {marketOptions.map(({ code, name }) => (
                          <MultiSelectOption key={code} value={code}>
                            {name}
                          </MultiSelectOption>
                        ))}
                      </MultiSelect>
                    </Box>
                    <Button
                      variant="secondary"
                      size="L"
                      disabled={draft.markets.length === markets.length}
                      onClick={() =>
                        setMarkets([
                          ...draft.markets,
                          ...markets.filter((code) => !draft.markets.includes(code)),
                        ])
                      }
                    >
                      {t('ecommerce.settings.manual.selectAll')}
                    </Button>
                    <Button
                      variant="tertiary"
                      size="L"
                      disabled={draft.markets.length === 0}
                      onClick={() => setMarkets([])}
                    >
                      {t('ecommerce.settings.manual.clear')}
                    </Button>
                  </Flex>
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>

                {ratesError && (
                  <Typography variant="pi" textColor="danger600" role="alert">
                    {ratesError}
                  </Typography>
                )}

                {draft.markets.length > 0 && (
                  <Typography variant="pi" textColor="neutral600">
                    {t('ecommerce.settings.manual.noLimit')}
                  </Typography>
                )}

                {draft.markets.map((code) => {
                  const rows = draft.brackets[code] ?? [];
                  const marketError = errors[`rates.${code}`];
                  return (
                    <Box
                      key={code}
                      borderColor={marketError ? 'danger600' : 'neutral200'}
                      hasRadius
                      padding={4}
                    >
                      <Flex direction="column" alignItems="stretch" gap={3}>
                        <Flex justifyContent="space-between" alignItems="center" gap={2}>
                          <Typography variant="delta" tag="h3">
                            {countryName(code)}
                          </Typography>
                          {draft.markets.length >= 2 && (
                            <Button variant="tertiary" size="S" onClick={() => applyToAll(code)}>
                              {t('ecommerce.settings.manual.applyAll')}
                            </Button>
                          )}
                        </Flex>
                        {rows.length > 0 && (
                          <RangeGrid>
                            <Typography variant="sigma" textColor="neutral600">
                              {t('ecommerce.settings.manual.upTo')}
                            </Typography>
                            <Typography variant="sigma" textColor="neutral600">
                              {t('ecommerce.settings.manual.price')}
                            </Typography>
                            <span />
                            {rows.map((row, i) => (
                              <Fragment key={i}>
                                {(['upTo', 'price'] as const).map((field) => {
                                  const path = `rates.${code}.${i}.${field}`;
                                  return (
                                    <Field.Root key={field} name={path} error={errorText(path)}>
                                      <TextInput
                                        aria-label={`${countryName(code)}: ${t(
                                          `ecommerce.settings.manual.${field}`
                                        )} (${i + 1})`}
                                        inputMode="decimal"
                                        value={row[field]}
                                        onChange={(e: any) =>
                                          updateRow(code, i, field, e.target.value)
                                        }
                                      />
                                      <Field.Error />
                                    </Field.Root>
                                  );
                                })}
                                {/* Same height as the inputs, so the button sits on their line. */}
                                <Flex height="4rem" alignItems="center">
                                  <IconButton
                                    label={t('ecommerce.settings.manual.removeRange')}
                                    variant="ghost"
                                    disabled={rows.length === 1}
                                    onClick={() => removeRow(code, i)}
                                  >
                                    <Trash />
                                  </IconButton>
                                </Flex>
                              </Fragment>
                            ))}
                          </RangeGrid>
                        )}
                        {marketError && (
                          <Typography variant="pi" textColor="danger600" role="alert">
                            {marketError === 'required'
                              ? t('ecommerce.settings.manual.rangesRequired')
                              : errorText(`rates.${code}`)}
                          </Typography>
                        )}
                        <Flex justifyContent="flex-start">
                          <Button
                            variant="secondary"
                            size="S"
                            startIcon={<Plus />}
                            onClick={() => addRow(code)}
                          >
                            {t('ecommerce.settings.manual.addRange')}
                          </Button>
                        </Flex>
                      </Flex>
                    </Box>
                  );
                })}
              </Flex>
            )}

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
