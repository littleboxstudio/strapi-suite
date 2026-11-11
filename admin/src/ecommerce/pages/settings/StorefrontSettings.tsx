import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { useNotification } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  Field,
  Flex,
  Link,
  Loader,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import FetchApiTokens from '../../usecases/settings/fetchApiTokens';
import UpdateStoreSettings from '../../usecases/settings/updateStoreSettings';
import EmptySection from '../../illustrations/EmptySection';
import { buildStoreSettingsInput, extractErrorCode, storeFormFromSettings } from '../../utils/settingsForm';
import { extractFieldErrors } from '../../utils/productForm';
import {
  TTL_MAX_HOURS,
  TTL_MIN_HOURS,
  storefrontBasePath,
  tokenWarning,
  validateTtlHours,
} from '../../utils/storefrontSettings';
import type { StoreSettings, StorefrontApiToken } from '../../settingsTypes';

const HEADERS = ['Authorization', 'X-Checkout-Session', 'Idempotency-Key', 'X-Storefront-Client-IP'] as const;
const API_TOKENS_PATH = '/settings/api-tokens';

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Box background="neutral0" shadow="tableShadow" hasRadius padding={6}>
    <Flex direction="column" alignItems="stretch" gap={5}>
      <Typography variant="delta" tag="h2">
        {title}
      </Typography>
      {children}
    </Flex>
  </Box>
);

const StorefrontSettings = ({ readOnly }: { readOnly: boolean }) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [tokens, setTokens] = useState<StorefrontApiToken[]>([]);
  const [tokenId, setTokenId] = useState<number | null>(null);
  const [ttl, setTtl] = useState('');
  const [ttlError, setTtlError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = (loaded: StoreSettings) => {
    setSettings(loaded);
    setTokenId(loaded.storefrontApiTokenId ?? null);
    setTtl(String(loaded.checkoutSessionTtlHours ?? ''));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [store, list] = await Promise.allSettled([
        new FetchStoreSettings().execute(),
        new FetchApiTokens().execute(),
      ]);
      if (cancelled) return;
      if (store.status === 'rejected') {
        setLoadError(true);
        return;
      }
      if (list.status === 'fulfilled') setTokens(list.value);
      apply(store.value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => tokens.find((tk) => tk.id === tokenId) ?? null, [tokens, tokenId]);
  const warning = useMemo(() => tokenWarning(selected, new Date()), [selected]);

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
  }
  if (!settings) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const save = async () => {
    if (saving || readOnly) return;
    const hours = validateTtlHours(ttl);
    if (hours === 'invalid_number') {
      setTtlError(hours);
      toggleNotification({ type: 'warning', message: t('ecommerce.settings.errors.fix') });
      return;
    }
    setSaving(true);
    try {
      const form = {
        ...storeFormFromSettings(settings),
        storefrontApiTokenId: tokenId,
        checkoutSessionTtlHours: hours,
      };
      const saved = await new UpdateStoreSettings().execute(buildStoreSettingsInput(form));
      apply(saved);
      setTtlError(null);
      setTokenError(null);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) {
        setTokenError(fieldErrors.find((e) => e.path === 'storefrontApiTokenId')?.code ?? null);
        setTtlError(fieldErrors.find((e) => e.path === 'checkoutSessionTtlHours')?.code ?? null);
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

  const apiTokensLink = (
    <Link tag={RouterLink} to={API_TOKENS_PATH}>
      {t('ecommerce.settings.storefrontApi.tokensLink')}
    </Link>
  );

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Card title={t('ecommerce.settings.storefrontApi.title')}>
        <Typography textColor="neutral600">{t('ecommerce.settings.storefrontApi.intro')}</Typography>

        {tokens.length === 0 ? (
          <Flex
            direction="column"
            alignItems="center"
            gap={3}
            padding={6}
            background="neutral100"
            hasRadius
          >
            <EmptySection />
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.settings.storefrontApi.noTokens')}
            </Typography>
            {apiTokensLink}
          </Flex>
        ) : (
          <Field.Root
            name="storefrontApiTokenId"
            error={tokenError ? t(`ecommerce.settings.errors.${tokenError}`) : undefined}
            hint={t('ecommerce.settings.storefrontApi.token.hint')}
          >
            <Field.Label>{t('ecommerce.settings.storefrontApi.token')}</Field.Label>
            <SingleSelect
              value={tokenId === null ? '' : String(tokenId)}
              disabled={readOnly}
              hasError={!!tokenError}
              placeholder={t('ecommerce.settings.storefrontApi.token.none')}
              onChange={(value: string | number) => {
                setTokenId(value === '' ? null : Number(value));
                setTokenError(null);
              }}
              onClear={readOnly ? undefined : () => setTokenId(null)}
            >
              {tokens.map((tk) => (
                <SingleSelectOption key={tk.id} value={String(tk.id)}>
                  {`${tk.name} (${tk.type})`}
                </SingleSelectOption>
              ))}
            </SingleSelect>
            <Field.Error />
            <Field.Hint />
          </Field.Root>
        )}

        {warning && (
          <Box role="status" background="warning100" borderColor="warning200" hasRadius padding={4}>
            <Flex gap={3} alignItems="flex-start">
              <Box color="warning600" paddingTop={1}>
                <WarningCircle aria-hidden fill="currentColor" />
              </Box>
              <Typography textColor="neutral800">
                {t(`ecommerce.settings.storefrontApi.warning.${warning}`)}
              </Typography>
            </Flex>
          </Box>
        )}

        <Field.Root
          name="checkoutSessionTtlHours"
          error={ttlError ? t(`ecommerce.settings.errors.${ttlError}`) : undefined}
          hint={t('ecommerce.settings.storefrontApi.ttl.hint', { min: TTL_MIN_HOURS, max: TTL_MAX_HOURS })}
        >
          <Field.Label>{t('ecommerce.settings.storefrontApi.ttl')}</Field.Label>
          <TextInput
            type="number"
            min={TTL_MIN_HOURS}
            max={TTL_MAX_HOURS}
            value={ttl}
            disabled={readOnly}
            onChange={(e: any) => {
              setTtl(e.target.value);
              setTtlError(null);
            }}
          />
          <Field.Error />
          <Field.Hint />
        </Field.Root>

        {!readOnly && (
          <Flex justifyContent="flex-end">
            <Button onClick={save} loading={saving}>
              {t('ecommerce.settings.save')}
            </Button>
          </Flex>
        )}
      </Card>

      <Card title={t('ecommerce.settings.storefrontApi.info.title')}>
        <Typography variant="pi" textColor="neutral600">
          {t('ecommerce.settings.storefrontApi.info.description')}
        </Typography>
        <Field.Root name="storefrontBasePath">
          <Field.Label>{t('ecommerce.settings.storefrontApi.info.basePath')}</Field.Label>
          <TextInput value={storefrontBasePath} readOnly onFocus={(e: any) => e.target.select()} />
        </Field.Root>
        <Flex direction="column" alignItems="flex-start" gap={2}>
          <Typography variant="sigma" textColor="neutral600">
            {t('ecommerce.settings.storefrontApi.info.headers')}
          </Typography>
          <Flex direction="column" alignItems="flex-start" gap={2} tag="ul">
            {HEADERS.map((header) => (
              <Flex key={header} direction="column" alignItems="flex-start" tag="li">
                <Typography variant="omega" style={{ fontFamily: 'monospace' }}>
                  {header}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t(`ecommerce.settings.storefrontApi.info.header.${header}`)}
                </Typography>
              </Flex>
            ))}
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
};

export { StorefrontSettings };
