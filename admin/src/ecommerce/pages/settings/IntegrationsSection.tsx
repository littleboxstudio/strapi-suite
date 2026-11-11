import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useNotification } from '@strapi/strapi/admin';
import { Button, Flex, Loader, Typography } from '@strapi/design-system';
import { Link as LinkIcon } from '@strapi/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import { getTranslation } from '../../../core/utils/getTranslation';
import FetchIntegrations from '../../usecases/settings/fetchIntegrations';
import SetIntegrationActive from '../../usecases/settings/setIntegrationActive';
import TestIntegration from '../../usecases/settings/testIntegration';
import { IntegrationCard, type TestState } from '../../components/settings/IntegrationCard';
import { IntegrationConfigModal } from '../../components/settings/IntegrationConfigModal';
import { ManualMethodsTable } from '../../components/settings/ManualMethodsTable';
import StripeWebhookModal from '../../components/settings/StripeWebhookModal';
import { extractFieldErrors } from '../../utils/productForm';
import { extractErrorCode } from '../../utils/settingsForm';
import { integrationErrorMap } from '../../utils/integrationForm';
import type { IntegrationView, ProviderCategory, ShippingZone } from '../../settingsTypes';

type Props = {
  category: ProviderCategory;
  readOnly: boolean;
  /** Carriers only: the shipping zones; a new list (a zone changed) refetches the integrations. */
  zones?: ShippingZone[];
};

/** Stable fallback, so the methods table does not refetch on every render. */
const NO_ZONES: ShippingZone[] = [];

/** Billing allows a single active provider; the server deactivates the others. */
const EXCLUSIVE_CATEGORIES: ProviderCategory[] = ['billing'];

const IntegrationsSection = ({ category, readOnly, zones }: Props) => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const t = (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const [integrations, setIntegrations] = useState<IntegrationView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [toggling, setToggling] = useState<string | null>(null);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [configuring, setConfiguring] = useState<{
    id: string;
    errors?: Record<string, string>;
  } | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<{
    id: string;
    replaced: IntegrationView[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    new FetchIntegrations()
      .execute()
      .then((all) => {
        if (!cancelled) setIntegrations(all.filter((i) => i.category === category));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [category, zones]);

  const providerName = (i: IntegrationView) =>
    t(`ecommerce.settings.providers.${i.id}.name`, undefined, i.name);

  /** Replaces one integration; the server may have deactivated the others, so refetch those. */
  const refresh = async (updated: IntegrationView, othersChanged = false) => {
    setIntegrations((list) => list?.map((i) => (i.id === updated.id ? updated : i)) ?? list);
    if (!othersChanged) return;
    try {
      const all = await new FetchIntegrations().execute();
      setIntegrations(all.filter((i) => i.category === category));
    } catch {
      // The updated card is already right; the others refresh on the next visit.
    }
  };

  const setActive = async (integration: IntegrationView, active: boolean) => {
    setToggling(integration.id);
    try {
      const updated = await new SetIntegrationActive().execute(integration.id, active);
      await refresh(updated, active && EXCLUSIVE_CATEGORIES.includes(category));
      toggleNotification({
        type: 'success',
        message: t(
          active
            ? 'ecommerce.settings.integrations.activated'
            : 'ecommerce.settings.integrations.deactivated',
          { name: providerName(integration) }
        ),
      });
    } catch (err) {
      const fieldErrors = extractFieldErrors(err);
      const code = extractErrorCode(err);
      if (fieldErrors) {
        toggleNotification({
          type: 'warning',
          message: t('ecommerce.settings.integrations.activateMissing'),
        });
        if (integration.fields.length > 0) {
          setConfiguring({ id: integration.id, errors: integrationErrorMap(fieldErrors) });
        }
      } else if (code) {
        toggleNotification({ type: 'danger', message: t(`ecommerce.settings.errors.${code}`) });
      } else {
        toggleNotification({ type: 'danger', message: t('ecommerce.settings.saveError') });
      }
    } finally {
      setToggling(null);
    }
  };

  const onToggleActive = (integration: IntegrationView, active: boolean) => {
    if (readOnly || !integrations) return;
    if (active && EXCLUSIVE_CATEGORIES.includes(category)) {
      const replaced = integrations.filter((i) => i.active && i.id !== integration.id);
      if (replaced.length) {
        setConfirmActivate({ id: integration.id, replaced });
        return;
      }
    }
    setActive(integration, active);
  };

  const runTest = async (id: string) => {
    setTests((s) => ({ ...s, [id]: { status: 'testing' } }));
    try {
      const result = await new TestIntegration().execute(id);
      setTests((s) => ({ ...s, [id]: { status: 'done', result } }));
    } catch {
      setTests((s) => ({ ...s, [id]: { status: 'error' } }));
    }
  };

  if (loadError) {
    return <Typography textColor="danger600">{t('ecommerce.settings.loadError')}</Typography>;
  }

  if (!integrations) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const configured = configuring && integrations.find((i) => i.id === configuring.id);
  const toActivate = confirmActivate && integrations.find((i) => i.id === confirmActivate.id);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      {integrations.length === 0 && (
        <Typography textColor="neutral600">{t('ecommerce.settings.integrations.empty')}</Typography>
      )}
      {integrations.map((integration) => (
        <IntegrationCard
          key={integration.id}
          integration={integration}
          readOnly={readOnly}
          toggling={toggling === integration.id}
          test={tests[integration.id] ?? { status: 'idle' }}
          onConfigure={() => setConfiguring({ id: integration.id })}
          onTest={() => runTest(integration.id)}
          onToggleActive={(active) => onToggleActive(integration, active)}
          extraActions={
            integration.id === 'stripe' ? (
              <Button variant="secondary" startIcon={<LinkIcon />} onClick={() => setWebhookOpen(true)}>
                {t('ecommerce.settings.stripeWebhook.open')}
              </Button>
            ) : undefined
          }
        >
          {integration.id === 'manual' && (
            <ManualMethodsTable readOnly={readOnly} zones={zones ?? NO_ZONES} />
          )}
        </IntegrationCard>
      ))}

      {configured && !readOnly && (
        <IntegrationConfigModal
          integration={configured}
          initialErrors={configuring?.errors}
          zones={zones}
          onClose={() => setConfiguring(null)}
          onChanged={(saved) => {
            refresh(saved);
            setTests((s) => ({ ...s, [saved.id]: { status: 'idle' } }));
          }}
          onSaved={(saved) => {
            setConfiguring(null);
            refresh(saved);
            // Saved credentials invalidate the previous test result.
            setTests((s) => ({ ...s, [saved.id]: { status: 'idle' } }));
          }}
        />
      )}

      {webhookOpen && <StripeWebhookModal onClose={() => setWebhookOpen(false)} />}

      <ConfirmModal
        open={!!toActivate}
        title={t('ecommerce.settings.integrations.replaceConfirm.title')}
        text={
          toActivate && confirmActivate
            ? t('ecommerce.settings.integrations.replaceConfirm.text', {
                name: providerName(toActivate),
                replaced: confirmActivate.replaced.map(providerName).join(', '),
              })
            : ''
        }
        confirm={{
          button: t('ecommerce.settings.integrations.replaceConfirm.confirm'),
          action: () => {
            if (toActivate) setActive(toActivate, true);
            setConfirmActivate(null);
          },
        }}
        cancel={{
          button: t('ecommerce.settings.cancel'),
          action: () => setConfirmActivate(null),
        }}
      />
    </Flex>
  );
};

export { IntegrationsSection };
