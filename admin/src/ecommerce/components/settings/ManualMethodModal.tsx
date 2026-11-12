import { useMemo, useState } from 'react';
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
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import { LocaleSwitcher } from '../LocaleSwitcher';
import { ActionConfirmModal } from '../ActionConfirmModal';
import { FilteredMarkets, MarketPicker, MarketCard } from './MarketPicker';
import { BracketRows } from './BracketRows';
import { FillMarketsModal } from './FillMarketsModal';
import CreateShippingMethod from '../../usecases/settings/createShippingMethod';
import UpdateShippingMethod from '../../usecases/settings/updateShippingMethod';
import { extractFieldErrors } from '../../utils/productForm';
import { TAX_OTHER, TAX_PRESETS } from '../../utils/variantDraft';
import { countryOptions } from '../../utils/settingsForm';
import {
  fillAllMarkets,
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
  /** A saved method was enabled or disabled from the footer (applied right away). */
  onActiveChange: (method: ManualMethod) => void;
};

const ManualMethodModal = ({
  method,
  locales,
  defaultLocale,
  markets,
  onClose,
  onSaved,
  onActiveChange,
}: Props) => {
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
    method ? manualMethodToDraft(method, codes, uiLocale, markets) : emptyManualMethodDraft(codes)
  );
  const [errors, setErrors] = useState<ManualMethodErrors>({});
  const [locale, setLocale] = useState(defaultLocale);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [filling, setFilling] = useState(false);

  /**
   * Like the variant button: a saved method is enabled/disabled right away; a new one only in the
   * draft (stored when it is saved).
   */
  const toggleActive = async () => {
    if (toggling) return;
    const next = !draft.active;
    if (!method) {
      setDraft((d) => ({ ...d, active: next }));
      return;
    }
    setToggling(true);
    try {
      const saved = await new UpdateShippingMethod().execute(method.id, { active: next });
      setDraft((d) => ({ ...d, active: saved.active }));
      onActiveChange(saved);
      toggleNotification({
        type: 'success',
        message: t(
          saved.active
            ? 'ecommerce.settings.manualMethods.enabledNotice'
            : 'ecommerce.settings.manualMethods.disabledNotice'
        ),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('ecommerce.settings.manualMethods.toggleError'),
      });
    } finally {
      setToggling(false);
    }
  };

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
    setDraft((d) => ({
      ...d,
      brackets: { ...d.brackets, [code]: change(d.brackets[code] ?? []) },
    }));

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

  const fillAll = (rows: BracketDraft[]) => {
    setDraft((d) => fillAllMarkets(d, rows));
    clearErrorsUnder('rates');
    setFilling(false);
  };

  const errorText = (path: string) =>
    errors[path] ? t(`ecommerce.settings.errors.${errors[path]}`) : undefined;

  /** Bumped when errors are shown: clears the market search so no market with an error is hidden. */
  const [errorRound, setErrorRound] = useState(0);

  const showErrors = (map: ManualMethodErrors) => {
    setErrors(map);
    setErrorRound((n) => n + 1);
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
            <Flex direction="column" alignItems="stretch" gap={6}>
              <LocaleSwitcher
                locales={locales}
                defaultLocale={defaultLocale}
                value={locale}
                onChange={setLocale}
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
                        update(
                          'names',
                          { ...draft.names, [locale]: e.target.value },
                          namePath(locale)
                        )
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
                    <Field.Hint />
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>
              </Grid.Root>
            </Flex>

            {markets.length === 0 ? (
              <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
                <Typography textColor="neutral800">
                  {t('ecommerce.settings.manual.noStoreMarkets')}
                </Typography>
              </Box>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Field.Root name="markets" error={marketsError} required>
                  <Field.Label>{t('ecommerce.settings.manual.markets')}</Field.Label>
                  <Flex gap={2} wrap="wrap">
                    <MarketPicker
                      options={marketOptions}
                      selected={draft.markets}
                      hasError={!!marketsError}
                      onChange={setMarkets}
                    />
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
                      variant="secondary"
                      size="L"
                      disabled={draft.markets.length === 0}
                      onClick={() => setFilling(true)}
                    >
                      {t('ecommerce.settings.manual.fillAll.open')}
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

                <FilteredMarkets codes={draft.markets} nameOf={countryName} resetKey={errorRound}>
                  {(visibleMarkets) => (
                    <Flex direction="column" alignItems="stretch">
                      {visibleMarkets.map((code) => {
                        const rows = draft.brackets[code] ?? [];
                        const marketError = errors[`rates.${code}`];
                        return (
                          <MarketCard key={code}>
                            <Flex direction="column" alignItems="stretch" gap={2}>
                              <Flex
                                justifyContent="space-between"
                                alignItems="center"
                                gap={2}
                                wrap="wrap"
                              >
                                <Typography variant="omega" fontWeight="bold" tag="h3">
                                  {countryName(code)}
                                </Typography>
                                <Flex gap={1}>
                                  <IconButton
                                    label={`${t('ecommerce.settings.manual.addRange')}: ${countryName(code)}`}
                                    variant="ghost"
                                    onClick={() => addRow(code)}
                                  >
                                    <Plus />
                                  </IconButton>
                                  <IconButton
                                    label={`${t('ecommerce.settings.manual.removeMarket')}: ${countryName(code)}`}
                                    variant="ghost"
                                    onClick={() =>
                                      setMarkets(draft.markets.filter((c) => c !== code))
                                    }
                                  >
                                    <Trash />
                                  </IconButton>
                                </Flex>
                              </Flex>
                              <BracketRows
                                rows={rows}
                                label={countryName(code)}
                                errorText={(i, field) => errorText(`rates.${code}.${i}.${field}`)}
                                onChange={(i, field, text) => updateRow(code, i, field, text)}
                                onRemove={(i) => removeRow(code, i)}
                              />
                              {marketError && (
                                <Typography variant="pi" textColor="danger600" role="alert">
                                  {marketError === 'required'
                                    ? t('ecommerce.settings.manual.rangesRequired')
                                    : errorText(`rates.${code}`)}
                                </Typography>
                              )}
                            </Flex>
                          </MarketCard>
                        );
                      })}
                    </Flex>
                  )}
                </FilteredMarkets>
              </Flex>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Flex gap={2}>
            <Button variant="tertiary" onClick={onClose}>
              {t('ecommerce.settings.cancel')}
            </Button>
            {/* Same as the variant's button: confirmed, then applied immediately on a saved method. */}
            <Button
              variant={draft.active ? 'danger-light' : 'success-light'}
              onClick={() => setConfirmToggle(true)}
              loading={toggling}
              disabled={saving}
            >
              {t(
                draft.active
                  ? 'ecommerce.settings.manualMethods.disable'
                  : 'ecommerce.settings.manualMethods.enable'
              )}
            </Button>
          </Flex>
          <Button onClick={save} loading={saving} disabled={markets.length === 0 || toggling}>
            {t('ecommerce.settings.save')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
      <ActionConfirmModal
        open={confirmToggle}
        title={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disableConfirm.title'
            : 'ecommerce.settings.manualMethods.enableConfirm.title'
        )}
        text={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disableConfirm.text'
            : 'ecommerce.settings.manualMethods.enableConfirm.text'
        )}
        confirmLabel={t(
          draft.active
            ? 'ecommerce.settings.manualMethods.disable'
            : 'ecommerce.settings.manualMethods.enable'
        )}
        cancelLabel={t('ecommerce.settings.cancel')}
        confirmVariant={draft.active ? 'danger' : 'default'}
        onCancel={() => setConfirmToggle(false)}
        onConfirm={() => {
          setConfirmToggle(false);
          toggleActive();
        }}
      />
      {filling && (
        <FillMarketsModal
          marketCount={draft.markets.length}
          onClose={() => setFilling(false)}
          onApply={fillAll}
        />
      )}
    </Modal.Root>
  );
};

export { ManualMethodModal };
