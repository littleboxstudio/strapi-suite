import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Grid,
  Loader,
  Radio,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { StoreLogoField } from '../../components/settings/StoreLogoField';
import { MarketsTable } from '../../components/settings/MarketsTable';
import { ModuleStatusSection } from '../../components/settings/ModuleStatusSection';
import { HeaderActions } from '../../components/HeaderActions';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import FetchIntegrations from '../../usecases/settings/fetchIntegrations';
import UpdateStoreSettings from '../../usecases/settings/updateStoreSettings';
import { extractFieldErrors } from '../../utils/productForm';
import {
  buildStoreSettingsInput,
  extractErrorCode,
  isValidHexColor,
  marketInUseNames,
  marketOptions,
  storeFormFromSettings,
  timezoneOptions,
  validateStoreForm,
  type StoreForm,
} from '../../utils/settingsForm';
import type {
  AccountsReadiness,
  CustomerAccountsMode,
  SettingsFieldError,
  StoreSettings,
} from '../../settingsTypes';

type TextField = Exclude<
  keyof StoreForm,
  'markets' | 'timezone' | 'customerAccountsMode' | 'checkoutSessionTtlHours'
>;

const ACCOUNT_MODES: CustomerAccountsMode[] = ['GUEST_ONLY', 'REGISTERED_ONLY', 'BOTH'];

/** First error code per field (`markets.2` → `markets`). */
type ErrorMap = Partial<Record<string, string>>;

const toErrorMap = (errors: SettingsFieldError[]): ErrorMap => {
  const map: ErrorMap = {};
  errors.forEach(({ path, code }) => {
    const field = path.split('.')[0];
    if (!(field in map)) map[field] = code;
  });
  return map;
};

/** A white card; the title is optional (the logo card has none). */
const Section = ({ title, children }: { title?: string; children: ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      {title && (
        <Typography variant="delta" tag="h2">
          {title}
        </Typography>
      )}
      {children}
    </Flex>
  </Box>
);

/** The bordered square; the colour picker inside fills it edge to edge. */
const SwatchFrame = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const ColorSwatch = styled.input`
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  appearance: none;

  /* The browser's own inner padding and border around the colour. */
  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  &::-webkit-color-swatch {
    border: 0;
    border-radius: 0;
  }
  &::-moz-color-swatch {
    border: 0;
    border-radius: 0;
  }

  &:disabled {
    cursor: not-allowed;
  }
`;

const GeneralSettings = ({ readOnly }: { readOnly: boolean }) => {
  const { formatMessage, locale } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [form, setForm] = useState<StoreForm | null>(null);
  const [keyConfigured, setKeyConfigured] = useState(true);
  const [readiness, setReadiness] = useState<AccountsReadiness | null>(null);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<StoreSettings['logo']>(null);
  /** Shipping methods and carriers named by a `MARKET_IN_USE` error, shown in the Markets field. */
  const [marketUsers, setMarketUsers] = useState<string[]>([]);

  const islandsName = t('ecommerce.settings.markets.names.PT-ISL');
  const countries = useMemo(() => marketOptions(locale, islandsName), [locale, islandsName]);
  const timezones = useMemo(() => timezoneOptions(form?.timezone ?? ''), [form?.timezone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [store, integrations] = await Promise.allSettled([
        new FetchStoreSettings().execute(),
        new FetchIntegrations().execute(),
      ]);
      if (cancelled) return;
      if (store.status === 'rejected') {
        setLoadError(true);
        return;
      }
      setForm(storeFormFromSettings(store.value));
      setLogo(store.value.logo);
      setReadiness(store.value.accountsReadiness ?? null);
      // Every integration carries the same flag; without the list, assume the key is there.
      if (integrations.status === 'fulfilled' && integrations.value.length > 0) {
        setKeyConfigured(integrations.value[0].encryptionKeyConfigured);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
  }

  if (!form) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const update = <K extends keyof StoreForm>(field: K, value: StoreForm[K]) => {
    setForm((f) => (f ? { ...f, [field]: value } : f));
    setErrors((map) => {
      if (!(field in map)) return map;
      const next = { ...map };
      delete next[field];
      return next;
    });
  };

  const errorText = (field: string) =>
    errors[field]
      ? t(`ecommerce.settings.errors.${errors[field]}`, { methods: marketUsers.join(', ') })
      : undefined;

  const showErrors = (list: SettingsFieldError[]) => {
    setErrors(toErrorMap(list));
    setMarketUsers(marketInUseNames(list));
    toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
  };

  const save = async () => {
    if (saving || readOnly) return;
    const local = validateStoreForm(form);
    if (local.length) {
      showErrors(local);
      return;
    }
    setSaving(true);
    try {
      const saved = await new UpdateStoreSettings().execute(buildStoreSettingsInput(form));
      setForm(storeFormFromSettings(saved));
      setLogo(saved.logo);
      setReadiness(saved.accountsReadiness ?? readiness);
      setErrors({});
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) showErrors(fieldErrors);
      else if (code)
        toggleNotification({ type: 'danger', message: t(`ecommerce.settings.errors.${code}`) });
      else toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
    } finally {
      setSaving(false);
    }
  };

  const textField = (
    field: TextField,
    options: {
      required?: boolean;
      hint?: string;
      placeholder?: string;
      type?: string;
      start?: ReactNode;
    } = {}
  ) => (
    <Field.Root
      name={field}
      required={options.required}
      error={errorText(field)}
      hint={options.hint}
    >
      <Field.Label>{t(`ecommerce.settings.store.${field}`)}</Field.Label>
      <Flex gap={2} alignItems="center">
        {options.start}
        <Box style={{ flex: 1 }}>
          <TextInput
            type={options.type ?? 'text'}
            value={form[field]}
            placeholder={options.placeholder}
            disabled={readOnly}
            onChange={(e: any) => update(field, e.target.value)}
          />
        </Box>
      </Flex>
      <Field.Error />
      <Field.Hint />
    </Field.Root>
  );

  const brandColor = form.brandColor.trim();

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      {!keyConfigured && (
        <Box role="status" background="warning100" borderColor="warning200" hasRadius padding={5}>
          <Flex gap={3} alignItems="flex-start">
            <Box color="warning600" paddingTop={1}>
              <WarningCircle aria-hidden fill="currentColor" />
            </Box>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography fontWeight="bold" textColor="neutral800">
                {t('ecommerce.settings.encryptionKey.title')}
              </Typography>
              <Typography textColor="neutral800">
                {t('ecommerce.settings.encryptionKey.description', {
                  variable: <code key="variable">LTB_ECOMMERCE_ENCRYPTION_KEY</code>,
                })}
              </Typography>
            </Flex>
          </Flex>
        </Box>
      )}

      <ModuleStatusSection readOnly={readOnly} />

      <Section>
        <StoreLogoField logo={logo} readOnly={readOnly} onChange={(saved) => setLogo(saved.logo)} />
      </Section>

      <Section title={t('ecommerce.settings.store.title')}>
        <Grid.Root gap={5}>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('storeName', { required: true })}
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <Field.Root name="timezone" required error={errorText('timezone')}>
              <Field.Label>{t('ecommerce.settings.store.timezone')}</Field.Label>
              <SingleSelect
                value={form.timezone}
                disabled={readOnly}
                hasError={!!errors.timezone}
                onChange={(value: string | number) => update('timezone', String(value))}
              >
                {timezones.map((tz) => (
                  <SingleSelectOption key={tz} value={tz}>
                    {tz}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Error />
            </Field.Root>
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('supportEmail', {
              type: 'email',
              placeholder: 'support@example.com',
              hint: t('ecommerce.settings.store.supportEmail.hint'),
            })}
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('brandColor', {
              required: true,
              placeholder: '#4945ff',
              hint: t('ecommerce.settings.store.brandColor.hint'),
              start: (
                <SwatchFrame>
                  <ColorSwatch
                    type="color"
                    aria-label={t('ecommerce.settings.store.brandColor.picker')}
                    value={isValidHexColor(brandColor) ? brandColor.toLowerCase() : '#000000'}
                    disabled={readOnly}
                    onChange={(e) => update('brandColor', e.target.value)}
                  />
                </SwatchFrame>
              ),
            })}
          </Grid.Item>
          <Grid.Item col={12} direction="column" alignItems="stretch">
            {textField('storefrontUrl', {
              placeholder: 'https://shop.example.com',
              hint: t('ecommerce.settings.store.storefrontUrl.hint'),
            })}
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section title={t('ecommerce.settings.accounts.title')}>
        <Flex direction="column" alignItems="stretch" gap={5}>
          <Field.Root name="customerAccountsMode" error={errorText('customerAccountsMode')}>
            <Field.Label>{t('ecommerce.settings.accounts.mode')}</Field.Label>
            <Radio.Group
              value={form.customerAccountsMode}
              disabled={readOnly}
              aria-label={t('ecommerce.settings.accounts.mode')}
              onValueChange={(value: string) =>
                update('customerAccountsMode', value as CustomerAccountsMode)
              }
            >
              <Flex direction="column" alignItems="flex-start" gap={2}>
                {ACCOUNT_MODES.map((mode) => (
                  <Radio.Item key={mode} value={mode}>
                    {t(`ecommerce.settings.accounts.mode.${mode}`)}
                  </Radio.Item>
                ))}
              </Flex>
            </Radio.Group>
            <Field.Error />
          </Field.Root>

          {form.customerAccountsMode !== 'GUEST_ONLY' && readiness && (!readiness.pepperConfigured || !readiness.keyConfigured) && (
            <Box role="status" background="warning100" borderColor="warning200" hasRadius padding={4}>
              <Flex gap={3} alignItems="flex-start">
                <Box color="warning600" paddingTop={1}>
                  <WarningCircle aria-hidden fill="currentColor" />
                </Box>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  <Typography fontWeight="bold" textColor="neutral800">
                    {t('ecommerce.settings.accounts.notReady.title')}
                  </Typography>
                  {!readiness.pepperConfigured && (
                    <Typography textColor="neutral800">
                      {t('ecommerce.settings.accounts.notReady.pepper', {
                        variable: <code key="pepper">LTB_ECOMMERCE_PASSWORD_PEPPER_V1</code>,
                      })}
                    </Typography>
                  )}
                  {!readiness.keyConfigured && (
                    <Typography textColor="neutral800">
                      {t('ecommerce.settings.accounts.notReady.key', {
                        variable: <code key="key">LTB_ECOMMERCE_ENCRYPTION_KEY</code>,
                      })}
                    </Typography>
                  )}
                </Flex>
              </Flex>
            </Box>
          )}

          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.settings.accounts.linksHint', {
              url: <code key="url">{'{{store.url}}'}</code>,
              token: <code key="token">{'{{token}}'}</code>,
            })}
          </Typography>
        </Flex>
      </Section>

      <Section title={t('ecommerce.settings.markets.title')}>
        <Grid.Root gap={5}>
          <Grid.Item col={12} direction="column" alignItems="stretch">
            <MarketsTable
              value={form.markets}
              countries={countries}
              readOnly={readOnly}
              error={errorText('markets')}
              onChange={(markets) => update('markets', markets)}
            />
          </Grid.Item>
        </Grid.Root>
      </Section>

      {!readOnly && (
        <HeaderActions>
          <Button variant="secondary" onClick={save} loading={saving}>
            {t('ecommerce.settings.save')}
          </Button>
        </HeaderActions>
      )}
    </Flex>
  );
};

export { GeneralSettings };
