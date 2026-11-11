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
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { StoreLogoField } from '../../components/settings/StoreLogoField';
import { MarketsTable } from '../../components/settings/MarketsTable';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import FetchIntegrations from '../../usecases/settings/fetchIntegrations';
import UpdateStoreSettings from '../../usecases/settings/updateStoreSettings';
import { extractFieldErrors } from '../../utils/productForm';
import {
  buildStoreSettingsInput,
  countryOptions,
  extractErrorCode,
  isValidHexColor,
  marketInUseZones,
  storeFormFromSettings,
  timezoneOptions,
  validateStoreForm,
  type StoreForm,
} from '../../utils/settingsForm';
import type { SettingsFieldError, StoreSettings } from '../../settingsTypes';

type TextField = Exclude<keyof StoreForm, 'markets' | 'timezone'>;

/** First error code per top-level field (`markets.2` → `markets`). */
type ErrorMap = Partial<Record<keyof StoreForm, string>>;

const toErrorMap = (errors: SettingsFieldError[]): ErrorMap => {
  const map: ErrorMap = {};
  errors.forEach(({ path, code }) => {
    const field = path.split('.')[0] as keyof StoreForm;
    if (!(field in map)) map[field] = code;
  });
  return map;
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
      {children}
    </Flex>
  </Box>
);

const ColorSwatch = styled.input`
  width: 40px;
  height: 40px;
  padding: 2px;
  flex-shrink: 0;
  cursor: pointer;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};

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
  const [errors, setErrors] = useState<ErrorMap>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<StoreSettings['logo']>(null);
  /** Zones named by a `MARKET_IN_USE` error, shown in the Markets field. */
  const [marketZones, setMarketZones] = useState<string[]>([]);

  const countries = useMemo(() => countryOptions(locale), [locale]);
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

  const errorText = (field: keyof StoreForm) =>
    errors[field]
      ? t(`ecommerce.settings.errors.${errors[field]}`, { zones: marketZones.join(', ') })
      : undefined;

  const showErrors = (list: SettingsFieldError[]) => {
    setErrors(toErrorMap(list));
    setMarketZones(marketInUseZones(list));
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

      <Section title={t('ecommerce.settings.store.title')}>
        <Grid.Root gap={5}>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('storeName', { required: true })}
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('supportEmail', {
              type: 'email',
              placeholder: 'support@example.com',
              hint: t('ecommerce.settings.store.supportEmail.hint'),
            })}
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <StoreLogoField
              logo={logo}
              readOnly={readOnly}
              onChange={(saved) => setLogo(saved.logo)}
            />
          </Grid.Item>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            {textField('brandColor', {
              required: true,
              placeholder: '#4945ff',
              hint: t('ecommerce.settings.store.brandColor.hint'),
              start: (
                <ColorSwatch
                  type="color"
                  aria-label={t('ecommerce.settings.store.brandColor.picker')}
                  value={isValidHexColor(brandColor) ? brandColor.toLowerCase() : '#000000'}
                  disabled={readOnly}
                  onChange={(e) => update('brandColor', e.target.value)}
                />
              ),
            })}
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section title={t('ecommerce.settings.storefront.title')}>
        <Grid.Root gap={5}>
          <Grid.Item col={12} direction="column" alignItems="stretch">
            {textField('storefrontUrl', {
              placeholder: 'https://shop.example.com',
              hint: t('ecommerce.settings.store.storefrontUrl.hint'),
            })}
          </Grid.Item>
        </Grid.Root>
      </Section>

      <Section title={t('ecommerce.settings.region.title')}>
        <Grid.Root gap={5}>
          <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
            <Field.Root name="timezone" required error={errorText('timezone')}>
              <Field.Label>{t('ecommerce.settings.store.timezone')}</Field.Label>
              <SingleSelect
                value={form.timezone}
                disabled={readOnly}
                hasError={!!errors.timezone}
                onChange={(value: string | number) => update('timezone', String(value))}
              >
                {timezones.map((zone) => (
                  <SingleSelectOption key={zone} value={zone}>
                    {zone}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Field.Error />
            </Field.Root>
          </Grid.Item>
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
        <Flex justifyContent="flex-end">
          <Button onClick={save} loading={saving}>
            {t('ecommerce.settings.save')}
          </Button>
        </Flex>
      )}
    </Flex>
  );
};

export { GeneralSettings };
