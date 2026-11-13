import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Information, Trash } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import UpdateIntegration from '../../usecases/settings/updateIntegration';
import FetchIntegrationLookups from '../../usecases/settings/fetchIntegrationLookups';
import { extractFieldErrors } from '../../utils/productForm';
import { countryOptions, extractErrorCode } from '../../utils/settingsForm';
import {
  buildIntegrationPayload,
  credentialsSaved,
  hasCredentialsStep,
  integrationErrorMap,
  integrationFormFromView,
  isIntegerText,
  lookupFieldOptions,
  missingCredentials,
  stepFields,
  type IntegrationFormValues,
  validateIntegrationForm,
  showsAsRequired,
} from '../../utils/integrationForm';
import type { IntegrationView, LookupResult, ProviderField } from '../../settingsTypes';
import { FieldHelpModal } from './FieldHelpModal';
import { FilteredMarkets, MarketPicker, MarketRow } from './MarketPicker';

/** All fields in two columns (one on narrow screens). */
const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px 16px;
  align-items: start;

  @media (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

/** A field that takes the whole row of the grid (the markets list). */
const FullRow = styled.div`
  grid-column: 1 / -1;
`;

const FieldCell = ({ full, children }: { full: boolean; children: React.ReactNode }) =>
  full ? <FullRow>{children}</FullRow> : <>{children}</>;

/** The field whose value selects the company-specific lookup lists. */
const COMPANY_FIELD = 'companyId';

type Step = 'credentials' | 'details';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; result: LookupResult; companyId: string }
  | { status: 'error'; code: string | null };

/** Mount it only while open: the form is initialised once, from the props. */
type Props = {
  integration: IntegrationView;
  /** Errors to show on open (e.g. an activation refused for missing fields), keyed by field. */
  initialErrors?: Record<string, string>;
  /** The store markets offered by a `markets` field. */
  markets?: string[];
  onClose: () => void;
  onSaved: (integration: IntegrationView) => void;
  /** Two-step providers: the credentials were saved and the modal stays open on step 2. */
  onChanged?: (integration: IntegrationView) => void;
};

/**
 * Every label row as tall as one with the "i" help button, so the fields of a grid row line up
 * whether or not their label has one.
 */
const LabelRow = styled.div`
  display: flex;
  align-items: center;
  min-height: 22px;
`;

const IntegrationConfigModal = ({
  integration,
  initialErrors = {},
  markets = [],
  onClose,
  onSaved,
  onChanged,
}: Props) => {
  const { formatMessage, locale: uiLocale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  /** The store markets by country name, for `markets` fields. */
  const marketOptions = useMemo(
    () => countryOptions(uiLocale).filter((c) => markets.includes(c.code)),
    [uiLocale, markets]
  );

  const [values, setValues] = useState<IntegrationFormValues>(() =>
    integrationFormFromView(integration)
  );
  const [errors, setErrors] = useState<Record<string, string>>(initialErrors);
  const [saving, setSaving] = useState(false);
  /** Stored optional secrets the user chose to delete on save. */
  const [clearedSecrets, setClearedSecrets] = useState<string[]>([]);
  /** The field whose "how to find this" help is open. */
  const [helpField, setHelpField] = useState<ProviderField | null>(null);
  /** The integration as last saved: step 1 saves the credentials without closing the modal. */
  const [current, setCurrent] = useState<IntegrationView>(integration);

  const twoStep = hasCredentialsStep(integration.fields);
  const [step, setStep] = useState<Step>(() =>
    twoStep && !credentialsSaved(integration) ? 'credentials' : 'details'
  );
  const [lookups, setLookups] = useState<LookupState>({ status: 'idle' });
  /** Why step 1 could not continue: an i18n key (the provider refused the credentials, ...). */
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const lookupRequest = useRef(0);

  const hasCompanyField = integration.fields.some((f) => f.key === COMPANY_FIELD);
  const companyValue =
    hasCompanyField && typeof values[COMPANY_FIELD] === 'string'
      ? (values[COMPANY_FIELD] as string)
      : '';

  /** Reads the lookup lists for the given company (or only the companies). */
  const loadLookups = async (companyId: string): Promise<LookupState> => {
    const request = ++lookupRequest.current;
    setLookups({ status: 'loading' });
    let next: LookupState;
    try {
      const result = await new FetchIntegrationLookups().execute(
        integration.id,
        companyId || undefined
      );
      next = { status: 'ok', result, companyId };
    } catch (err) {
      next = { status: 'error', code: extractErrorCode(err) };
    }
    // A newer request (another company picked) wins.
    if (request === lookupRequest.current) setLookups(next);
    return next;
  };

  // Step 2: (re)load the lists when it opens and whenever another company is picked.
  useEffect(() => {
    if (!twoStep || step !== 'details') return;
    if (lookups.status === 'ok' && lookups.companyId === companyValue) return;
    if (lookups.status === 'loading') return;
    loadLookups(companyValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twoStep, step, companyValue]);

  const name = t(
    `ecommerce.settings.providers.${integration.id}.name`,
    undefined,
    integration.name
  );
  const hasSecrets = integration.fields.some((f) => f.type === 'secret');
  const visibleFields = twoStep ? stepFields(integration.fields, step) : integration.fields;

  /** Step 1 → 2: saves the credentials, then checks them by reading the companies. */
  const continueToDetails = async () => {
    if (checking) return;
    setCredentialsError(null);
    const missing = missingCredentials(current, values);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((key) => [key, 'required'])));
      return;
    }
    setChecking(true);
    try {
      const credentialFields = stepFields(integration.fields, 'credentials');
      let saved: IntegrationView;
      try {
        saved = await new UpdateIntegration().execute(
          integration.id,
          buildIntegrationPayload(credentialFields, values)
        );
      } catch (err) {
        const fieldErrors = extractFieldErrors(err);
        const code = extractErrorCode(err);
        if (fieldErrors) setErrors(integrationErrorMap(fieldErrors));
        setCredentialsError(
          code ? `ecommerce.settings.errors.${code}` : 'ecommerce.settings.saveError'
        );
        return;
      }
      setCurrent(saved);
      onChanged?.(saved);
      // Saved secrets now show as masks; the typed values are no longer needed.
      setValues((v) => {
        const next = { ...v };
        credentialFields.filter((f) => f.type === 'secret').forEach((f) => (next[f.key] = ''));
        return next;
      });
      const result = await loadLookups(companyValue);
      if (result.status === 'ok') setStep('details');
      else {
        const code = result.status === 'error' ? result.code : null;
        setCredentialsError(`ecommerce.settings.integrations.lookup.errors.${code ?? 'unknown'}`);
      }
    } finally {
      setChecking(false);
    }
  };

  /** Lookup options for a field; null when the field falls back to a plain input. */
  const lookupState = (field: ProviderField) => {
    if (!twoStep || !field.lookup) return null;
    if (lookups.status === 'idle' || lookups.status === 'loading')
      return { kind: 'loading' as const };
    if (lookups.status === 'error') return null;
    if (lookups.result.failed.includes(field.lookup)) return null;
    const list = lookups.result.lists[field.lookup];
    if (!list) return field.key === COMPANY_FIELD ? null : { kind: 'needsCompany' as const };
    return { kind: 'list' as const, list };
  };

  const setValue = (key: string, value: string | boolean | string[]) => {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // Ids of series, methods, ... belong to one company: picking another one clears them.
      if (twoStep && key === COMPANY_FIELD && v[key] !== value) {
        integration.fields
          .filter((f) => f.lookup && f.key !== COMPANY_FIELD)
          .forEach((f) => (next[f.key] = ''));
      }
      return next;
    });
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  };

  const save = async () => {
    if (saving) return;
    const local = validateIntegrationForm(integration.fields, values, integration.active);
    if (Object.keys(local).length) {
      setErrors(local);
      toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      return;
    }
    setSaving(true);
    try {
      const saved = await new UpdateIntegration().execute(
        integration.id,
        buildIntegrationPayload(integration.fields, values, clearedSecrets)
      );
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
      onSaved(saved);
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) {
        const map = integrationErrorMap(fieldErrors);
        setErrors(map);
        // An error on a credential is only visible on step 1.
        if (twoStep && stepFields(integration.fields, 'credentials').some((f) => f.key in map)) {
          setStep('credentials');
        }
        toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      } else if (code) {
        toggleNotification({ type: 'danger', message: t(`ecommerce.settings.errors.${code}`) });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
      }
    } finally {
      setSaving(false);
    }
  };

  const fieldInput = (field: ProviderField) => {
    const value = values[field.key];
    const hasError = !!errors[field.key];

    const lookup = lookupState(field);
    if (lookup) {
      const text = typeof value === 'string' ? value : '';
      if (lookup.kind !== 'list') {
        return (
          <SingleSelect
            disabled
            value=""
            placeholder={t(
              lookup.kind === 'loading'
                ? 'ecommerce.settings.integrations.lookup.loading'
                : 'ecommerce.settings.integrations.lookup.chooseCompany'
            )}
            onChange={() => undefined}
          >
            {[]}
          </SingleSelect>
        );
      }
      const options = lookupFieldOptions(lookup.list, text, (id) =>
        t('ecommerce.settings.integrations.lookup.unknown', { value: id, name })
      );
      return (
        <SingleSelect
          value={text}
          hasError={hasError}
          placeholder={t(
            field.required
              ? 'ecommerce.settings.integrations.selectPlaceholder'
              : 'ecommerce.settings.integrations.lookup.automatic',
            { name }
          )}
          onChange={(next: string | number) => setValue(field.key, String(next))}
          onClear={field.required ? undefined : () => setValue(field.key, '')}
        >
          {options.map((option) => (
            <SingleSelectOption key={option.value} value={option.value}>
              {option.label}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      );
    }

    switch (field.type) {
      case 'boolean':
        return (
          <Flex gap={3}>
            <Switch
              checked={value === true}
              onCheckedChange={(checked: boolean) => setValue(field.key, checked)}
              aria-label={t(field.label, undefined, field.key)}
            />
          </Flex>
        );
      case 'select':
        return (
          <SingleSelect
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            placeholder={t('ecommerce.settings.integrations.selectPlaceholder')}
            onChange={(next: string | number) => setValue(field.key, String(next))}
            onClear={field.required ? undefined : () => setValue(field.key, '')}
          >
            {(field.options ?? []).map((option) => (
              <SingleSelectOption key={option} value={option}>
                {t(`${field.label}.options.${option}`, undefined, option)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        );
      case 'secret': {
        const cleared = clearedSecrets.includes(field.key);
        const clearable = !field.required && !!current.secrets[field.key];
        return (
          <Flex gap={2} alignItems="center">
            <Box flex="1">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={typeof value === 'string' ? value : ''}
                placeholder={cleared ? '' : (current.secrets[field.key] ?? '')}
                hasError={hasError}
                onChange={(e: any) => {
                  setValue(field.key, e.target.value);
                  // Typing a new value replaces the stored one instead of clearing it.
                  if (cleared) setClearedSecrets((keys) => keys.filter((k) => k !== field.key));
                }}
              />
            </Box>
            {clearable && (
              <Button
                variant="tertiary"
                size="L"
                onClick={() => {
                  setValue(field.key, '');
                  setClearedSecrets((keys) =>
                    cleared ? keys.filter((k) => k !== field.key) : [...keys, field.key]
                  );
                }}
              >
                {t(`ecommerce.settings.integrations.secret.${cleared ? 'undoClear' : 'clear'}`)}
              </Button>
            )}
          </Flex>
        );
      }
      case 'markets': {
        if (markets.length === 0) {
          return (
            <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
              <Typography textColor="neutral800">
                {t('ecommerce.settings.manual.noStoreMarkets')}
              </Typography>
            </Box>
          );
        }
        const selected = Array.isArray(value) ? value : [];
        const countryName = (code: string) =>
          marketOptions.find((c) => c.code === code)?.name ?? code;
        return (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex gap={2} wrap="wrap">
              <MarketPicker
                options={marketOptions}
                selected={selected}
                hasError={hasError}
                onChange={(next) => setValue(field.key, next)}
              />
              <Button
                variant="secondary"
                size="L"
                disabled={markets.every((code) => selected.includes(code))}
                onClick={() =>
                  setValue(field.key, [
                    ...selected,
                    ...markets.filter((code) => !selected.includes(code)),
                  ])
                }
              >
                {t('ecommerce.settings.manual.selectAll')}
              </Button>
              <Button
                variant="tertiary"
                size="L"
                disabled={selected.length === 0}
                onClick={() => setValue(field.key, [])}
              >
                {t('ecommerce.settings.manual.clear')}
              </Button>
            </Flex>
            {selected.length > 0 && (
              <FilteredMarkets codes={selected} nameOf={countryName}>
                {(visibleMarkets) => (
                  <Box>
                    {visibleMarkets.map((code) => (
                      <MarketRow key={code}>
                        <Typography variant="omega">{countryName(code)}</Typography>
                        <IconButton
                          label={`${t('ecommerce.settings.manual.removeMarket')}: ${countryName(code)}`}
                          variant="ghost"
                          onClick={() =>
                            setValue(
                              field.key,
                              selected.filter((c) => c !== code)
                            )
                          }
                        >
                          <Trash />
                        </IconButton>
                      </MarketRow>
                    ))}
                  </Box>
                )}
              </FilteredMarkets>
            )}
          </Flex>
        );
      }
      case 'number':
        return (
          <TextInput
            inputMode="numeric"
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            onChange={(e: any) => {
              const next = e.target.value.trim();
              if (isIntegerText(next)) setValue(field.key, next);
            }}
          />
        );
      default:
        return (
          <TextInput
            type={field.format === 'email' ? 'email' : 'text'}
            placeholder={typeof field.default === 'string' ? field.default : undefined}
            value={typeof value === 'string' ? value : ''}
            hasError={hasError}
            onChange={(e: any) => setValue(field.key, e.target.value)}
          />
        );
    }
  };

  const secretHint = (field: ProviderField) => {
    if (field.type !== 'secret') return undefined;
    if (clearedSecrets.includes(field.key)) {
      return t('ecommerce.settings.integrations.secret.clearHint');
    }
    if (current.secretsStatus === 'unreadable') {
      return t('ecommerce.settings.integrations.secret.unreadableHint');
    }
    return current.secrets[field.key]
      ? t('ecommerce.settings.integrations.secret.keepHint')
      : undefined;
  };

  return (
    <Modal.Root open onOpenChange={(next: boolean) => !next && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>{t('ecommerce.settings.integrations.configureTitle', { name })}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={5}>
            {hasSecrets && !integration.encryptionKeyConfigured && (
              <Box background="warning100" borderColor="warning200" hasRadius padding={4}>
                <Typography textColor="neutral800">
                  {t('ecommerce.settings.errors.ENCRYPTION_KEY_MISSING')}
                </Typography>
              </Box>
            )}
            {twoStep && step === 'credentials' && (
              <Typography variant="omega" textColor="neutral600">
                {t('ecommerce.settings.integrations.steps.credentials', { name })}
              </Typography>
            )}
            {twoStep && step === 'credentials' && credentialsError && (
              <Box
                background="danger100"
                borderColor="danger200"
                hasRadius
                padding={4}
                role="alert"
              >
                <Typography textColor="danger700">
                  {t(
                    credentialsError,
                    { name },
                    t('ecommerce.settings.integrations.lookup.errors.unknown', { name })
                  )}
                </Typography>
              </Box>
            )}
            {twoStep && step === 'details' && (
              <Flex
                justifyContent="space-between"
                alignItems="center"
                gap={4}
                background="neutral100"
                hasRadius
                padding={4}
              >
                <Flex gap={2} alignItems="center">
                  {lookups.status === 'loading' && <Loader small />}
                  <Typography variant="omega">
                    {t('ecommerce.settings.integrations.steps.details', {
                      name,
                      user: String(current.config.username ?? ''),
                    })}
                  </Typography>
                </Flex>
                <Button variant="tertiary" onClick={() => setStep('credentials')}>
                  {t('ecommerce.settings.integrations.steps.editCredentials')}
                </Button>
              </Flex>
            )}
            {twoStep && step === 'details' && lookups.status === 'error' && (
              <Box
                background="warning100"
                borderColor="warning200"
                hasRadius
                padding={4}
                role="alert"
              >
                <Typography textColor="neutral800">
                  {t(
                    `ecommerce.settings.integrations.lookup.errors.${lookups.code ?? 'unknown'}`,
                    { name },
                    t('ecommerce.settings.integrations.lookup.errors.unknown', { name })
                  )}{' '}
                  {t('ecommerce.settings.integrations.lookup.manual')}
                </Typography>
              </Box>
            )}
            {twoStep &&
              step === 'details' &&
              lookups.status === 'ok' &&
              lookups.result.failed.length > 0 && (
                <Box
                  background="warning100"
                  borderColor="warning200"
                  hasRadius
                  padding={4}
                  role="note"
                >
                  <Typography textColor="neutral800">
                    {t('ecommerce.settings.integrations.lookup.someFailed', { name })}
                  </Typography>
                </Box>
              )}
            <FieldGrid>
              {visibleFields.map((field) => (
                <FieldCell key={field.key} full={field.type === 'markets'}>
                  <Field.Root
                    name={field.key}
                    required={showsAsRequired(field)}
                    error={
                      errors[field.key]
                        ? t(`ecommerce.settings.errors.${errors[field.key]}`)
                        : undefined
                    }
                    hint={secretHint(field)}
                  >
                    <LabelRow>
                      <Field.Label
                        action={
                          field.help ? (
                            <IconButton
                              variant="ghost"
                              size="XS"
                              label={t('ecommerce.settings.integrations.help.open', {
                                field: t(field.label, undefined, field.key),
                              })}
                              onClick={() => setHelpField(field)}
                            >
                              <Information />
                            </IconButton>
                          ) : undefined
                        }
                      >
                        {t(field.label, undefined, field.key)}
                      </Field.Label>
                    </LabelRow>
                    {fieldInput(field)}
                    <Field.Error />
                    <Field.Hint />
                  </Field.Root>
                </FieldCell>
              ))}
            </FieldGrid>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="tertiary" onClick={onClose}>
            {t('ecommerce.settings.cancel')}
          </Button>
          {twoStep && step === 'credentials' ? (
            <Button onClick={continueToDetails} loading={checking}>
              {t('ecommerce.settings.integrations.steps.continue')}
            </Button>
          ) : (
            <Button onClick={save} loading={saving}>
              {t('ecommerce.settings.save')}
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
      {helpField?.help && (
        <FieldHelpModal
          title={t(helpField.label, undefined, helpField.key)}
          textKey={helpField.help}
          onClose={() => setHelpField(null)}
        />
      )}
    </Modal.Root>
  );
};

export { IntegrationConfigModal };
