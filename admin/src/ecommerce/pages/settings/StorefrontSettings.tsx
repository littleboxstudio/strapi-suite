import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Box, Button, Field, Flex, Loader, TextInput, Typography } from '@strapi/design-system';
import { ArrowClockwise, Key, WarningCircle } from '@strapi/icons';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchStoreSettings from '../../usecases/settings/fetchStoreSettings';
import FetchStorefrontToken from '../../usecases/settings/fetchStorefrontToken';
import GenerateStorefrontToken from '../../usecases/settings/generateStorefrontToken';
import RegenerateStorefrontToken from '../../usecases/settings/regenerateStorefrontToken';
import UpdateStoreSettings from '../../usecases/settings/updateStoreSettings';
import ConfirmModal from '../../../components/ConfirmModal';
import StorefrontTokenKeyModal from '../../components/settings/StorefrontTokenKeyModal';
import { HeaderActions } from '../../components/HeaderActions';
import {
  buildStoreSettingsInput,
  extractErrorCode,
  storeFormFromSettings,
} from '../../utils/settingsForm';
import { extractFieldErrors } from '../../utils/productForm';
import {
  TTL_MAX_HOURS,
  TTL_MIN_HOURS,
  storefrontBasePath,
  storefrontTokenActions,
  tokenWarnings,
  validateTtlHours,
} from '../../utils/storefrontSettings';
import type {
  GeneratedStorefrontToken,
  StoreSettings,
  StorefrontTokenState,
} from '../../settingsTypes';

const HEADERS = [
  'Authorization',
  'X-Checkout-Session',
  'Idempotency-Key',
  'X-Storefront-Client-IP',
] as const;

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

const Notice = ({ children }: { children: React.ReactNode }) => (
  <Box role="status" background="warning100" borderColor="warning200" hasRadius padding={4}>
    <Flex gap={3} alignItems="flex-start">
      <Box color="warning600" paddingTop={1}>
        <WarningCircle aria-hidden fill="currentColor" />
      </Box>
      <Typography textColor="neutral800">{children}</Typography>
    </Flex>
  </Box>
);

const Detail = ({ label, value }: { label: string; value: string }) => (
  <Flex direction="column" alignItems="flex-start" gap={1}>
    <Typography variant="sigma" textColor="neutral600">
      {label}
    </Typography>
    <Typography variant="omega">{value}</Typography>
  </Flex>
);

const StorefrontSettings = ({ readOnly }: { readOnly: boolean }) => {
  const { formatMessage, formatDate } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>) =>
    formatMessage({ id: getTranslation(id) }, values);

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [tokenState, setTokenState] = useState<StorefrontTokenState | null>(null);
  const [ttl, setTtl] = useState('');
  const [ttlError, setTtlError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tokenLoadError, setTokenLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [generated, setGenerated] = useState<GeneratedStorefrontToken | null>(null);

  const apply = (loaded: StoreSettings) => {
    setSettings(loaded);
    setTtl(String(loaded.checkoutSessionTtlHours ?? ''));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [store, token] = await Promise.allSettled([
        new FetchStoreSettings().execute(),
        new FetchStorefrontToken().execute(),
      ]);
      if (cancelled) return;
      if (store.status === 'rejected') {
        setLoadError(true);
        return;
      }
      if (token.status === 'fulfilled') setTokenState(token.value);
      else setTokenLoadError(true);
      apply(store.value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const warnings = useMemo(
    () => tokenWarnings(tokenState?.token ?? null, new Date()),
    [tokenState]
  );

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
      const form = { ...storeFormFromSettings(settings), checkoutSessionTtlHours: hours };
      const saved = await new UpdateStoreSettings().execute(buildStoreSettingsInput(form));
      apply(saved);
      setTtlError(null);
      toggleNotification({ type: 'success', message: t('ecommerce.settings.saved') });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) {
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

  const runTokenAction = async (kind: 'generate' | 'regenerate') => {
    if (tokenBusy || readOnly) return;
    setTokenBusy(true);
    try {
      const result =
        kind === 'generate'
          ? await new GenerateStorefrontToken().execute()
          : await new RegenerateStorefrontToken().execute();
      setTokenState({ token: result.token, missing: result.missing });
      setGenerated(result);
    } catch (err) {
      if (extractErrorCode(err) === 'STOREFRONT_TOKEN_EXISTS') {
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.settings.storefrontApi.tokenExists'),
        });
        try {
          setTokenState(await new FetchStorefrontToken().execute());
        } catch {
          // Keep the current state; the notification already explains what happened.
        }
      } else {
        toggleNotification({
          type: 'danger',
          message: t(`ecommerce.settings.storefrontApi.${kind}Error`),
        });
      }
    } finally {
      setTokenBusy(false);
    }
  };

  const formatWhen = (value: string | null) =>
    value
      ? formatDate(value, { dateStyle: 'medium', timeStyle: 'short' })
      : t('ecommerce.settings.storefrontApi.token.never');

  const tokenSection = () => {
    if (tokenLoadError || !tokenState) {
      return (
        <Typography textColor="danger600">
          {t('ecommerce.settings.storefrontApi.tokenLoadError')}
        </Typography>
      );
    }
    const actions = storefrontTokenActions(tokenState, readOnly);
    const { token } = tokenState;
    return (
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="sigma" textColor="neutral600" tag="h3">
            {t('ecommerce.settings.storefrontApi.token')}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {t('ecommerce.settings.storefrontApi.token.hint')}
          </Typography>
        </Flex>

        {token ? (
          <Box background="neutral100" hasRadius padding={4}>
            <Flex gap={6} wrap="wrap" alignItems="flex-start">
              <Detail label={t('ecommerce.settings.storefrontApi.token.name')} value={token.name} />
              <Detail
                label={t('ecommerce.settings.storefrontApi.token.createdAt')}
                value={formatWhen(token.createdAt)}
              />
              <Detail
                label={t('ecommerce.settings.storefrontApi.token.lastUsedAt')}
                value={formatWhen(token.lastUsedAt)}
              />
              {token.expiresAt && (
                <Detail
                  label={t('ecommerce.settings.storefrontApi.token.expiresAt')}
                  value={formatWhen(token.expiresAt)}
                />
              )}
            </Flex>
          </Box>
        ) : (
          <Flex
            direction="column"
            alignItems="center"
            gap={3}
            padding={6}
            background="neutral100"
            hasRadius
          >
            <Typography variant="omega" textColor="neutral600">
              {t('ecommerce.settings.storefrontApi.token.none')}
            </Typography>
            {actions.generate && (
              <Button
                startIcon={<Key />}
                onClick={() => runTokenAction('generate')}
                loading={tokenBusy}
              >
                {t('ecommerce.settings.storefrontApi.generate')}
              </Button>
            )}
          </Flex>
        )}

        {tokenState.missing && (
          <Notice>{t('ecommerce.settings.storefrontApi.warning.MISSING')}</Notice>
        )}
        {warnings.map((w) => (
          <Notice key={w}>{t(`ecommerce.settings.storefrontApi.warning.${w}`)}</Notice>
        ))}

        {actions.regenerate && (
          <Flex justifyContent="flex-end">
            <Button
              variant="danger-light"
              startIcon={<ArrowClockwise />}
              onClick={() => setConfirmRegenerate(true)}
              loading={tokenBusy}
            >
              {t('ecommerce.settings.storefrontApi.regenerate')}
            </Button>
          </Flex>
        )}
      </Flex>
    );
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Card title={t('ecommerce.settings.storefrontApi.title')}>
        <Typography textColor="neutral600">
          {t('ecommerce.settings.storefrontApi.intro')}
        </Typography>

        {tokenSection()}

        <Field.Root
          name="checkoutSessionTtlHours"
          error={ttlError ? t(`ecommerce.settings.errors.${ttlError}`) : undefined}
          hint={t('ecommerce.settings.storefrontApi.ttl.hint', {
            min: TTL_MIN_HOURS,
            max: TTL_MAX_HOURS,
          })}
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
          <HeaderActions>
            <Button onClick={save} loading={saving}>
              {t('ecommerce.settings.save')}
            </Button>
          </HeaderActions>
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

      <ConfirmModal
        open={confirmRegenerate}
        title={t('ecommerce.settings.storefrontApi.regenerateConfirm.title')}
        text={t('ecommerce.settings.storefrontApi.regenerateConfirm.text')}
        confirm={{
          button: t('ecommerce.settings.storefrontApi.regenerate'),
          action: () => {
            setConfirmRegenerate(false);
            runTokenAction('regenerate');
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirmRegenerate(false),
        }}
      />

      {generated && (
        <StorefrontTokenKeyModal
          accessKey={generated.accessKey}
          previousTokenDeleted={generated.previousTokenDeleted}
          onClose={() => setGenerated(null)}
        />
      )}
    </Flex>
  );
};

export { StorefrontSettings };
